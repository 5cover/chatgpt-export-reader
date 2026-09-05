import { lineChartSvg } from "../../lib/line-chart.js";
import {
  collectUsageStatistics,
  type UsageDay,
  type UsageRole,
} from "../../lib/usage-stats.js";
import type { ArtifactTree, Chat, OutputFormat } from "../../types.js";
import { artifactTree } from "../artifact-tree.js";

export default class StatsOutput implements OutputFormat {
  async render(chats: AsyncIterable<Chat>): Promise<ArtifactTree> {
    const stats = await collectUsageStatistics(chats);
    const root = artifactTree();

    root.set("stats.json", `${JSON.stringify(stats, null, 2)}\n`);
    root.set("messages-by-day.csv", toDailyCsv(stats.days));
    root.set("messages-by-day.svg", dailyChart(stats.days));
    root.set("messages-by-role.csv", toRoleCsv(stats.roles));
    root.set("README.md", readme());

    return root;
  }
}

function dailyChart(days: readonly UsageDay[]): string {
  const first = days[0]?.date ?? "No timestamped messages";
  const last = days.at(-1)?.date ?? first;
  return lineChartSvg({
    title: "ChatGPT messages per day",
    description: `Daily ChatGPT message and prompt counts from ${first} through ${last}, in UTC.`,
    firstLabel: first,
    lastLabel: last,
    series: [
      {
        label: "All messages",
        color: "#007c83",
        values: days.map((day) => day.messages),
      },
      {
        label: "User prompts",
        color: "#d15b2d",
        values: days.map((day) => day.prompts),
      },
    ],
  });
}

function toDailyCsv(days: readonly UsageDay[]): string {
  return csv(
    [
      "date",
      "messages",
      "prompts",
      "assistant_messages",
      "other_messages",
      "active_chats",
    ],
    days.map((day) => [
      day.date,
      day.messages,
      day.prompts,
      day.assistantMessages,
      day.otherMessages,
      day.activeChats,
    ]),
  );
}

function toRoleCsv(roles: readonly UsageRole[]): string {
  return csv(
    ["role", "messages"],
    roles.map((role) => [role.role, role.messages]),
  );
}

function csv(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  return `${[headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n")}\n`;
}

function csvValue(value: string | number): string {
  const string = value.toString();
  return /[",\n\r]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function readme(): string {
  return [
    "# ChatGPT usage statistics",
    "",
    "This directory is a self-contained stats package generated from normalized chat messages.",
    "",
    "- `stats.json` contains the complete structured aggregate.",
    "- `messages-by-day.csv` is the daily raw data used by the chart.",
    "- `messages-by-day.svg` is a line chart from the first timestamped message through the last, including inactive days as zeroes.",
    "- `messages-by-role.csv` breaks all messages down by role.",
    "",
    "Dates use UTC calendar days for stable output across machines. A prompt is a message whose role is `user`. Messages without a valid timestamp are included in totals and role counts, but cannot be assigned to a daily bucket.",
    "",
  ].join("\n");
}
