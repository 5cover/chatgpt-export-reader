import type { SessionAnalytics } from '@chatgpt-export-reader/core'
import { SortableTable } from './sortable-table.js'
import { TextValue } from './ui.js'
import { formatDate, formatDuration } from './format.js'
import { sessionRoute } from './routes.js'
import { conversationRoute } from './conversation-table.js'
export function SessionTable({
  sessions,
  timeZone,
  linkSessions = true,
}: {
  sessions: readonly SessionAnalytics[]
  timeZone: string
  linkSessions?: boolean
}) {
  return (
    <SortableTable
      label="Sessions in scope"
      rows={sessions}
      columns={[
        {
          id: 'start',
          label: 'Session start',
          align: 'left',
          compare: (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
          render: session =>
            linkSessions ? (
              <a href={sessionRoute(session.id)}>{formatDate(session.startAt, timeZone)}</a>
            ) : (
              formatDate(session.startAt, timeZone)
            ),
        },
        {
          id: 'prompts',
          label: 'Prompts',
          compare: (a, b) => a.prompts - b.prompts,
          render: session => session.prompts,
        },
        {
          id: 'span',
          label: 'Observed elapsed span',
          compare: (a, b) => a.spanMs - b.spanMs,
          render: session => formatDuration(session.spanMs),
        },
        { id: 'chats', label: 'Conversations', render: session => session.conversations.length },
        {
          id: 'input',
          label: 'Input',
          optional: true,
          compare: (a, b) => a.input.words - b.input.words,
          render: session => <TextValue {...session.input} />,
        },
        {
          id: 'output',
          label: 'Output',
          optional: true,
          compare: (a, b) => a.output.words - b.output.words,
          render: session => <TextValue {...session.output} />,
        },
      ]}
      initialSort={{ column: 'prompts', direction: 'descending' }}
      rowKey={session => session.id}
    />
  )
}
export function SessionEvidence({ session, timeZone }: { session?: SessionAnalytics; timeZone: string }) {
  return !session ? (
    <p>
      This session is not available in the current scope. <a href="#/rhythm">Return to Time and rhythm.</a>
    </p>
  ) : (
    <section>
      <h3>{formatDate(session.startAt, timeZone)}</h3>
      <p>
        {session.prompts} prompts across {session.conversations.length} conversations over an observed span of{' '}
        {formatDuration(session.spanMs)}. This is elapsed time, not interaction time. Sessions may span multiple
        conversations.
      </p>
      <h3>Contributing conversations</h3>
      <ul>
        {session.conversations.map(chat => (
          <li key={chat.id}>
            <a href={conversationRoute(chat.id)}>{chat.title || 'Untitled chat'}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}
export function SessionScatter({ sessions }: { sessions: readonly SessionAnalytics[] }) {
  const maxPrompts = sessions.reduce((max, session) => Math.max(max, session.prompts), 1)
  const maxSpan = sessions.reduce((max, session) => Math.max(max, session.spanMs), 1)
  const sample = [...sessions].sort((a, b) => b.prompts - a.prompts).slice(0, 200)
  return (
    <figure>
      <svg
        viewBox="0 0 640 280"
        role="img"
        aria-label="Session prompts versus observed elapsed span. Exact values and links are in the sessions table.">
        <path d="M65 15V235H620" fill="none" stroke="currentColor" />
        <text x="65" y="255">
          0
        </text>
        <text x="580" y="255">
          {maxPrompts}
        </text>
        <text x="260" y="277">
          Prompts per session
        </text>
        <text x="0" y="25">
          {formatDuration(maxSpan)}
        </text>
        <text x="0" y="235">
          0m
        </text>
        {sample.map(session => (
          <circle
            key={session.id}
            cx={65 + (session.prompts / maxPrompts) * 550}
            cy={235 - (session.spanMs / maxSpan) * 215}
            r="3"
            fill="#0b7773"
            opacity="0.5"
          />
        ))}
      </svg>
      <figcaption>
        Observed elapsed span, not interaction time.{' '}
        {sessions.length > 200
          ? 'The plot shows the 200 sessions with the most prompts. The table includes every session.'
          : 'Each point is one session. Exact values and conversation links are below.'}
      </figcaption>
    </figure>
  )
}
