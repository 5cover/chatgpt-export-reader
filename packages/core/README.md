# @chatgpt-export-reader/core

Browser-safe primitives for normalizing ChatGPT v1 conversation records and calculating usage statistics. It has no Node filesystem or stream dependencies.

```ts
import { normalizeV1Chat, UsageStatsAccumulator } from '@chatgpt-export-reader/core'

const accumulator = new UsageStatsAccumulator('UTC')
accumulator.addChat(normalizeV1Chat(rawConversation))
const statistics = accumulator.finish()
```

`normalizeV1Chat` accepts one raw entry from a `conversations*.json` array. Consumers choose their own file and JSON streaming layer; this makes the package usable from Node, browsers, and Workers.

Pass an options object to group days in a timezone and exclude earlier messages. The cutoff is inclusive and uses that timezone's calendar days. When a cutoff is set, messages without valid timestamps are excluded because they cannot be placed in the range.

```ts
const accumulator = new UsageStatsAccumulator({
    timeZone: 'Europe/Paris',
    startDate: '2025-01-01',
})
```

For text-volume, temporal, and session analytics, use `collectAnalytics`. It counts literal normalized message bodies locally, separates user input from assistant output, and returns daily, weekday-hour, conversation, and observed-session aggregates.

```ts
import { collectAnalytics } from '@chatgpt-export-reader/core'

const analytics = collectAnalytics(chats, {
    timeZone: 'Europe/Paris',
    sessionGapMinutes: 60,
})
```
