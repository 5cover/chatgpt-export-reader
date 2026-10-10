import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useEffect, useRef } from 'preact/hooks'
import { dailyMetricValue, type AnalyticsDay, type DailyMetric, type Distribution } from '@chatgpt-export-reader/core'

export type DailyChartProps = {
  days: readonly AnalyticsDay[]
  selectedDate?: string
  onSelectDate: (date: string) => void
  metric: DailyMetric
  distribution: Distribution
  title?: string
  note?: string
}

export function DailyChart({
  days,
  selectedDate,
  onSelectDate,
  metric,
  distribution,
  title = 'How usage changes over time.',
  note = 'Click a day to inspect the conversations behind it. Drag to zoom; double-click to reset.',
}: DailyChartProps) {
  const target = useRef<HTMLDivElement>(null)
  const onSelectDateRef = useRef(onSelectDate)
  onSelectDateRef.current = onSelectDate

  useEffect(() => {
    if (!target.current || days.length === 0) return
    const timestamps = days.map(day => Date.parse(`${day.date}T12:00:00Z`) / 1000)
    const chart = new uPlot(
      {
        width: target.current.clientWidth,
        height: 390,
        cursor: { drag: { x: true, y: false } },
        scales: { x: { time: true } },
        axes: [
          { stroke: '#607276', grid: { stroke: '#d8e0df', width: 1 } },
          { stroke: '#607276', grid: { stroke: '#d8e0df', width: 1 } },
        ],
        series: [
          {},
          {
            label: metricLabel(metric),
            stroke: '#0b7773',
            fill: 'rgba(11, 119, 115, 0.60)',
            paths: uPlot.paths.bars!({ size: [0.82], gap: 1, radius: 0.2 }),
          },
          {
            label: '28-day mean',
            stroke: '#d36c37',
            width: 2,
            points: { show: false },
          },
        ],
        hooks: {
          ready: [
            plot => {
              plot.over.addEventListener('click', () => {
                if (plot.cursor.left === undefined) return
                const index = plot.posToIdx(plot.cursor.left)
                const day = days[index]
                if (day) onSelectDateRef.current(day.date)
              })
            },
          ],
        },
      },
      [
        timestamps,
        days.map(day => metricValue(day, metric)),
        rollingMean(
          days.map(day => metricValue(day, metric)),
          28
        ),
      ],
      target.current
    )

    return () => chart.destroy()
  }, [days])

  return (
    <section class="chart-card" aria-label="Daily ChatGPT message activity">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Daily activity</p>
          <h2>{title}</h2>
        </div>
        {selectedDate && <span class="selected-date">Selected: {selectedDate}</span>}
      </div>
      <div class="chart" ref={target} />
      <p class="chart-note">{note}</p>
      <p class="chart-summary">
        Per calendar day: <strong>mean {distribution.mean.toFixed(1)}</strong> ·{' '}
        <strong>median {distribution.median.toFixed(1)}</strong>
      </p>
    </section>
  )
}

function rollingMean(values: readonly number[], width: number): number[] {
  let total = 0
  return values.map((value, index) => {
    total += value
    if (index >= width) total -= values[index - width]!
    return total / Math.min(index + 1, width)
  })
}

export type { DailyMetric } from '@chatgpt-export-reader/core'

export const metricValue = dailyMetricValue

export function metricLabel(metric: DailyMetric): string {
  return {
    prompts: 'User prompts',
    messages: 'Messages',
    inputWords: 'Input words',
    outputWords: 'Output words',
    totalWords: 'Total words',
  }[metric]
}
