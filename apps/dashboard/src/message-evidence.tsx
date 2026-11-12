import { useId, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

export function MessageEvidence({
  role,
  preview,
  metadata,
  content,
  error,
  onLoad,
}: {
  role: string
  preview: string
  metadata: ComponentChildren
  content?: string
  error?: string
  onLoad: () => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <article class={`message-evidence ${role}`}>
      <div class="message-meta">
        {metadata}
        <span>{role}</span>
      </div>
      <button
        class="message-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open)
          if (!open && content === undefined) onLoad()
        }}>
        {preview || 'Empty message'}
      </button>
      <div id={id} hidden={!open}>
        {open &&
          (error ? (
            <div role="alert">
              {error}
              <button type="button" class="ui-button" onClick={onLoad}>
                Retry
              </button>
            </div>
          ) : content === undefined ? (
            <p role="status">Loading message...</p>
          ) : (
            <pre>{content || 'Empty message'}</pre>
          ))}
      </div>
    </article>
  )
}
