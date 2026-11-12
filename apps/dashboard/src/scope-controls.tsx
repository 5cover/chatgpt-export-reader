import { useEffect, useState } from 'preact/hooks'
import type { AnalysisScope, Period } from './analysis-scope.js'
import { localTimeZone, shiftDate } from './analysis-scope.js'
import { useProjectNames } from './project-identity.js'
export function TimeZoneSelect({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const local = localTimeZone()
  const zones = [...new Set([local, 'UTC', value, ...Intl.supportedValuesOf('timeZone')])]
  return (
    <label>
      Timezone
      <select value={value} onChange={event => onChange(event.currentTarget.value)}>
        {zones.map(zone => (
          <option key={zone} value={zone}>
            {zone}
            {zone === local ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
export function ScopeControls({
  scope,
  available,
  projects,
  busy,
  onApply,
}: {
  scope: AnalysisScope
  available?: Period
  projects: readonly string[]
  busy: boolean
  onApply: (scope: AnalysisScope) => void
}) {
  const [draft, setDraft] = useState(scope)
  const { names } = useProjectNames()
  useEffect(() => setDraft(scope), [scope])
  return (
    <form
      class="scope-controls"
      aria-label="Analysis scope"
      onSubmit={event => {
        event.preventDefault()
        onApply(draft)
      }}>
      <fieldset disabled={busy}>
        <legend>Analysis scope</legend>
        <div class="scope-fields">
          <label>
            From
            <input
              type="date"
              value={draft.startDate ?? ''}
              max={draft.endDate}
              onInput={event => setDraft({ ...draft, startDate: event.currentTarget.value || undefined })}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={draft.endDate ?? ''}
              min={draft.startDate}
              onInput={event => setDraft({ ...draft, endDate: event.currentTarget.value || undefined })}
            />
          </label>
          <TimeZoneSelect value={draft.timeZone} onChange={timeZone => setDraft({ ...draft, timeZone })} />
          <label>
            Project
            <select
              value={draft.projectId === undefined ? 'all' : `id:${draft.projectId}`}
              onChange={event =>
                setDraft({
                  ...draft,
                  projectId: event.currentTarget.value === 'all' ? undefined : event.currentTarget.value.slice(3),
                })
              }>
              <option value="all">All projects</option>
              {projects.map(id => (
                <option key={id} value={`id:${id}`}>
                  {names[id] || id || 'Unassigned'}
                </option>
              ))}
            </select>
          </label>
          <button class="ui-button primary" type="submit">
            Apply scope
          </button>
        </div>
        <div class="scope-shortcuts">
          <button
            class="text-button"
            type="button"
            onClick={() => onApply({ ...scope, startDate: undefined, endDate: undefined })}>
            All time
          </button>
          {available && (
            <button
              class="text-button"
              type="button"
              onClick={() =>
                onApply({ ...scope, startDate: shiftDate(available.endDate, -27), endDate: available.endDate })
              }>
              Last 28 days of export
            </button>
          )}
        </div>
        <details class="scope-advanced">
          <summary>Session definition</summary>
          <label>
            Split sessions after inactivity (minutes)
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              value={draft.sessionGapMinutes}
              onInput={event => setDraft({ ...draft, sessionGapMinutes: Number(event.currentTarget.value) })}
            />
          </label>
          <p>This changes session grouping, not the interaction-time estimate.</p>
        </details>
      </fieldset>
    </form>
  )
}
