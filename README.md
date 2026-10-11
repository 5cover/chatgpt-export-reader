# ChatGPT Export Reader

Turns ChatGPT data exports into Markdown documents for easy browsing.

## Usage statistics

Generate a self-contained usage-report directory from a ChatGPT export:

```sh
pnpm build
node packages/cli/dist/cli.js stats conversations.json --export-format filesystem --fs-path out/stats
```

The report contains `stats.json`, CSV tables for daily and role counts, and an SVG line chart of daily message and user-prompt activity. Daily data uses UTC and includes every calendar day from the first timestamped message to the last.

## Conversation recap

Generate two editable recap artifacts from a filesystem export: `recap-context.yaml` contains the selected evidence and computed statistics, while `recap-prompt.md` contains the prompt for a consuming model.

```sh
pnpm build
node packages/cli/dist/cli.js recap exports/conversations.json \
  --export-format filesystem \
  --fs-path out/recap \
  --time-zone Europe/Paris \
  --start-date 2026-01-01 \
  --end-date 2026-03-31 \
  --context-strategy rolling-window \
  --context-messages 20 \
  --recap-style reflective
```

`--context-strategy full` includes all preceding timestamped messages for each included conversation. `rolling-window` is the default and includes a per-conversation budget split between the start of the conversation and messages directly before the selected range. Prompt styles are `narrative`, `reflective`, and `playful`.

YAML is the default context format. Use `--context-format toon` to write `recap-context.toon` instead, then compare separate runs with `wc -c out/recap-yaml/recap-context.yaml out/recap-toon/recap-context.toon`. TOON can reduce structural overhead for regular arrays, but it is not guaranteed to be smaller for every recap.

Run `node packages/cli/dist/cli.js --help` for rendering subcommands and `node packages/cli/dist/cli.js formats` for supported input and artifact export formats.

## Usage dashboard

The browser dashboard is a local-only companion for investigating usage spikes. It accepts the folder extracted from a ChatGPT export, discovers every `conversations*.json` file, and processes it in a Web Worker. Raw export data is never uploaded or persisted by the site.

```sh
pnpm install
pnpm --filter @chatgpt-export-reader/dashboard dev
```

Vite prints the local URL, normally `http://localhost:5173/`. Open it, choose the folder extracted from a ChatGPT export, and select the `conversations*.json` files through the folder picker. The importer ignores the remaining assets and processes data only in the browser.

To test the production build locally:

```sh
pnpm build:dashboard
pnpm --filter @chatgpt-export-reader/dashboard preview
```

It provides local text-volume analytics, daily and temporal-rhythm views, configurable observed sessions, concentration rankings, and a paginated conversation evidence explorer with literal search and on-demand message text. The static dashboard deploys to GitHub Pages on pushes to `main`.

## Step 3

- Max label size configurable (default 50)
- Clean CLI (commander + commander extra typings)
- Customize message parsing (hardcoded codeblock backticks, etc... what if user configured answers in asciidoc? user should be able to provide a response body parser that turns it into markdown ast (using markdown builder optionally))
- Images

## Step 2

- Debug singleton array problem with chat.json : multiple root messages?
- Archived projects
- Projects? see gizmo_id/conversation_template_id (seem to always sync, use conversation_template_id). that gets us the ID, but where is the project label

## ~~Step 1~~

- streaming JSON array parse (multiple chats)
- increment Markdown headings to match output document hierarcy

converting a chat tree to markdown files:

what do we do when we hit multiple children?
multiple files with continuation point

Title.md

```md
## 1. Assistant

Message 1

Branches:

[Child message 2](./Title.Child message 2.md)
[Child message 3](./Title.Child message 3.md)

## 2. User

Child message 1
```

Title.Child message 2.md

```md
# Title > Child message 2..

[Source](<./Title.md#1. assistant>)

Message 1

## 1.1 Assistant

## 1.2
```

Create branch-off file only if child message also has children

algorithm:

- walk tree of messages
- keep longest branch in current file
- create new files for other branches

how do we return the documents?
we return
Document = { title: string, messages: Message[], branches: Document[] }

## ~~Step 0~~

Extract one chat object.

Infer facts schema structure in a strategy object (in case current schema changed today, map data requests -> how to get it in the schema)

- metadata in keys
- messages stored in the `mapping` key, keyed by UUID
- special `client-created-root` key contains the first message
- there is bidirectional parent/children tree, but we can just walk `children`
- message object contains message data in a `message` key
- role in `message.author.role`
- create_time in `message.create_time`, update_time also known but likely not relevant and oftne null
- `message.metadata.is_visually_hidden_from_conversation`
- content in `message.content.parts` array (only support `message.content.content_type` = `"text"` for v0). Mutliple elements not observed. Error if not singleton. Concatenate content. If empty string, skip the message.
- there is one message where `message.content.content_type` = `"user_editable_context"`, with a `user_instriction` keys containing the custom instructions block. (duplicated in `message.metadata.user_context_message_data` but we don't need that here)
- there is also `weight` which seems to be always 0 or 1. Include it in the result, in case we get something interesting

Algorithm:

- read chat object
- read root message
- when finding user_editable_context (custom prompt), add it to the beginning

1. parse chat object with zod
2. convert to IR message
3. export to markdown files

Difficulty converting schema msg mapping to my recursive message format.
since some mesage contain userInstructions, other contain text
an iterative non recurisve approach.

Basically

- Input: flat array of Message[]. content may be null (bubble children up), user_editable_text (set userInstructions)
- Output: { message: my.Message, userInstructions: string | null, }

Objective :

- Stream the conversations.json file, convert every chat into a readable markdown-based representation
- Problem : chats are trees. Map to file system trees? Problem, some tree branches are tiny, others are huge. Instead, minimize switch points. Make a file for the longest brnach, then brnach off into another file, etc with relative links to not get lost.

For instance :

```mermaid
flowchart TD
A --> B --> C
B --> D --> E
```

Result:

Chat Title.md

```md
# title

id
create_time
update_time

user_editable_context

## 1. Role

Timestamp

$$
A
$$

## 2. Role@Timestamp

### Body

C

### Branches

## C
```
