import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ConversationSummary, UsageDay, UsageStatistics } from '@chatgpt-export-reader/core'
import { DailyChart } from './daily-chart.js'
import { PromptHistogram } from './prompt-histogram.js'
import { SortableTable, type SortableColumn } from './sortable-table.js'

type ImportState =
    | { kind: 'idle' }
    | { kind: 'loading'; detail: string }
    | { kind: 'ready'; local: UsageStatistics; utc: UsageStatistics; skipped: number; durationMs: number; startDate?: string }
    | { kind: 'error'; message: string }
type TimeZoneMode = 'local' | 'utc'
type Route = { page: 'about' } | { page: 'overview' } | { page: 'conversations' } | { page: 'conversation'; id: string }
type Detail =
    | { kind: 'ready'; summary: ConversationSummary; days: UsageDay[] }
    | { kind: 'missing' }
    | { kind: 'error'; message: string }

export function App() {
    const input = useRef<HTMLInputElement>(null)
    const worker = useRef<Worker>()
    const nextRequestId = useRef(0)
    const activeImportRequest = useRef<number>()
    const activeStatisticsRequest = useRef<number>()
    const activeDetailRequest = useRef<number>()
    const zoneRef = useRef<TimeZoneMode>('local')
    const appliedStartDateRef = useRef<string>()
    const [state, setState] = useState<ImportState>({ kind: 'idle' })
    const [zone, setZone] = useState<TimeZoneMode>('local')
    const [route, setRoute] = useState<Route>(readRoute)
    const [detail, setDetail] = useState<Detail | undefined>()
    const [selectedDate, setSelectedDate] = useState<string>()
    const [startDate, setStartDate] = useState<string>()
    const [filtering, setFiltering] = useState(false)
    const [filterError, setFilterError] = useState<string>()

    zoneRef.current = zone
    const appliedStartDate = state.kind === 'ready' ? state.startDate : undefined
    appliedStartDateRef.current = appliedStartDate
    const stats = state.kind === 'ready' ? (zone === 'local' ? state.local : state.utc) : undefined
    const importing = state.kind === 'loading'
    const selectedDay = stats?.days.find(day => day.date === selectedDate)
    const visibleRoute: Route = stats ? route : { page: 'about' }

    useEffect(() => {
        input.current?.setAttribute('webkitdirectory', '')
        const nextWorker = new Worker(new URL('./stats-worker.ts', import.meta.url), { type: 'module' })
        worker.current = nextWorker
        nextWorker.addEventListener('message', event => receiveWorkerMessage(event.data as WorkerMessage))
        const onHashChange = () => setRoute(readRoute())
        addEventListener('hashchange', onHashChange)
        return () => { nextWorker.terminate(); removeEventListener('hashchange', onHashChange) }
    }, [])

    useEffect(() => {
        if (route.page !== 'conversation' || !stats) return
        if (!stats.conversations.some(chat => chat.id === route.id)) {
            setDetail({ kind: 'missing' })
            return
        }
        const requestId = ++nextRequestId.current
        activeDetailRequest.current = requestId
        setDetail(undefined)
        worker.current?.postMessage({
            type: 'conversation-detail',
            requestId,
            id: route.id,
            timeZone: zone === 'local' ? localTimeZone() : 'UTC',
            startDate: appliedStartDate,
        })
    }, [route, zone, stats, appliedStartDate])

    function receiveWorkerMessage(message: WorkerMessage) {
        if (message.type === 'progress') {
            if (message.requestId !== activeImportRequest.current) return
            const percent = message.bytesTotal === 0 ? 0 : Math.round((message.bytesRead / message.bytesTotal) * 100)
            setState({ kind: 'loading', detail: `${message.fileName} (${message.fileIndex}/${message.fileCount}, ${percent}%) - ${message.chats} chats` })
        } else if (message.type === 'complete') {
            if (message.requestId !== activeImportRequest.current) return
            activeImportRequest.current = undefined
            setState({ kind: 'ready', local: message.local, utc: message.utc, skipped: message.skipped, durationMs: message.durationMs, startDate: message.startDate })
            setFiltering(false)
            setFilterError(undefined)
            setZone('local')
            setSelectedDate(busiestDay(message.local.days)?.date)
            location.hash = '#/'
        } else if (message.type === 'statistics') {
            if (message.requestId !== activeStatisticsRequest.current) return
            activeStatisticsRequest.current = undefined
            setState(current => current.kind === 'ready'
                ? { ...current, local: message.local, utc: message.utc, startDate: message.startDate }
                : current)
            setFiltering(false)
            setFilterError(undefined)
            setSelectedDate(busiestDay(zoneRef.current === 'local' ? message.local.days : message.utc.days)?.date)
        } else if (message.type === 'conversation-detail') {
            if (message.requestId !== activeDetailRequest.current) return
            activeDetailRequest.current = undefined
            setDetail({ kind: 'ready', summary: message.summary, days: message.days })
        } else if (message.operation === 'import') {
            if (message.requestId !== activeImportRequest.current) return
            activeImportRequest.current = undefined
            setState({ kind: 'error', message: message.message })
        } else if (message.operation === 'statistics') {
            if (message.requestId !== activeStatisticsRequest.current) return
            activeStatisticsRequest.current = undefined
            setFiltering(false)
            setStartDate(appliedStartDateRef.current)
            setFilterError(message.message)
        } else {
            if (message.requestId !== activeDetailRequest.current) return
            activeDetailRequest.current = undefined
            setDetail({ kind: 'error', message: message.message })
        }
    }

    function selectFolder(event: Event) {
        const picker = event.currentTarget as HTMLInputElement
        const files = [...picker.files ?? []]
        picker.value = ''
        if (files.length === 0) return
        const requestId = ++nextRequestId.current
        activeImportRequest.current = requestId
        activeStatisticsRequest.current = undefined
        activeDetailRequest.current = undefined
        setDetail(undefined)
        setFiltering(false)
        setFilterError(undefined)
        setState({ kind: 'loading', detail: 'Preparing local import...' })
        worker.current?.postMessage({ type: 'import', requestId, files, localTimeZone: localTimeZone(), startDate })
    }

    function applyStartDate(nextStartDate: string | undefined) {
        if (nextStartDate === startDate || state.kind !== 'ready') return
        const requestId = ++nextRequestId.current
        activeStatisticsRequest.current = requestId
        activeDetailRequest.current = undefined
        setStartDate(nextStartDate)
        setDetail(undefined)
        setFiltering(true)
        setFilterError(undefined)
        worker.current?.postMessage({ type: 'statistics', requestId, localTimeZone: localTimeZone(), startDate: nextStartDate })
    }

    function selectZone(nextZone: TimeZoneMode) {
        if (nextZone === zone) return
        setZone(nextZone)
        if (state.kind === 'ready') setSelectedDate(busiestDay(nextZone === 'local' ? state.local.days : state.utc.days)?.date)
    }

    return <main>
        <header class="masthead">
            <div><p class="eyebrow">Private local analytics</p><h1>ChatGPT Usage Atlas</h1><p class="subtitle">Find the conversations behind your busiest days.</p></div>
            <button class="import-button" type="button" disabled={importing} onClick={() => input.current?.click()}>{importing ? 'Importing...' : 'Choose export folder'}</button>
            <input class="import-input" ref={input} type="file" multiple onChange={selectFolder} />
        </header>
        <Nav route={visibleRoute} hasExport={Boolean(stats)} />
        {!stats && <About />}
        {state.kind === 'loading' && <section class="status-card"><p class="eyebrow">Importing locally</p><strong>{state.detail}</strong><p>Files never leave this browser.</p></section>}
        {state.kind === 'error' && <section class="status-card error"><p class="eyebrow">Import failed</p><strong>{state.message}</strong></section>}
        {stats && <>
            {visibleRoute.page !== 'about' && <div class="toolbar" aria-label="Statistics controls">
                <div class="toolbar-group" role="group" aria-label="Calendar timezone"><span>Calendar timezone</span><button class={zone === 'local' ? 'active' : ''} onClick={() => selectZone('local')}>Local</button><button class={zone === 'utc' ? 'active' : ''} onClick={() => selectZone('utc')}>UTC</button></div>
                <label class="date-filter">Measure from <input type="date" value={startDate ?? ''} onChange={event => applyStartDate(event.currentTarget.value || undefined)} /></label>
                <button type="button" disabled={!startDate || filtering} onClick={() => applyStartDate(undefined)}>All time</button>
                <small class={filterError ? 'range-status error-text' : 'range-status'}>{filtering ? 'Updating locally...' : filterError ?? (appliedStartDate ? `Inclusive from ${appliedStartDate} in ${zone === 'local' ? 'local time' : 'UTC'}` : 'All time')}</small>
                {state.kind === 'ready' && <small class="import-summary">Imported in {(state.durationMs / 1000).toFixed(1)}s{state.skipped ? `; ${state.skipped} invalid chats skipped` : ''}</small>}
            </div>}
            {visibleRoute.page === 'overview' && <Overview stats={stats} selectedDay={selectedDay} selectedDate={selectedDate} startDate={appliedStartDate} onSelectDate={setSelectedDate} />}
            {visibleRoute.page === 'conversations' && <ConversationList conversations={stats.conversations} startDate={appliedStartDate} />}
            {visibleRoute.page === 'conversation' && <ConversationDetail detail={detail} startDate={appliedStartDate} />}
            {visibleRoute.page === 'about' && <About />}
        </>}
    </main>
}

function Nav({ route, hasExport }: { route: Route; hasExport: boolean }) {
    return <nav class="nav" aria-label="Dashboard">
        {hasExport && <><a class={route.page === 'overview' ? 'active' : ''} href="#/">Overview</a><a class={route.page === 'conversations' || route.page === 'conversation' ? 'active' : ''} href="#/conversations">Conversations</a></>}
        <a class={route.page === 'about' ? 'active' : ''} href="#/about">About</a>
    </nav>
}

function About() {
    return <section class="about-page">
        <div class="page-heading"><p class="eyebrow">About this dashboard</p><h2>Usage analytics that stay on your computer.</h2><p>ChatGPT Usage Atlas is a static website for exploring the timestamps and structure in a ChatGPT data export. It does not require an account with this site.</p></div>
        <div class="about-grid">
            <section class="about-card"><p class="eyebrow">Use it</p><h3>Import an extracted ChatGPT export</h3><ol><li><a href="https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data" target="_blank" rel="noreferrer">Request a ChatGPT data export from OpenAI</a>.</li><li>Download the export from the email OpenAI sends, then extract the ZIP file.</li><li>Choose the extracted folder here. The dashboard reads its <code>conversations*.json</code> files.</li></ol></section>
            <section class="about-card"><p class="eyebrow">Privacy</p><h3>Nothing is uploaded</h3><p>Your selected files are parsed in a Web Worker in this browser. The site makes no network request with your export, and it does not store a copy on disk or on a server.</p><p>Normalized conversations, including message content, remain only in the worker’s memory while this tab is open so the conversation views can be calculated. Message bodies are never displayed in the dashboard.</p></section>
            <section class="about-card"><p class="eyebrow">Results</p><h3>How the figures are calculated</h3><p>Counts and charts come from timestamped conversation messages. Switch between local time and UTC to control how messages near midnight are assigned to calendar days.</p><p>Use Measure from to exclude earlier messages from every statistic. Refreshing the page or closing the tab clears the imported data and selected cutoff.</p></section>
        </div>
    </section>
}

function Overview({ stats, selectedDay, selectedDate, startDate, onSelectDate }: { stats: UsageStatistics; selectedDay?: UsageDay; selectedDate?: string; startDate?: string; onSelectDate: (date: string) => void }) {
    const empty = stats.summary.messages === 0
    return <><section class="summary-grid"><Metric label="Chats" value={stats.summary.chats} /><Metric label="Messages" value={stats.summary.messages} /><Metric label="User prompts" value={stats.summary.prompts} /><Metric label="Active days" value={stats.summary.activeDays} /></section>{empty ? <EmptyResults startDate={startDate} /> : <><DailyChart days={stats.days} selectedDate={selectedDate} onSelectDate={onSelectDate} showPromptSummary /><PromptHistogram days={stats.days} />{selectedDay && <section class="breakdown-card"><div class="chart-heading"><div><p class="eyebrow">Spike attribution</p><h2>{selectedDay.date}: {selectedDay.messages.toLocaleString()} messages</h2></div><span class="selected-date">{selectedDay.activeChats} active chats</span></div><SortableTable rows={selectedDay.conversations} columns={dayColumns(selectedDay.messages)} initialSort={{ column: 'messages', direction: 'descending' }} rowKey={chat => chat.id} /></section>}</>}</>
}

function ConversationList({ conversations, startDate }: { conversations: readonly ConversationSummary[]; startDate?: string }) {
    const [query, setQuery] = useState('')
    const visible = useMemo(() => conversations.filter(chat => `${chat.title} ${chat.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [conversations, query])
    return <section class="breakdown-card"><div class="chart-heading"><div><p class="eyebrow">All conversations</p><h2>{conversations.length.toLocaleString()} chats</h2></div><input class="search" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search title or ID" /></div>{visible.length === 0 ? <p class="empty-table">{query ? 'No conversations match this search.' : startDate ? `No conversations have messages on or after ${startDate}.` : 'No conversations are available.'}</p> : <SortableTable rows={visible} columns={conversationColumns} initialSort={{ column: 'messages', direction: 'descending' }} rowKey={chat => chat.id} />}</section>
}

function ConversationDetail({ detail, startDate }: { detail?: Detail; startDate?: string }) {
    if (detail === undefined) return <section class="status-card"><p class="eyebrow">Loading conversation</p><strong>Calculating its timeline and daily activity locally...</strong></section>
    if (detail.kind === 'missing') return <section class="status-card"><p class="eyebrow">Conversation unavailable</p><strong>{startDate ? `This chat has no messages on or after ${startDate}.` : 'This chat is unavailable in the current statistics.'}</strong></section>
    if (detail.kind === 'error') return <section class="status-card error"><p class="eyebrow">Conversation unavailable</p><strong>{detail.message}</strong></section>
    const { summary, days } = detail
    const prompts = summary.roles.find(role => role.role === 'user')?.messages ?? 0
    return <><section class="detail-card"><p class="eyebrow">Conversation detail</p><h2>{summary.title || 'Untitled chat'}</h2><code>{summary.id}</code><section class="summary-grid"><Metric label="Messages" value={summary.messages} /><Metric label="User prompts" value={prompts} /><Metric label="Active days" value={summary.activeDays} /><Metric label="Lifetime" value={formatDuration(summary.lifetimeMs)} /></section><p>{formatDate(summary.firstMessageAt)} to {formatDate(summary.lastMessageAt)}</p></section><DailyChart days={days} title="Activity across this chat's lifetime" note="Bars show all messages and user prompts across this conversation's active lifetime." onSelectDate={() => {}} /></>
}

function EmptyResults({ startDate }: { startDate?: string }) { return <section class="status-card"><p class="eyebrow">No matching messages</p><strong>{startDate ? `No timestamped messages fall on or after ${startDate}.` : 'This export has no timestamped messages.'}</strong><p>Choose an earlier start date or reset the range to all time.</p></section> }
function Metric({ label, value }: { label: string; value: number | string }) { return <div class="metric"><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong></div> }
function busiestDay(days: readonly UsageDay[]): UsageDay | undefined { return days.reduce<UsageDay | undefined>((best, day) => !best || day.messages > best.messages ? day : best, undefined) }
function formatDate(value?: string): string { return value ? new Date(value).toLocaleString() : 'No timestamp' }
function formatDuration(value?: number): string { if (value === undefined) return 'No duration'; const hours = Math.floor(value / 3_600_000); const days = Math.floor(hours / 24); return days ? `${days}d ${hours % 24}h` : `${hours}h ${Math.floor(value / 60_000) % 60}m` }
function localTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone }
const conversationColumns: readonly SortableColumn<ConversationSummary>[] = [
    { id: 'title', label: 'Conversation', align: 'left', compare: (a, b) => a.title.localeCompare(b.title), render: chat => <><a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title || 'Untitled chat'}</a><code>{chat.id}</code></> },
    { id: 'messages', label: 'Messages by role', compare: (a, b) => a.messages - b.messages, render: chat => <>{chat.messages.toLocaleString()} total<code>{chat.roles.map(role => `${role.role} ${role.messages}`).join(' · ')}</code></> },
    { id: 'first', label: 'First / last message', compare: (a, b) => compareOptionalDate(a.firstMessageAt, b.firstMessageAt), render: chat => <>{formatDate(chat.firstMessageAt)}<code>{formatDate(chat.lastMessageAt)}</code></> },
    { id: 'lifetime', label: 'Lifetime', compare: (a, b) => compareOptionalNumber(a.lifetimeMs, b.lifetimeMs), render: chat => formatDuration(chat.lifetimeMs) },
]
function dayColumns(total: number): readonly SortableColumn<UsageDay['conversations'][number]>[] { return [
    { id: 'title', label: 'Conversation', align: 'left', compare: (a, b) => a.title.localeCompare(b.title), render: chat => <><a href={`#/conversations/${encodeURIComponent(chat.id)}`}>{chat.title || 'Untitled chat'}</a><code>{chat.id}</code></> },
    { id: 'messages', label: 'Messages', compare: (a, b) => a.messages - b.messages, render: chat => chat.messages },
    { id: 'prompts', label: 'Prompts', compare: (a, b) => a.prompts - b.prompts, render: chat => chat.prompts },
    { id: 'share', label: 'Share', compare: (a, b) => a.messages - b.messages, render: chat => `${Math.round(chat.messages / total * 100)}%` },
] }
function compareOptionalNumber(a?: number, b?: number): number { return (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY) }
function compareOptionalDate(a?: string, b?: string): number { return compareOptionalNumber(a ? Date.parse(a) : undefined, b ? Date.parse(b) : undefined) }
function readRoute(): Route { const [page, id] = location.hash.slice(2).split('/'); return page === 'conversations' ? id ? { page: 'conversation', id: decodeURIComponent(id) } : { page: 'conversations' } : page === 'about' ? { page: 'about' } : { page: 'overview' } }

type WorkerMessage =
    | { type: 'progress'; requestId: number; fileName: string; fileIndex: number; fileCount: number; bytesRead: number; bytesTotal: number; chats: number }
    | { type: 'complete'; requestId: number; local: UsageStatistics; utc: UsageStatistics; skipped: number; durationMs: number; startDate?: string }
    | { type: 'statistics'; requestId: number; local: UsageStatistics; utc: UsageStatistics; startDate?: string }
    | { type: 'conversation-detail'; requestId: number; id: string; summary: ConversationSummary; days: UsageDay[] }
    | { type: 'failure'; requestId: number; operation: 'import' | 'statistics' | 'conversation-detail'; message: string }
