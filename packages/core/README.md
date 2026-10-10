# @chatgpt-export-reader/core

Browser-safe primitives for normalizing ChatGPT v1 conversation records and calculating usage statistics. It has no Node filesystem or stream dependencies.

```ts
import {
  normalizeV1Chat,
  UsageStatsAccumulator,
} from "@chatgpt-export-reader/core";

const accumulator = new UsageStatsAccumulator("UTC");
accumulator.addChat(normalizeV1Chat(rawConversation));
const statistics = accumulator.finish(); 
```

`normalizeV1Chat` accepts one raw entry from a `conversations*.json` array. Consumers choose their own file and JSON streaming layer; this makes the package usable from Node, browsers, and Workers.

Pass an options object to group days in a timezone and exclude earlier messages. The cutoff is inclusive and uses that timezone's calendar days. When a cutoff is set, messages without valid timestamps are excluded because they cannot be placed in the range.

```ts
const accumulator = new UsageStatsAccumulator({
  timeZone: "Europe/Paris",
  startDate: "2025-01-01",
});
```

For text-volume, temporal, and session analytics, use `collectAnalytics`. It counts literal normalized message bodies locally, separates user input from assistant output, and returns daily, weekday-hour, conversation, and observed-session aggregates.

```ts
import { collectAnalytics } from "@chatgpt-export-reader/core";

const analytics = collectAnalytics(chats, {
  timeZone: "Europe/Paris",
  sessionGapMinutes: 60,
});
```

`endDate` is also inclusive. Analytics validates both calendar dates and rejects a reversed range.

Use `collectTemporalMessageSlice` to inspect the user or assistant messages behind a weekday-hour aggregate. Omit `weekday` to match that hour on every day. The result includes conversation rollups and matching message evidence; paginate the `messages` array before sending large slices across a process or Worker boundary.

```ts
import { collectTemporalMessageSlice } from "@chatgpt-export-reader/core";

const slice = collectTemporalMessageSlice(
  chats,
  { timeZone: "Europe/Paris", startDate: "2025-01-01" },
  { role: "user", weekday: 0, hour: 4 },
);
```

## Recaps

`buildRecap` creates a portable evidence document for an LLM recap. It keeps the selected range separate from optional preceding context, so its analytics never include context messages.

```ts
import { buildRecap, createRecapPrompt, serializeRecapYaml } from "@chatgpt-export-reader/core";

const recap = buildRecap(chats, {
  timeZone: "Europe/Paris",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  context: { strategy: "rolling-window", maxMessages: 20 },
});

const contextYaml = serializeRecapYaml(recap);
const prompt = createRecapPrompt("reflective");
```

Use `context.strategy: "full"` when every earlier timestamped message in each included conversation is needed. The default `rolling-window` mode preserves the beginning and the messages immediately before the range, with explicit omission markers. Untimestamped messages are not placed in recap evidence and are counted in each conversation's metadata.
