import assert from "node:assert/strict";
import test from "node:test";
import { UsageStatsAccumulator } from "../dist/usage-stats.js";

const at = (year, month, day, hour = 12) =>
  Date.UTC(year, month - 1, day, hour);

test("a cutoff excludes earlier and untimestamped messages from every aggregate", () => {
  const accumulator = new UsageStatsAccumulator({
    timeZone: "UTC",
    startDate: "2025-01-01",
  });
  accumulator.addConversation({
    id: "before",
    title: "Before the cutoff",
    messages: [
      { role: "user", createTime: at(2024, 12, 31) },
      { role: "assistant" },
    ],
  });
  accumulator.addConversation({
    id: "spanning",
    title: "Across the cutoff",
    messages: [
      { role: "user", createTime: at(2024, 12, 31) },
      { role: "user", createTime: at(2025, 1, 1) },
      { role: "assistant", createTime: at(2025, 1, 2) },
      { role: "assistant" },
    ],
  });

  const statistics = accumulator.finish();
  assert.equal(statistics.summary.chats, 1);
  assert.equal(statistics.summary.messages, 2);
  assert.equal(statistics.summary.prompts, 1);
  assert.equal(statistics.summary.untimestampedMessages, 0);
  assert.deepEqual(
    statistics.days.map((day) => [day.date, day.messages]),
    [
      ["2025-01-01", 1],
      ["2025-01-02", 1],
    ],
  );
  assert.deepEqual(
    statistics.conversations.map((chat) => [
      chat.id,
      chat.messages,
      chat.lifetimeMs,
    ]),
    [["spanning", 2, 86_400_000]],
  );
});

test("unfiltered aggregates retain untimestamped messages and empty conversations", () => {
  const accumulator = new UsageStatsAccumulator("UTC");
  accumulator.addConversation({ id: "empty", title: "Empty", messages: [] });
  accumulator.addConversation({
    id: "mixed",
    title: "Mixed",
    messages: [
      { role: "user" },
      { role: "assistant", createTime: at(2024, 12, 31) },
    ],
  });

  const statistics = accumulator.finish();
  assert.equal(statistics.summary.chats, 2);
  assert.equal(statistics.summary.messages, 2);
  assert.equal(statistics.summary.untimestampedMessages, 1);
  assert.deepEqual(
    statistics.conversations.map((chat) => chat.id),
    ["mixed", "empty"],
  );
});

test("the cutoff uses the supplied calendar timezone", () => {
  const message = { role: "user", createTime: at(2025, 1, 1, 0) };
  const utc = new UsageStatsAccumulator({
    timeZone: "UTC",
    startDate: "2025-01-01",
  });
  const losAngeles = new UsageStatsAccumulator({
    timeZone: "America/Los_Angeles",
    startDate: "2025-01-01",
  });
  utc.addConversation({
    id: "chat",
    title: "Timezone boundary",
    messages: [message],
  });
  losAngeles.addConversation({
    id: "chat",
    title: "Timezone boundary",
    messages: [message],
  });

  assert.equal(utc.finish().summary.messages, 1);
  assert.equal(losAngeles.finish().summary.messages, 0);
});

test("invalid cutoff dates are rejected", () => {
  assert.throws(
    () => new UsageStatsAccumulator({ startDate: "2025-02-30" }),
    /Invalid start date/,
  );
  assert.throws(
    () => new UsageStatsAccumulator({ startDate: "2025/01/01" }),
    /Invalid start date/,
  );
});
