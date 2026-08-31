import type { UsageDay } from '@chatgpt-export-reader/core'

type PromptBin = {
    from: number
    to: number
    days: number
}

export function PromptHistogram({ days }: { days: readonly UsageDay[] }) {
    const bins = buildPromptBins(days.map(day => day.prompts))
    const largestBin = Math.max(...bins.map(bin => bin.days), 1)

    return <section class="chart-card">
        <div class="chart-heading">
            <div>
                <p class="eyebrow">Prompt distribution</p>
                <h2>How many prompts do you send on a day?</h2>
            </div>
        </div>
        <ul class="histogram" aria-label="Number of calendar days by user prompt count">
            {bins.map(bin => <li class={bin.from === 0 ? 'histogram-bin zero-bin' : 'histogram-bin'} key={`${bin.from}-${bin.to}`}>
                <div class="histogram-bars">
                    <strong>{bin.days.toLocaleString()}</strong>
                    <div class="histogram-bar" style={{ height: bin.days === 0 ? '0' : `${Math.max(bin.days / largestBin * 100, 3)}%` }} />
                </div>
                <span>{formatBin(bin)}</span>
            </li>)}
        </ul>
        <p class="chart-note">Bar height is the number of calendar days. <code>0</code> is always its own inactive-day bin; positive prompt counts are grouped automatically.</p>
    </section>
}

export function buildPromptBins(prompts: readonly number[]): PromptBin[] {
    const positive = prompts.filter(value => value > 0).sort((a, b) => a - b)
    const bins: PromptBin[] = [{ from: 0, to: 0, days: prompts.length - positive.length }]
    if (positive.length === 0) return bins

    const minimum = positive[0]!
    const maximum = positive.at(-1)!
    const range = maximum - minimum + 1
    const binCount = automaticBinCount(positive, range)
    const width = Math.max(1, Math.ceil(range / binCount))

    for (let from = minimum; from <= maximum; from += width) {
        const to = Math.min(from + width - 1, maximum)
        bins.push({ from, to, days: positive.filter(value => value >= from && value <= to).length })
    }
    return bins
}

function automaticBinCount(values: readonly number[], range: number): number {
    if (range === 1) return 1
    const interquartileRange = quantile(values, 0.75) - quantile(values, 0.25)
    const suggestedWidth = 2 * interquartileRange / Math.cbrt(values.length)
    const suggestedCount = suggestedWidth > 0 ? Math.ceil(range / suggestedWidth) : Math.ceil(Math.log2(values.length) + 1)
    return Math.min(12, range, Math.max(1, suggestedCount))
}

function quantile(values: readonly number[], percentile: number): number {
    const position = (values.length - 1) * percentile
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    return values[lower]! + (values[upper]! - values[lower]!) * (position - lower)
}

function formatBin(bin: PromptBin): string {
    return bin.from === bin.to ? `${bin.from}` : `${bin.from}-${bin.to}`
}
