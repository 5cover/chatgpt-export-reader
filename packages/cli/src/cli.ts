#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";
import type {
  RecapContextFormat,
  RecapContextStrategy,
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

type CommonOptions = {
  inputFormat: string;
  exportFormat: string;
  chat: string[];
  fsPath?: string;
  streamFile: string;
};

type ExportOptions = Pick<CommonOptions, "fsPath" | "streamFile">;

type RecapCommandOptions = CommonOptions & {
  timeZone: string;
  startDate?: string;
  endDate?: string;
  sessionGapMinutes?: string;
  contextStrategy: string;
  contextMessages: string;
  contextFormat: string;
  repeatedPhrasePercentile: string;
};

const exportFormats = [
  {
    name: "filesystem",
    desc: "Write artifacts to the filesystem as directories or a single file.",
    create: (options: ExportOptions) => {
      if (!options.fsPath)
        throw new Error("--fs-path is required for the filesystem exporter");
      return new FilesystemExporter({ path: options.fsPath });
    },
  },
  {
    name: "flat",
    desc: "Write flattened artifact contents to a stream separated by blank lines.",
    create: (options: ExportOptions) =>
      new FlatExporter({ stream: openStream(options.streamFile) }),
  },
  {
    name: "json",
    desc: "Write the full artifact tree as JSON to a stream.",
    create: (options: ExportOptions) =>
      new JsonArtifactExporter({ stream: openStream(options.streamFile) }),
  },
] as const satisfies readonly {
  name: string;
  desc: string;
  create: (options: ExportOptions) => Exporter;
}[];

const program = new Command()
  .name("chatgpt-export-reader")
  .description("Turn ChatGPT exports into transcript, statistics, and recap artifacts.")
  .showHelpAfterError();

addOutputCommand(
  "markdown",
  "Render chats into branch-aware Markdown documents.",
  () => new MarkdownOutput(),
);
addOutputCommand(
  "json",
  "Render each chat as a JSON string artifact keyed by chat ID.",
  () => new JsonOutput(),
);
addOutputCommand(
  "prompt",
  "Render chats as prompt-style transcripts with configurable role prefixes.",
  () => new PromptOutput(),
);
addOutputCommand(
  "stats",
  "Generate usage statistics as JSON, CSV, and SVG chart artifacts.",
  () => new StatsOutput(),
);

configureCommonOptions(
  program
    .command("recap <input-path>")
    .description("Generate editable recap context and an LLM prompt."),
)
  .option("--start-date <YYYY-MM-DD>", "Inclusive recap start date in the selected timezone")
  .option("--end-date <YYYY-MM-DD>", "Inclusive recap end date in the selected timezone")
  .option("--time-zone <iana-zone>", "Recap timezone", "UTC")
  .option("--session-gap-minutes <number>", "Minutes separating observed recap sessions")
  .option("--context-strategy <full|rolling-window>", "Pre-window context strategy", "rolling-window")
  .option("--context-messages <number>", "Maximum preceding messages per conversation", "20")
  .option("--context-format <yaml|toon>", "Recap context serialization", "yaml")
  .option(
    "--repeated-phrase-percentile <0-100>",
    "Minimum repeated-phrase score percentile for recap evidence",
    "90",
  )
  .showHelpAfterError()
  .action(async (input, options) => {
    const recapOptions: RecapCommandOptions = options;
    await render(
      input,
      recapOptions,
      new RecapOutput(
        {
          timeZone: recapOptions.timeZone,
          startDate: recapOptions.startDate,
          endDate: recapOptions.endDate,
          sessionGapMinutes: numberOption(
            recapOptions.sessionGapMinutes,
            "--session-gap-minutes",
          ),
          context: {
            strategy: recapStrategy(recapOptions.contextStrategy),
            maxMessages: recapContextMessages(recapOptions.contextMessages),
          },
          repeatedPhrases: {
            minimumScorePercentile: recapRepeatedPhrasePercentile(
              recapOptions.repeatedPhrasePercentile,
            ),
          },
        },
        recapContextFormat(recapOptions.contextFormat),
      ),
    );
  });

program
  .command("formats")
  .description("List supported input and artifact export formats.")
  .action(() => {
    printFormats("Input formats", inputFormats);
    printFormats("Export formats", exportFormats);
  });

await program.parseAsync();

function addOutputCommand(
  name: string,
  description: string,
  create: () => OutputFormat,
): void {
  configureCommonOptions(
    program.command(`${name} <input-path>`).description(description),
  )
    .showHelpAfterError()
    .action(async (input, options) => {
      await render(input, options, create());
    });
}

function configureCommonOptions<
  Args extends unknown[],
  Options extends Record<string, unknown>,
  GlobalOptions extends Record<string, unknown>,
>(command: Command<Args, Options, GlobalOptions>) {
  return command
    .option("-i, --input-format <name>", "Input format", "v1")
    .option("-e, --export-format <name>", "Export format", "flat")
    .option("-c, --chat <uuid>", "Keep only specific chat IDs", collect, [] as string[])
    .option("--fs-path <path>", "Filesystem exporter destination path")
    .option(
      "--stream-file <path|->",
      "Stream exporter destination, use - for stdout",
      "-",
    );
}

async function render(
  inputPath: string,
  options: CommonOptions,
  output: OutputFormat,
): Promise<void> {
  const input = getInputFormat(options.inputFormat);
  const exporter = createExporter(options.exportFormat, options);
  const selectedChats = new Set(options.chat);
  const artifacts = await output.render(
    filterChats(readInput(input, inputPath), selectedChats),
  );
  if (selectedChats.size && artifacts.size === 0) {
    throw new Error(
      `no chats matched requested IDs: ${[...selectedChats].join(", ")}`,
    );
  }
  await exporter.export(artifacts);
}

function getInputFormat(name: string): Input {
  const format = inputFormats.find((format) => format.name === name);
  if (!format) throw new Error(`unknown input format: ${name}`);
  return format.input;
}

function createExporter(name: string, options: ExportOptions): Exporter {
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

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function numberOption(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error(`${option} must be a number.`);
  return Number(value);
}

function recapStrategy(value: string): RecapContextStrategy {
  if (value === "full" || value === "rolling-window") return value;
  throw new Error(`unknown context strategy: ${value}`);
}

function recapContextFormat(value: string): RecapContextFormat {
  if (value === "yaml" || value === "toon") return value;
  throw new Error(`unknown recap context format: ${value}`);
}

function recapContextMessages(value: string): number | undefined {
  const number = numberOption(value, "--context-messages");
  if (number === undefined) return undefined;
  if (!Number.isInteger(number) || number < 0)
    throw new Error("--context-messages must be a non-negative integer.");
  return number;
}

function recapRepeatedPhrasePercentile(value: string): number {
  const number = numberOption(value, "--repeated-phrase-percentile");
  if (number === undefined || number < 0 || number > 100)
    throw new Error("--repeated-phrase-percentile must be a number from 0 to 100.");
  return number;
}

function printFormats(
  title: string,
  formats: readonly { name: string; desc: string }[],
): void {
  console.log(title);
  for (const format of formats) console.log(`- ${format.name}: ${format.desc}`);
}
