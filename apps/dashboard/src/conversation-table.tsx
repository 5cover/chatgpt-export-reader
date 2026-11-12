import { useMemo } from 'preact/hooks'
import type { ConversationAnalytics, TimingStatistics } from '@chatgpt-export-reader/core'
import { SortableTable, type SortableColumn } from './sortable-table.js'
import { ProjectLink, useProjectNames } from './project-identity.js'
import { TextValue } from './ui.js'
import { formatDuration } from './format.js'
export const conversationRoute = (id: string) => `#/conversations/${encodeURIComponent(id)}`
export function ConversationTable({
  conversations,
  timing,
}: {
  conversations: readonly ConversationAnalytics[]
  timing?: TimingStatistics
}) {
  const { names } = useProjectNames()
  const times = useMemo(() => new Map(timing?.conversations.map(chat => [chat.id, chat.usageMs])), [timing])
  const columns: SortableColumn<ConversationAnalytics>[] = [
    {
      id: 'title',
      label: 'Conversation',
      align: 'left',
      compare: (a, b) => a.title.localeCompare(b.title),
      render: chat => <a href={conversationRoute(chat.id)}>{chat.title || 'Untitled chat'}</a>,
    },
    {
      id: 'project',
      label: 'Project',
      align: 'left',
      compare: (a, b) =>
        (names[a.projectId ?? ''] || a.projectId || 'Unassigned').localeCompare(
          names[b.projectId ?? ''] || b.projectId || 'Unassigned'
        ),
      render: chat => <ProjectLink id={chat.projectId ?? ''} />,
    },
    {
      id: 'time',
      label: 'Estimated interaction time',
      compare: (a, b) => (times.get(a.id) ?? 0) - (times.get(b.id) ?? 0),
      render: chat => formatDuration(times.get(chat.id) ?? 0),
    },
    {
      id: 'prompts',
      label: 'Prompts',
      compare: (a, b) => a.prompts - b.prompts,
      render: chat => chat.prompts.toLocaleString(),
    },
    {
      id: 'input',
      label: 'Input',
      compare: (a, b) => a.input.words - b.input.words,
      render: chat => <TextValue {...chat.input} />,
    },
    {
      id: 'output',
      label: 'Output',
      compare: (a, b) => a.output.words - b.output.words,
      render: chat => <TextValue {...chat.output} />,
    },
    {
      id: 'days',
      label: 'Active days',
      optional: true,
      compare: (a, b) => a.activeDays - b.activeDays,
      render: chat => chat.activeDays,
    },
    {
      id: 'lifetime',
      label: 'First-to-last message span',
      optional: true,
      compare: (a, b) => (a.lifetimeMs ?? 0) - (b.lifetimeMs ?? 0),
      render: chat => (chat.lifetimeMs === undefined ? 'Undated' : formatDuration(chat.lifetimeMs)),
    },
  ]
  return (
    <SortableTable
      label="Conversations in scope"
      rows={conversations}
      columns={columns}
      initialSort={{ column: 'time', direction: 'descending' }}
      rowKey={chat => chat.id}
    />
  )
}
