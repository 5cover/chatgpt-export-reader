import type { AnalyticsDay, TimingStatistics } from '@chatgpt-export-reader/core'
import { formatDuration, formatNumber } from './format.js'
export type Measure = 'usageMs' | 'thinkingMs' | 'prompts' | 'messages' | 'inputWords' | 'outputWords' | 'totalWords'
export const measures: Record<
  Measure,
  { label: string; unit: string; description: string; format: (value: number) => string }
> = {
  usageMs: {
    label: 'Estimated interaction time',
    unit: 'minutes',
    description: 'Estimated typing and reading, not measured screen time. Waiting for replies is excluded.',
    format: formatDuration,
  },
  thinkingMs: {
    label: 'Total first-reply delay',
    unit: 'minutes',
    description:
      'Sum of observed delays to one first eligible reply per prompt. Waits over 30 minutes are reported separately. This is not compute time or typical response latency.',
    format: formatDuration,
  },
  prompts: {
    label: 'Prompts',
    unit: 'prompts',
    description: 'User messages, including branches retained in the export.',
    format: formatNumber,
  },
  messages: {
    label: 'Messages',
    unit: 'messages',
    description: 'Exported messages across all included roles.',
    format: formatNumber,
  },
  inputWords: {
    label: 'Input',
    unit: 'words',
    description: 'Words in user message bodies, not tokens.',
    format: formatNumber,
  },
  outputWords: {
    label: 'Output',
    unit: 'words',
    description: 'Words in assistant message bodies, not tokens or proof that the output was read.',
    format: formatNumber,
  },
  totalWords: {
    label: 'Input and output',
    unit: 'words',
    description: 'User and assistant words combined.',
    format: formatNumber,
  },
}
export function dailyValues(
  days: readonly AnalyticsDay[],
  timing: TimingStatistics,
  measure: Measure
): { date: string; value: number }[] {
  const times = new Map(timing.days.map(day => [day.id, day]))
  return days.map(day => ({
    date: day.date,
    value:
      measure === 'usageMs' || measure === 'thinkingMs'
        ? (times.get(day.date)?.[measure] ?? 0)
        : measure === 'inputWords'
          ? day.input.words
          : measure === 'outputWords'
            ? day.output.words
            : measure === 'totalWords'
              ? day.input.words + day.output.words
              : day[measure],
  }))
}
