import uPlot from 'uplot'
import { useEffect, useRef } from 'preact/hooks'
import type { TimingStatistics } from '@chatgpt-export-reader/core'

export function TimingChart({ timing }: { timing: TimingStatistics }) {
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!target.current || timing.days.length === 0) return
    const values = timing.days.map(day => day.usageMs / 60_000)
    const chart = new uPlot({
      width: target.current.clientWidth, height: 300,
      scales: { x: { time: true } },
      series: [{}, { label: 'Estimated use (min)', stroke: '#0b7773', width: 2 }, { label: '28-day mean', stroke: '#d36c37', width: 2 }],
    }, [timing.days.map(day => Date.parse(`${day.id}T12:00:00Z`) / 1000), values,
      values.map((_, index) => values.slice(Math.max(0, index - 27), index + 1).reduce((sum, value) => sum + value, 0) / Math.min(28, index + 1))], target.current)
    return () => chart.destroy()
  }, [timing])
  return <section class="chart-card"><h2>Estimated daily interaction time</h2><div class="chart" ref={target} />
    <p class="chart-note">Typing and reading estimate, not measured screen time. Reply waiting is excluded.</p></section>
}
