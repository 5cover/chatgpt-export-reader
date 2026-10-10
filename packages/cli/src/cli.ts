import { Command } from "@commander-js/extra-typings";
import type {
  RecapContextStrategy,
  RecapPromptStyle,
} from "@chatgpt-export-reader/core";
import { createWriteStream } from "fs";
import { stat } from "fs/promises";
import { stdout } from "process";
import type { Writable } from "stream";
import trifall from "./input/trifall.js";
import v1 from "./input/v1.js";
import type { Chat, Exporter, Input, OutputFormat } from "./types.js";
import FilesystemExporter from "./output/exporters/filesystem.js";
import FlatExporter from "./output/exporters/flat.js";
import JsonArtifactExporter from "./output/exporters/json.js";
import JsonOutput from "./output/formats/json.js";
import MarkdownOutput from "./output/formats/markdown.js";
import PromptOutput from "./output/formats/prompt.js";
import RecapOutput from "./output/formats/recap.js";
import StatsOutput from "./output/formats/stats.js";

const inputFormats = [
  {
    name: "v1",
    desc: "OpenAI ChatGPT export parser for conversations*.json files.",
    input: v1,
  },
  {
    name: "trifall",
    desc: "Trifall chat-export JSON format from https://github.com/Trifall/chat-export/.",
    input: trifall,
  },
] as const satisfies readonly { name: string; desc: string; input: Input }[];

const outputFormats = [
  {
    name: "markdown",
    desc: "Render chats into branch-aware Markdown documents.",
    create: () => new MarkdownOutput(),
  },
  {
    name: "json",
    desc: "Render each chat as a JSON string artifact keyed by chat ID.",
    create: () => new JsonOutput(),
  },
  {
    name: "prompt",
    desc: "Render chats as prompt-style transcripts with configurable role prefixes.",
    create: () => new PromptOutput(),
  },
  {
    name: "stats",
    desc: "Generate usage statistics as JSON, CSV, and SVG chart artifacts.",
    create: () => new StatsOutput(),
  },
  {
    name: "recap",
    desc: "Generate editable recap evidence YAML and an LLM prompt.",
    create: (options) =>
      new RecapOutput({
        timeZone: options.timeZone,
        startDate: options.startDate,
        endDate: options.endDate,
        sessionGapMinutes: numberOption(
          options.sessionGapMinutes,
          "--session-gap-minutes",
        ),
        context: {
          strategy: recapStrategy(options.contextStrategy),
          maxMessages: recapContextMessages(options.contextMessages),
        },
        promptStyle: recapStyle(options.recapStyle),
      }),
  },
] as const satisfies readonly {
  name: string;
  desc: string;
  create: (options: OutputOptions) => OutputFormat;
}[];

type OutputOptions = {
  timeZone?: string;
  startDate?: string;
  endDate?: string;
  sessionGapMinutes?: string;
  contextStrategy?: string;
  contextMessages?: string;
  recapStyle?: string;
};

const exportFormats = [
  {
    name: "filesystem",
    desc: "Write artifacts to the filesystem as directories or a single file.",
    create: (options: { fsPath?: string; streamFile: string }) => {
      if (!options.fsPath)
        throw new Error("--fs-path is required for the filesystem exporter");
      return new FilesystemExporter({ path: options.fsPath });
    },
  },
  {
    name: "flat",
    desc: "Write flattened artifact contents to a stream separated by blank lines.",
    create: (options: { fsPath?: string; streamFile: string }) =>
      new FlatExporter({ stream: openStream(options.streamFile) }),
  },
  {
    name: "json",
    desc: "Write the full artifact tree as JSON to a stream.",
    create: (options: { fsPath?: string; streamFile: string }) =>
      new JsonArtifactExporter({ stream: openStream(options.streamFile) }),
  },
] as const satisfies readonly {
  name: string;
  desc: string;
  create: (options: { fsPath?: string; streamFile: string }) => Exporter;
}[];

const program = new Command();

program
  .name("chatgpt-export-reader")
  .description("Turn ChatGPT exports into markdown, prompt, or JSON artifacts.")
  .argument("[input-path]", "Input export file or directory")
  .option("-i, --input-format <name>", "Input format", "v1")
  .option("-o, --output-format <name>", "Output format", "markdown")
  .option("-e, --export-format <name>", "Export format", "flat")
  .option("--input-formats", "List available input formats")
  .option("--output-formats", "List available output formats")
  .option("--export-formats", "List available export formats")
  .option(
    "-c, --chat <uuid>",
    "Keep only specific chat IDs",
    collect,
    [] as string[],
  )
  .option("--fs-path <path>", "Filesystem exporter destination path")
  .option("--start-date <YYYY-MM-DD>", "Inclusive recap start date in the selected timezone")
  .option("--end-date <YYYY-MM-DD>", "Inclusive recap end date in the selected timezone")
  .option("--time-zone <iana-zone>", "Recap timezone", "UTC")
  .option("--session-gap-minutes <number>", "Minutes separating observed recap sessions")
  .option("--context-strategy <full|rolling-window>", "Pre-window context strategy", "rolling-window")
  .option("--context-messages <number>", "Maximum preceding messages per conversation", "20")
  .option("--recap-style <name>", "Prompt style: narrative, reflective, or playful", "narrative")
  .option(
    "--stream-file <path|->",
    "Stream exporter destination, use - for stdout",
    "-",
  )
  .showHelpAfterError()
  .action(async (input, options) => {
    if (options.inputFormats) {
      printFormats("Input formats", inputFormats);
      return;
    }
    if (options.outputFormats) {
      printFormats("Output formats", outputFormats);
      return;
    }
    if (options.exportFormats) {
      printFormats("Export formats", exportFormats);
      return;
    }
    if (!input)
      throw new Error(
        "input-path is required unless a --*-formats flag is used",
      );

    const inputF = getInputFormat(options.inputFormat);
    const outputF = getOutputFormat(options.outputFormat, options);
    const exportF = createExporter(options.exportFormat, {
      fsPath: options.fsPath,
      streamFile: options.streamFile,
    });
    const selectedChats = new Set(options.chat);
    const artifacts = await outputF.render(
      filterChats(readInput(inputF, input), selectedChats),
    );
    if (selectedChats.size && artifacts.size === 0) {
      throw new Error(
        `no chats matched requested IDs: ${[...selectedChats].join(", ")}`,
      );
    }
    await exportF.export(artifacts);
  })
  .parse();

function getInputFormat(name: string): Input {
  const format = inputFormats.find((format) => format.name === name);
  if (!format) throw new Error(`unknown input format: ${name}`);
  return format.input;
}

function getOutputFormat(name: string, options?: OutputOptions): OutputFormat {
  const format = outputFormats.find((format) => format.name === name);
  if (!format) throw new Error(`unknown output format: ${name}`);
  return format.create(options ?? {});
}

function createExporter(
  name: string,
  options: {
    fsPath?: string;
    streamFile: string;
  },
): Exporter {
  const format = exportFormats.find((format) => format.name === name);
  if (!format) throw new Error(`unknown export format: ${name}`);
  return format.create(options);
}

async function* readInput(input: Input, path: string): AsyncGenerator<Chat> {
  const info = await stat(path);
  if (info.isDirectory()) {
    yield* input.parse(path);
    return;
  }
  yield* input.parseFile(path);
}

async function* filterChats(
  chats: AsyncIterable<Chat>,
  ids: ReadonlySet<string>,
): AsyncGenerator<Chat> {
  for await (const chat of chats) {
    if (ids.size && !ids.has(chat.id)) continue;
    yield chat;
  }
}

function openStream(path: string): Writable {
  if (path === "-") return stdout;
  return createWriteStream(path, { encoding: "utf8" });
}

function collect(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

function numberOption(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error(`${option} must be a number.`);
  return Number(value);
}

function recapStrategy(value: string | undefined): RecapContextStrategy | undefined {
  if (value === undefined || value === "full" || value === "rolling-window")
    return value;
  throw new Error(`unknown context strategy: ${value}`);
}

function recapStyle(value: string | undefined): RecapPromptStyle | undefined {
  if (
    value === undefined ||
    value === "narrative" ||
    value === "reflective" ||
    value === "playful"
  )
    return value;
  throw new Error(`unknown recap style: ${value}`);
}

function recapContextMessages(value: string | undefined): number | undefined {
  const number = numberOption(value, "--context-messages");
  if (number === undefined) return undefined;
  if (!Number.isInteger(number) || number < 0)
    throw new Error("--context-messages must be a non-negative integer.");
  return number;
}

function printFormats(
  title: string,
  formats: readonly { name: string; desc: string }[],
) {
  console.log(title);
  for (const format of formats) {
    console.log(`- ${format.name}: ${format.desc}`);
  }
}
