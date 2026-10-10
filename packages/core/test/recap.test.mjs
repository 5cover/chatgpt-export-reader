import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import {
  buildRecap,
  createRecapPrompt,
  serializeRecapYaml,
} from "../dist/index.js";

const at = (day, hour = 0, minute = 0) => Date.UTC(2026, 0, day, hour, minute);
const message = (id, role, body, createTime, children = []) => ({
  id,
  role,
  body,
  weight: 1,
  createTime,
  children,
});
const chat = (id, messages) => ({
  id,
  title: `${id} title`,
  createTime: at(1),
  updateTime: at(1),
  messages,
  isArchived: false,
});

test("recap uses inclusive local date boundaries and resolves a missing end date", () => {
  const source = [
    chat("one", [
      message("old", "user", "before", at(1, 22)),
      message("first", "user", "included first", at(2)),
      message("last", "assistant", "included last", at(3, 23)),
    ]),
  ];
  const recap = buildRecap(source, {
    timeZone: "Europe/Paris",
    startDate: "2026-01-02",
  });

  assert.deepEqual(recap.selection.resolvedDateRange, {
    startDate: "2026-01-02",
    endDate: "2026-01-04",
  });
  assert.equal(recap.analytics.summary.messages, 2);
  assert.deepEqual(recap.conversations[0].messages.map(value => value.id), ["first", "last"]);
  assert.equal(recap.conversations[0].preWindowContext.length, 1);
});

test("recap validates dates and excludes context from statistics", () => {
  const source = [chat("one", [message("old", "user", "old words", at(1)), message("new", "assistant", "new output", at(2))])];
  assert.throws(
    () => buildRecap(source, { startDate: "2026-02-30" }),
    /Invalid start date/,
  );
  assert.throws(
    () => buildRecap(source, { startDate: "2026-01-03", endDate: "2026-01-02" }),
    /startDate must be on or before endDate/,
  );
  const recap = buildRecap(source, { startDate: "2026-01-02", endDate: "2026-01-02" });
  assert.equal(recap.analytics.summary.input.words, 0);
  assert.equal(recap.analytics.summary.output.words, 2);
  assert.equal(recap.conversations[0].preWindowContext[0].id, "old");
});

test("rolling context preserves branches, applies independent budgets, and marks omissions", () => {
  const branch = message("root", "user", "root", at(1), [
    message("left", "assistant", "left", at(2)),
    message("right", "assistant", "right", at(3)),
  ]);
  const source = [
    chat("one", [
      branch,
      message("near", "user", "near", at(4)),
      message("selected", "assistant", "selected", at(5)),
      message("untimed", "user", "not placed"),
    ]),
    chat("two", [message("two-old", "user", "two old", at(1)), message("two-selected", "user", "two selected", at(5))]),
  ];
  const recap = buildRecap(source, {
    startDate: "2026-01-05",
    endDate: "2026-01-05",
    context: { strategy: "rolling-window", maxMessages: 2 },
  });
  const one = recap.conversations.find(value => value.id === "one");
  const two = recap.conversations.find(value => value.id === "two");
  assert.equal(one.omittedUntimestampedMessages, 1);
  assert.equal(one.preWindowContext[1].kind, "omission");
  assert.equal(one.messages[0].parentId, "");
  assert.equal(one.messages[0].branchPath, "3");
  assert.equal(two.preWindowContext.length, 1);
});

test("YAML is parseable, timestamped locally, and prompt styles remain separate", () => {
  const source = [chat("one", [message("one", "assistant", "first line\nsecond line", Date.UTC(2026, 9, 11, 8, 30))])];
  source[0].messages[0].thoughts = [{ summary: "plan", content: "reasoning", chunks: ["reasoning"] }];
  const recap = buildRecap(source, { timeZone: "Europe/Paris" });
  const yaml = serializeRecapYaml(recap);
  const parsed = parse(yaml);
  assert.equal(parsed.schema, "chatgpt-export-reader/recap/v1");
  assert.match(yaml, /text: \|-\n/);
  assert.match(yaml, /sun 2026-10-11T10:30\+02:00/);
  assert.equal(yaml.includes("null"), false);
  assert.match(createRecapPrompt("playful"), /awards-and-highlights/);
  assert.throws(() => createRecapPrompt("unknown"), /unknown recap prompt style/);
});
