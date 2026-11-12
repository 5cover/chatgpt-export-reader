import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
export const projectNamesKey = 'chatgpt-export-reader/project-names/v1'
export type ProjectNames = Record<string, string>
const listeners = new Set<() => void>()
function validateName(name: unknown): string {
  if (typeof name !== 'string' || name.length > 200)
    throw new Error('Project names must be text of at most 200 characters.')
  return name.trim()
}
export function validNames(value: unknown): ProjectNames {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object of project IDs and names.')
  return Object.fromEntries<string>(
    Object.entries(value)
      .map(([id, name]): [string, string] => {
        if (!id) throw new Error('A project ID cannot be empty.')
        return [id, validateName(name)]
      })
      .filter(([, name]) => name)
  )
}
function snapshot(): { names: ProjectNames; warning?: string } {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(projectNamesKey) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return { names: {}, warning: 'The saved project-name mapping is invalid. Import a backup to restore it.' }
    const names: ProjectNames = Object.create(null) as ProjectNames
    let invalid = 0
    for (const [id, name] of Object.entries(value)) {
      try {
        if (!id) throw new Error('Empty ID')
        const valid = validateName(name)
        if (valid) names[id] = valid
      } catch {
        invalid++
      }
    }
    return {
      names,
      warning: invalid ? `${invalid} invalid saved names were ignored. Valid names have been preserved.` : undefined,
    }
  } catch {
    return { names: {}, warning: 'Project names could not be read. Browser storage may be unavailable.' }
  }
}
export function readProjectNames(): ProjectNames {
  return snapshot().names
}
export function useProjectNames() {
  const [state, setState] = useState(snapshot)
  useEffect(() => {
    const refresh = () => setState(snapshot())
    listeners.add(refresh)
    addEventListener('storage', refresh)
    return () => {
      listeners.delete(refresh)
      removeEventListener('storage', refresh)
    }
  }, [])
  const save = (next: ProjectNames) => {
    const valid = validNames(next)
    try {
      localStorage.setItem(projectNamesKey, JSON.stringify(valid))
    } catch {
      throw new Error('Names could not be saved. Browser storage is unavailable or full.')
    }
    for (const listener of listeners) listener()
  }
  return {
    ...state,
    save,
    setName: (id: string, name: string) => {
      validateName(name)
      const next = Object.fromEntries(Object.entries(readProjectNames()).filter(([key]) => key !== id))
      if (name.trim()) next[id] = name.trim()
      save(next)
    },
  }
}
export const projectRoute = (id: string) => `#/projects/${id ? encodeURIComponent(id) : '~unassigned'}`
export function ProjectLabel({ id, name }: { id: string; name?: string }) {
  const { names } = useProjectNames()
  return <span class="project-label">{name || names[id] || id || 'Unassigned'}</span>
}
export function ProjectLink({ id }: { id: string }) {
  return (
    <a href={projectRoute(id)}>
      <ProjectLabel id={id} />
    </a>
  )
}
export function ProjectNameEditor({ id }: { id: string }) {
  const { names, setName } = useProjectNames()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const errorId = useId()
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    } else if (wasEditing.current) trigger.current?.focus()
    wasEditing.current = editing
  }, [editing])
  const finish = () => {
    try {
      setName(id, draft)
      setError('')
      setEditing(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  if (!id) return <span>Unassigned</span>
  return editing ? (
    <span class="inline-editor">
      <input
        ref={input}
        aria-label={`Name for project ${id}`}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        maxLength={200}
        value={draft}
        onInput={event => setDraft(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setEditing(false)
          }
        }}
      />
      <button class="ui-button" type="button" onClick={finish}>
        Save
      </button>
      <button class="ui-button" type="button" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && (
        <small id={errorId} role="alert">
          {error}
        </small>
      )}
    </span>
  ) : (
    <button
      ref={trigger}
      type="button"
      class="editable-project text-button"
      title="Click to rename"
      aria-label={`Rename project ${names[id] || id}`}
      onClick={() => {
        setDraft(names[id] ?? '')
        setError('')
        setEditing(true)
      }}>
      <ProjectLabel id={id} />
    </button>
  )
}
