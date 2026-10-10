import type { PromptDistributionBin } from '@chatgpt-export-reader/core'

export function PromptHistogram({ bins }: { bins: readonly PromptDistributionBin[] }) {
  const largestBin = Math.max(...bins.map(bin => bin.days), 1)

  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Prompt distribution</p>
          <h2>How many prompts do you send on a day?</h2>
        </div>
      </div>
      <ul class="histogram" aria-label="Number of calendar days by user prompt count">
        {bins.map(bin => (
          <li class={bin.from === 0 ? 'histogram-bin zero-bin' : 'histogram-bin'} key={`${bin.from}-${bin.to}`}>
            <div class="histogram-bars">
              <strong>{bin.days.toLocaleString()}</strong>
              <div
                class="histogram-bar"
                style={{ height: bin.days === 0 ? '0' : `${Math.max((bin.days / largestBin) * 100, 3)}%` }}
              />
            </div>
            <span>{formatBin(bin)}</span>
          </li>
        ))}
      </ul>
      <p class="chart-note">
        Bar height is the number of calendar days. <code>0</code> is always its own inactive-day bin; positive prompt
        counts are grouped automatically.
      </p>
    </section>
  )
}

function formatBin(bin: PromptDistributionBin): string {
  return bin.from === bin.to ? `${bin.from}` : `${bin.from}-${bin.to}`
}
