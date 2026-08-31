import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useEffect, useRef } from 'preact/hooks'
import type { UsageDay } from '@chatgpt-export-reader/core'

export type DailyChartProps = {
    days: readonly UsageDay[]
    selectedDate?: string
    onSelectDate: (date: string) => void
}

export function DailyChart({ days, selectedDate, onSelectDate }: DailyChartProps) {
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
                    { label: 'All messages', stroke: '#0b7773', width: 2.5, fill: 'rgba(11, 119, 115, 0.10)' },
                    { label: 'User prompts', stroke: '#d36c37', width: 2.5 },
                ],
                hooks: {
                    ready: [plot => {
                        plot.over.addEventListener('click', () => {
                            if (plot.cursor.left === undefined) return
                            const index = plot.posToIdx(plot.cursor.left)
                            const day = days[index]
                            if (day) onSelectDateRef.current(day.date)
                        })
                    }],
                },
            },
            [timestamps, days.map(day => day.messages), days.map(day => day.prompts)],
            target.current,
        )

        return () => chart.destroy()
    }, [days])

    return (
        <section class="chart-card" aria-label="Daily ChatGPT message activity">
            <div class="chart-heading">
                <div>
                    <p class="eyebrow">Daily activity</p>
                    <h2>Messages reveal the spikes.</h2>
                </div>
                {selectedDate && <span class="selected-date">Selected: {selectedDate}</span>}
            </div>
            <div class="chart" ref={target} />
            <p class="chart-note">Click a day to inspect the conversations that contributed to it. Drag to zoom; double-click to reset.</p>
        </section>
    )
}
