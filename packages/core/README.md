# @chatgpt-export-reader/core

Browser-safe primitives for normalizing ChatGPT v1 conversation records and calculating usage statistics. It has no Node filesystem or stream dependencies.

```ts
import { normalizeV1Chat, UsageStatsAccumulator } from '@chatgpt-export-reader/core'

const accumulator = new UsageStatsAccumulator('UTC')
accumulator.addChat(normalizeV1Chat(rawConversation))
const statistics = accumulator.finish()
```

`normalizeV1Chat` accepts one raw entry from a `conversations*.json` array. Consumers choose their own file and JSON streaming layer; this makes the package usable from Node, browsers, and Workers.
