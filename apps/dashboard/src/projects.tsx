import { useState } from 'preact/hooks'
import type { AnalyticsStatistics } from '@chatgpt-export-reader/core'
import { TimingChart } from './timing-chart.js'

const storageKey = 'chatgpt-export-reader/project-names/v1'
type Names = Record<string, string>
function ProjectName({ id, name, onSave }: { id: string; name?: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name ?? '')
  const finish = (save: boolean) => { if (save) onSave(draft.trim()); setEditing(false) }
  if (!editing) return <><button type="button" aria-label={`Rename project ${name || id}`} onClick={() => { setDraft(name ?? ''); setEditing(true) }}>{name || id}</button><small>{name ? id : 'Click to rename'}</small></>
  return <input autoFocus aria-label={`Name for project ${id}`} value={draft} onInput={event => setDraft(event.currentTarget.value)} onBlur={() => finish(true)} onKeyDown={event => { if (event.key === 'Enter') finish(true); if (event.key === 'Escape') finish(false) }} />
}
export function readProjectNames(): Names {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    return validNames(value)
  } catch { return {} }
}
function validNames(value: unknown): Names {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a project-name object.')
  const result: Names = {}
  for (const [id, name] of Object.entries(value)) {
    if (!id || typeof name !== 'string' || name.length > 200) throw new Error('Invalid project ID or name.')
    if (name.trim()) result[id] = name.trim()
  }
  return result
}
export function Projects({ stats }: { stats: AnalyticsStatistics }) {
  const timing = stats.timing
  const [names, setNames] = useState(readProjectNames)
  const [error, setError] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [onlyUnnamed, setOnlyUnnamed] = useState(false)
  const save = (next: Names) => { localStorage.setItem(storageKey, JSON.stringify(next)); setNames(next) }
  const exportNames = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: storageKey, names }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'project-names.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importNames = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 1_000_000) throw new Error('Mapping file is too large.')
      const value: unknown = JSON.parse(await file.text())
      if (!value || typeof value !== 'object' || (value as { schema?: unknown }).schema !== storageKey) throw new Error('Unsupported mapping format.')
      save({ ...names, ...validNames((value as { names: unknown }).names) })
      setError(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <section class="chart-card">
    <h2>Projects</h2>
    <p class="chart-note">Rename project IDs inline. Names stay in this browser; export a mapping to use them elsewhere. Unassigned chats cannot be renamed.</p>
    <div class="recap-actions"><button type="button" onClick={exportNames}>Export names</button><label>Import names <input type="file" accept="application/json,.json" onChange={event => void importNames(event.currentTarget.files?.[0])} /></label></div>
    <label><input type="checkbox" checked={onlyUnnamed} onChange={event => setOnlyUnnamed(event.currentTarget.checked)} /> Show only unnamed projects ({stats.projects.filter(project => project.id && !names[project.id]).length})</label>
    {error && <p role="alert">{error}</p>}
    <div class="table-wrap"><table><thead><tr><th>Project</th><th>Chats</th><th>Prompts</th><th>Messages</th><th>Input words</th><th>Output words</th><th>Estimated use</th><th>Reply latency</th><th>Long waits</th></tr></thead><tbody>
      {stats.projects.filter(project => !onlyUnnamed || (project.id && !names[project.id])).map(project => { const time = timing.projects.find(value => value.id === project.id); return <tr key={project.id}><td>
        {project.id ? <ProjectName id={project.id} name={names[project.id]} onSave={name => { const next = { ...names }; if (name) next[project.id] = name; else delete next[project.id]; save(next) }} /> : 'Unassigned'}
      </td><td>{project.chats}</td><td>{project.prompts}</td><td>{project.messages}</td><td>{project.input.words}</td><td>{project.output.words}</td><td><button type="button" onClick={() => setSelectedId(project.id)}>{Math.round((time?.usageMs ?? 0) / 60_000)} min</button></td><td>{Math.round((time?.thinkingMs ?? 0) / 60_000)} min</td><td>{time?.longWaits ?? 0}</td></tr> })}
    </tbody></table></div>
    {selectedId !== undefined && <section><h3>{names[selectedId] || selectedId || 'Unassigned'} by day</h3>
      <TimingChart timing={{ ...timing, days: timing.projectDays.filter(day => day.projectId === selectedId).map(day => ({ ...day, id: day.date })) }} calendarDays={stats.days.map(day => day.date)} />
      <table><thead><tr><th>Day</th><th>Estimated use</th><th>Reply latency</th></tr></thead><tbody>
        {timing.projectDays.filter(day => day.projectId === selectedId).sort((a, b) => a.date.localeCompare(b.date)).map(day => <tr key={day.id}><td>{day.date}</td><td>{Math.round(day.usageMs / 60_000)} min</td><td>{Math.round(day.thinkingMs / 60_000)} min</td></tr>)}
      </tbody></table>
      <h3>Activity</h3><p>{stats.projects.find(project => project.id === selectedId)?.activeDays ?? 0} active days</p>
      <table><thead><tr><th>Day</th><th>Prompts</th><th>Messages</th><th>Input words</th><th>Output words</th></tr></thead><tbody>
        {stats.projects.find(project => project.id === selectedId)?.days.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.prompts}</td><td>{day.messages}</td><td>{day.input.words}</td><td>{day.output.words}</td></tr>)}
      </tbody></table>
      <h3>Conversations</h3><ul>{timing.conversations.filter(chat => chat.projectId === selectedId).sort((a, b) => b.usageMs - a.usageMs).map(chat => <li key={chat.id}><a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title}</a> - {Math.round(chat.usageMs / 60_000)} min</li>)}</ul>
    </section>}
  </section>
}
