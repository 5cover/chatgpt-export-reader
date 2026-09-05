import assert from "node:assert/strict";
import test from "node:test";
import {
  collectAnalytics,
  collectConversationDetail,
  collectRepeatedPhrases,
  collectTemporalMessageSlice,
  findConversationTurns,
  getMessageContents,
} from "../dist/analytics.js";

const at = (hour, minute = 0) => Date.UTC(2025, 0, 1, hour, minute);
const message = (id, role, body, createTime) => ({
  id,
  role,
  body,
  weight: 1,
  createTime,
  children: [],
});
const chat = (id, messages) => ({
  id,
  title: id,
  createTime: at(0),
  updateTime: at(0),
  messages,
  isArchived: false,
});

test("analytics counts user and assistant text separately and splits sessions by the configured gap", () => {
  const value = collectAnalytics(
    [
      chat("one", [
        message("u1", "user", "Hello, world! café", at(9)),
        message("a1", "assistant", "A short response.", at(9, 30)),
        message("u2", "user", "Second session", at(10, 31)),
      ]),
    ],
    { timeZone: "UTC", sessionGapMinutes: 60 },
  );

  assert.equal(value.summary.prompts, 2);
  assert.equal(value.summary.input.words, 5);
  assert.equal(value.summary.output.words, 3);
  assert.equal(
    value.summary.input.characters,
    "Hello, world! café".length + "Second session".length,
  );
  assert.equal(value.summary.sessions, 2);
  assert.deepEqual(
    value.sessions.map((session) => session.prompts),
    [1, 1],
  );
});

test("analytics cutoff excludes pre-range and untimestamped text from filtered analysis", () => {
  const value = collectAnalytics(
    [
      chat("one", [
        message("old", "user", "old words", Date.UTC(2024, 11, 31, 23)),
        message("unknown", "assistant", "unplaced output"),
        message("new", "assistant", "new output words", at(1)),
      ]),
    ],
    { timeZone: "UTC", startDate: "2025-01-01" },
  );

  assert.equal(value.summary.messages, 1);
  assert.equal(value.summary.input.words, 0);
  assert.equal(value.summary.output.words, 3);
  assert.deepEqual(
    value.days.map((day) => day.date),
    ["2025-01-01"],
  );
});

test("repeated phrases are role-separated, word-aligned, and do not cross messages", () => {
  const value = collectRepeatedPhrases(
    [
      chat("one", [
        message(
          "u1",
          "user",
          "Build a better plan, build a better plan.",
          at(9),
        ),
        message("u2", "user", "Build a better plan.", at(10)),
        message("u3", "user", "boundary words", at(11)),
        message("u4", "user", "words should not join", at(12)),
        message("a1", "assistant", "A different repeated phrase.", at(13)),
        message("a2", "assistant", "A different repeated phrase!", at(14)),
      ]),
    ],
    { timeZone: "UTC" },
  );

  assert.deepEqual(value.user[0], {
    phrase: "Build a better plan",
    occurrences: 3,
    words: 4,
    score: 12,
  });
  assert.equal(
    value.user.some((phrase) => phrase.phrase === "Build a better"),
    false,
  );
  assert.deepEqual(value.assistant[0], {
    phrase: "A different repeated phrase",
    occurrences: 2,
    words: 4,
    score: 8,
  });
  assert.equal(
    value.user.some((phrase) =>
      phrase.phrase.includes("boundary words should"),
    ),
    false,
  );
});

test("repeated phrases retain shorter sequences only when they occur in additional places and respect cutoffs", () => {
  const source = [
    chat("one", [
      message(
        "old",
        "user",
        "shared phrase extra shared phrase extra",
        Date.UTC(2024, 11, 31, 23),
      ),
      message("new1", "user", "shared phrase extra", at(9)),
      message("new2", "user", "shared phrase", at(10)),
      message("new3", "user", "shared phrase", at(11)),
    ]),
  ];
  const all = collectRepeatedPhrases(source, { timeZone: "UTC" });
  const filtered = collectRepeatedPhrases(source, {
    timeZone: "UTC",
    startDate: "2025-01-01",
  });

  assert.equal(
    all.user.some((phrase) => phrase.phrase === "shared phrase extra"),
    true,
  );
  assert.deepEqual(filtered.user[0], {
    phrase: "shared phrase",
    occurrences: 3,
    words: 2,
    score: 6,
  });
  assert.equal(
    filtered.user.some((phrase) => phrase.phrase === "shared phrase extra"),
    false,
  );
});

test("conversation evidence pages literal previews and returns bodies only for selected IDs", () => {
  const source = [
    chat("one", [
      message("u1", "user", "Find the important phrase here", at(9)),
      message(
        "a1",
        "assistant",
        "This is the full generated response.",
        at(9, 2),
      ),
    ]),
  ];
  const detail = collectConversationDetail(source, { timeZone: "UTC" });
  const page = findConversationTurns(
    source,
    { timeZone: "UTC" },
    0,
    50,
    "important",
  );

  assert.equal(detail?.totalTurns, 2);
  assert.equal(page.total, 1);
  assert.match(page.turns[0].preview, /important phrase/);
  assert.equal(
    getMessageContents(source, { timeZone: "UTC" }, [page.turns[0].id])[0].body,
    "Find the important phrase here",
  );
});

test("temporal message slices filter by local weekday, hour, role, and cutoff", () => {
  const source = [
    chat("one", [
      message("old", "user", "before cutoff", Date.UTC(2024, 11, 25, 3)),
      message("u1", "user", "Wednesday at four", Date.UTC(2025, 0, 1, 3)),
      message(
        "a1",
        "assistant",
        "Assistant at four",
        Date.UTC(2025, 0, 1, 3, 5),
      ),
      message("u2", "user", "Thursday at four", Date.UTC(2025, 0, 2, 3)),
      message("u3", "user", "Thursday at five", Date.UTC(2025, 0, 2, 4)),
      message("unknown", "user", "No timestamp"),
    ]),
  ];

  const exact = collectTemporalMessageSlice(
    source,
    { timeZone: "Europe/Paris", startDate: "2025-01-01" },
    { role: "user", weekday: 3, hour: 4 },
  );
  const everyWeekday = collectTemporalMessageSlice(
    source,
    { timeZone: "Europe/Paris", startDate: "2025-01-01" },
    { role: "user", hour: 4 },
  );
  const assistant = collectTemporalMessageSlice(
    source,
    { timeZone: "Europe/Paris", startDate: "2025-01-01" },
    { role: "assistant", hour: 4 },
  );

  assert.deepEqual(
    exact.messages.map((entry) => entry.body),
    ["Wednesday at four"],
  );
  assert.deepEqual(
    everyWeekday.messages.map((entry) => entry.body),
    ["Thursday at four", "Wednesday at four"],
  );
  assert.deepEqual(
    assistant.messages.map((entry) => entry.body),
    ["Assistant at four"],
  );
});

test("temporal message slices aggregate conversations and validate filters", () => {
  const source = [
    chat("one", [
      message("u1", "user", "first matching prompt", at(4)),
      message("u2", "user", "second matching prompt", at(4, 30)),
    ]),
    chat("two", [message("u3", "user", "another chat", at(4, 45))]),
  ];
  const value = collectTemporalMessageSlice(
    source,
    { timeZone: "UTC" },
    { role: "user", hour: 4 },
  );

  assert.equal(value.messages.length, 3);
  assert.deepEqual(value.summary, {
    messages: 3,
    conversations: 2,
    activeDays: 1,
    text: { characters: 55, words: 8 },
  });
  assert.deepEqual(
    value.messages.map((entry) => entry.body),
    ["another chat", "second matching prompt", "first matching prompt"],
  );
  assert.deepEqual(value.conversations[0], {
    id: "one",
    title: "one",
    messages: 2,
    text: { characters: 43, words: 6 },
    activeDays: 1,
    firstMessageAt: new Date(at(4)).toISOString(),
    lastMessageAt: new Date(at(4, 30)).toISOString(),
  });
  assert.throws(
    () =>
      collectTemporalMessageSlice(
        source,
        { timeZone: "UTC" },
        {
          role: "user",
          hour: 24,
        },
      ),
    /hour must be an integer between 0 and 23/,
  );
  assert.throws(
    () =>
      collectTemporalMessageSlice(
        source,
        { timeZone: "UTC" },
        {
          role: "user",
          weekday: -1,
          hour: 4,
        },
      ),
    /weekday must be an integer between 0 and 6/,
  );
  assert.throws(
    () =>
      collectTemporalMessageSlice(
        source,
        { timeZone: "UTC" },
        {
          role: "system",
          hour: 4,
        },
      ),
    /role must be "user" or "assistant"/,
  );
});

test("analytics rejects invalid cutoff dates", () => {
  assert.throws(
    () => collectAnalytics([], { startDate: "2025-02-30" }),
    /Invalid start date/,
  );
});
