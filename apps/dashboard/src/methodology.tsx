import type { TimingStatistics } from '@stemmatic/core'
import { formatDuration } from './format.js'
import { Disclosure } from './ui.js'
export function Methodology({ timing }: { timing: TimingStatistics }) {
  return (
    <Disclosure title="Estimation method and evidence coverage">
      <p>
        Interaction time estimates typing at 40 words per minute and reading at 200. Each message receives a 3-second
        minimum and 15-minute maximum. Direct reply-to-next-prompt gaps constrain or extend the combined budget to at
        most twice the text baseline and 15 minutes. Overlapping intervals are counted once; earlier intervals receive
        attribution. These assumptions cannot measure attention, pasted prompts, rereading, or time away from the
        screen.
      </p>
      <p>
        Total first-reply delay sums one earliest eligible assistant descendant per timestamped prompt, stopping at an
        intervening user message. Delays above 30 minutes are excluded from that total. It includes network and system
        delays, not just processing.
      </p>
      <dl class="coverage">
        <div>
          <dt>Long waits over 30 minutes</dt>
          <dd>
            {timing.summary.longWaits} ({formatDuration(timing.summary.longWaitMs)})
          </dd>
        </div>
        <div>
          <dt>Prompts without an eligible reply</dt>
          <dd>{timing.summary.unmatchedPrompts}</dd>
        </div>
        <div>
          <dt>Prompts without a usable timestamp</dt>
          <dd>{timing.summary.invalidPrompts} across imported history; they cannot be assigned to a date.</dd>
        </div>
      </dl>
      <p>
        Word and character counts describe message bodies, not tokens. Exported branches are included. Session span and
        first-to-last message span are elapsed intervals, not interaction time.
      </p>
    </Disclosure>
  )
}
