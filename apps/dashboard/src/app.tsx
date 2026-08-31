import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ConversationSummary, UsageDay, UsageStatistics } from '@chatgpt-export-reader/core'
import { DailyChart } from './daily-chart.js'
import { SortableTable, type SortableColumn } from './sortable-table.js'

type ImportState =
    | { kind: 'idle' }
    | { kind: 'loading'; detail: string }
    | { kind: 'ready'; local: UsageStatistics; utc: UsageStatistics; skipped: number; durationMs: number }
    | { kind: 'error'; message: string }
type TimeZoneMode = 'local' | 'utc'
type Route = { page: 'overview' } | { page: 'conversations' } | { page: 'conversation'; id: string }
type Detail = { summary: ConversationSummary; days: UsageDay[] }

export function App() {
    const input = useRef<HTMLInputElement>(null)
    const worker = useRef<Worker>()
    const [state, setState] = useState<ImportState>({ kind: 'idle' })
    const [zone, setZone] = useState<TimeZoneMode>('local')
    const [route, setRoute] = useState<Route>(readRoute)
    const [detail, setDetail] = useState<Detail | undefined>()
    const [selectedDate, setSelectedDate] = useState<string>()

    useEffect(() => {
        input.current?.setAttribute('webkitdirectory', '')
        const nextWorker = new Worker(new URL('./stats-worker.ts', import.meta.url), { type: 'module' })
        worker.current = nextWorker
        nextWorker.addEventListener('message', event => receiveWorkerMessage(event.data as WorkerMessage))
        const onHashChange = () => setRoute(readRoute())
        addEventListener('hashchange', onHashChange)
        return () => { nextWorker.terminate(); removeEventListener('hashchange', onHashChange) }
    }, [])

    const stats = state.kind === 'ready' ? (zone === 'local' ? state.local : state.utc) : undefined
    const importing = state.kind === 'loading'
    const selectedDay = stats?.days.find(day => day.date === selectedDate)

    useEffect(() => {
        if (route.page !== 'conversation' || !stats) return
        setDetail(undefined)
        worker.current?.postMessage({ type: 'conversation-detail', id: route.id, timeZone: zone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC' })
    }, [route, zone, stats])

    function receiveWorkerMessage(message: WorkerMessage) {
        if (message.type === 'progress') {
            const percent = message.bytesTotal === 0 ? 0 : Math.round((message.bytesRead / message.bytesTotal) * 100)
            setState({ kind: 'loading', detail: `${message.fileName} (${message.fileIndex}/${message.fileCount}, ${percent}%) - ${message.chats} chats` })
        } else if (message.type === 'complete') {
            setState({ kind: 'ready', local: message.local, utc: message.utc, skipped: message.skipped, durationMs: message.durationMs })
            setSelectedDate(busiestDay(message.local.days)?.date)
        } else if (message.type === 'conversation-detail') {
            setDetail({ summary: message.summary, days: message.days })
        } else setState({ kind: 'error', message: message.message })
    }

    function selectFolder(event: Event) {
        const picker = event.currentTarget as HTMLInputElement
        const files = [...picker.files ?? []]
        picker.value = ''
        if (files.length === 0) return
        setDetail(undefined)
        setState({ kind: 'loading', detail: 'Preparing local import...' })
        worker.current?.postMessage({ type: 'import', files, localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    }

    return <main>
        <header class="masthead">
            <div><p class="eyebrow">Private local analytics</p><h1>ChatGPT Usage Atlas</h1><p class="subtitle">Find the conversations behind your busiest days.</p></div>
            <button class="import-button" type="button" disabled={importing} onClick={() => input.current?.click()}>{importing ? 'Importing...' : 'Choose export folder'}</button>
            <input class="import-input" ref={input} type="file" multiple onChange={selectFolder} />
        </header>
        {state.kind === 'idle' && <Welcome />}
        {state.kind === 'loading' && <section class="status-card"><p class="eyebrow">Importing locally</p><strong>{state.detail}</strong><p>Files never leave this browser.</p></section>}
        {state.kind === 'error' && <section class="status-card error"><p class="eyebrow">Import failed</p><strong>{state.message}</strong></section>}
        {stats && <>
            <Nav route={route} />
            <div class="toolbar" role="group" aria-label="Calendar timezone"><span>Calendar timezone</span><button class={zone === 'local' ? 'active' : ''} onClick={() => setZone('local')}>Local</button><button class={zone === 'utc' ? 'active' : ''} onClick={() => setZone('utc')}>UTC</button>{state.kind === 'ready' && <small>Imported in {(state.durationMs / 1000).toFixed(1)}s{state.skipped ? `; ${state.skipped} invalid chats skipped` : ''}</small>}</div>
            {route.page === 'overview' && <Overview stats={stats} selectedDay={selectedDay} selectedDate={selectedDate} onSelectDate={setSelectedDate} />}
            {route.page === 'conversations' && <ConversationList conversations={stats.conversations} />}
            {route.page === 'conversation' && <ConversationDetail detail={detail} />}
        </>}
    </main>
}

function Welcome() { return <section class="welcome-card"><p class="eyebrow">How it works</p><h2>Select the folder extracted from your ChatGPT data export.</h2><p>The dashboard keeps normalized chats in a local Worker for this browser session. Message bodies never leave your computer and are not shown in this statistics view.</p></section> }
function Nav({ route }: { route: Route }) { return <nav class="nav"><a class={route.page === 'overview' ? 'active' : ''} href="#/">Overview</a><a class={route.page === 'conversations' || route.page === 'conversation' ? 'active' : ''} href="#/conversations">Conversations</a></nav> }

function Overview({ stats, selectedDay, selectedDate, onSelectDate }: { stats: UsageStatistics; selectedDay?: UsageDay; selectedDate?: string; onSelectDate: (date: string) => void }) {
    return <><section class="summary-grid"><Metric label="Chats" value={stats.summary.chats} /><Metric label="Messages" value={stats.summary.messages} /><Metric label="User prompts" value={stats.summary.prompts} /><Metric label="Active days" value={stats.summary.activeDays} /></section><DailyChart days={stats.days} selectedDate={selectedDate} onSelectDate={onSelectDate} />{selectedDay && <section class="breakdown-card"><div class="chart-heading"><div><p class="eyebrow">Spike attribution</p><h2>{selectedDay.date}: {selectedDay.messages.toLocaleString()} messages</h2></div><span class="selected-date">{selectedDay.activeChats} active chats</span></div><SortableTable rows={selectedDay.conversations} columns={dayColumns(selectedDay.messages)} initialSort={{ column: 'messages', direction: 'descending' }} rowKey={chat => chat.id} /></section>}</>
}

function ConversationList({ conversations }: { conversations: readonly ConversationSummary[] }) {
    const [query, setQuery] = useState('')
    const visible = useMemo(() => conversations.filter(chat => `${chat.title} ${chat.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [conversations, query])
    return <section class="breakdown-card"><div class="chart-heading"><div><p class="eyebrow">All conversations</p><h2>{conversations.length.toLocaleString()} chats</h2></div><input class="search" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="Search title or ID" /></div><SortableTable rows={visible} columns={conversationColumns} initialSort={{ column: 'messages', direction: 'descending' }} rowKey={chat => chat.id} /></section>
}

function ConversationDetail({ detail }: { detail?: Detail }) {
    if (!detail) return <section class="status-card"><p class="eyebrow">Loading conversation</p><strong>Calculating its timeline and daily activity locally...</strong></section>
    const { summary, days } = detail
    return <><section class="detail-card"><p class="eyebrow">Conversation detail</p><h2>{summary.title || 'Untitled chat'}</h2><code>{summary.id}</code><section class="summary-grid"><Metric label="Messages" value={summary.messages} /><Metric label="Active days" value={summary.activeDays} /><Metric label="Lifetime" value={formatDuration(summary.lifetimeMs)} /><Metric label="Roles" value={summary.roles.length} /></section><p>{formatDate(summary.firstMessageAt)} to {formatDate(summary.lastMessageAt)}</p></section><DailyChart days={days} title="Activity across this chat's lifetime" note="Bars show all messages and user prompts across this conversation's active lifetime." onSelectDate={() => {}} /></>
}

function Metric({ label, value }: { label: string; value: number | string }) { return <div class="metric"><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong></div> }
function busiestDay(days: readonly UsageDay[]): UsageDay | undefined { return days.reduce<UsageDay | undefined>((best, day) => !best || day.messages > best.messages ? day : best, undefined) }
function formatDate(value?: string): string { return value ? new Date(value).toLocaleString() : 'No timestamp' }
function formatDuration(value?: number): string { if (value === undefined) return 'No duration'; const hours = Math.floor(value / 3_600_000); const days = Math.floor(hours / 24); return days ? `${days}d ${hours % 24}h` : `${hours}h ${Math.floor(value / 60_000) % 60}m` }
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
function readRoute(): Route { const [page, id] = location.hash.slice(2).split('/'); return page === 'conversations' ? id ? { page: 'conversation', id: decodeURIComponent(id) } : { page: 'conversations' } : { page: 'overview' } }

type WorkerMessage =
    | { type: 'progress'; fileName: string; fileIndex: number; fileCount: number; bytesRead: number; bytesTotal: number; chats: number }
    | { type: 'complete'; local: UsageStatistics; utc: UsageStatistics; skipped: number; durationMs: number }
    | { type: 'conversation-detail'; id: string; summary: ConversationSummary; days: UsageDay[] }
    | { type: 'failure'; message: string }
