import { JSONParser } from '@streamparser/json'
import { isEmptyV1Record, normalizeV1Chat, UsageStatsAccumulator, type ConversationSummary, type UsageDay, type UsageStatistics } from '@chatgpt-export-reader/core'

type ImportRequest = {
    type: 'import'
    files: File[]
    localTimeZone: string
}

type DetailRequest = { type: 'conversation-detail'; id: string; timeZone: string }

type Progress = {
    type: 'progress'
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
    local: UsageStatistics
    utc: UsageStatistics
    chats: number
    skipped: number
    durationMs: number
}

type Detail = { type: 'conversation-detail'; id: string; summary: ConversationSummary; days: UsageDay[] }

type Failure = {
    type: 'failure'
    message: string
}

const worker = globalThis
const retainedChats = new Map<string, ReturnType<typeof normalizeV1Chat>>()

worker.addEventListener('message', (event: MessageEvent<ImportRequest | DetailRequest>) => {
    const request = event.data
    const operation = request.type === 'import' ? importFiles(request) : loadConversationDetail(request)
    void operation.catch(error => {
        worker.postMessage({
            type: 'failure',
            message: error instanceof Error ? error.message : String(error),
        } satisfies Failure)
    })
})

async function importFiles(request: ImportRequest): Promise<void> {
    if (request.type !== 'import') return

    const files = request.files
        .filter(file => /^conversations(?:-[^/]+)?\.json$/i.test(file.name))
        .sort((a, b) => relativeName(a).localeCompare(relativeName(b)))
    if (files.length === 0) throw new Error('No conversations*.json files were found in the selected folder.')

    const local = new UsageStatsAccumulator(request.localTimeZone)
    const utc = new UsageStatsAccumulator('UTC')
    let chats = 0
    let skipped = 0
    let lastProgressAt = 0
    const startedAt = performance.now()
    retainedChats.clear()

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]!
        const parser = new JSONParser({ paths: ['$.*'], keepStack: false })
        parser.onValue = ({ value }) => {
            if (isEmptyV1Record(value)) return
            try {
                const chat = normalizeV1Chat(value)
                retainedChats.set(chat.id, chat)
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
        local: local.finish(),
        utc: utc.finish(),
        chats,
        skipped,
        durationMs: Math.round(performance.now() - startedAt),
    } satisfies Complete)
}

async function loadConversationDetail(request: DetailRequest): Promise<void> {
    const chat = retainedChats.get(request.id)
    if (chat === undefined) throw new Error(`Conversation no longer exists in this browser session: ${request.id}`)

    const accumulator = new UsageStatsAccumulator(request.timeZone)
    accumulator.addChat(chat)
    const statistics = accumulator.finish()
    const summary = statistics.conversations[0]
    if (summary === undefined) throw new Error(`Conversation statistics are unavailable: ${request.id}`)
    worker.postMessage({
        type: 'conversation-detail',
        id: request.id,
        summary,
        days: statistics.days,
    } satisfies Detail)
}

function relativeName(file: File): string {
    return file.webkitRelativePath || file.name
}

function formatBytes(bytes: number): string {
    return new Intl.NumberFormat('en', { style: 'unit', unit: 'byte', unitDisplay: 'short' }).format(bytes)
}
