import { useState } from 'preact/hooks'
import type { TimingStatistics } from '@chatgpt-export-reader/core'

const storageKey = 'chatgpt-export-reader/project-names/v1'
type Names = Record<string, string>
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
export function Projects({ timing }: { timing: TimingStatistics }) {
  const [names, setNames] = useState(readProjectNames)
  const [error, setError] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
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
    {error && <p role="alert">{error}</p>}
    <table><thead><tr><th>Project</th><th>Chats</th><th>Estimated use</th><th>Reply latency</th><th>Long waits</th></tr></thead><tbody>
      {timing.projects.map(project => <tr key={project.id}><td>
        {project.id ? <><input aria-label={`Name for project ${project.id}`} value={names[project.id] ?? ''} placeholder={project.id} onInput={event => save({ ...names, [project.id]: event.currentTarget.value })} /><small>{project.id}</small></> : 'Unassigned'}
      </td><td>{timing.conversations.filter(chat => chat.projectId === project.id).length}</td><td><button type="button" onClick={() => setSelectedId(project.id)}>{Math.round(project.usageMs / 60_000)} min</button></td><td>{Math.round(project.thinkingMs / 60_000)} min</td><td>{project.longWaits}</td></tr>)}
    </tbody></table>
    {selectedId !== undefined && <section><h3>{names[selectedId] || selectedId || 'Unassigned'} by day</h3>
      <table><thead><tr><th>Day</th><th>Estimated use</th><th>Reply latency</th></tr></thead><tbody>
        {timing.projectDays.filter(day => day.projectId === selectedId).sort((a, b) => a.date.localeCompare(b.date)).map(day => <tr key={day.id}><td>{day.date}</td><td>{Math.round(day.usageMs / 60_000)} min</td><td>{Math.round(day.thinkingMs / 60_000)} min</td></tr>)}
      </tbody></table>
      <h3>Conversations</h3><ul>{timing.conversations.filter(chat => chat.projectId === selectedId).sort((a, b) => b.usageMs - a.usageMs).map(chat => <li key={chat.id}><a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title}</a> - {Math.round(chat.usageMs / 60_000)} min</li>)}</ul>
    </section>}
  </section>
}
