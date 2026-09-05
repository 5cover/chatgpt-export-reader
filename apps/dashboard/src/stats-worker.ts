import { JSONParser } from '@streamparser/json'
import {
    collectAnalytics,
    collectConversationDetail,
    findConversationTurns,
    getMessageContents,
    isEmptyV1Record,
    normalizeV1Chat,
    type AnalyticsStatistics,
    type Chat,
    type ConversationDetail,
    type MessageContent,
    type TurnPage,
} from '@chatgpt-export-reader/core'

type SharedOptions = { localTimeZone: string; startDate?: string; sessionGapMinutes: number }
type ImportRequest = { type: 'import'; requestId: number; files: File[] } & SharedOptions
type StatisticsRequest = { type: 'statistics'; requestId: number } & SharedOptions
type DetailRequest = { type: 'conversation-detail'; requestId: number; id: string; timeZone: string; startDate?: string; sessionGapMinutes: number }
type OutlineRequest = { type: 'conversation-outline'; requestId: number; id: string; timeZone: string; startDate?: string; sessionGapMinutes: number; offset: number; limit: number; query?: string }
type ContentRequest = { type: 'message-content'; requestId: number; id: string; timeZone: string; startDate?: string; sessionGapMinutes: number; ids: string[] }
type Request = ImportRequest | StatisticsRequest | DetailRequest | OutlineRequest | ContentRequest

type Progress = { type: 'progress'; requestId: number; fileName: string; fileIndex: number; fileCount: number; bytesRead: number; bytesTotal: number; chats: number; skipped: number }
type Complete = { type: 'complete'; requestId: number; local: AnalyticsStatistics; utc: AnalyticsStatistics; chats: number; skipped: number; durationMs: number; startDate?: string; sessionGapMinutes: number }
type Statistics = { type: 'statistics'; requestId: number; local: AnalyticsStatistics; utc: AnalyticsStatistics; startDate?: string; sessionGapMinutes: number }
type Detail = { type: 'conversation-detail'; requestId: number; id: string; detail?: ConversationDetail }
type Outline = { type: 'conversation-outline'; requestId: number; id: string; page: TurnPage }
type Content = { type: 'message-content'; requestId: number; id: string; contents: MessageContent[] }
type Failure = { type: 'failure'; requestId: number; operation: Request['type']; message: string }

const worker = globalThis
const retainedChats: Chat[] = []
const retainedChatsById = new Map<string, Chat[]>()

worker.addEventListener('message', (event: MessageEvent<Request>) => {
    const request = event.data
    const operation = request.type === 'import' ? importFiles(request)
        : request.type === 'statistics' ? recalculateStatistics(request)
            : request.type === 'conversation-detail' ? loadConversationDetail(request)
                : request.type === 'conversation-outline' ? loadConversationOutline(request)
                    : loadMessageContents(request)
    void operation.catch(error => worker.postMessage({
        type: 'failure', requestId: request.requestId, operation: request.type,
        message: error instanceof Error ? error.message : String(error),
    } satisfies Failure))
})

async function importFiles(request: ImportRequest): Promise<void> {
    const files = request.files.filter(file => /^conversations(?:-[^/]+)?\.json$/i.test(file.name)).sort((a, b) => relativeName(a).localeCompare(relativeName(b)))
    if (files.length === 0) throw new Error('No conversations*.json files were found in the selected folder.')
    let chats = 0
    let skipped = 0
    let lastProgressAt = 0
    const startedAt = performance.now()
    retainedChats.length = 0
    retainedChatsById.clear()

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]!
        const parser = new JSONParser({ paths: ['$.*'], keepStack: false })
        parser.onValue = ({ value }) => {
            if (isEmptyV1Record(value)) return
            try {
                const chat = normalizeV1Chat(value)
                retainedChats.push(chat)
                const records = retainedChatsById.get(chat.id) ?? []
                records.push(chat)
                retainedChatsById.set(chat.id, records)
                chats++
            } catch { skipped++ }
        }
        let bytesRead = 0
        try {
            const reader = file.stream().getReader()
            while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                parser.write(chunk.value)
                bytesRead += chunk.value.byteLength
                if (performance.now() - lastProgressAt >= 250) {
                    lastProgressAt = performance.now()
                    worker.postMessage({ type: 'progress', requestId: request.requestId, fileName: relativeName(file), fileIndex: fileIndex + 1, fileCount: files.length, bytesRead, bytesTotal: file.size, chats, skipped } satisfies Progress)
                }
            }
            if (!parser.isEnded) parser.end()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`Failed to parse ${relativeName(file)} after ${formatBytes(bytesRead)} of ${formatBytes(file.size)}: ${message}`)
        }
    }

    const statistics = statisticsFor(request)
    worker.postMessage({ type: 'complete', requestId: request.requestId, ...statistics, chats, skipped, durationMs: Math.round(performance.now() - startedAt), startDate: request.startDate, sessionGapMinutes: request.sessionGapMinutes } satisfies Complete)
}

async function recalculateStatistics(request: StatisticsRequest): Promise<void> {
    worker.postMessage({ type: 'statistics', requestId: request.requestId, ...statisticsFor(request), startDate: request.startDate, sessionGapMinutes: request.sessionGapMinutes } satisfies Statistics)
}

async function loadConversationDetail(request: DetailRequest): Promise<void> {
    const chats = chatsFor(request.id)
    const detail = collectConversationDetail(chats, analyticsOptions(request.timeZone, request.startDate, request.sessionGapMinutes))
    worker.postMessage({ type: 'conversation-detail', requestId: request.requestId, id: request.id, detail } satisfies Detail)
}

async function loadConversationOutline(request: OutlineRequest): Promise<void> {
    const page = findConversationTurns(chatsFor(request.id), analyticsOptions(request.timeZone, request.startDate, request.sessionGapMinutes), request.offset, request.limit, request.query)
    worker.postMessage({ type: 'conversation-outline', requestId: request.requestId, id: request.id, page } satisfies Outline)
}

async function loadMessageContents(request: ContentRequest): Promise<void> {
    const contents = getMessageContents(chatsFor(request.id), analyticsOptions(request.timeZone, request.startDate, request.sessionGapMinutes), request.ids)
    worker.postMessage({ type: 'message-content', requestId: request.requestId, id: request.id, contents } satisfies Content)
}

function statisticsFor(request: SharedOptions): { local: AnalyticsStatistics; utc: AnalyticsStatistics } {
    return {
        local: collectAnalytics(retainedChats, analyticsOptions(request.localTimeZone, request.startDate, request.sessionGapMinutes)),
        utc: collectAnalytics(retainedChats, analyticsOptions('UTC', request.startDate, request.sessionGapMinutes)),
    }
}
function analyticsOptions(timeZone: string, startDate: string | undefined, sessionGapMinutes: number) { return { timeZone, startDate, sessionGapMinutes } }
function chatsFor(id: string): Chat[] { const chats = retainedChatsById.get(id); if (chats === undefined) throw new Error(`Conversation no longer exists in this browser session: ${id}`); return chats }
function relativeName(file: File): string { return file.webkitRelativePath || file.name }
function formatBytes(bytes: number): string { return new Intl.NumberFormat('en', { style: 'unit', unit: 'byte', unitDisplay: 'short' }).format(bytes) }
