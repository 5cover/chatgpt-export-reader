import { useMemo, useState } from 'preact/hooks'
import { deriveOutputConcentration, type AnalyticsDay } from '@chatgpt-export-reader/core'
import type { StatisticsResult } from './worker-protocol.js'
import { Choice, Disclosure, Metric, TextValue } from './ui.js'
import { DailySeriesChart } from './daily-series-chart.js'
import { dailyValues, measures, type Measure } from './metric-definitions.js'
import { formatDuration, formatShare, formatRatio } from './format.js'
import { ProjectLink } from './project-identity.js'
import { SortableTable } from './sortable-table.js'
import { conversationRoute } from './conversation-table.js'
import { Methodology } from './methodology.js'
export function Overview({
  result,
  selectedDate,
  onSelectDate,
}: {
  result: StatisticsResult
  selectedDate?: string
  onSelectDate: (date: string) => void
}) {
  const { stats, previous, comparisonCovered } = result
  const [measure, setMeasure] = useState<Measure>('usageMs')
  const values = useMemo(() => dailyValues(stats.days, stats.timing, measure), [stats, measure])
  const delta = (current: number, old: number | undefined) =>
    !comparisonCovered
      ? 'Export bounds do not cover both periods'
      : !old
        ? 'No earlier activity to compare'
        : `${current >= old ? '+' : ''}${Math.round((current / old - 1) * 100)}% vs previous period`
  const concentration = useMemo(() => deriveOutputConcentration(stats.conversations), [stats])
  const selected = stats.days.find(day => day.date === selectedDate)
  const times = new Map(stats.timing.projects.map(project => [project.id, project.usageMs]))
  const oldTimes = new Map(previous?.timing.projects.map(project => [project.id, project.usageMs]))
  const projects = [
    ...new Set([
      ...stats.projects.map(project => project.id),
      ...(previous?.projects.map(project => project.id) ?? []),
    ]),
  ]
  return (
    <>
      <dl class="summary-grid">
        <Metric
          label="Estimated interaction time"
          value={formatDuration(stats.timing.summary.usageMs)}
          note={delta(stats.timing.summary.usageMs, previous?.timing.summary.usageMs)}
        />
        <Metric
          label="Prompts"
          value={stats.summary.prompts}
          note={delta(stats.summary.prompts, previous?.summary.prompts)}
        />
        <Metric
          label="Active days"
          value={`${stats.summary.activeDays} / ${stats.days.length}`}
          secondary={
            stats.summary.activeDays
              ? `${(stats.summary.prompts / stats.summary.activeDays).toFixed(1)} prompts per active day`
              : 'No dated activity'
          }
          note={delta(stats.summary.activeDays, previous?.summary.activeDays)}
        />
        <Metric
          label="Projects with activity"
          value={stats.projects.length}
          secondary={`${stats.summary.chats} conversations`}
        />
      </dl>
      {result.period && (
        <p class="comparison-note">
          {result.period.days} calendar days, {result.period.startDate} through {result.period.endDate}. Comparison:{' '}
          {result.previousPeriod?.startDate} through {result.previousPeriod?.endDate}, the preceding equal-length
          period.{' '}
          {!comparisonCovered &&
            'The export bounds do not cover both periods; missing history is not evidence of inactivity.'}
        </p>
      )}
      {result.available &&
        result.period &&
        (result.period.startDate < result.available.startDate || result.period.endDate > result.available.endDate) && (
          <p class="comparison-note">
            Requested dates extend beyond the export's observed range ({result.available.startDate} through{' '}
            {result.available.endDate}). Zeroes outside that range mean no exported evidence, not established
            inactivity.
          </p>
        )}
      {comparisonCovered && previous && (
        <p class="driver-note">
          Activity combines frequency ({stats.summary.activeDays} active days vs {previous.summary.activeDays}) and
          depth ({stats.summary.activeDays ? (stats.summary.prompts / stats.summary.activeDays).toFixed(1) : '0'}{' '}
          prompts per active day vs{' '}
          {previous.summary.activeDays ? (previous.summary.prompts / previous.summary.activeDays).toFixed(1) : '0'}).
          Volume alone does not establish productivity or excessive use.
        </p>
      )}
      <Choice
        label="Daily measure"
        value={measure}
        onChange={setMeasure}
        options={(['usageMs', 'prompts', 'inputWords', 'outputWords', 'messages', 'totalWords'] as const).map(
          value => ({ value, label: measures[value].label })
        )}
      />
      <DailySeriesChart
        title="Activity over time"
        days={values}
        measure={measure}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
      />
      {selected && (
        <section class="day-inspector" aria-label="Selected day evidence">
          <h3>Conversations on {selected.date}</h3>
          <p>
            {selected.prompts} prompts; estimated interaction time{' '}
            {formatDuration(stats.timing.days.find(day => day.id === selected.date)?.usageMs ?? 0)}.
          </p>
          <ul class="project-breakdown">
            {stats.timing.projectDays
              .filter(day => day.date === selected.date)
              .sort((a, b) => b.usageMs - a.usageMs)
              .map(day => (
                <li key={day.id}>
                  <ProjectLink id={day.projectId} />
                  <span>{formatDuration(day.usageMs)}</span>
                </li>
              ))}
          </ul>
          <DayConversations day={selected} />
        </section>
      )}
      <section>
        <h3>What accounts for the time?</h3>
        <p>
          Time shares compare the current and previous period. Their reliability depends on the estimation method and
          available history.
        </p>
        <SortableTable
          label="Project contributions"
          rows={projects}
          columns={[
            { id: 'project', label: 'Project', align: 'left', render: id => <ProjectLink id={id} /> },
            {
              id: 'time',
              label: 'Estimated interaction time',
              compare: (a, b) => (times.get(a) ?? 0) - (times.get(b) ?? 0),
              render: id => formatDuration(times.get(id) ?? 0),
            },
            {
              id: 'share',
              label: 'Current share',
              render: id => formatShare((times.get(id) ?? 0) / (stats.timing.summary.usageMs || 1)),
            },
            {
              id: 'previous',
              label: 'Previous share',
              render: id =>
                comparisonCovered && previous?.timing.summary.usageMs
                  ? formatShare((oldTimes.get(id) ?? 0) / previous.timing.summary.usageMs)
                  : 'Not comparable',
            },
          ]}
          initialSort={{ column: 'time', direction: 'descending' }}
          rowKey={id => id}
        />
      </section>
      <Disclosure title="Text volume and reply delay">
        <dl class="summary-grid">
          <Metric
            label="Input"
            value={`${stats.summary.input.words.toLocaleString()} words`}
            secondary={`${stats.summary.input.characters.toLocaleString()} characters`}
          />
          <Metric
            label="Output"
            value={`${stats.summary.output.words.toLocaleString()} words`}
            secondary={`${stats.summary.output.characters.toLocaleString()} characters`}
          />
          <Metric label="Total first-reply delay" value={formatDuration(stats.timing.summary.thinkingMs)} />
          <Metric label="Sessions" value={stats.summary.sessions} note="Grouped using the session definition above" />
        </dl>
        <p>
          Assistant words per user word:{' '}
          {formatRatio(stats.summary.input.words ? stats.summary.output.words / stats.summary.input.words : null)}. This
          describes output expansion, not quality.
        </p>
      </Disclosure>
      <Disclosure title="Output concentration">
        <p>
          Share of assistant words from the top 1, 5, and 10 conversations:{' '}
          {concentration.topConversationShares.map(share => formatShare(share.share)).join(' / ')}.
        </p>
        <SortableTable
          label="Conversations ranked by output share"
          rows={concentration.conversations}
          columns={[
            {
              id: 'conversation',
              label: 'Conversation',
              align: 'left',
              render: entry => (
                <a href={conversationRoute(entry.conversation.id)}>{entry.conversation.title || 'Untitled chat'}</a>
              ),
            },
            {
              id: 'words',
              label: 'Output words',
              compare: (a, b) => a.outputWords - b.outputWords,
              render: entry => entry.outputWords.toLocaleString(),
            },
            { id: 'share', label: 'Share', render: entry => formatShare(entry.share) },
          ]}
          initialSort={{ column: 'words', direction: 'descending' }}
          rowKey={entry => entry.conversation.id}
        />
      </Disclosure>
      <Methodology timing={stats.timing} />
    </>
  )
}
function DayConversations({ day }: { day: AnalyticsDay }) {
  return (
    <SortableTable
      label={`Conversation contributions on ${day.date}`}
      rows={day.conversations}
      columns={[
        {
          id: 'title',
          label: 'Conversation',
          align: 'left',
          compare: (a, b) => a.title.localeCompare(b.title),
          render: chat => <a href={conversationRoute(chat.id)}>{chat.title || 'Untitled chat'}</a>,
        },
        { id: 'prompts', label: 'Prompts', compare: (a, b) => a.prompts - b.prompts, render: chat => chat.prompts },
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
      ]}
      initialSort={{ column: 'prompts', direction: 'descending' }}
      rowKey={chat => chat.id}
    />
  )
}
