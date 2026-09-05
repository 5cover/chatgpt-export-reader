import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type {
  AnalyticsDay,
  AnalyticsStatistics,
  ConversationAnalytics,
  ConversationDetail,
  DayConversation,
  MessageContent,
  RepeatedPhraseAnalysis,
  SessionAnalytics,
  TemporalConversation,
  TemporalMessageEvidence,
  TemporalMessageFilter,
  TemporalMessageRole,
  TurnPage,
  TextMetrics,
} from '@chatgpt-export-reader/core'
import { DailyChart, type DailyMetric, metricLabel, metricValue } from './daily-chart.js'
import { PromptHistogram } from './prompt-histogram.js'
import { SortableTable, type SortableColumn } from './sortable-table.js'

type ImportState =
  | { kind: 'idle' }
  | { kind: 'loading'; detail: string }
  | {
      kind: 'ready'
      local: AnalyticsStatistics
      utc: AnalyticsStatistics
      skipped: number
      durationMs: number
      startDate?: string
      sessionGapMinutes: number
    }
  | { kind: 'error'; message: string }
type TimeZoneMode = 'local' | 'utc'
type Route =
  | { page: 'about' }
  | { page: 'overview' }
  | { page: 'patterns' }
  | { page: 'time'; filter: TemporalMessageFilter }
  | { page: 'conversations' }
  | { page: 'conversation'; id: string }
type DetailState =
  { kind: 'ready'; detail: ConversationDetail } | { kind: 'missing' } | { kind: 'error'; message: string }
type RepetitionState =
  { kind: 'loading' } | { kind: 'ready'; analysis: RepeatedPhraseAnalysis } | { kind: 'error'; message: string }
type TemporalMessagePreview = Omit<TemporalMessageEvidence, 'body'>
type TemporalPage = {
  cacheKey: string
  filter: TemporalMessageFilter
  summary: { messages: number; conversations: number; activeDays: number; text: TextMetrics }
  conversations: TemporalConversation[]
  offset: number
  total: number
  messages: TemporalMessagePreview[]
}
type TemporalState =
  { kind: 'loading' } | { kind: 'ready'; page: TemporalPage; updating: boolean } | { kind: 'error'; message: string }

export function App() {
  const folderInput = useRef<HTMLInputElement>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
  const worker = useRef<Worker>()
  const nextRequest = useRef(0)
  const activeImport = useRef<number>()
  const activeStatistics = useRef<number>()
  const activeDetail = useRef<number>()
  const activeOutline = useRef<number>()
  const activeContent = useRef<number>()
  const activeConversationRepetitions = useRef<number>()
  const activeTemporalSlice = useRef<number>()
  const activeTemporalContent = useRef<number>()
  const zoneRef = useRef<TimeZoneMode>('local')
  const [state, setState] = useState<ImportState>({ kind: 'idle' })
  const [zone, setZone] = useState<TimeZoneMode>('local')
  const [route, setRoute] = useState<Route>(readRoute)
  const [startDate, setStartDate] = useState<string>()
  const [sessionGapMinutes, setSessionGapMinutes] = useState(60)
  const [updating, setUpdating] = useState(false)
  const [controlError, setControlError] = useState<string>()
  const [selectedDate, setSelectedDate] = useState<string>()
  const [detail, setDetail] = useState<DetailState>()
  const [outline, setOutline] = useState<TurnPage>()
  const [outlineQuery, setOutlineQuery] = useState('')
  const [contents, setContents] = useState<Record<string, string>>({})
  const [conversationRepetitions, setConversationRepetitions] = useState<RepetitionState>()
  const [temporal, setTemporal] = useState<TemporalState>()
  const [temporalConversation, setTemporalConversation] = useState<string>()
  const [temporalOrder, setTemporalOrder] = useState<'newest' | 'oldest'>('newest')
  const [temporalContents, setTemporalContents] = useState<Record<string, string>>({})

  zoneRef.current = zone
  const readyState = state.kind === 'ready' ? state : undefined
  const appliedStartDate = readyState?.startDate
  const appliedGap = readyState?.sessionGapMinutes ?? sessionGapMinutes
  const stats = readyState === undefined ? undefined : zone === 'local' ? readyState.local : readyState.utc
  const visibleRoute: Route = stats ? route : { page: 'about' }

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
    const nextWorker = new Worker(new URL('./stats-worker.ts', import.meta.url), { type: 'module' })
    worker.current = nextWorker
    nextWorker.addEventListener('message', event => receive(event.data as WorkerMessage))
    const onHashChange = () => setRoute(readRoute())
    addEventListener('hashchange', onHashChange)
    return () => {
      nextWorker.terminate()
      removeEventListener('hashchange', onHashChange)
    }
  }, [])

  useEffect(() => {
    if (route.page !== 'conversation' || !stats) return
    if (!stats.conversations.some(chat => chat.id === route.id)) {
      setDetail({ kind: 'missing' })
      return
    }
    const requestId = ++nextRequest.current
    activeDetail.current = requestId
    setDetail(undefined)
    setOutline(undefined)
    setContents({})
    setConversationRepetitions({ kind: 'loading' })
    worker.current?.postMessage({
      type: 'conversation-detail',
      requestId,
      id: route.id,
      timeZone: selectedTimeZone(zone),
      startDate: appliedStartDate,
      sessionGapMinutes: appliedGap,
    })
    loadOutline(route.id, 0, undefined)
    loadConversationRepetitions(route.id)
  }, [route, stats, zone, appliedStartDate, appliedGap])

  useEffect(() => {
    if (route.page !== 'time' || !stats) return
    activeTemporalContent.current = undefined
    setTemporalConversation(undefined)
    setTemporalOrder('newest')
    setTemporalContents({})
    setTemporal({ kind: 'loading' })
    loadTemporalSlice(route.filter, 0, undefined, 'newest')
  }, [route, stats, zone, appliedStartDate])

  function receive(message: WorkerMessage) {
    if (message.type === 'progress') {
      if (message.requestId !== activeImport.current) return
      const percent = message.bytesTotal ? Math.round((message.bytesRead / message.bytesTotal) * 100) : 0
      const position = message.fileCount === undefined ? '' : ` (${message.fileIndex}/${message.fileCount}`
      const progress = message.bytesTotal === undefined ? '' : `${position ? ', ' : ' ('}${percent}%)`
      setState({
        kind: 'loading',
        detail: `${message.archiveName ? `${message.archiveName}: ` : ''}${message.fileName}${position}${progress} - ${message.chats} chats`,
      })
    } else if (message.type === 'complete') {
      if (message.requestId !== activeImport.current) return
      activeImport.current = undefined
      setState({
        kind: 'ready',
        local: message.local,
        utc: message.utc,
        skipped: message.skipped,
        durationMs: message.durationMs,
        startDate: message.startDate,
        sessionGapMinutes: message.sessionGapMinutes,
      })
      setStartDate(message.startDate)
      setSessionGapMinutes(message.sessionGapMinutes)
      setZone('local')
      setSelectedDate(busiestDay(message.local.days)?.date)
      setUpdating(false)
      location.hash = '#/'
    } else if (message.type === 'statistics') {
      if (message.requestId !== activeStatistics.current) return
      activeStatistics.current = undefined
      setState(current =>
        current.kind === 'ready'
          ? {
              ...current,
              local: message.local,
              utc: message.utc,
              startDate: message.startDate,
              sessionGapMinutes: message.sessionGapMinutes,
            }
          : current
      )
      setSelectedDate(busiestDay(zoneRef.current === 'local' ? message.local.days : message.utc.days)?.date)
      setUpdating(false)
      setControlError(undefined)
    } else if (message.type === 'conversation-detail') {
      if (message.requestId !== activeDetail.current) return
      activeDetail.current = undefined
      setDetail(message.detail ? { kind: 'ready', detail: message.detail } : { kind: 'missing' })
    } else if (message.type === 'conversation-outline') {
      if (message.requestId !== activeOutline.current) return
      activeOutline.current = undefined
      setOutline(message.page)
    } else if (message.type === 'message-content') {
      if (message.requestId !== activeContent.current) return
      activeContent.current = undefined
      setContents(current => ({
        ...current,
        ...Object.fromEntries(message.contents.map(content => [content.id, content.body])),
      }))
    } else if (message.type === 'conversation-repetitions') {
      if (message.requestId !== activeConversationRepetitions.current) return
      activeConversationRepetitions.current = undefined
      setConversationRepetitions({ kind: 'ready', analysis: message.analysis })
    } else if (message.type === 'temporal-slice') {
      if (message.requestId !== activeTemporalSlice.current) return
      activeTemporalSlice.current = undefined
      setTemporal({ kind: 'ready', page: message, updating: false })
    } else if (message.type === 'temporal-content') {
      if (message.requestId !== activeTemporalContent.current) return
      activeTemporalContent.current = undefined
      setTemporalContents(current => ({
        ...current,
        ...Object.fromEntries(message.contents.map(content => [content.id, content.body])),
      }))
    } else if (message.operation === 'import') {
      if (message.requestId !== activeImport.current) return
      activeImport.current = undefined
      setState({ kind: 'error', message: message.message })
    } else if (message.operation === 'statistics') {
      if (message.requestId !== activeStatistics.current) return
      activeStatistics.current = undefined
      setStartDate(appliedStartDate)
      setSessionGapMinutes(appliedGap)
      setUpdating(false)
      setControlError(message.message)
    } else if (message.operation === 'conversation-detail') {
      if (message.requestId !== activeDetail.current) return
      activeDetail.current = undefined
      setDetail({ kind: 'error', message: message.message })
    } else if (message.operation === 'conversation-outline') {
      if (message.requestId !== activeOutline.current) return
      activeOutline.current = undefined
      setDetail({ kind: 'error', message: message.message })
    } else if (message.operation === 'message-content') {
      if (message.requestId !== activeContent.current) return
      activeContent.current = undefined
      setDetail({ kind: 'error', message: message.message })
    } else if (message.operation === 'temporal-slice') {
      if (message.requestId !== activeTemporalSlice.current) return
      activeTemporalSlice.current = undefined
      setTemporal({ kind: 'error', message: message.message })
    } else if (message.operation === 'temporal-content') {
      if (message.requestId !== activeTemporalContent.current) return
      activeTemporalContent.current = undefined
      setTemporal({ kind: 'error', message: message.message })
    } else {
      if (message.requestId !== activeConversationRepetitions.current) return
      activeConversationRepetitions.current = undefined
      setConversationRepetitions({ kind: 'error', message: message.message })
    }
  }

  function chooseFolder(event: Event) {
    const picker = event.currentTarget as HTMLInputElement
    const files = [...(picker.files ?? [])]
    picker.value = ''
    if (files.length === 0) return
    beginImport({ kind: 'folder', files })
  }

  function chooseArchive(event: Event) {
    const picker = event.currentTarget as HTMLInputElement
    const archive = picker.files?.[0]
    picker.value = ''
    if (!archive) return
    beginImport({ kind: 'zip', archive })
  }

  function beginImport(source: { kind: 'folder'; files: File[] } | { kind: 'zip'; archive: File }) {
    const requestId = ++nextRequest.current
    activeImport.current = requestId
    activeStatistics.current = undefined
    activeConversationRepetitions.current = undefined
    activeTemporalSlice.current = undefined
    activeTemporalContent.current = undefined
    setConversationRepetitions(undefined)
    setTemporal(undefined)
    setTemporalContents({})
    setState({
      kind: 'loading',
      detail: source.kind === 'zip' ? `Preparing ${source.archive.name}...` : 'Preparing analytics...',
    })
    worker.current?.postMessage({
      type: 'import',
      requestId,
      source,
      localTimeZone: localTimeZone(),
      startDate,
      sessionGapMinutes,
    })
  }

  function applyOptions(nextStartDate = startDate, nextGap = sessionGapMinutes) {
    if (state.kind !== 'ready' || !Number.isInteger(nextGap) || nextGap < 1 || nextGap > 1_440) return
    const requestId = ++nextRequest.current
    activeStatistics.current = requestId
    activeDetail.current = undefined
    setStartDate(nextStartDate)
    setSessionGapMinutes(nextGap)
    setUpdating(true)
    setControlError(undefined)
    activeConversationRepetitions.current = undefined
    activeTemporalSlice.current = undefined
    activeTemporalContent.current = undefined
    setConversationRepetitions(undefined)
    setTemporal(undefined)
    setTemporalContents({})
    worker.current?.postMessage({
      type: 'statistics',
      requestId,
      localTimeZone: localTimeZone(),
      startDate: nextStartDate,
      sessionGapMinutes: nextGap,
    })
  }

  function loadOutline(id: string, offset = 0, query = outlineQuery || undefined) {
    const requestId = ++nextRequest.current
    activeOutline.current = requestId
    worker.current?.postMessage({
      type: 'conversation-outline',
      requestId,
      id,
      timeZone: selectedTimeZone(zone),
      startDate: appliedStartDate,
      sessionGapMinutes: appliedGap,
      offset,
      limit: 50,
      query,
    })
  }

  function openContent(id: string) {
    if (contents[id] !== undefined || route.page !== 'conversation') return
    const requestId = ++nextRequest.current
    activeContent.current = requestId
    worker.current?.postMessage({
      type: 'message-content',
      requestId,
      id: route.id,
      timeZone: selectedTimeZone(zone),
      startDate: appliedStartDate,
      sessionGapMinutes: appliedGap,
      ids: [id],
    })
  }

  function loadConversationRepetitions(id: string) {
    const requestId = ++nextRequest.current
    activeConversationRepetitions.current = requestId
    worker.current?.postMessage({
      type: 'conversation-repetitions',
      requestId,
      id,
      timeZone: selectedTimeZone(zone),
      startDate: appliedStartDate,
    })
  }

  function loadTemporalSlice(
    filter: TemporalMessageFilter,
    offset: number,
    conversationId = temporalConversation,
    order = temporalOrder
  ) {
    const requestId = ++nextRequest.current
    activeTemporalSlice.current = requestId
    setTemporal(current => (current?.kind === 'ready' ? { ...current, updating: true } : { kind: 'loading' }))
    worker.current?.postMessage({
      type: 'temporal-slice',
      requestId,
      timeZone: selectedTimeZone(zone),
      startDate: appliedStartDate,
      filter,
      conversationId,
      order,
      offset,
      limit: 50,
    })
  }

  function openTemporalContent(id: string, cacheKey: string) {
    if (temporalContents[id] !== undefined) return
    const requestId = ++nextRequest.current
    activeTemporalContent.current = requestId
    worker.current?.postMessage({ type: 'temporal-content', requestId, cacheKey, ids: [id] })
  }

  return (
    <main>
      <header class="masthead">
        <div>
          <p class="eyebrow">Usage analysis</p>
          <h1>ChatGPT Usage Atlas</h1>
          <p class="subtitle">Measure the scale, rhythm, and intensity of your own usage.</p>
        </div>
        <div class="import-actions">
          <button
            class="import-button"
            type="button"
            disabled={state.kind === 'loading'}
            onClick={() => archiveInput.current?.click()}>
            Choose export ZIP
          </button>
          <button
            class="import-button folder-button"
            type="button"
            disabled={state.kind === 'loading'}
            onClick={() => folderInput.current?.click()}>
            Choose export folder
          </button>
        </div>
        <input class="import-input" ref={folderInput} type="file" multiple onChange={chooseFolder} />
        <input
          class="import-input"
          ref={archiveInput}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={chooseArchive}
        />
      </header>
      <Nav route={visibleRoute} hasExport={Boolean(stats)} />
      {!stats && <About />}
      {state.kind === 'loading' && <Status title="Importing export" detail={state.detail} />}
      {state.kind === 'error' && <Status title="Import failed" detail={state.message} error />}
      {stats && (
        <>
          {visibleRoute.page !== 'about' && readyState && (
            <Controls
              zone={zone}
              startDate={startDate}
              gap={sessionGapMinutes}
              updating={updating}
              error={controlError}
              imported={readyState.durationMs}
              skipped={readyState.skipped}
              onZone={next => {
                setZone(next)
                activeConversationRepetitions.current = undefined
                setConversationRepetitions(undefined)
                setSelectedDate(busiestDay(next === 'local' ? readyState.local.days : readyState.utc.days)?.date)
              }}
              onStartDate={next => applyOptions(next || undefined)}
              onGap={next => applyOptions(startDate, next)}
              onReset={() => applyOptions(undefined)}
            />
          )}
          {visibleRoute.page === 'overview' && (
            <Overview stats={stats} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          )}
          {visibleRoute.page === 'patterns' && <Patterns stats={stats} zone={zone} />}
          {visibleRoute.page === 'time' && (
            <TemporalView
              route={visibleRoute}
              state={temporal}
              zone={zone}
              conversationId={temporalConversation}
              order={temporalOrder}
              contents={temporalContents}
              onFilter={filter => {
                location.hash = temporalRoute(filter)
              }}
              onConversation={id => {
                activeTemporalContent.current = undefined
                setTemporalConversation(id)
                setTemporalContents({})
                loadTemporalSlice(visibleRoute.filter, 0, id, temporalOrder)
              }}
              onOrder={order => {
                activeTemporalContent.current = undefined
                setTemporalOrder(order)
                setTemporalContents({})
                loadTemporalSlice(visibleRoute.filter, 0, temporalConversation, order)
              }}
              onPage={offset => loadTemporalSlice(visibleRoute.filter, offset)}
              onOpen={openTemporalContent}
            />
          )}
          {visibleRoute.page === 'conversations' && <ConversationList conversations={stats.conversations} />}
          {visibleRoute.page === 'conversation' && (
            <ConversationView
              detail={detail}
              repetitions={conversationRepetitions}
              outline={outline}
              query={outlineQuery}
              contents={contents}
              onSearch={query => {
                setOutlineQuery(query)
                if (route.page === 'conversation') loadOutline(route.id, 0, query || undefined)
              }}
              onPage={offset => route.page === 'conversation' && loadOutline(route.id, offset)}
              onOpen={openContent}
            />
          )}
          {visibleRoute.page === 'about' && <About />}
        </>
      )}
    </main>
  )
}

function Nav({ route, hasExport }: { route: Route; hasExport: boolean }) {
  return (
    <nav class="nav" aria-label="Dashboard">
      {hasExport && (
        <>
          <a class={route.page === 'overview' ? 'active' : ''} href="#/">
            Overview
          </a>
          <a class={route.page === 'patterns' || route.page === 'time' ? 'active' : ''} href="#/patterns">
            Patterns
          </a>
          <a
            class={route.page === 'conversations' || route.page === 'conversation' ? 'active' : ''}
            href="#/conversations">
            Conversations
          </a>
        </>
      )}
      <a class={route.page === 'about' ? 'active' : ''} href="#/about">
        About
      </a>
    </nav>
  )
}
function Controls({
  zone,
  startDate,
  gap,
  updating,
  error,
  imported,
  skipped,
  onZone,
  onStartDate,
  onGap,
  onReset,
}: {
  zone: TimeZoneMode
  startDate?: string
  gap: number
  updating: boolean
  error?: string
  imported: number
  skipped: number
  onZone: (zone: TimeZoneMode) => void
  onStartDate: (date: string) => void
  onGap: (gap: number) => void
  onReset: () => void
}) {
  return (
    <div class="toolbar">
      <div class="toolbar-group">
        <span>Calendar</span>
        <button class={zone === 'local' ? 'active' : ''} onClick={() => onZone('local')}>
          Local
        </button>
        <button class={zone === 'utc' ? 'active' : ''} onClick={() => onZone('utc')}>
          UTC
        </button>
      </div>
      <label class="date-filter">
        Measure from{' '}
        <input type="date" value={startDate ?? ''} onChange={event => onStartDate(event.currentTarget.value)} />
      </label>
      <button disabled={!startDate || updating} onClick={onReset}>
        All time
      </button>
      <label class="gap-filter">
        Session gap{' '}
        <input
          type="number"
          min="1"
          max="1440"
          value={gap}
          onChange={event => onGap(Number(event.currentTarget.value))}
        />{' '}
        min
      </label>
      <small class={error ? 'range-status error-text' : 'range-status'}>
        {updating ? 'Updating...' : (error ?? `Sessions split after ${gap} minutes without a message`)}
      </small>
      <small class="import-summary">
        Imported in {(imported / 1000).toFixed(1)}s{skipped ? `; ${skipped} invalid chats skipped` : ''}
      </small>
    </div>
  )
}
function Accordion({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  description: string
  defaultOpen?: boolean
  children: ComponentChildren
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section class={open ? 'accordion open' : 'accordion'}>
      <h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <span>
            <strong>{title}</strong>
            <small>{description}</small>
          </span>
          <i aria-hidden="true">{open ? '−' : '+'}</i>
        </button>
      </h2>
      {open && <div class="accordion-body">{children}</div>}
    </section>
  )
}
function Overview({
  stats,
  selectedDate,
  onSelectDate,
}: {
  stats: AnalyticsStatistics
  selectedDate?: string
  onSelectDate: (date: string) => void
}) {
  const [metric, setMetric] = useState<DailyMetric>('prompts')
  const selected = stats.days.find(day => day.date === selectedDate)
  return (
    <>
      <section class="summary-grid analytics-metrics">
        <Metric label="Chats" value={stats.summary.chats} />
        <Metric label="Sessions" value={stats.summary.sessions} />
        <Metric label="Prompts" value={stats.summary.prompts} />
        <Metric label="Input words" value={stats.summary.input.words} />
        <Metric label="Output words" value={stats.summary.output.words} />
        <Metric label="Input characters" value={stats.summary.input.characters} />
        <Metric label="Output characters" value={stats.summary.output.characters} />
        <Metric label="Output / input" value={ratio(stats.summary.output, stats.summary.input)} />
      </section>
      <Accordion title="Activity over time" description="Compare daily message and text volume." defaultOpen>
        <section class="metric-picker">
          <span>Daily measure</span>
          {(['prompts', 'messages', 'inputWords', 'outputWords', 'totalWords'] as DailyMetric[]).map(value => (
            <button class={metric === value ? 'active' : ''} onClick={() => setMetric(value)}>
              {metricLabel(value)}
            </button>
          ))}
        </section>
        <DailyChart days={stats.days} metric={metric} selectedDate={selectedDate} onSelectDate={onSelectDate} />
      </Accordion>
      <Accordion title="Calendar and distribution" description="See active days and the range of daily prompt counts.">
        <section class="two-up">
          <CalendarHeatmap days={stats.days} metric={metric} />
          <PromptHistogram days={stats.days} />
        </section>
      </Accordion>
      {selected && (
        <Accordion
          title={`Conversations on ${selected.date}`}
          description={`${selected.activeChats.toLocaleString()} chats contributed ${selected.prompts.toLocaleString()} prompts.`}>
          <DayAttribution day={selected} />
        </Accordion>
      )}
      <Accordion title="Usage concentration" description="See which conversations account for the most output.">
        <Concentration conversations={stats.conversations} />
      </Accordion>
    </>
  )
}
function Patterns({ stats, zone }: { stats: AnalyticsStatistics; zone: TimeZoneMode }) {
  const [metric, setMetric] = useState<'prompts' | 'input' | 'output'>('prompts')
  return (
    <>
      <section class="summary-grid">
        <Metric label="Active days" value={stats.summary.activeDays} />
        <Metric
          label="Median session prompts"
          value={median(stats.sessions.map(session => session.prompts)).toFixed(1)}
        />
        <Metric
          label="Sessions over 25 prompts"
          value={stats.sessions.filter(session => session.prompts > 25).length}
        />
        <Metric
          label="Sessions over 100 prompts"
          value={stats.sessions.filter(session => session.prompts > 100).length}
        />
      </section>
      <Accordion title="Weekly rhythm" description="Compare activity by weekday and hour." defaultOpen>
        <section class="metric-picker">
          <span>Heatmap measure</span>
          {(['prompts', 'input', 'output'] as const).map(value => (
            <button class={metric === value ? 'active' : ''} onClick={() => setMetric(value)}>
              {value === 'prompts' ? 'Prompts' : `${value === 'input' ? 'Input' : 'Output'} words`}
            </button>
          ))}
        </section>
        <HourHeatmap
          cells={stats.hours}
          metric={metric}
          onSelect={filter => {
            location.hash = temporalRoute(filter)
          }}
        />
      </Accordion>
      <Accordion title="Session profile" description="Compare session size and start times.">
        <section class="two-up">
          <SessionDistribution sessions={stats.sessions} />
          <SessionStarts sessions={stats.sessions} utc={zone === 'utc'} />
        </section>
      </Accordion>
      <Accordion title="Session continuation" description="See how session depth relates to duration and continuation.">
        <section class="two-up">
          <SessionScatter sessions={stats.sessions} />
          <Continuation sessions={stats.sessions} />
        </section>
      </Accordion>
      <Accordion title="Longest sessions" description="Inspect and sort the 25 sessions with the most prompts.">
        <SessionTable
          sessions={stats.sessions
            .slice()
            .sort((a, b) => b.prompts - a.prompts)
            .slice(0, 25)}
        />
      </Accordion>
    </>
  )
}
function TemporalView({
  route,
  state,
  zone,
  conversationId,
  order,
  contents,
  onFilter,
  onConversation,
  onOrder,
  onPage,
  onOpen,
}: {
  route: Extract<Route, { page: 'time' }>
  state?: TemporalState
  zone: TimeZoneMode
  conversationId?: string
  order: 'newest' | 'oldest'
  contents: Record<string, string>
  onFilter: (filter: TemporalMessageFilter) => void
  onConversation: (id?: string) => void
  onOrder: (order: 'newest' | 'oldest') => void
  onPage: (offset: number) => void
  onOpen: (id: string, cacheKey: string) => void
}) {
  const page = state?.kind === 'ready' ? state.page : undefined
  const roleLabel = route.filter.role === 'user' ? 'User prompts' : 'Assistant messages'
  const scopeLabel =
    route.filter.weekday === undefined
      ? `Every day at ${hourLabel(route.filter.hour)}`
      : `${weekdayName(route.filter.weekday)} at ${hourLabel(route.filter.hour)}`
  const selectedConversation = page?.conversations.find(conversation => conversation.id === conversationId)
  const conversationColumns: readonly SortableColumn<TemporalConversation>[] = [
    {
      id: 'title',
      label: 'Conversation',
      align: 'left',
      compare: (left, right) => left.title.localeCompare(right.title),
      render: conversation => (
        <>
          <a href={`#/conversations/${encodeURIComponent(conversation.id)}`}>{conversation.title || 'Untitled chat'}</a>
          <button
            class="table-action"
            type="button"
            disabled={conversation.id === conversationId}
            onClick={() => onConversation(conversation.id)}>
            {conversation.id === conversationId ? 'Showing messages' : 'Show messages'}
          </button>
        </>
      ),
    },
    {
      id: 'messages',
      label: route.filter.role === 'user' ? 'Prompts' : 'Messages',
      compare: (left, right) => left.messages - right.messages,
      render: conversation => conversation.messages,
    },
    {
      id: 'words',
      label: 'Words',
      compare: (left, right) => left.text.words - right.text.words,
      render: conversation => formatNumber(conversation.text.words),
    },
    {
      id: 'days',
      label: 'Active days',
      compare: (left, right) => left.activeDays - right.activeDays,
      render: conversation => conversation.activeDays,
    },
    {
      id: 'first',
      label: 'First match',
      compare: (left, right) => Date.parse(left.firstMessageAt) - Date.parse(right.firstMessageAt),
      render: conversation => formatInTimeZone(conversation.firstMessageAt, selectedTimeZone(zone)),
    },
    {
      id: 'last',
      label: 'Last match',
      compare: (left, right) => Date.parse(left.lastMessageAt) - Date.parse(right.lastMessageAt),
      render: conversation => formatInTimeZone(conversation.lastMessageAt, selectedTimeZone(zone)),
    },
  ]

  return (
    <>
      <section class="time-heading">
        <a href="#/patterns">Back to patterns</a>
        <p class="eyebrow">Time slice</p>
        <h2>{scopeLabel}</h2>
        <p>{roleLabel} in the selected calendar and date range.</p>
        <div class="time-controls">
          <label>
            Messages
            <select
              value={route.filter.role}
              onChange={event => onFilter({ ...route.filter, role: event.currentTarget.value as TemporalMessageRole })}>
              <option value="user">User prompts</option>
              <option value="assistant">Assistant messages</option>
            </select>
          </label>
          <label>
            Weekday
            <select
              value={route.filter.weekday ?? 'all'}
              onChange={event => {
                const value = event.currentTarget.value
                onFilter({
                  ...route.filter,
                  weekday: value === 'all' ? undefined : Number(value),
                })
              }}>
              <option value="all">All weekdays</option>
              {Array.from({ length: 7 }, (_, weekday) => (
                <option value={weekday}>{weekdayName(weekday)}</option>
              ))}
            </select>
          </label>
          <label>
            Hour
            <select
              value={route.filter.hour}
              onChange={event => onFilter({ ...route.filter, hour: Number(event.currentTarget.value) })}>
              {Array.from({ length: 24 }, (_, hour) => (
                <option value={hour}>{hourLabel(hour)}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {state === undefined || state.kind === 'loading' ? (
        <Status title="Loading time slice" detail="Finding matching messages..." />
      ) : state.kind === 'error' ? (
        <Status title="Time slice unavailable" detail={state.message} error />
      ) : (
        <>
          <section class="summary-grid temporal-metrics">
            <Metric label={route.filter.role === 'user' ? 'Prompts' : 'Messages'} value={page!.summary.messages} />
            <Metric label="Conversations" value={page!.summary.conversations} />
            <Metric label="Active days" value={page!.summary.activeDays} />
            <Metric label="Words" value={page!.summary.text.words} />
            <Metric label="Characters" value={page!.summary.text.characters} />
          </section>
          <Accordion
            title="Conversation attribution"
            description={`${page!.conversations.length.toLocaleString()} conversations contain matching messages.`}
            defaultOpen>
            {page!.conversations.length === 0 ? (
              <p class="empty-table">No messages match this time slice.</p>
            ) : (
              <div class="bounded-table">
                <SortableTable
                  rows={page!.conversations}
                  columns={conversationColumns}
                  initialSort={{ column: 'messages', direction: 'descending' }}
                  rowKey={conversation => conversation.id}
                />
              </div>
            )}
          </Accordion>
          <Accordion
            title="Message evidence"
            description={
              selectedConversation
                ? `${page!.total.toLocaleString()} matches in ${selectedConversation.title || 'Untitled chat'}.`
                : `${page!.total.toLocaleString()} matching messages.`
            }
            defaultOpen>
            <div class="evidence-toolbar">
              <div>
                {selectedConversation && (
                  <button type="button" onClick={() => onConversation(undefined)}>
                    Show all conversations
                  </button>
                )}
              </div>
              <div class="toolbar-group">
                <span>Order</span>
                <button class={order === 'newest' ? 'active' : ''} type="button" onClick={() => onOrder('newest')}>
                  Newest
                </button>
                <button class={order === 'oldest' ? 'active' : ''} type="button" onClick={() => onOrder('oldest')}>
                  Oldest
                </button>
              </div>
            </div>
            {state.updating && <p class="range-status">Updating...</p>}
            {page!.messages.length === 0 ? (
              <p class="empty-table">No messages match the current conversation filter.</p>
            ) : (
              <div class="time-message-list">
                {page!.messages.map(message => (
                  <article class={`time-message ${message.role}`} key={message.id}>
                    <div>
                      <time dateTime={message.createTime}>
                        {formatInTimeZone(message.createTime, selectedTimeZone(zone))}
                      </time>
                      <a href={`#/conversations/${encodeURIComponent(message.conversationId)}`}>
                        {message.conversationTitle || 'Untitled chat'}
                      </a>
                      <span>{message.text.words.toLocaleString()} words</span>
                    </div>
                    <button type="button" onClick={() => onOpen(message.id, page!.cacheKey)}>
                      {message.preview || 'Empty message'}
                    </button>
                    {contents[message.id] !== undefined && <pre>{contents[message.id]}</pre>}
                  </article>
                ))}
              </div>
            )}
            <div class="pagination">
              <button
                type="button"
                disabled={page!.offset === 0 || state.updating}
                onClick={() => onPage(Math.max(0, page!.offset - 50))}>
                Previous 50
              </button>
              <span>
                {page!.total === 0 ? 0 : page!.offset + 1}-{Math.min(page!.offset + page!.messages.length, page!.total)}{' '}
                of {page!.total.toLocaleString()}
              </span>
              <button
                type="button"
                disabled={page!.offset + page!.messages.length >= page!.total || state.updating}
                onClick={() => onPage(page!.offset + page!.messages.length)}>
                Next 50
              </button>
            </div>
          </Accordion>
        </>
      )}
    </>
  )
}
function ConversationList({ conversations }: { conversations: readonly ConversationAnalytics[] }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () =>
      conversations.filter(chat => `${chat.title} ${chat.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [conversations, query]
  )
  return (
    <Accordion
      title="All conversations"
      description={`${rows.length.toLocaleString()} conversations match the current search.`}
      defaultOpen>
      <section class="breakdown-card">
        <div class="chart-heading">
          <div>
            <p class="eyebrow">Conversation inventory</p>
            <h2>Compare conversation volume and duration.</h2>
          </div>
          <input
            class="search"
            value={query}
            onInput={event => setQuery(event.currentTarget.value)}
            placeholder="Search title or ID"
          />
        </div>
        <SortableTable
          rows={rows}
          columns={conversationColumns}
          initialSort={{ column: 'output', direction: 'descending' }}
          rowKey={chat => chat.id}
        />
      </section>
    </Accordion>
  )
}
function ConversationView({
  detail,
  repetitions,
  outline,
  query,
  contents,
  onSearch,
  onPage,
  onOpen,
}: {
  detail?: DetailState
  repetitions?: RepetitionState
  outline?: TurnPage
  query: string
  contents: Record<string, string>
  onSearch: (query: string) => void
  onPage: (offset: number) => void
  onOpen: (id: string) => void
}) {
  if (detail === undefined)
    return <Status title="Loading conversation" detail="Calculating structure and evidence..." />
  if (detail.kind === 'missing')
    return <Status title="Conversation unavailable" detail="No messages fit the current date range." />
  if (detail.kind === 'error') return <Status title="Conversation unavailable" detail={detail.message} error />
  const value = detail.detail
  return (
    <>
      <section class="detail-card">
        <p class="eyebrow">Conversation evidence</p>
        <h2>{value.summary.title || 'Untitled chat'}</h2>
        <code>{value.summary.id}</code>
        <section class="summary-grid">
          <Metric label="Prompts" value={value.summary.prompts} />
          <Metric label="Input words" value={value.summary.input.words} />
          <Metric label="Output words" value={value.summary.output.words} />
          <Metric label="Output / input" value={ratio(value.summary.output, value.summary.input)} />
          <Metric label="Sessions" value={value.summary.sessions} />
          <Metric label="Active days" value={value.summary.activeDays} />
          <Metric
            label="Lifetime"
            value={value.summary.lifetimeMs === undefined ? 'No duration' : formatDuration(value.summary.lifetimeMs)}
          />
        </section>
      </section>
      <Accordion
        title="Session structure"
        description={`${value.sessions.length.toLocaleString()} observed sessions in this conversation.`}>
        <SessionCards sessions={value.sessions} />
      </Accordion>
      <PhraseAnalysis
        title="Repeated language"
        subtitle="Compare exact sequences repeated in this conversation."
        repetitions={repetitions}
      />
      <Accordion
        title="Conversation timeline"
        description={`${value.totalTurns.toLocaleString()} turns grouped into ${value.turnBins.length.toLocaleString()} bins.`}
        defaultOpen>
        <TurnTimeline bins={value.turnBins} total={value.totalTurns} onSelect={bin => onPage(bin.startIndex - 1)} />
      </Accordion>
      <Accordion title="Message outline" description="Search and inspect individual turns.">
        <section class="breakdown-card">
          <div class="chart-heading">
            <div>
              <p class="eyebrow">Turn outline</p>
              <h2>Inspect the messages behind the statistics.</h2>
            </div>
            <input
              class="search"
              value={query}
              onInput={event => onSearch(event.currentTarget.value)}
              placeholder="Search exact text"
            />
          </div>
          {outline === undefined ? (
            <p>Loading outline...</p>
          ) : (
            <>
              <p class="chart-note">{outline.total.toLocaleString()} matching turns. Select a row to show its text.</p>
              <div class="turn-list">
                {outline.turns.map(turn => (
                  <article class={`turn ${turn.role}`} onClick={() => onOpen(turn.id)}>
                    <span>
                      #{turn.index} · {turn.role} · {turn.input.words || turn.output.words} words · session{' '}
                      {turn.session || 'untimed'}
                    </span>
                    <strong>{turn.preview}</strong>
                    {contents[turn.id] && <pre>{contents[turn.id]}</pre>}
                  </article>
                ))}
              </div>
              {outline.offset > 0 && (
                <button onClick={() => onPage(Math.max(0, outline.offset - 50))}>Previous 50 turns</button>
              )}{' '}
              {outline.offset + outline.turns.length < outline.total && (
                <button onClick={() => onPage(outline.offset + outline.turns.length)}>Next 50 turns</button>
              )}
            </>
          )}
        </section>
      </Accordion>
    </>
  )
}
function PhraseAnalysis({
  title,
  subtitle,
  repetitions,
}: {
  title: string
  subtitle: string
  repetitions?: RepetitionState
}) {
  return (
    <Accordion title={title} description={subtitle}>
      {repetitions === undefined || repetitions.kind === 'loading' ? (
        <p class="accordion-status">Finding repeated language...</p>
      ) : repetitions.kind === 'error' ? (
        <p class="accordion-status error-text">{repetitions.message}</p>
      ) : (
        <>
          <p class="chart-note">
            Maximal sequences contain at least two words. Score equals occurrences multiplied by words. Each table
            contains up to 500 phrases.
          </p>
          <PhraseTable title="Your repeated phrases" rows={repetitions.analysis.user} />
          <PhraseTable title="Assistant repeated phrases" rows={repetitions.analysis.assistant} />
        </>
      )}
    </Accordion>
  )
}
function PhraseTable({
  title,
  rows,
}: {
  title: string
  rows: readonly { phrase: string; occurrences: number; words: number; score: number }[]
}) {
  return (
    <Accordion title={title} description={`${rows.length.toLocaleString()} phrases found.`}>
      <div class="phrase-table">
        {rows.length === 0 ? (
          <p class="chart-note">No repeated two-word sequences found.</p>
        ) : (
          <SortableTable
            rows={rows}
            columns={phraseColumns}
            initialSort={{ column: 'score', direction: 'descending' }}
            rowKey={phrase => phrase.phrase}
          />
        )}
      </div>
    </Accordion>
  )
}
function CopyPhrase({ phrase }: { phrase: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<number>()
  useEffect(() => () => clearTimeout(resetTimer.current), [])

  async function copyPhrase() {
    clearTimeout(resetTimer.current)
    try {
      await navigator.clipboard.writeText(phrase)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 1_800)
  }

  return (
    <button class="phrase-copy" type="button" onClick={() => void copyPhrase()} title="Copy full phrase">
      <span>{phrasePreview(phrase)}</span>
      <small>
        {copyState === 'copied'
          ? 'Copied full phrase'
          : copyState === 'failed'
            ? 'Copy failed'
            : 'Click to copy full phrase'}
      </small>
    </button>
  )
}
function DayAttribution({ day }: { day: AnalyticsDay }) {
  return (
    <section class="breakdown-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Selected day</p>
          <h2>
            {day.date}: {day.prompts.toLocaleString()} prompts, {day.output.words.toLocaleString()} output words
          </h2>
        </div>
        <span class="selected-date">{day.activeChats} chats</span>
      </div>
      <SortableTable
        rows={day.conversations}
        columns={dayColumns}
        initialSort={{ column: 'output', direction: 'descending' }}
        rowKey={chat => chat.id}
      />
    </section>
  )
}
function Concentration({ conversations }: { conversations: readonly ConversationAnalytics[] }) {
  const ordered = conversations.slice().sort((a, b) => b.output.words - a.output.words)
  const ranked = ordered.slice(0, 12)
  const total = conversations.reduce((sum, chat) => sum + chat.output.words, 0)
  let cumulative = 0
  return (
    <section class="breakdown-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Concentration</p>
          <h2>Which chats account for output volume?</h2>
        </div>
        <span class="selected-date">
          Top 1 / 5 / 10:{' '}
          {share(
            ordered.slice(0, 1).reduce((sum, chat) => sum + chat.output.words, 0),
            total
          )}{' '}
          /{' '}
          {share(
            ordered.slice(0, 5).reduce((sum, chat) => sum + chat.output.words, 0),
            total
          )}{' '}
          /{' '}
          {share(
            ordered.slice(0, 10).reduce((sum, chat) => sum + chat.output.words, 0),
            total
          )}
        </span>
      </div>
      <ol class="concentration">
        {ranked.map(chat => {
          cumulative += chat.output.words
          return (
            <li>
              <a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title || 'Untitled chat'}</a>
              <div>
                <i style={{ width: `${total ? (chat.output.words / total) * 100 : 0}%` }} />
                <span>
                  {formatNumber(chat.output.words)} words · {share(cumulative, total)} cumulative
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
function CalendarHeatmap({ days, metric }: { days: readonly AnalyticsDay[]; metric: DailyMetric }) {
  const max = Math.max(...days.map(day => metricValue(day, metric)), 1)
  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Calendar rhythm</p>
          <h2>Daily {metricLabel(metric).toLocaleLowerCase()} at a glance.</h2>
        </div>
      </div>
      <div class="calendar-heatmap">
        {days.map(day => (
          <span
            title={`${day.date}: ${metricValue(day, metric).toLocaleString()} ${metricLabel(metric).toLocaleLowerCase()}`}
            style={{ opacity: `${heatmapOpacity(metricValue(day, metric), max, 0.12)}` }}
          />
        ))}
      </div>
      <p class="chart-note">Each cell is one calendar day, including inactive days.</p>
    </section>
  )
}
function HourHeatmap({
  cells,
  metric,
  onSelect,
}: {
  cells: readonly { weekday: number; hour: number; prompts: number; input: TextMetrics; output: TextMetrics }[]
  metric: 'prompts' | 'input' | 'output'
  onSelect: (filter: TemporalMessageFilter) => void
}) {
  const value = (cell: (typeof cells)[number]) => (metric === 'prompts' ? cell.prompts : cell[metric].words)
  const max = Math.max(...cells.map(value), 1)
  const label = metric === 'prompts' ? 'prompts' : `${metric} words`
  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Temporal rhythm</p>
          <h2>When {label} happen.</h2>
        </div>
      </div>
      <div class="hour-heatmap">
        {cells.map(cell => {
          const count = value(cell)
          const title = `${weekdayName(cell.weekday, 'short')} ${hourLabel(cell.hour)}: ${count.toLocaleString()} ${label}`
          return (
            <button
              type="button"
              title={title}
              aria-label={`${title}. Explore messages.`}
              disabled={count === 0}
              onClick={() =>
                onSelect({ role: metric === 'output' ? 'assistant' : 'user', weekday: cell.weekday, hour: cell.hour })
              }
              style={{ opacity: `${heatmapOpacity(count, max, 0.1)}` }}
            />
          )
        })}
      </div>
      <p class="chart-note">
        Rows run Sunday to Saturday; columns run 00:00 to 23:00 in the selected timezone. Select a cell to inspect its
        messages.
      </p>
    </section>
  )
}
function SessionDistribution({ sessions }: { sessions: readonly SessionAnalytics[] }) {
  const bins: readonly (readonly [number, number])[] = [
    [1, 1],
    [2, 5],
    [6, 10],
    [11, 25],
    [26, 50],
    [51, 100],
    [101, Infinity],
  ]
  const counts = bins.map(
    ([from, to]) => sessions.filter(session => session.prompts >= from && session.prompts <= to).length
  )
  return (
    <MiniBars
      title="Session depth"
      labels={bins.map(([from, to]) => (to === Infinity ? `${from}+` : from === to ? `${from}` : `${from}-${to}`))}
      values={counts}
      note="Prompts per observed session."
    />
  )
}
function SessionStarts({ sessions, utc }: { sessions: readonly SessionAnalytics[]; utc: boolean }) {
  const values = Array.from(
    { length: 24 },
    (_, hour) =>
      sessions.filter(session =>
        utc ? new Date(session.startAt).getUTCHours() === hour : new Date(session.startAt).getHours() === hour
      ).length
  )
  return (
    <MiniBars
      title="Session starts"
      labels={values.map((_, hour) => String(hour).padStart(2, '0'))}
      values={values}
      note="Observed session starts by hour."
    />
  )
}
function SessionScatter({ sessions }: { sessions: readonly SessionAnalytics[] }) {
  const maxPrompts = Math.max(...sessions.map(session => session.prompts), 1)
  const maxSpan = Math.max(...sessions.map(session => session.spanMs), 1)
  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Intensity</p>
          <h2>Session depth and observed span.</h2>
        </div>
      </div>
      <div class="scatter">
        {sessions.map(session => (
          <a
            href={`#/conversations/${encodeURIComponent(session.conversations[0]?.id ?? '')}`}
            title={`${session.prompts} prompts over ${formatDuration(session.spanMs)}`}
            style={{ left: `${(session.prompts / maxPrompts) * 100}%`, bottom: `${(session.spanMs / maxSpan) * 100}%` }}
          />
        ))}
      </div>
      <p class="chart-note">Each point is a session. This is observed elapsed span, not time spent.</p>
    </section>
  )
}
function Continuation({ sessions }: { sessions: readonly SessionAnalytics[] }) {
  const points = Array.from({ length: 12 }, (_, index) => index + 1)
    .map(prompts => {
      const reached = sessions.filter(session => session.prompts >= prompts).length
      const continued = sessions.filter(session => session.prompts > prompts).length
      return { prompts, rate: reached ? continued / reached : 0, reached }
    })
    .filter(point => point.reached >= 5)
  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Continuation</p>
          <h2>How often sessions continue.</h2>
        </div>
      </div>
      <div class="continuation">
        {points.map(point => (
          <div>
            <span>{point.prompts}</span>
            <i style={{ width: `${point.rate * 100}%` }} />
            <strong>{Math.round(point.rate * 100)}%</strong>
          </div>
        ))}
      </div>
      <p class="chart-note">
        Among sessions reaching a prompt count, the share with at least one further prompt. Minimum sample: 5 sessions.
      </p>
    </section>
  )
}
function SessionCards({ sessions }: { sessions: readonly SessionAnalytics[] }) {
  return (
    <section class="breakdown-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Conversation sessions</p>
          <h2>Structural breaks in this chat.</h2>
        </div>
      </div>
      <div class="session-cards">
        {sessions.map(session => (
          <article>
            <strong>
              {formatDate(session.startAt)} · {session.prompts} prompts · {formatDuration(session.spanMs)}
            </strong>
            <span>{session.preview || 'No user prompt preview'}</span>
          </article>
        ))}
      </div>
    </section>
  )
}
function SessionTable({ sessions }: { sessions: readonly SessionAnalytics[] }) {
  return (
    <section class="breakdown-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Outlier queue</p>
          <h2>Sessions to inspect.</h2>
        </div>
      </div>
      <SortableTable
        rows={sessions}
        columns={sessionColumns}
        initialSort={{ column: 'prompts', direction: 'descending' }}
        rowKey={session => session.id}
      />
    </section>
  )
}
function TurnTimeline({
  bins,
  total,
  onSelect,
}: {
  bins: readonly { startIndex: number; endIndex: number; input: TextMetrics; output: TextMetrics }[]
  total: number
  onSelect: (bin: { startIndex: number; endIndex: number }) => void
}) {
  const max = Math.max(...bins.map(bin => Math.max(bin.input.words, bin.output.words)), 1)
  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Turn volume</p>
          <h2>
            {total.toLocaleString()} turns, compressed into {bins.length} inspectable bins.
          </h2>
        </div>
      </div>
      <div class="turn-timeline">
        {bins.map(bin => (
          <button
            title={`Turns ${bin.startIndex}-${bin.endIndex}: ${bin.input.words} input words, ${bin.output.words} output words`}
            onClick={() => onSelect(bin)}>
            <i style={{ height: `${(bin.input.words / max) * 100}%` }} />
            <b style={{ height: `${(bin.output.words / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <p class="chart-note">
        Orange is user input; teal is assistant output. Select a bin to load those turns in the message outline.
      </p>
    </section>
  )
}
function MiniBars({
  title,
  labels,
  values,
  note,
}: {
  title: string
  labels: string[]
  values: number[]
  note: string
}) {
  const max = Math.max(...values, 1)
  return (
    <section class="chart-card">
      <div class="chart-heading">
        <div>
          <p class="eyebrow">Sessions</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div class="mini-bars">
        {values.map((value, index) => (
          <div>
            <strong>{value}</strong>
            <i style={{ height: `${(value / max) * 100}%` }} />
            <span>{labels[index]}</span>
          </div>
        ))}
      </div>
      <p class="chart-note">{note}</p>
    </section>
  )
}
function Status({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return (
    <section class={error ? 'status-card error' : 'status-card'}>
      <p class="eyebrow">{title}</p>
      <strong>{detail}</strong>
    </section>
  )
}
function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div class="metric">
      <span>{label}</span>
      <strong>{typeof value === 'number' ? formatNumber(value) : value}</strong>
    </div>
  )
}
function About() {
  return (
    <section class="about-page">
      <div class="page-heading">
        <p class="eyebrow">About this dashboard</p>
        <h2>Understand your ChatGPT usage.</h2>
        <p>
          Atlas measures messages, text, timing, and session structure. It does not infer purpose, topic, wellbeing, or
          intent from your chats.
        </p>
      </div>
      <div class="about-grid">
        <section class="about-card">
          <p class="eyebrow">Get started</p>
          <h3>Import an export</h3>
          <p>
            <a
              href="https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data"
              target="_blank"
              rel="noreferrer">
              Request a ChatGPT data export from OpenAI
            </a>
            , then choose the downloaded ZIP or an extracted folder.
          </p>
        </section>
        <section class="about-card">
          <p class="eyebrow">Text metrics</p>
          <h3>Volume is not tokens</h3>
          <p>
            Input and output use message bodies. Words are Unicode word segments; characters are text characters. Custom
            instructions and hidden reasoning are not counted.
          </p>
        </section>
        <section class="about-card">
          <p class="eyebrow">Data handling</p>
          <h3>Your data stays in your browser</h3>
          <p>Atlas analyzes files locally in a browser worker. It does not upload or store your conversations.</p>
        </section>
      </div>
    </section>
  )
}
function busiestDay(days: readonly AnalyticsDay[]): AnalyticsDay | undefined {
  return days.reduce<AnalyticsDay | undefined>(
    (best, day) => (!best || day.prompts > best.prompts ? day : best),
    undefined
  )
}
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
function selectedTimeZone(zone: TimeZoneMode): string {
  return zone === 'local' ? localTimeZone() : 'UTC'
}
function readRoute(): Route {
  const [page, section, role, weekday, hour] = location.hash.slice(2).split('/')
  if (page === 'patterns' && section === 'time') {
    const parsedHour = Number(hour)
    const parsedWeekday = weekday === 'all' ? undefined : Number(weekday)
    if (
      (role === 'user' || role === 'assistant') &&
      Number.isInteger(parsedHour) &&
      parsedHour >= 0 &&
      parsedHour <= 23 &&
      (parsedWeekday === undefined || (Number.isInteger(parsedWeekday) && parsedWeekday >= 0 && parsedWeekday <= 6))
    )
      return { page: 'time', filter: { role, weekday: parsedWeekday, hour: parsedHour } }
  }
  return page === 'patterns'
    ? { page: 'patterns' }
    : page === 'conversations'
      ? section
        ? { page: 'conversation', id: decodeURIComponent(section) }
        : { page: 'conversations' }
      : page === 'about'
        ? { page: 'about' }
        : { page: 'overview' }
}
function temporalRoute(filter: TemporalMessageFilter): string {
  return `#/patterns/time/${filter.role}/${filter.weekday ?? 'all'}/${filter.hour}`
}
function weekdayName(weekday: number, length: 'long' | 'short' = 'long'): string {
  const names =
    length === 'short'
      ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return names[weekday]!
}
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}
function ratio(output: TextMetrics, input: TextMetrics): string {
  return input.words === 0 ? 'n/a' : `${(output.words / input.words).toFixed(1)}x`
}
function share(value: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((value / total) * 100)}%`
}
function formatNumber(value: number): string {
  return value.toLocaleString()
}
function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>()
function formatInTimeZone(value: string, timeZone: string): string {
  let formatter = timeZoneFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })
    timeZoneFormatters.set(timeZone, formatter)
  }
  return formatter.format(new Date(value))
}
function formatDuration(value: number): string {
  const minutes = Math.round(value / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
function heatmapOpacity(value: number, maximum: number, minimum: number): number {
  return value === 0 ? 0 : minimum + ((1 - minimum) * value) / maximum
}
function phrasePreview(phrase: string): string {
  const compact = phrase.replace(/\s+/g, ' ').trim()
  if (compact.length <= 180) return compact
  const boundary = compact.lastIndexOf(' ', 180)
  return `${compact.slice(0, boundary > 0 ? boundary : 180)}...`
}
function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const center = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[center]! : (sorted[center - 1]! + sorted[center]!) / 2
}
const conversationColumns: readonly SortableColumn<ConversationAnalytics>[] = [
  {
    id: 'title',
    label: 'Conversation',
    align: 'left',
    compare: (a, b) => a.title.localeCompare(b.title),
    render: chat => (
      <>
        <a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title || 'Untitled chat'}</a>
        <code>{chat.id}</code>
      </>
    ),
  },
  { id: 'prompts', label: 'Prompts', compare: (a, b) => a.prompts - b.prompts, render: chat => chat.prompts },
  {
    id: 'input',
    label: 'Input words',
    compare: (a, b) => a.input.words - b.input.words,
    render: chat => chat.input.words,
  },
  {
    id: 'output',
    label: 'Output words',
    compare: (a, b) => a.output.words - b.output.words,
    render: chat => chat.output.words,
  },
  {
    id: 'characters',
    label: 'Input / output characters',
    compare: (a, b) => a.input.characters + a.output.characters - (b.input.characters + b.output.characters),
    render: chat => `${formatNumber(chat.input.characters)} / ${formatNumber(chat.output.characters)}`,
  },
  {
    id: 'ratio',
    label: 'Output / input',
    compare: (a, b) => a.output.words / Math.max(a.input.words, 1) - b.output.words / Math.max(b.input.words, 1),
    render: chat => ratio(chat.output, chat.input),
  },
  { id: 'sessions', label: 'Sessions', compare: (a, b) => a.sessions - b.sessions, render: chat => chat.sessions },
  { id: 'days', label: 'Active days', compare: (a, b) => a.activeDays - b.activeDays, render: chat => chat.activeDays },
  {
    id: 'lifetime',
    label: 'Lifetime',
    compare: (a, b) => (a.lifetimeMs ?? -1) - (b.lifetimeMs ?? -1),
    render: chat => (chat.lifetimeMs === undefined ? 'No duration' : formatDuration(chat.lifetimeMs)),
  },
]
const dayColumns: readonly SortableColumn<DayConversation>[] = [
  {
    id: 'title',
    label: 'Conversation',
    align: 'left',
    compare: (a, b) => a.title.localeCompare(b.title),
    render: chat => <a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title || 'Untitled chat'}</a>,
  },
  { id: 'prompts', label: 'Prompts', compare: (a, b) => a.prompts - b.prompts, render: chat => chat.prompts },
  {
    id: 'input',
    label: 'Input words',
    compare: (a, b) => a.input.words - b.input.words,
    render: chat => chat.input.words,
  },
  {
    id: 'output',
    label: 'Output words',
    compare: (a, b) => a.output.words - b.output.words,
    render: chat => chat.output.words,
  },
]
const sessionColumns: readonly SortableColumn<SessionAnalytics>[] = [
  {
    id: 'start',
    label: 'Start',
    align: 'left',
    compare: (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
    render: session => (
      <>
        {formatDate(session.startAt)}
        <code>{session.preview || 'No prompt preview'}</code>
      </>
    ),
  },
  { id: 'prompts', label: 'Prompts', compare: (a, b) => a.prompts - b.prompts, render: session => session.prompts },
  {
    id: 'input',
    label: 'Input words',
    compare: (a, b) => a.input.words - b.input.words,
    render: session => session.input.words,
  },
  {
    id: 'output',
    label: 'Output words',
    compare: (a, b) => a.output.words - b.output.words,
    render: session => session.output.words,
  },
  {
    id: 'span',
    label: 'Observed span',
    compare: (a, b) => a.spanMs - b.spanMs,
    render: session => formatDuration(session.spanMs),
  },
]
const phraseColumns: readonly SortableColumn<{ phrase: string; occurrences: number; words: number; score: number }>[] =
  [
    {
      id: 'phrase',
      label: 'Phrase',
      align: 'left',
      compare: (a, b) => a.phrase.localeCompare(b.phrase),
      render: phrase => <CopyPhrase phrase={phrase.phrase} />,
    },
    {
      id: 'occurrences',
      label: 'Occurrences',
      compare: (a, b) => a.occurrences - b.occurrences,
      render: phrase => phrase.occurrences,
    },
    { id: 'words', label: 'Words', compare: (a, b) => a.words - b.words, render: phrase => phrase.words },
    { id: 'score', label: 'Score', compare: (a, b) => a.score - b.score, render: phrase => phrase.score },
  ]
type WorkerMessage =
  | {
      type: 'progress'
      requestId: number
      fileName: string
      fileIndex: number
      fileCount?: number
      bytesRead: number
      bytesTotal?: number
      chats: number
      archiveName?: string
    }
  | {
      type: 'complete'
      requestId: number
      local: AnalyticsStatistics
      utc: AnalyticsStatistics
      skipped: number
      durationMs: number
      startDate?: string
      sessionGapMinutes: number
    }
  | {
      type: 'statistics'
      requestId: number
      local: AnalyticsStatistics
      utc: AnalyticsStatistics
      startDate?: string
      sessionGapMinutes: number
    }
  | { type: 'conversation-detail'; requestId: number; id: string; detail?: ConversationDetail }
  | { type: 'conversation-outline'; requestId: number; id: string; page: TurnPage }
  | { type: 'message-content'; requestId: number; id: string; contents: MessageContent[] }
  | { type: 'conversation-repetitions'; requestId: number; id: string; analysis: RepeatedPhraseAnalysis }
  | ({ type: 'temporal-slice'; requestId: number } & TemporalPage)
  | { type: 'temporal-content'; requestId: number; contents: MessageContent[] }
  | {
      type: 'failure'
      requestId: number
      operation:
        | 'import'
        | 'statistics'
        | 'conversation-detail'
        | 'conversation-outline'
        | 'message-content'
        | 'conversation-repetitions'
        | 'temporal-slice'
        | 'temporal-content'
      message: string
    }
