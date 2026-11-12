import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { readScope, scopeKey, writeScope, type AnalysisScope } from './analysis-scope.js'
import { WorkerClient } from './worker-client.js'
import type { Dataset, ImportSource, StatisticsResult } from './worker-protocol.js'
import { readRoute, routeTitle, type Route } from './routes.js'
import { Disclosure, FileButton, Status } from './ui.js'
import { ScopeControls } from './scope-controls.js'
import { Overview } from './overview.js'
import { TimeRhythm } from './time-rhythm.js'
import { Projects } from './projects.js'
import { ConversationTable } from './conversation-table.js'
import { ConversationView } from './conversation-view.js'
import { TemporalView } from './temporal-view.js'
import { RecapView } from './recap-view.js'
import { SessionEvidence } from './session-evidence.js'
import { About } from './about.js'
import { useProjectNames } from './project-identity.js'

type Loaded = { scope: AnalysisScope; result: StatisticsResult }
export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [scope, setScope] = useState<AnalysisScope>(readScope)
  const [loaded, setLoaded] = useState<Loaded>()
  const latest = useRef<Loaded>()
  latest.current = loaded
  const [dataset, setDataset] = useState<Dataset>()
  const [client, setClient] = useState<WorkerClient>()
  const clientRef = useRef<WorkerClient>()
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const lastScope = useRef('')
  const [selectedDate, setSelectedDate] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get('day') ?? undefined
  )
  const heading = useRef<HTMLHeadingElement>(null)
  const { names } = useProjectNames()
  const hasData = !!loaded
  const routeKey = JSON.stringify(route)
  const title =
    route.page === 'projects' && route.id !== undefined
      ? `Project: ${names[route.id] || route.id || 'Unassigned'}`
      : route.page === 'conversation'
        ? loaded?.result.stats.conversations.find(chat => chat.id === route.id)?.title || 'Conversation evidence'
        : routeTitle(route)
  useLayoutEffect(() => {
    const hash = () => {
      const next = readRoute()
      setRoute(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }
    const pop = () => {
      hash()
      setScope(readScope())
      setSelectedDate(new URLSearchParams(location.search).get('day') ?? undefined)
    }
    addEventListener('hashchange', hash)
    addEventListener('popstate', pop)
    return () => {
      removeEventListener('hashchange', hash)
      removeEventListener('popstate', pop)
      clientRef.current?.close()
    }
  }, [])
  useEffect(() => {
    document.title = `${title} | ChatGPT Usage Atlas`
  }, [title])
  useLayoutEffect(() => {
    heading.current?.focus()
  }, [routeKey, hasData])
  useEffect(() => {
    if (!client || !dataset || lastScope.current === scopeKey(scope)) return
    const controller = new AbortController()
    lastScope.current = scopeKey(scope)
    setUpdating(true)
    setError('')
    void client.request({ type: 'statistics', scope }, { signal: controller.signal }).then(
      result => {
        if (controller.signal.aborted) return
        setLoaded({ scope, result })
        writeScope(scope)
        setUpdating(false)
        setSelectedDate(current =>
          result.stats.days.some(day => day.date === current) ? current : result.stats.days.at(-1)?.date
        )
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setError(error instanceof Error ? error.message : String(error))
        setUpdating(false)
        const applied = latest.current?.scope
        if (applied) {
          lastScope.current = scopeKey(applied)
          setScope(applied)
        }
      }
    )
    return () => controller.abort()
  }, [client, dataset, scope])
  const beginImport = (source: ImportSource) => {
    clientRef.current?.close()
    const next = new WorkerClient(message => {
      setError(message)
      setImporting(false)
      setUpdating(false)
      setLoaded(undefined)
      setDataset(undefined)
    })
    clientRef.current = next
    setClient(next)
    setLoaded(undefined)
    setDataset(undefined)
    setImporting(true)
    setUpdating(false)
    setError('')
    setProgress('Reading export...')
    void next.request({ type: 'import', source, scope }, { onProgress: setProgress }).then(
      result => {
        if (clientRef.current !== next) return
        lastScope.current = scopeKey(scope)
        setLoaded({ scope, result })
        setDataset(result.dataset)
        setImporting(false)
        writeScope(scope)
        setSelectedDate(current =>
          result.stats.days.some(day => day.date === current) ? current : result.stats.days.at(-1)?.date
        )
      },
      (error: unknown) => {
        if (clientRef.current === next) {
          setImporting(false)
          setError(error instanceof Error ? error.message : String(error))
        }
      }
    )
  }
  const applyScope = (next: AnalysisScope) => {
    if (!Number.isInteger(next.sessionGapMinutes) || next.sessionGapMinutes < 1 || next.sessionGapMinutes > 1440) {
      setError('Session gap must be an integer between 1 and 1440 minutes.')
      return
    }
    if (next.startDate && next.endDate && next.startDate > next.endDate) {
      setError('The start date must be on or before the end date.')
      return
    }
    if (route.page === 'session') location.hash = '#/rhythm'
    setScope(next)
  }
  useEffect(() => {
    const url = new URL(location.href)
    if (selectedDate) url.searchParams.set('day', selectedDate)
    else url.searchParams.delete('day')
    history.replaceState(null, '', url)
  }, [selectedDate])
  const selectDay = (date: string) => setSelectedDate(date)

  return (
    <>
      <a class="skip-link" href="#analysis-content">
        Skip to analysis
      </a>
      <header class={hasData ? 'masthead compact' : 'masthead'}>
        <div>
          <h1>ChatGPT Usage Atlas</h1>
          {!hasData && <p class="subtitle">Understand the scale, rhythm, and purpose of your usage.</p>}
        </div>
        <div class="import-actions">
          <FileButton
            label={hasData ? 'Replace export ZIP' : 'Choose export ZIP'}
            accept=".zip,application/zip"
            disabled={importing || updating}
            onFiles={files => {
              if (files[0]) beginImport({ kind: 'zip', archive: files[0] })
            }}
          />
          <FileButton
            label="Choose export folder"
            directory
            disabled={importing || updating}
            onFiles={files => beginImport({ kind: 'folder', files })}
          />
        </div>
      </header>
      <Nav route={route} hasData={hasData} />
      <main id="analysis-content">
        <h2 ref={heading} tabIndex={-1} class="page-title">
          {hasData || route.page === 'not-found'
            ? route.page === 'conversation'
              ? 'Conversation evidence'
              : route.page === 'projects' && route.id !== undefined
                ? 'Project'
                : title
            : 'Explore your export'}
        </h2>
        {error && <Status title="Analysis unavailable" detail={error} error />}
        {importing && <Status title="Importing export" detail={progress} />}{' '}
        {!hasData && !importing && route.page !== 'not-found' && <About />}
        {route.page === 'not-found' && (
          <p>
            This address could not be understood. <a href="#/">Return to Overview.</a>
          </p>
        )}
        {loaded && client && dataset && (
          <>
            <ScopeControls
              scope={scope}
              available={loaded.result.available ?? dataset.available}
              projects={dataset.projects}
              busy={updating}
              onApply={applyScope}
            />
            <p class="applied-scope" aria-live="polite">
              Applied:{' '}
              {loaded.result.period
                ? `${loaded.result.period.startDate} through ${loaded.result.period.endDate}`
                : 'no dated activity'}
              , {loaded.scope.timeZone},{' '}
              {loaded.scope.projectId === undefined
                ? 'all projects'
                : names[loaded.scope.projectId] || loaded.scope.projectId || 'Unassigned'}
              .{updating ? ' Updating scope...' : ''}
            </p>
            {updating && <Status title="Updating analysis" detail="Applying the same scope to every view..." />}
            <div class="page-content" inert={updating} aria-busy={updating}>
              {route.page === 'overview' && (
                <Overview result={loaded.result} selectedDate={selectedDate} onSelectDate={selectDay} />
              )}
              {route.page === 'rhythm' && (
                <TimeRhythm
                  stats={loaded.result.stats}
                  timeZone={loaded.scope.timeZone}
                  selectedDate={selectedDate}
                  onSelectDate={selectDay}
                />
              )}
              {route.page === 'projects' && (
                <>
                  <Projects
                    stats={loaded.result.stats}
                    previous={loaded.result.comparisonCovered ? loaded.result.previous : undefined}
                    id={route.id}
                  />
                  {route.id !== undefined && (
                    <button
                      class="ui-button"
                      type="button"
                      onClick={() => {
                        applyScope({ ...loaded.scope, projectId: route.id })
                        location.hash = '#/'
                      }}>
                      Analyze this project across the dashboard
                    </button>
                  )}
                </>
              )}
              {route.page === 'conversations' && <ConversationLibrary stats={loaded.result.stats} />}
              {route.page === 'conversation' && (
                <ConversationView
                  key={`${route.id}:${scopeKey(loaded.scope)}`}
                  id={route.id}
                  scope={loaded.scope}
                  stats={loaded.result.stats}
                  client={client}
                />
              )}
              {route.page === 'session' && (
                <SessionEvidence
                  session={loaded.result.stats.sessions.find(session => session.id === route.id)}
                  timeZone={loaded.scope.timeZone}
                />
              )}
              {route.page === 'time' && (
                <TemporalView
                  key={`${JSON.stringify(route.filter)}:${scopeKey(loaded.scope)}`}
                  client={client}
                  scope={loaded.scope}
                  filter={route.filter}
                />
              )}
              {route.page === 'recap' && <RecapView scope={loaded.scope} client={client} projects={dataset.projects} />}
              {route.page === 'about' && <About />}
            </div>
            <Disclosure title="Import coverage and diagnostics">
              <p>
                {loaded.result.stats.summary.chats.toLocaleString()} conversations in scope. Import took{' '}
                {(dataset.durationMs / 1000).toFixed(1)} seconds. {dataset.skipped} records could not be imported.
                Skipped records do not contribute to any metric.
              </p>
              {dataset.diagnostics.length > 0 && (
                <>
                  <p>
                    First {dataset.diagnostics.length} skipped-record examples. Details come from schema validation; no
                    data is uploaded.
                  </p>
                  <ul>
                    {dataset.diagnostics.map((item, index) => (
                      <li key={index}>
                        <strong>
                          {item.file}, record {item.record}
                        </strong>
                        <pre>{item.reason}</pre>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p>
                Importing another export replaces the current in-memory dataset. Project names are retained locally.
              </p>
            </Disclosure>
          </>
        )}
      </main>
    </>
  )
}
function Nav({ route, hasData }: { route: Route; hasData: boolean }) {
  const current =
    route.page === 'conversation'
      ? 'conversations'
      : route.page === 'time' || route.page === 'session'
        ? 'rhythm'
        : route.page
  return (
    <nav class="nav" aria-label="Dashboard">
      {hasData &&
        [
          ['overview', '#/', 'Overview'],
          ['rhythm', '#/rhythm', 'Time and rhythm'],
          ['projects', '#/projects', 'Projects'],
          ['conversations', '#/conversations', 'Conversations'],
          ['recap', '#/recap', 'Recap'],
        ].map(([page, href, label]) => (
          <a key={page} href={href} aria-current={current === page ? 'page' : undefined}>
            {label}
          </a>
        ))}
      <a href="#/about" aria-current={current === 'about' ? 'page' : undefined}>
        About
      </a>
    </nav>
  )
}
function ConversationLibrary({ stats }: { stats: StatisticsResult['stats'] }) {
  const [query, setQuery] = useState('')
  const { names } = useProjectNames()
  const rows = stats.conversations.filter(chat =>
    `${chat.title} ${chat.id} ${names[chat.projectId ?? ''] ?? ''}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  )
  return (
    <section>
      <label>
        Find conversation
        <input
          type="search"
          value={query}
          onInput={event => setQuery(event.currentTarget.value)}
          placeholder="Title, ID, or project name"
        />
      </label>
      <p role="status">{rows.length.toLocaleString()} conversations in scope.</p>
      <ConversationTable conversations={rows} timing={stats.timing} />
    </section>
  )
}
