import { useMemo, useRef, useState } from 'preact/hooks'
import type { AnalyticsStatistics, RepeatedPhrase, TurnBin } from '@stemmatic/core'
import type { AnalysisScope } from './analysis-scope.js'
import type { WorkerClient } from './worker-client.js'
import { useWorkerQuery } from './use-worker-query.js'
import { useDebouncedValue } from './use-debounced-value.js'
import { CopyButton, Disclosure, Metric, Status } from './ui.js'
import { ProjectLink } from './project-identity.js'
import { WorkerMessage } from './worker-message.js'
import { SortableTable } from './sortable-table.js'
import { SessionTable } from './session-evidence.js'
import { formatDate, formatDuration } from './format.js'
export function ConversationView({
  id,
  client,
  scope,
  stats,
}: {
  id: string
  client: WorkerClient
  scope: AnalysisScope
  stats: AnalyticsStatistics
}) {
  const [query, setQuery] = useState('')
  const [queryMode, setQueryMode] = useState<'literal' | 'word-sequence'>('literal')
  const [offset, setOffset] = useState(0)
  const settledQuery = useDebouncedValue(query)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const outlineTarget = useRef<HTMLElement>(null)
  const detailRequest = useMemo(() => ({ type: 'conversation-detail' as const, id, scope }), [id, scope])
  const outlineRequest = useMemo(
    () =>
      query === settledQuery
        ? { type: 'conversation-outline' as const, id, scope, offset, query, queryMode }
        : undefined,
    [id, scope, offset, query, queryMode, settledQuery]
  )
  const detail = useWorkerQuery(client, detailRequest)
  const outline = useWorkerQuery(client, outlineRequest)
  const inspect = (query: string, offset = 0) => {
    setQuery(query)
    setQueryMode(query ? 'word-sequence' : 'literal')
    setOffset(offset)
    setOutlineOpen(true)
    requestAnimationFrame(() => {
      outlineTarget.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      outlineTarget.current?.focus()
    })
  }
  if (detail.kind === 'loading') return <Status title="Loading conversation" detail="Preparing scoped evidence..." />
  if (detail.kind === 'error') return <Status title="Conversation unavailable" detail={detail.message} error />
  if (!detail.value.detail)
    return (
      <p>
        No messages from this conversation fit the scope. <a href="#/conversations">Browse conversations.</a>
      </p>
    )
  const value = detail.value.detail
  return (
    <>
      <a href="#/conversations">All conversations in scope</a>
      <section>
        <h3>{value.summary.title || 'Untitled chat'}</h3>
        <p>
          <ProjectLink id={value.summary.projectId ?? ''} />
        </p>
        <dl class="summary-grid">
          <Metric
            label="Estimated interaction time"
            value={formatDuration(stats.timing.conversations.find(chat => chat.id === id)?.usageMs ?? 0)}
          />
          <Metric label="Prompts" value={value.summary.prompts} />
          <Metric
            label="Input"
            value={`${value.summary.input.words.toLocaleString()} words`}
            secondary={`${value.summary.input.characters.toLocaleString()} characters`}
          />
          <Metric
            label="Output"
            value={`${value.summary.output.words.toLocaleString()} words`}
            secondary={`${value.summary.output.characters.toLocaleString()} characters`}
          />
        </dl>
        <p>
          {value.summary.activeDays} active days. First-to-last message span:{' '}
          {value.summary.lifetimeMs === undefined ? 'undated' : formatDuration(value.summary.lifetimeMs)} (elapsed, not
          time spent).
        </p>
      </section>
      <Disclosure title="Session structure">
        <p>
          These sessions are reconstructed within this conversation; they can differ from sessions across the full
          scope.
        </p>
        <SessionTable sessions={value.sessions} timeZone={scope.timeZone} linkSessions={false} />
      </Disclosure>
      <section>
        <h3>Conversation timeline</h3>
        <p>Bins preserve chronological order. Select a bin to clear search and reveal its turns.</p>
        <Timeline bins={value.turnBins} onInspect={bin => inspect('', bin.startIndex - 1)} />
      </section>
      <section ref={outlineTarget} class="outline-section" tabIndex={-1} aria-label="Message outline">
        <Disclosure title="Message outline" open={outlineOpen} onToggle={setOutlineOpen}>
          <label>
            Search message text
            <input
              type="search"
              value={query}
              onInput={event => {
                setQueryMode('literal')
                setQuery(event.currentTarget.value)
                setOffset(0)
              }}
            />
          </label>
          {queryMode === 'word-sequence' && (
            <p>
              Matching whole word sequences, ignoring punctuation and spacing. Edit the search to return to literal text
              matching.
            </p>
          )}
          {query !== settledQuery || outline.kind === 'loading' ? (
            <p role="status">Loading messages...</p>
          ) : outline.kind === 'error' ? (
            <Status title="Messages unavailable" detail={outline.message} error />
          ) : (
            <>
              <p role="status">{outline.value.page.total} matching turns.</p>
              <div class="message-list">
                {outline.value.page.turns.map(turn => (
                  <WorkerMessage
                    key={turn.id}
                    client={client}
                    request={{ type: 'message-content', id, ids: [turn.id], scope }}
                    role={turn.role}
                    preview={turn.preview}
                    metadata={
                      <span>
                        Turn {turn.index}; {turn.input.words + turn.output.words} words;{' '}
                        {turn.createTime ? (
                          <time dateTime={turn.createTime}>{formatDate(turn.createTime, scope.timeZone)}</time>
                        ) : (
                          'Undated'
                        )}
                        {turn.model && `; ${turn.model}`}
                      </span>
                    }
                  />
                ))}
              </div>
              <nav class="pagination" aria-label="Message pages">
                <button
                  class="ui-button"
                  type="button"
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 50))}>
                  Previous messages
                </button>
                <span>
                  {outline.value.page.total ? offset + 1 : 0}-{Math.min(offset + 50, outline.value.page.total)} of{' '}
                  {outline.value.page.total}
                </span>
                <button
                  class="ui-button"
                  type="button"
                  disabled={offset + 50 >= outline.value.page.total}
                  onClick={() => setOffset(offset + 50)}>
                  Next messages
                </button>
              </nav>
            </>
          )}
        </Disclosure>
      </section>
      <PhraseAnalysis id={id} scope={scope} client={client} onInspect={phrase => inspect(phrase)} />
      <Disclosure title="Conversation identity">
        <code>{id}</code>
      </Disclosure>
    </>
  )
}
function Timeline({ bins, onInspect }: { bins: readonly TurnBin[]; onInspect: (bin: TurnBin) => void }) {
  const maximum = bins.reduce((max, bin) => Math.max(max, bin.input.words, bin.output.words), 1)
  return (
    <>
      <label>
        Jump to turns
        <select
          value=""
          onChange={event => {
            const bin = bins.find(bin => String(bin.startIndex) === event.currentTarget.value)
            if (bin) onInspect(bin)
          }}>
          <option value="">Choose a range</option>
          {bins.map(bin => (
            <option key={bin.startIndex} value={bin.startIndex}>
              {bin.startIndex}-{bin.endIndex}
            </option>
          ))}
        </select>
      </label>
      <div class="turn-timeline" aria-label="Turn volume bins">
        {bins.map(bin => (
          <button
            key={bin.startIndex}
            type="button"
            aria-label={`Inspect turns ${bin.startIndex} through ${bin.endIndex}: ${bin.input.words} input words and ${bin.output.words} output words`}
            onClick={() => onInspect(bin)}>
            <span aria-hidden="true" class="input-bar" style={{ height: `${(bin.input.words / maximum) * 100}%` }} />
            <span aria-hidden="true" class="output-bar" style={{ height: `${(bin.output.words / maximum) * 100}%` }} />
          </button>
        ))}
      </div>
      <p class="chart-note">Orange: input words. Teal: output words.</p>
    </>
  )
}
function PhraseAnalysis({
  id,
  scope,
  client,
  onInspect,
}: {
  id: string
  scope: AnalysisScope
  client: WorkerClient
  onInspect: (phrase: string) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const request = useMemo(
    () => (enabled ? { type: 'conversation-repetitions' as const, id, scope } : undefined),
    [enabled, id, scope]
  )
  const state = useWorkerQuery(client, request)
  return (
    <Disclosure title="Investigate repeated language" onOpen={() => setEnabled(true)}>
      {!enabled || state.kind === 'loading' ? (
        <p role="status">
          {enabled ? 'Analyzing repeated language...' : 'Open this section to analyze repeated language.'}
        </p>
      ) : state.kind === 'error' ? (
        <Status title="Repeated language unavailable" detail={state.message} error />
      ) : (
        <>
          <p>
            Up to 500 maximal repeated word sequences per role are shown. These are leads, not evidence of friction by
            themselves. Inspect their occurrences before interpreting them. Score is words multiplied by occurrences.
          </p>
          <PhraseTable title="Your phrases" rows={state.value.analysis.user} onInspect={onInspect} />
          <PhraseTable title="Assistant phrases" rows={state.value.analysis.assistant} onInspect={onInspect} />
        </>
      )}
    </Disclosure>
  )
}
function PhraseTable({
  title,
  rows,
  onInspect,
}: {
  title: string
  rows: readonly RepeatedPhrase[]
  onInspect: (phrase: string) => void
}) {
  return (
    <section>
      <h3>{title}</h3>
      <SortableTable
        label={title}
        rows={rows}
        columns={[
          {
            id: 'phrase',
            label: 'Phrase',
            align: 'left',
            render: row => <span class="phrase-text">{row.phrase}</span>,
          },
          {
            id: 'occurrences',
            label: 'Occurrences',
            compare: (a, b) => a.occurrences - b.occurrences,
            render: row => row.occurrences,
          },
          { id: 'score', label: 'Score', compare: (a, b) => a.score - b.score, render: row => row.score },
          {
            id: 'inspect',
            label: 'Evidence',
            render: row => (
              <button class="ui-button" type="button" onClick={() => onInspect(row.phrase)}>
                Inspect occurrences
              </button>
            ),
          },
          {
            id: 'copy',
            label: 'Copy',
            optional: true,
            render: row => <CopyButton text={row.phrase} label="Copy phrase" />,
          },
        ]}
        initialSort={{ column: 'score', direction: 'descending' }}
        rowKey={row => row.phrase}
      />
    </section>
  )
}
