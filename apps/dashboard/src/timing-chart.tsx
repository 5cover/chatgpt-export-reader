import uPlot from 'uplot'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TimingStatistics } from '@chatgpt-export-reader/core'

export function TimingChart({ timing, calendarDays, onSelectDate }: { timing: TimingStatistics; calendarDays?: readonly string[]; onSelectDate?: (date: string) => void }) {
  const target = useRef<HTMLDivElement>(null)
  const zoom = useRef<{ min: number; max: number }>()
  const selectRef = useRef(onSelectDate)
  selectRef.current = onSelectDate
  const [metric, setMetric] = useState<'usageMs' | 'thinkingMs'>('usageMs')
  useEffect(() => {
    if (!target.current || timing.days.length === 0) return
    const byDate = new Map(timing.days.map(day => [day.id, day]))
    const dates = calendarDays ?? timing.days.map(day => day.id)
    const values = dates.map(date => (byDate.get(date)?.[metric] ?? 0) / 60_000)
    const chart = new uPlot({
      width: target.current.clientWidth, height: 300,
      scales: { x: { time: true } },
      hooks: { ready: [plot => { plot.over.addEventListener('click', () => {
        if (plot.cursor.left === undefined) return
        const date = dates[plot.posToIdx(plot.cursor.left)]
        if (date) selectRef.current?.(date)
      }) }] },
      series: [{}, { label: metric === 'usageMs' ? 'Estimated use (min)' : 'Reply latency (min)', stroke: '#0b7773', width: 2 }, { label: '28-day mean', stroke: '#d36c37', width: 2 }],
    }, [dates.map(date => Date.parse(`${date}T12:00:00Z`) / 1000), values,
      values.map((_, index) => values.slice(Math.max(0, index - 27), index + 1).reduce((sum, value) => sum + value, 0) / Math.min(28, index + 1))], target.current)
    if (zoom.current) chart.setScale('x', zoom.current)
    return () => { const min = chart.scales.x?.min; const max = chart.scales.x?.max; if (min != null && max != null) zoom.current = { min, max }; chart.destroy() }
  }, [timing, calendarDays, metric])
  return <section class="chart-card"><h2>Daily interaction time</h2><div class="metric-picker"><button type="button" class={metric === 'usageMs' ? 'active' : ''} onClick={() => setMetric('usageMs')}>Estimated use</button><button type="button" class={metric === 'thinkingMs' ? 'active' : ''} onClick={() => setMetric('thinkingMs')}>Reply latency</button></div><div class="chart" ref={target} />
    <p class="chart-note">Typing and reading estimate, not measured screen time. Reply waiting is excluded. Click a day to inspect its breakdown.</p></section>
}
