import type { AnalyticsDay, AnalyticsStatistics, ConversationAnalytics } from "./analytics.js";

export type DailyMetric = "prompts" | "messages" | "inputWords" | "outputWords" | "totalWords";

export type Distribution = { mean: number; median: number };

export type PromptDistributionBin = { from: number; to: number; days: number };

export type OutputConcentration = {
  totalWords: number;
  topConversationShares: Array<{ count: number; share: number }>;
  conversations: Array<{
    conversation: ConversationAnalytics;
    outputWords: number;
    share: number;
    cumulativeShare: number;
  }>;
};

export type SessionDepthBin = { from: number; to: number | null; sessions: number };

export type SessionContinuation = {
  prompts: number;
  reached: number;
  continued: number;
  rate: number;
};

/** Derived presentation metrics shared by the dashboard and recap exports. */
export type AnalyticsDerivedMetrics = {
  outputToInputWordRatio: number | null;
  daily: Record<DailyMetric, Distribution>;
  promptDistribution: PromptDistributionBin[];
  outputConcentration: OutputConcentration;
  sessionPromptCounts: { median: number; over25: number; over100: number };
  sessionDepth: SessionDepthBin[];
  sessionStartsByHour: number[];
  sessionContinuation: SessionContinuation[];
};

export type DerivedMetricsOptions = {
  timeZone: string;
};

const sessionDepthBounds: readonly [number, number | null][] = [
  [1, 1],
  [2, 5],
  [6, 10],
  [11, 25],
  [26, 50],
  [51, 100],
  [101, null],
];

/**
 * Calculates display-ready metrics from canonical analytics statistics.
 * Callers should pass the same timezone used to collect the statistics.
 */
export function deriveAnalyticsMetrics(
  statistics: AnalyticsStatistics,
  options: DerivedMetricsOptions,
): AnalyticsDerivedMetrics {
  validateTimeZone(options.timeZone);
  const daily = Object.fromEntries(
    (["prompts", "messages", "inputWords", "outputWords", "totalWords"] as const).map((metric) => [
      metric,
      distribution(statistics.days.map((day) => dailyMetricValue(day, metric))),
    ]),
  ) as Record<DailyMetric, Distribution>;
  const outputConcentration = deriveOutputConcentration(statistics.conversations);
  const sessionPrompts = statistics.sessions.map((session) => session.prompts);

  return {
    outputToInputWordRatio:
      statistics.summary.input.words === 0
        ? null
        : statistics.summary.output.words / statistics.summary.input.words,
    daily,
    promptDistribution: buildPromptDistribution(statistics.days.map((day) => day.prompts)),
    outputConcentration,
    sessionPromptCounts: {
      median: median(sessionPrompts),
      over25: sessionPrompts.filter((prompts) => prompts > 25).length,
      over100: sessionPrompts.filter((prompts) => prompts > 100).length,
    },
    sessionDepth: sessionDepthBounds.map(([from, to]) => ({
      from,
      to,
      sessions: statistics.sessions.filter(
        (session) => session.prompts >= from && (to === null || session.prompts <= to),
      ).length,
    })),
    sessionStartsByHour: Array.from({ length: 24 }, (_, hour) =>
      statistics.sessions.filter((session) => hourInTimeZone(session.startAt, options.timeZone) === hour)
        .length,
    ),
    sessionContinuation: deriveSessionContinuation(sessionPrompts),
  };
}

export function dailyMetricValue(day: AnalyticsDay, metric: DailyMetric): number {
  if (metric === "prompts") return day.prompts;
  if (metric === "messages") return day.messages;
  if (metric === "inputWords") return day.input.words;
  if (metric === "outputWords") return day.output.words;
  return day.input.words + day.output.words;
}

export function distribution(values: readonly number[]): Distribution {
  return { mean: mean(values), median: median(values) };
}

export function buildPromptDistribution(values: readonly number[]): PromptDistributionBin[] {
  const positive = values.filter((value) => value > 0).sort((left, right) => left - right);
  const bins = [{ from: 0, to: 0, days: values.length - positive.length }];
  if (positive.length === 0) return bins;

  const minimum = positive[0]!;
  const maximum = positive.at(-1)!;
  const range = maximum - minimum + 1;
  const interquartileRange = quantile(positive, 0.75) - quantile(positive, 0.25);
  const suggestedWidth = (2 * interquartileRange) / Math.cbrt(positive.length);
  const suggestedCount =
    suggestedWidth > 0
      ? Math.ceil(range / suggestedWidth)
      : Math.ceil(Math.log2(positive.length) + 1);
  const width = Math.max(1, Math.ceil(range / Math.min(12, range, Math.max(1, suggestedCount))));
  for (let from = minimum; from <= maximum; from += width) {
    const to = Math.min(from + width - 1, maximum);
    bins.push({ from, to, days: positive.filter((value) => value >= from && value <= to).length });
  }
  return bins;
}

export function deriveOutputConcentration(
  conversations: readonly ConversationAnalytics[],
): OutputConcentration {
  const ordered = [...conversations].sort((left, right) => right.output.words - left.output.words);
  const totalWords = ordered.reduce((sum, conversation) => sum + conversation.output.words, 0);
  let cumulativeWords = 0;
  return {
    totalWords,
    topConversationShares: [1, 5, 10].map((count) => ({
      count,
      share:
        totalWords === 0
          ? 0
          : ordered.slice(0, count).reduce((sum, conversation) => sum + conversation.output.words, 0) /
            totalWords,
    })),
    conversations: ordered.map((conversation) => {
      cumulativeWords += conversation.output.words;
      return {
        conversation,
        outputWords: conversation.output.words,
        share: totalWords === 0 ? 0 : conversation.output.words / totalWords,
        cumulativeShare: totalWords === 0 ? 0 : cumulativeWords / totalWords,
      };
    }),
  };
}

function deriveSessionContinuation(sessionPrompts: readonly number[]): SessionContinuation[] {
  return Array.from({ length: 12 }, (_, index) => index + 1)
    .map((prompts) => {
      const reached = sessionPrompts.filter((count) => count >= prompts).length;
      const continued = sessionPrompts.filter((count) => count > prompts).length;
      return { prompts, reached, continued, rate: reached === 0 ? 0 : continued / reached };
    })
    .filter((point) => point.reached >= 5);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function quantile(values: readonly number[], percentile: number): number {
  const position = (values.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return values[lower]! + (values[upper]! - values[lower]!) * (position - lower);
}

function hourInTimeZone(iso: string, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" })
      .formatToParts(Date.parse(iso))
      .find((part) => part.type === "hour")!.value,
  );
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new RangeError(`Invalid time zone: ${timeZone}.`);
  }
}
