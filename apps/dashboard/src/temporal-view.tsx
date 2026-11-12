import { useMemo, useState } from 'preact/hooks'
import type { TemporalMessageFilter, TemporalMessageRole } from '@chatgpt-export-reader/core'
import type { WorkerClient } from './worker-client.js'
import type { AnalysisScope } from './analysis-scope.js'
import { useWorkerQuery } from './use-worker-query.js'
import { WorkerMessage } from './worker-message.js'
import { Choice, Metric, Status, TextValue } from './ui.js'
import { SortableTable } from './sortable-table.js'
import { formatDate, hourLabel, weekdayName } from './format.js'
import { conversationRoute } from './conversation-table.js'
import { temporalRoute } from './routes.js'
export function TemporalView({
  client,
  scope,
  filter,
}: {
  client: WorkerClient
  scope: AnalysisScope
  filter: TemporalMessageFilter
}) {
  const [conversationId, setConversationId] = useState<string>()
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest')
  const [offset, setOffset] = useState(0)
  const request = useMemo(
    () => ({ type: 'temporal-slice' as const, scope, filter, conversationId, order, offset }),
    [scope, filter, conversationId, order, offset]
  )
  const state = useWorkerQuery(client, request)
  const onFilter = (change: Partial<TemporalMessageFilter>) => {
    location.hash = temporalRoute({ ...filter, ...change })
  }
  return (
    <>
      <a href="#/rhythm">Time and rhythm</a>
      <h3>
        {filter.weekday === undefined ? 'Every day' : weekdayName(filter.weekday)} at {hourLabel(filter.hour)}
      </h3>
      <div class="filters">
        <label>
          Role
          <select
            value={filter.role}
            onChange={event => onFilter({ role: event.currentTarget.value as TemporalMessageRole })}>
            <option value="user">User prompts</option>
            <option value="assistant">Assistant messages</option>
          </select>
        </label>
        <label>
          Weekday
          <select
            value={filter.weekday ?? 'all'}
            onChange={event =>
              onFilter({ weekday: event.currentTarget.value === 'all' ? undefined : Number(event.currentTarget.value) })
            }>
            <option value="all">All weekdays</option>
            {Array.from({ length: 7 }, (_, day) => (
              <option key={day} value={day}>
                {weekdayName(day)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hour
          <select value={filter.hour} onChange={event => onFilter({ hour: Number(event.currentTarget.value) })}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.kind === 'loading' ? (
        <Status title="Loading time-slice evidence" detail="Finding messages in scope..." />
      ) : state.kind === 'error' ? (
        <Status title="Time slice unavailable" detail={state.message} error />
      ) : (
        <>
          <p>All matching activity in this time slice; the conversation filter below changes only the message list.</p>
          <dl class="summary-grid">
            <Metric
              label={filter.role === 'user' ? 'Prompts' : 'Assistant messages'}
              value={state.value.page.summary.messages}
            />
            <Metric label="Conversations" value={state.value.page.summary.conversations} />
            <Metric label="Active days" value={state.value.page.summary.activeDays} />
            <Metric
              label="Text"
              value={`${state.value.page.summary.text.words.toLocaleString()} words`}
              secondary={`${state.value.page.summary.text.characters.toLocaleString()} characters`}
            />
          </dl>
          <SortableTable
            label="Time-slice conversation contributions"
            rows={state.value.page.conversations}
            columns={[
              {
                id: 'title',
                label: 'Conversation',
                align: 'left',
                compare: (a, b) => a.title.localeCompare(b.title),
                render: chat => <a href={conversationRoute(chat.id)}>{chat.title || 'Untitled chat'}</a>,
              },
              {
                id: 'count',
                label: 'Matching messages',
                compare: (a, b) => a.messages - b.messages,
                render: chat => chat.messages,
              },
              {
                id: 'text',
                label: 'Text',
                compare: (a, b) => a.text.words - b.text.words,
                render: chat => <TextValue {...chat.text} />,
              },
            ]}
            initialSort={{ column: 'count', direction: 'descending' }}
            rowKey={chat => chat.id}
          />
          <section>
            <h3>Message evidence</h3>
            <label>
              Conversation
              <select
                value={conversationId ?? ''}
                onChange={event => {
                  setConversationId(event.currentTarget.value || undefined)
                  setOffset(0)
                }}>
                <option value="">All conversations</option>
                {state.value.page.conversations.map(chat => (
                  <option key={chat.id} value={chat.id}>
                    {chat.title || 'Untitled chat'}
                  </option>
                ))}
              </select>
            </label>
            <Choice
              label="Message order"
              value={order}
              onChange={value => {
                setOrder(value)
                setOffset(0)
              }}
              options={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
              ]}
            />
            <p role="status">{state.value.page.total} matching messages in this list.</p>
            {!state.value.page.total && <p>No messages match this filter.</p>}
            <div class="message-list">
              {state.value.page.messages.map(message => (
                <WorkerMessage
                  key={message.id}
                  client={client}
                  request={{ type: 'temporal-content', cacheKey: state.value.page.cacheKey, ids: [message.id] }}
                  role={message.role}
                  preview={message.preview}
                  metadata={
                    <>
                      <time dateTime={message.createTime}>{formatDate(message.createTime, scope.timeZone)}</time>
                      <a href={conversationRoute(message.conversationId)}>
                        {message.conversationTitle || 'Untitled chat'}
                      </a>
                      <span>{message.text.words} words</span>
                    </>
                  }
                />
              ))}
            </div>
            <nav class="pagination" aria-label="Time-slice message pages">
              <button
                type="button"
                class="ui-button"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 50))}>
                Previous messages
              </button>
              <span>
                {state.value.page.total ? offset + 1 : 0}-{Math.min(offset + 50, state.value.page.total)} of{' '}
                {state.value.page.total}
              </span>
              <button
                type="button"
                class="ui-button"
                disabled={offset + 50 >= state.value.page.total}
                onClick={() => setOffset(offset + 50)}>
                Next messages
              </button>
            </nav>
          </section>
        </>
      )}
    </>
  )
}
