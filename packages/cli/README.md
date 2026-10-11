# ChatGPT Export Reader

Turn a ChatGPT data export into Markdown documents, JSON artifacts, prompt-style
transcripts, usage statistics, or recap evidence for an LLM.

## Install

```sh
npm install --global chatgpt-export-reader
```

The CLI requires Node.js 20 or later.

## Usage

Render conversations into branch-aware Markdown files:

```sh
chatgpt-export-reader markdown conversations.json \
  --export-format filesystem \
  --fs-path out/markdown
```

Generate usage statistics as JSON, CSV, and SVG artifacts:

```sh
chatgpt-export-reader stats conversations.json \
  --export-format filesystem \
  --fs-path out/stats
```

Generate recap context and an LLM prompt for a date range:

```sh
chatgpt-export-reader recap conversations.json \
  --export-format filesystem \
  --fs-path out/recap \
  --time-zone Europe/Paris \
  --start-date 2026-01-01 \
  --end-date 2026-03-31
```

Run `chatgpt-export-reader --help` to list commands and options. Run
`chatgpt-export-reader formats` to list supported input and artifact formats.

## Privacy

The CLI processes the export file locally. It does not upload conversation data.

## License

[MIT](LICENSE)
