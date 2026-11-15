import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import {
  createRecapPrompt,
  recapPromptModules,
  recapPromptModuleDefinitions,
  type RecapContextFormat,
  type RecapContextStrategy,
  type RecapPromptModule,
} from '@chatgpt-export-reader/core'
import { scopeKey, type AnalysisScope } from './analysis-scope.js'
import type { WorkerClient } from './worker-client.js'
import { TimeZoneSelect } from './scope-controls.js'
import { useProjectNames, readProjectNames } from './project-identity.js'
import { CopyButton, Status } from './ui.js'
import { formatByteSize } from './format.js'
export function RecapView({
  scope,
  client,
  projects,
}: {
  scope: AnalysisScope
  client: WorkerClient
  projects: readonly string[]
}) {
  const [override, setOverride] = useState(false)
  const [custom, setCustom] = useState(scope)
  const evidenceScope = override ? custom : scope
  const [strategy, setStrategy] = useState<RecapContextStrategy>('rolling-window')
  const [messages, setMessages] = useState(20)
  const [format, setFormat] = useState<RecapContextFormat>('yaml')
  const [modules, setModules] = useState<RecapPromptModule[]>([
    'context',
    'interpretation',
    'investigation',
    'interaction',
    'temporal',
    'writing',
    'themes',
    'behavior',
    'friction',
    'prompting',
  ])
  const { names } = useProjectNames()
  const [artifact, setArtifact] = useState<{ url: string; size: number; format: RecapContextFormat }>()
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const url = useRef<string>()
  const pending = useRef<AbortController>()
  const evidenceKey = JSON.stringify([scopeKey(evidenceScope), strategy, messages, format, names])
  useEffect(() => {
    pending.current?.abort()
    setGenerating(false)
    setError('')
    setArtifact(undefined)
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = undefined
    return () => {
      pending.current?.abort()
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [evidenceKey])
  const prompt = useMemo(() => createRecapPrompt(format, modules), [format, modules])
  const id = useId()
  const generate = () => {
    if (
      !Number.isInteger(messages) ||
      messages < 0 ||
      !Number.isInteger(evidenceScope.sessionGapMinutes) ||
      evidenceScope.sessionGapMinutes < 1 ||
      evidenceScope.sessionGapMinutes > 1440
    ) {
      setError('Context messages must be a non-negative integer; session gap must be between 1 and 1440 minutes.')
      return
    }
    if (url.current) URL.revokeObjectURL(url.current)
    setArtifact(undefined)
    setGenerating(true)
    setError('')
    pending.current?.abort()
    pending.current = new AbortController()
    const signal = pending.current.signal
    void client
      .request(
        {
          type: 'recap',
          settings: {
            ...evidenceScope,
            contextStrategy: strategy,
            contextMessages: messages,
            contextFormat: format,
            projectNames: readProjectNames(),
          },
        },
        { signal }
      )
      .then(
        result => {
          if (signal.aborted) return
          url.current = URL.createObjectURL(result.context)
          setArtifact({ url: url.current, size: result.context.size, format: result.contextFormat })
          setGenerating(false)
        },
        (error: unknown) => {
          if (!signal.aborted) {
            setError(error instanceof Error ? error.message : String(error))
            setGenerating(false)
          }
        }
      )
  }
  return (
    <>
      <p>
        Download evidence, choose prompt modules, then attach the file and paste the prompt into ChatGPT. Generation and
        prompt composition are independent; changing modules does not regenerate evidence.
      </p>
      <form
        class="recap-settings"
        onSubmit={event => {
          event.preventDefault()
          generate()
        }}>
        <label class="full-row">
          <input
            type="checkbox"
            checked={override}
            onChange={event => {
              setCustom(scope)
              setOverride(event.currentTarget.checked)
            }}
          />{' '}
          Use a different evidence scope
        </label>
        {override ? (
          <>
            <TimeZoneSelect value={custom.timeZone} onChange={timeZone => setCustom({ ...custom, timeZone })} />
            <label>
              From
              <input
                type="date"
                max={custom.endDate}
                value={custom.startDate ?? ''}
                onInput={event => setCustom({ ...custom, startDate: event.currentTarget.value || undefined })}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                min={custom.startDate}
                value={custom.endDate ?? ''}
                onInput={event => setCustom({ ...custom, endDate: event.currentTarget.value || undefined })}
              />
            </label>
            <label>
              Project
              <select
                value={custom.projectId === undefined ? 'all' : `id:${custom.projectId}`}
                onChange={event =>
                  setCustom({
                    ...custom,
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
            <label>
              Session gap (minutes)
              <input
                type="number"
                required
                min={1}
                max={1440}
                step={1}
                value={custom.sessionGapMinutes}
                onInput={event => setCustom({ ...custom, sessionGapMinutes: Number(event.currentTarget.value) })}
              />
            </label>
          </>
        ) : (
          <p class="full-row">
            Evidence inherits Analysis scope: {scope.startDate ?? 'first available day'} through{' '}
            {scope.endDate ?? 'last available day'}, {scope.timeZone},{' '}
            {scope.projectId === undefined ? 'all projects' : names[scope.projectId] || scope.projectId || 'Unassigned'}
            .
          </p>
        )}
        <label>
          Earlier context
          <select value={strategy} onChange={event => setStrategy(event.currentTarget.value as RecapContextStrategy)}>
            <option value="rolling-window">Limited earlier messages per conversation</option>
            <option value="full">Full earlier history</option>
          </select>
        </label>
        {strategy === 'rolling-window' && (
          <label>
            Earlier messages per conversation
            <input
              type="number"
              min={0}
              step={1}
              required
              value={messages}
              onInput={event => setMessages(Number(event.currentTarget.value))}
            />
          </label>
        )}
        <label>
          Evidence format
          <select value={format} onChange={event => setFormat(event.currentTarget.value as RecapContextFormat)}>
            <option value="yaml">YAML</option>
            <option value="yaml-anchors">YAML with anchors</option>
            <option value="toon">TOON</option>
          </select>
        </label>
        <p class="full-row">
          Earlier context supports interpretation but does not contribute to the period's statistics. Dates are
          inclusive. The evidence can contain private conversations; review where you share it.
        </p>
        <div class="recap-actions">
          <button class="ui-button primary" type="submit" disabled={generating}>
            {generating ? 'Preparing evidence...' : 'Generate evidence'}
          </button>
        </div>
      </form>
      <div class="recap-artifact" aria-live="polite">
        {artifact && (
          <a class="ui-button" href={artifact.url} download={`recap-context.${artifact.format === 'yaml-anchors' ? 'yaml' : artifact.format}`}>
            Download recap-context.{artifact.format === 'yaml-anchors' ? 'yaml' : artifact.format} ({formatByteSize(artifact.size)})
          </a>
        )}
        {generating && <p role="status">Building the scoped evidence file...</p>}
        {error && <Status title="Evidence unavailable" detail={error} error />}
      </div>
      <div class="recap-composer">
        <fieldset class="recap-module-list">
          <legend>Prompt modules</legend>
          <p>
            Evidence and processing instructions are always included. Choose modules for your purpose; not every
            combination needs to produce one unified output.
          </p>
          {recapPromptModules.map(module => {
            const label = module === 'room' ? 'Room portrait' : module === 'context' ? 'Context format' : module[0]!.toUpperCase() + module.slice(1)
            return (
              <div class="recap-module" key={module}>
                <input
                  type="checkbox"
                  id={`${id}-input-${module}`}
                  checked={modules.includes(module)}
                  disabled={module === 'context'}
                  aria-describedby={`${id}-${module}`}
                  onChange={event =>
                    setModules(
                      event.currentTarget.checked ? [...modules, module] : modules.filter(value => value !== module)
                    )
                  }
                />
                <span>
                  <label htmlFor={`${id}-input-${module}`}>
                    <strong>{label}</strong>
                  </label>
                  <small id={`${id}-${module}`}>{recapPromptModuleDefinitions[module].description}</small>
                </span>
              </div>
            )
          })}
        </fieldset>
        <section class="recap-prompt-card">
          <div class="chart-heading">
            <h3>Prompt preview</h3>
            <CopyButton text={prompt} label="Copy prompt" />
          </div>
          <pre class="recap-prompt">{prompt}</pre>
        </section>
      </div>
    </>
  )
}
