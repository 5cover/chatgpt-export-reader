import { JSONParser } from '@streamparser/json'
import { isEmptyV1Record, normalizeV1Chat, UsageStatsAccumulator, type Chat, type ConversationSummary, type UsageDay, type UsageStatistics } from '@chatgpt-export-reader/core'

type ImportRequest = {
    type: 'import'
    requestId: number
    files: File[]
    localTimeZone: string
    startDate?: string
}

type StatisticsRequest = {
    type: 'statistics'
    requestId: number
    localTimeZone: string
    startDate?: string
}

type DetailRequest = {
    type: 'conversation-detail'
    requestId: number
    id: string
    timeZone: string
    startDate?: string
}

type Request = ImportRequest | StatisticsRequest | DetailRequest

type Progress = {
    type: 'progress'
    requestId: number
    fileName: string
    fileIndex: number
    fileCount: number
    bytesRead: number
    bytesTotal: number
    chats: number
    skipped: number
}

type Complete = {
    type: 'complete'
    requestId: number
    local: UsageStatistics
    utc: UsageStatistics
    chats: number
    skipped: number
    durationMs: number
    startDate?: string
}

type Statistics = {
    type: 'statistics'
    requestId: number
    local: UsageStatistics
    utc: UsageStatistics
    startDate?: string
}

type Detail = {
    type: 'conversation-detail'
    requestId: number
    id: string
    summary: ConversationSummary
    days: UsageDay[]
}

type Failure = {
    type: 'failure'
    requestId: number
    operation: Request['type']
    message: string
}

const worker = globalThis
const retainedChats: Chat[] = []
const retainedChatsById = new Map<string, Chat[]>()

worker.addEventListener('message', (event: MessageEvent<Request>) => {
    const request = event.data
    const operation = request.type === 'import'
        ? importFiles(request)
        : request.type === 'statistics'
            ? recalculateStatistics(request)
            : loadConversationDetail(request)
    void operation.catch(error => {
        worker.postMessage({
            type: 'failure',
            requestId: request.requestId,
            operation: request.type,
            message: error instanceof Error ? error.message : String(error),
        } satisfies Failure)
    })
})

async function importFiles(request: ImportRequest): Promise<void> {
    const files = request.files
        .filter(file => /^conversations(?:-[^/]+)?\.json$/i.test(file.name))
        .sort((a, b) => relativeName(a).localeCompare(relativeName(b)))
    if (files.length === 0) throw new Error('No conversations*.json files were found in the selected folder.')

    const local = new UsageStatsAccumulator({ timeZone: request.localTimeZone, startDate: request.startDate })
    const utc = new UsageStatsAccumulator({ timeZone: 'UTC', startDate: request.startDate })
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
                const chatsWithId = retainedChatsById.get(chat.id) ?? []
                chatsWithId.push(chat)
                retainedChatsById.set(chat.id, chatsWithId)
                local.addChat(chat)
                utc.addChat(chat)
                chats++
            } catch {
                skipped++
            }
        }

        let bytesRead = 0
        try {
            const reader = file.stream().getReader()
            while (true) {
                const chunk = await reader.read()
                if (chunk.done) break
                parser.write(chunk.value)
                bytesRead += chunk.value.byteLength
                const now = performance.now()
                if (now - lastProgressAt >= 250) {
                    lastProgressAt = now
                    worker.postMessage({
                        type: 'progress',
                        requestId: request.requestId,
                        fileName: relativeName(file),
                        fileIndex: fileIndex + 1,
                        fileCount: files.length,
                        bytesRead,
                        bytesTotal: file.size,
                        chats,
                        skipped,
                    } satisfies Progress)
                }
            }

            // The parser closes itself after a complete top-level array. Calling end twice reports a false malformed-export error.
            if (!parser.isEnded) parser.end()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(
                `Failed to parse ${relativeName(file)} after ${formatBytes(bytesRead)} of ${formatBytes(file.size)}: ${message}`,
            )
        }
    }

    worker.postMessage({
        type: 'complete',
        requestId: request.requestId,
        local: local.finish(),
        utc: utc.finish(),
        chats,
        skipped,
        durationMs: Math.round(performance.now() - startedAt),
        startDate: request.startDate,
    } satisfies Complete)
}

async function recalculateStatistics(request: StatisticsRequest): Promise<void> {
    const { local, utc } = statisticsFor(request.localTimeZone, request.startDate)
    worker.postMessage({
        type: 'statistics',
        requestId: request.requestId,
        local,
        utc,
        startDate: request.startDate,
    } satisfies Statistics)
}

async function loadConversationDetail(request: DetailRequest): Promise<void> {
    const chats = retainedChatsById.get(request.id)
    if (chats === undefined) throw new Error(`Conversation no longer exists in this browser session: ${request.id}`)

    const accumulator = new UsageStatsAccumulator({ timeZone: request.timeZone, startDate: request.startDate })
    for (const chat of chats) accumulator.addChat(chat)
    const statistics = accumulator.finish()
    const summary = statistics.conversations.find(chat => chat.id === request.id)
    if (summary === undefined) throw new Error(`Conversation has no messages in the selected date range: ${request.id}`)
    worker.postMessage({
        type: 'conversation-detail',
        requestId: request.requestId,
        id: request.id,
        summary,
        days: statistics.days,
    } satisfies Detail)
}

function statisticsFor(localTimeZone: string, startDate?: string): { local: UsageStatistics; utc: UsageStatistics } {
    const local = new UsageStatsAccumulator({ timeZone: localTimeZone, startDate })
    const utc = new UsageStatsAccumulator({ timeZone: 'UTC', startDate })
    for (const chat of retainedChats) {
        local.addChat(chat)
        utc.addChat(chat)
    }
    return { local: local.finish(), utc: utc.finish() }
}

function relativeName(file: File): string {
    return file.webkitRelativePath || file.name
}

function formatBytes(bytes: number): string {
    return new Intl.NumberFormat('en', { style: 'unit', unit: 'byte', unitDisplay: 'short' }).format(bytes)
}
