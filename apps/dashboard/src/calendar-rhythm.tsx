import { useState } from 'preact/hooks'
import type { AnalyticsDay } from '@chatgpt-export-reader/core'
import { weekdayName } from './format.js'
export function CalendarRhythm({
  days,
  onSelectDate,
  selectedDate,
}: {
  days: readonly AnalyticsDay[]
  onSelectDate: (date: string) => void
  selectedDate?: string
}) {
  const months = [...new Set(days.map(day => day.date.slice(0, 7)))]
  const [chosen, setChosen] = useState(months.at(-1) ?? '')
  const month = months.includes(chosen) ? chosen : (months.at(-1) ?? '')
  const matching = days.filter(day => day.date.startsWith(month))
  const first = matching[0]
  if (!first) return <p>No calendar activity in this scope.</p>
  const offset = new Date(`${first.date}T00:00:00Z`).getUTCDay()
  return (
    <section>
      <label>
        Calendar month
        <select value={month} onChange={event => setChosen(event.currentTarget.value)}>
          {months.map(month => (
            <option key={month}>{month}</option>
          ))}
        </select>
      </label>
      <p>Select a day, then open its conversation evidence in Overview.</p>
      <div class="month-grid">
        {Array.from({ length: 7 }, (_, day) => (
          <span key={day} class="weekday">
            {weekdayName(day, true)}
          </span>
        ))}
        {Array.from({ length: offset }, (_, index) => (
          <span key={`pad-${index}`} />
        ))}
        {matching.map(day => (
          <button
            key={day.date}
            type="button"
            aria-pressed={selectedDate === day.date}
            aria-label={`${Number(day.date.slice(8))} ${day.prompts} ${day.prompts === 1 ? 'prompt' : 'prompts'}. ${day.date}. Inspect conversations.`}
            class={day.prompts ? 'calendar-day has-activity' : 'calendar-day'}
            onClick={() => onSelectDate(day.date)}>
            <span>{Number(day.date.slice(8))}</span>{' '}
            <small>
              {day.prompts} {day.prompts === 1 ? 'prompt' : 'prompts'}
            </small>
          </button>
        ))}
      </div>
      {selectedDate && (
        <p>
          <a href="#/">Inspect conversations on {selectedDate}</a>
        </p>
      )}
    </section>
  )
}
