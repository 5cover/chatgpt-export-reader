import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { UsageDay, UsageStatistics } from '@chatgpt-export-reader/core'
import { DailyChart } from './daily-chart.js'

type ImportState =
    | { kind: 'idle' }
    | { kind: 'loading'; detail: string }
    | { kind: 'ready'; local: UsageStatistics; utc: UsageStatistics; skipped: number }
    | { kind: 'error'; message: string }

type TimeZoneMode = 'local' | 'utc'

export function App() {
    const input = useRef<HTMLInputElement>(null)
    const worker = useRef<Worker | undefined>(undefined)
    const [state, setState] = useState<ImportState>({ kind: 'idle' })
    const [timeZoneMode, setTimeZoneMode] = useState<TimeZoneMode>('local')
    const [selectedDate, setSelectedDate] = useState<string | undefined>()

    useEffect(() => {
        input.current?.setAttribute('webkitdirectory', '')
        const nextWorker = new Worker(new URL('./stats-worker.ts', import.meta.url), { type: 'module' })
        worker.current = nextWorker
        nextWorker.addEventListener('message', event => {
            const message = event.data as WorkerMessage
            if (message.type === 'progress') {
                const percent = message.bytesTotal === 0 ? 0 : Math.round((message.bytesRead / message.bytesTotal) * 100)
                setState({ kind: 'loading', detail: `${message.fileName} (${message.fileIndex}/${message.fileCount}, ${percent}%) - ${message.chats} chats` })
                return
            }
            if (message.type === 'complete') {
                const stats = timeZoneMode === 'local' ? message.local : message.utc
                setSelectedDate(busiestDay(stats.days)?.date)
                setState({ kind: 'ready', local: message.local, utc: message.utc, skipped: message.skipped })
                return
            }
            if (message.type === 'failure') setState({ kind: 'error', message: message.message })
        })
        return () => nextWorker.terminate()
    }, [])

    const stats = state.kind === 'ready' ? (timeZoneMode === 'local' ? state.local : state.utc) : undefined
    const skipped = state.kind === 'ready' ? state.skipped : 0
    const selectedDay = useMemo(() => stats?.days.find(day => day.date === selectedDate), [stats, selectedDate])

    function selectFolder(event: Event) {
        const files = [...(event.currentTarget as HTMLInputElement).files ?? []]
        if (files.length === 0) return
        setState({ kind: 'loading', detail: 'Preparing local import...' })
        worker.current?.postMessage({
            type: 'import',
            files,
            localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
    }

    function setZone(mode: TimeZoneMode) {
        setTimeZoneMode(mode)
        if (state.kind === 'ready') {
            const next = mode === 'local' ? state.local : state.utc
            setSelectedDate(current => next.days.some(day => day.date === current) ? current : busiestDay(next.days)?.date)
        }
    }

    return (
        <main>
            <header class="masthead">
                <div>
                    <p class="eyebrow">Private local analytics</p>
                    <h1>ChatGPT Usage Atlas</h1>
                    <p class="subtitle">Find the conversations behind your busiest days.</p>
                </div>
                <label class="import-button">
                    <input ref={input} type="file" multiple onChange={selectFolder} />
                    Choose export folder
                </label>
            </header>

            {state.kind === 'idle' && <Welcome />}
            {state.kind === 'loading' && <section class="status-card"><p class="eyebrow">Importing locally</p><strong>{state.detail}</strong><p>Files never leave this browser.</p></section>}
            {state.kind === 'error' && <section class="status-card error"><p class="eyebrow">Import failed</p><strong>{state.message}</strong></section>}
            {stats && <Dashboard stats={stats} selectedDay={selectedDay} selectedDate={selectedDate} setZone={setZone} timeZoneMode={timeZoneMode} onSelectDate={setSelectedDate} skipped={skipped} />}
        </main>
    )
}

function Welcome() {
    return <section class="welcome-card">
        <p class="eyebrow">How it works</p>
        <h2>Select the folder extracted from your ChatGPT data export.</h2>
        <p>The dashboard reads every <code>conversations*.json</code> file in your browser, then discards message text and keeps only anonymous usage counts, timestamps, and conversation titles needed for drill-down.</p>
    </section>
}

type DashboardProps = {
    stats: UsageStatistics
    selectedDay?: UsageDay
    selectedDate?: string
    timeZoneMode: TimeZoneMode
    setZone: (mode: TimeZoneMode) => void
    onSelectDate: (date: string) => void
    skipped: number
}

function Dashboard({ stats, selectedDay, selectedDate, timeZoneMode, setZone, onSelectDate, skipped }: DashboardProps) {
    return <>
        <section class="summary-grid">
            <Metric label="Chats" value={stats.summary.chats} />
            <Metric label="Messages" value={stats.summary.messages} />
            <Metric label="User prompts" value={stats.summary.prompts} />
            <Metric label="Active days" value={stats.summary.activeDays} />
        </section>
        <div class="toolbar" role="group" aria-label="Calendar timezone">
            <span>Calendar timezone</span>
            <button class={timeZoneMode === 'local' ? 'active' : ''} onClick={() => setZone('local')}>Local</button>
            <button class={timeZoneMode === 'utc' ? 'active' : ''} onClick={() => setZone('utc')}>UTC</button>
            {skipped > 0 && <small>{skipped} invalid chats skipped</small>}
        </div>
        <DailyChart days={stats.days} selectedDate={selectedDate} onSelectDate={onSelectDate} />
        {selectedDay && <ConversationBreakdown day={selectedDay} />}
    </>
}

function Metric({ label, value }: { label: string; value: number }) {
    return <div class="metric"><span>{label}</span><strong>{value.toLocaleString()}</strong></div>
}

function ConversationBreakdown({ day }: { day: UsageDay }) {
    return <section class="breakdown-card">
        <div class="chart-heading">
            <div><p class="eyebrow">Spike attribution</p><h2>{day.date}: {day.messages.toLocaleString()} messages</h2></div>
            <span class="selected-date">{day.activeChats} active chats</span>
        </div>
        <div class="table-wrap"><table>
            <thead><tr><th>Conversation</th><th>Messages</th><th>Prompts</th><th>Assistant</th><th>Share</th></tr></thead>
            <tbody>{day.conversations.map(conversation => <tr key={conversation.id}>
                <td><strong>{conversation.title || 'Untitled chat'}</strong><code>{conversation.id}</code></td>
                <td>{conversation.messages.toLocaleString()}</td>
                <td>{conversation.prompts.toLocaleString()}</td>
                <td>{conversation.assistantMessages.toLocaleString()}</td>
                <td>{Math.round((conversation.messages / day.messages) * 100)}%</td>
            </tr>)}</tbody>
        </table></div>
    </section>
}

function busiestDay(days: readonly UsageDay[]): UsageDay | undefined {
    return days.reduce<UsageDay | undefined>((best, day) => !best || day.messages > best.messages ? day : best, undefined)
}

type WorkerMessage =
    | { type: 'progress'; fileName: string; fileIndex: number; fileCount: number; bytesRead: number; bytesTotal: number; chats: number }
    | { type: 'complete'; local: UsageStatistics; utc: UsageStatistics; skipped: number }
    | { type: 'failure'; message: string }
