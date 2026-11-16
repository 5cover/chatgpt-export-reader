import { useMemo, useState } from 'preact/hooks'
import type { AnalyticsStatistics } from '@stemmatic/core'
import { ProjectNameEditor, projectNamesKey, projectRoute, useProjectNames, validNames } from './project-identity.js'
import { SortableTable, type SortableColumn } from './sortable-table.js'
import { Choice, FileButton, TextValue } from './ui.js'
import { formatDuration, formatShare } from './format.js'
import { DailySeriesChart } from './daily-series-chart.js'
import { dailyValues, measures, type Measure } from './metric-definitions.js'
import { ConversationTable } from './conversation-table.js'
import { chatGptProjectUrl } from './chatgpt-urls.js'

function OpenProjectInChatGPT({ id }: { id: string }) {
  if (!id) return null
  return (
    <a
      class="icon-button"
      href={chatGptProjectUrl(id)}
      target="_blank"
      rel="noreferrer"
      title="Open project in ChatGPT"
      onClick={event => event.stopPropagation()}>
      <span class="material-icons" aria-hidden="true">
        open_in_new
      </span>
      <span class="visually-hidden">Open project in ChatGPT</span>
    </a>
  )
}

export function Projects({
  stats,
  previous,
  id,
}: {
  stats: AnalyticsStatistics
  previous?: AnalyticsStatistics
  id?: string
}) {
  const { names, warning, save } = useProjectNames()
  const [error, setError] = useState('')
  const [onlyUnnamed, setOnlyUnnamed] = useState(false)
  const [query, setQuery] = useState('')
  const [measure, setMeasure] = useState<Measure>('usageMs')
  const times = useMemo(() => new Map(stats.timing.projects.map(project => [project.id, project])), [stats])
  const oldTimes = useMemo(() => new Map(previous?.timing.projects.map(project => [project.id, project])), [previous])
  const rows = stats.projects.filter(
    project =>
      (!onlyUnnamed || (project.id && !names[project.id])) &&
      `${names[project.id] ?? ''} ${project.id}`.toLowerCase().includes(query.toLowerCase())
  )
  const columns: SortableColumn<(typeof rows)[number]>[] = [
    {
      id: 'open',
      label: 'Open in ChatGPT',
      align: 'left',
      render: project => <OpenProjectInChatGPT id={project.id} />,
    },
    {
      id: 'name',
      label: 'Project',
      align: 'left',
      compare: (a, b) => (names[a.id] || a.id).localeCompare(names[b.id] || b.id),
      render: project => <ProjectNameEditor id={project.id} />,
    },
    {
      id: 'time',
      label: 'Estimated interaction time',
      compare: (a, b) => (times.get(a.id)?.usageMs ?? 0) - (times.get(b.id)?.usageMs ?? 0),
      render: project => formatDuration(times.get(project.id)?.usageMs ?? 0),
    },
    {
      id: 'share',
      label: 'Time share: current / previous',
      compare: (a, b) => (times.get(a.id)?.usageMs ?? 0) - (times.get(b.id)?.usageMs ?? 0),
      render: project =>
        `${formatShare((times.get(project.id)?.usageMs ?? 0) / (stats.timing.summary.usageMs || 1))} / ${previous?.timing.summary.usageMs ? formatShare((oldTimes.get(project.id)?.usageMs ?? 0) / previous.timing.summary.usageMs) : 'Not available'}`,
    },
    {
      id: 'prompts',
      label: 'Prompts',
      compare: (a, b) => a.prompts - b.prompts,
      render: project => project.prompts.toLocaleString(),
    },
    {
      id: 'chats',
      label: 'Conversations',
      compare: (a, b) => a.chats - b.chats,
      render: project => project.chats.toLocaleString(),
    },
    {
      id: 'input',
      label: 'Input',
      optional: true,
      compare: (a, b) => a.input.words - b.input.words,
      render: project => <TextValue {...project.input} />,
    },
    {
      id: 'output',
      label: 'Output',
      optional: true,
      compare: (a, b) => a.output.words - b.output.words,
      render: project => <TextValue {...project.output} />,
    },
    {
      id: 'delay',
      label: 'Total first-reply delay',
      optional: true,
      compare: (a, b) => (times.get(a.id)?.thinkingMs ?? 0) - (times.get(b.id)?.thinkingMs ?? 0),
      render: project => formatDuration(times.get(project.id)?.thinkingMs ?? 0),
    },
  ]
  const project = stats.projects.find(project => project.id === id)
  const projectValues = useMemo(() => {
    const byDate = new Map(project?.days.map(day => [day.date, day]))
    return dailyValues(
      stats.days.map(day => ({
        ...day,
        prompts: byDate.get(day.date)?.prompts ?? 0,
        input: byDate.get(day.date)?.input ?? { words: 0, characters: 0 },
        output: byDate.get(day.date)?.output ?? { words: 0, characters: 0 },
      })),
      {
        ...stats.timing,
        days: stats.timing.projectDays.filter(day => day.projectId === id).map(day => ({ ...day, id: day.date })),
      },
      measure
    )
  }, [stats, project, id, measure])
  const exportNames = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ schema: projectNamesKey, names }, null, 2)], { type: 'application/json' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'project-names.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const importNames = async (file: File) => {
    try {
      if (file.size > 1_000_000) throw new Error('The mapping file must be smaller than 1 MB.')
      const value: unknown = JSON.parse(await file.text())
      if (
        !value ||
        typeof value !== 'object' ||
        !('schema' in value) ||
        value.schema !== projectNamesKey ||
        !('names' in value)
      )
        throw new Error('Unsupported project-name mapping.')
      save({ ...names, ...validNames(value.names) })
      setError('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  if (id !== undefined)
    return (
      <section>
        <a href="#/projects">All projects</a>
        <h3>
          <ProjectNameEditor key={id} id={id} />
          <OpenProjectInChatGPT id={id} />
        </h3>
        {!project ? (
          <p>No activity for this project in the current scope. Change the project filter or period above.</p>
        ) : (
          <>
            <p>
              {project.activeDays} active days and {project.chats} conversations in this scope.
            </p>
            <Choice
              label="Project measure"
              value={measure}
              onChange={setMeasure}
              options={(['usageMs', 'prompts', 'inputWords', 'outputWords', 'thinkingMs'] as const).map(value => ({
                value,
                label: measures[value].label,
              }))}
            />
            <DailySeriesChart title="Project activity over time" days={projectValues} measure={measure} />
            <h3>Contributing conversations</h3>
            <ConversationTable
              conversations={stats.conversations.filter(chat => (chat.projectId ?? '') === id)}
              timing={stats.timing}
            />
          </>
        )}
      </section>
    )
  return (
    <section>
      <p>Compare thematic allocation. Project names stay in this browser; mapping files make them portable.</p>
      <div class="project-actions">
        <button class="ui-button" type="button" onClick={exportNames}>
          Export names
        </button>
        <FileButton
          label="Import names"
          accept="application/json,.json"
          onFiles={files => {
            if (files[0]) void importNames(files[0])
          }}
        />
      </div>
      {warning && <p role="status">{warning}</p>}
      {error && <p role="alert">{error}</p>}
      <div class="filters">
        <label>
          Find project
          <input type="search" value={query} onInput={event => setQuery(event.currentTarget.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyUnnamed}
            onChange={event => setOnlyUnnamed(event.currentTarget.checked)}
          />{' '}
          Only unnamed projects
        </label>
      </div>
      <SortableTable
        label="Project allocation"
        rows={rows}
        columns={columns}
        initialSort={{ column: 'time', direction: 'descending' }}
        rowKey={project => project.id}
        onRowClick={project => {
          location.hash = projectRoute(project.id)
        }}
        rowLabel={project => `Open project ${names[project.id] || project.id}`}
      />
    </section>
  )
}
