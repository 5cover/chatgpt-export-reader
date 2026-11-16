import { useMemo, useState } from 'preact/hooks'
import { deriveAnalyticsMetrics, type AnalyticsStatistics } from '@stemmatic/core'
import { Choice, Disclosure } from './ui.js'
import { DailySeriesChart } from './daily-series-chart.js'
import { dailyValues, measures, type Measure } from './metric-definitions.js'
import { CalendarRhythm } from './calendar-rhythm.js'
import { PromptHistogram } from './prompt-histogram.js'
import { HeatmapTable, type HeatmapRow } from './heatmap-table.js'
import { hourLabel, weekdayName, formatShare } from './format.js'
import { temporalRoute } from './routes.js'
import { SessionScatter, SessionTable } from './session-evidence.js'
import { SortableTable } from './sortable-table.js'
import { Methodology } from './methodology.js'
export function TimeRhythm({
  stats,
  timeZone,
  selectedDate,
  onSelectDate,
}: {
  stats: AnalyticsStatistics
  timeZone: string
  selectedDate?: string
  onSelectDate: (date: string) => void
}) {
  const [measure, setMeasure] = useState<Measure>('usageMs')
  const [heatMeasure, setHeatMeasure] = useState<'prompts' | 'input' | 'output'>('prompts')
  const metrics = useMemo(() => deriveAnalyticsMetrics(stats, { timeZone }), [stats, timeZone])
  const values = useMemo(() => dailyValues(stats.days, stats.timing, measure), [stats, measure])
  const byPosition = new Map(stats.hours.map(cell => [`${cell.weekday}:${cell.hour}`, cell]))
  const rows: HeatmapRow[] = Array.from({ length: 7 }, (_, day) => ({
    key: String(day),
    label: weekdayName(day),
    cells: Array.from({ length: 24 }, (_, hour) => {
      const cell = byPosition.get(`${day}:${hour}`)
      const value = heatMeasure === 'prompts' ? (cell?.prompts ?? 0) : (cell?.[heatMeasure].words ?? 0)
      const title = `${weekdayName(day)} ${hourLabel(hour)}: ${value} ${heatMeasure === 'prompts' ? 'prompts' : `${heatMeasure} words`}`
      return {
        value,
        title,
        href: value
          ? temporalRoute({ role: heatMeasure === 'output' ? 'assistant' : 'user', weekday: day, hour })
          : undefined,
        actionLabel: `${title}. Inspect messages.`,
      }
    }),
  }))
  return (
    <>
      <Choice
        label="Time measure"
        value={measure}
        onChange={setMeasure}
        options={(['usageMs', 'thinkingMs'] as const).map(value => ({ value, label: measures[value].label }))}
      />
      <DailySeriesChart
        title="Daily time"
        days={values}
        measure={measure}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
      />
      {selectedDate && (
        <p>
          <a href="#/">Inspect conversations on {selectedDate} in Overview</a>
        </p>
      )}
      <Disclosure title="Calendar rhythm">
        <CalendarRhythm days={stats.days} selectedDate={selectedDate} onSelectDate={onSelectDate} />
      </Disclosure>
      <Disclosure title="Prompt distribution">
        <PromptHistogram bins={metrics.promptDistribution} />
      </Disclosure>
      <section>
        <h3>Weekly rhythm</h3>
        <Choice
          label="Weekly measure"
          value={heatMeasure}
          onChange={setHeatMeasure}
          options={[
            { value: 'prompts', label: 'Prompts' },
            { value: 'input', label: 'Input words' },
            { value: 'output', label: 'Output words' },
          ]}
        />
        <p>
          Totals by weekday and hour in {timeZone}. Select a nonzero cell to inspect its messages. Values are totals,
          not averages per occurrence of that weekday.
        </p>
        <HeatmapTable
          label="Activity by weekday and hour"
          cornerLabel="Day / hour"
          columns={Array.from({ length: 24 }, (_, hour) => hourLabel(hour))}
          rows={rows}
          color="#0b7773"
        />
      </section>
      <section>
        <h3>Session structure</h3>
        <p>
          Sessions split after the inactivity gap in Analysis scope. Their observed span includes time between messages
          and is not estimated use.
        </p>
        <SessionScatter sessions={stats.sessions} />
        <SessionTable sessions={stats.sessions} timeZone={timeZone} />
      </section>
      <Disclosure title="Session distributions">
        <SortableTable
          label="Prompts per session"
          rows={metrics.sessionDepth}
          columns={[
            {
              id: 'depth',
              label: 'Prompts',
              render: bin => (bin.to === null ? `${bin.from}+` : `${bin.from}-${bin.to}`),
            },
            { id: 'count', label: 'Sessions', render: bin => bin.sessions },
          ]}
          initialSort={{ column: 'depth' }}
          rowKey={bin => String(bin.from)}
        />
        <SortableTable
          label="Session starts by local hour"
          rows={Array.from({ length: 24 }, (_, hour) => ({ hour, count: metrics.sessionStartsByHour[hour] ?? 0 }))}
          columns={[
            { id: 'hour', label: 'Hour', render: row => hourLabel(row.hour) },
            { id: 'count', label: 'Session starts', render: row => row.count },
          ]}
          initialSort={{ column: 'hour' }}
          rowKey={row => String(row.hour)}
        />
        <p>
          Continuation is the share of sessions reaching a prompt count that include at least one further prompt.
          Minimum sample: 5 sessions.
        </p>
        <SortableTable
          label="Session continuation"
          rows={metrics.sessionContinuation}
          columns={[
            { id: 'prompts', label: 'Prompt count reached', render: point => point.prompts },
            { id: 'sample', label: 'Sessions reaching count', render: point => point.reached },
            { id: 'rate', label: 'Continued', render: point => formatShare(point.rate) },
          ]}
          initialSort={{ column: 'prompts' }}
          rowKey={point => String(point.prompts)}
        />
      </Disclosure>
      <Methodology timing={stats.timing} />
    </>
  )
}
