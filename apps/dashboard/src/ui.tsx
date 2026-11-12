import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { formatNumber } from './format.js'

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <fieldset class="choice">
      <legend>{label}</legend>
      {options.map(option => (
        <label key={option.value} class={value === option.value ? 'active' : ''}>
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
export function Status({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return (
    <div class={error ? 'status-card error' : 'status-card'} role={error ? 'alert' : 'status'}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}
export function Disclosure({
  title,
  children,
  open,
  onOpen,
  onToggle,
}: {
  title: string
  children: ComponentChildren
  open?: boolean
  onOpen?: () => void
  onToggle?: (open: boolean) => void
}) {
  // Keep mounted content and its exploration state when collapsing.
  return (
    <details
      class="disclosure"
      open={open ?? undefined}
      onToggle={event => {
        if (event.currentTarget.open) onOpen?.()
      }}>
      <summary
        onClick={event => {
          if (onToggle) {
            event.preventDefault()
            onToggle(!open)
          }
        }}>
        {title}
      </summary>
      <div class="disclosure-body">{children}</div>
    </details>
  )
}
export function FileButton({
  label,
  accept,
  directory,
  disabled,
  onFiles,
}: {
  label: string
  accept?: string
  directory?: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (directory) input.current?.setAttribute('webkitdirectory', '')
  }, [directory])
  return (
    <>
      <button class="ui-button" type="button" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        hidden
        type="file"
        accept={accept}
        multiple={directory}
        aria-label={label}
        onChange={event => {
          const files = [...(event.currentTarget.files ?? [])]
          event.currentTarget.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}
export function Metric({
  label,
  value,
  secondary,
  note,
}: {
  label: string
  value: number | string
  secondary?: string
  note?: string
}) {
  return (
    <div class="metric">
      <dt>{label}</dt>
      <dd>
        <strong>{typeof value === 'number' ? formatNumber(value) : value}</strong>
        {secondary && <small>{secondary}</small>}
        {note && <small>{note}</small>}
      </dd>
    </div>
  )
}
export function TextValue({ words, characters }: { words: number; characters: number }) {
  return (
    <span class="text-value">
      <span>{formatNumber(words)} words</span>
      <small>{formatNumber(characters)} characters</small>
    </span>
  )
}
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState('')
  useEffect(() => setState(''), [text])
  return (
    <>
      <button
        class="ui-button"
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => setState('Copied'),
            () => setState('Copy failed. Select and copy the text manually.')
          )
        }}>
        {label}
      </button>
      <span class="action-status" role="status">
        {state}
      </span>
    </>
  )
}
