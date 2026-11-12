import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { measures, type Measure } from './metric-definitions.js'
import { Disclosure } from './ui.js'
import { SortableTable } from './sortable-table.js'

export function DailySeriesChart({
  days,
  measure,
  selectedDate,
  onSelectDate,
  title,
}: {
  days: readonly { date: string; value: number }[]
  measure: Measure
  selectedDate?: string
  onSelectDate?: (date: string) => void
  title: string
}) {
  const target = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot>()
  const [viewport, setViewport] = useState<{ min: number; max: number }>()
  const zoom = useRef<{ min: number; max: number; domain: string }>()
  const selection = useRef({ selectedDate, onSelectDate })
  selection.current = { selectedDate, onSelectDate }
  const metric = measures[measure]
  const domain = `${days[0]?.date ?? ''}/${days.at(-1)?.date ?? ''}`
  const divisor = measure === 'usageMs' || measure === 'thinkingMs' ? 60_000 : 1
  const series = useMemo(() => {
    let total = 0
    const values = days.map(day => day.value / divisor)
    return [
      days.map(day => Date.parse(`${day.date}T12:00:00Z`) / 1000),
      values,
      values.map((value, index) => {
        total += value
        if (index >= 28) total -= values[index - 28]!
        return total / Math.min(28, index + 1)
      }),
    ]
  }, [days, divisor])
  useEffect(() => {
    if (!target.current || !days.length) return
    const chart = new uPlot(
      {
        width: Math.max(240, target.current.clientWidth),
        height: 300,
        tzDate: at => uPlot.tzDate(new Date(at * 1000), 'UTC'),
        cursor: { drag: { x: true, y: false } },
        series: [
          {},
          { label: `${metric.label} (${metric.unit})`, stroke: '#0b7773', width: 2, points: { show: false } },
          { label: '28-calendar-day mean', stroke: '#bc5628', width: 2, points: { show: false } },
        ],
        hooks: {
          setScale: [
            (chart, key) => {
              if (key !== 'x') return
              const { min, max } = chart.scales.x!
              if (min != null && max != null) setViewport({ min, max })
            },
          ],
          ready: [
            chart => {
              const { min, max } = chart.scales.x!
              if (min != null && max != null) setViewport({ min, max })
              let down = 0
              chart.over.addEventListener('pointerdown', event => {
                down = event.clientX
              })
              chart.over.addEventListener('click', event => {
                if (Math.abs(event.clientX - down) > 5 || chart.cursor.left === undefined) return
                const day = days[chart.posToIdx(chart.cursor.left)]
                if (day) selection.current.onSelectDate?.(day.date)
              })
            },
          ],
          draw: [
            chart => {
              const date = selection.current.selectedDate
              if (!date) return
              const x = chart.valToPos(Date.parse(`${date}T12:00:00Z`) / 1000, 'x', true)
              if (x < chart.bbox.left || x > chart.bbox.left + chart.bbox.width) return
              chart.ctx.save()
              chart.ctx.strokeStyle = '#303c40'
              chart.ctx.setLineDash([4, 4])
              chart.ctx.beginPath()
              chart.ctx.moveTo(x, chart.bbox.top)
              chart.ctx.lineTo(x, chart.bbox.top + chart.bbox.height)
              chart.ctx.stroke()
              chart.ctx.restore()
            },
          ],
        },
      },
      series as uPlot.AlignedData,
      target.current
    )
    plot.current = chart
    if (zoom.current?.domain === domain) chart.setScale('x', zoom.current)
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width) chart.setSize({ width: Math.max(240, width), height: 300 })
    })
    observer.observe(target.current)
    return () => {
      observer.disconnect()
      const { min, max } = chart.scales.x!
      if (min != null && max != null) zoom.current = { min, max, domain }
      chart.destroy()
      plot.current = undefined
    }
  }, [series, days, metric, domain])
  useEffect(() => {
    plot.current?.redraw(false, false)
  }, [selectedDate])
  const mean = days.length ? days.reduce((sum, day) => sum + day.value, 0) / days.length : 0
  return (
    <section class="daily-series" aria-label={title}>
      <h3>{title}</h3>
      <p>{metric.description}</p>
      {days.length ? (
        <>
          <div ref={target} class="chart" aria-hidden="true" />
          {viewport && (
            <output aria-label="Chart viewport">
              Viewing {new Date(viewport.min * 1000).toISOString().slice(0, 10)} through{' '}
              {new Date(viewport.max * 1000).toISOString().slice(0, 10)}
            </output>
          )}
          <p class="chart-note">
            Mean per calendar day: <strong>{metric.format(mean)}</strong>. Includes inactive days. The first 27 rolling
            values use the available days. Drag to zoom; double-click to reset. Zoom does not filter totals.
          </p>
          {onSelectDate && (
            <label class="day-picker">
              Inspect day
              <input
                type="date"
                min={days[0]?.date}
                max={days.at(-1)?.date}
                value={selectedDate ?? ''}
                onChange={event => {
                  if (days.some(day => day.date === event.currentTarget.value)) onSelectDate(event.currentTarget.value)
                }}
              />
            </label>
          )}
          <Disclosure title="Daily values and keyboard navigation">
            <SortableTable
              label={`${title}: daily values`}
              rows={days}
              columns={[
                {
                  id: 'date',
                  label: 'Day',
                  align: 'left',
                  compare: (a, b) => a.date.localeCompare(b.date),
                  render: day =>
                    onSelectDate ? (
                      <button
                        class="text-button"
                        type="button"
                        aria-pressed={day.date === selectedDate}
                        onClick={() => onSelectDate(day.date)}>
                        {day.date}
                      </button>
                    ) : (
                      day.date
                    ),
                },
                {
                  id: 'value',
                  label: metric.label,
                  compare: (a, b) => a.value - b.value,
                  render: day => metric.format(day.value),
                },
              ]}
              initialSort={{ column: 'date' }}
              rowKey={day => day.date}
            />
          </Disclosure>
        </>
      ) : (
        <p class="empty-table">No dated activity in this scope.</p>
      )}
    </section>
  )
}
