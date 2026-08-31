import { JSONParser } from '@streamparser/json'
import { isEmptyV1Record, normalizeV1Chat, UsageStatsAccumulator, type UsageStatistics } from '@chatgpt-export-reader/core'

type ImportRequest = {
    type: 'import'
    files: File[]
    localTimeZone: string
}

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
}

type Failure = {
    type: 'failure'
    message: string
}

const worker = globalThis

worker.addEventListener('message', (event: MessageEvent<ImportRequest>) => {
    void importFiles(event.data).catch(error => {
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

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]!
        const parser = new JSONParser({ paths: ['$.*'], keepStack: false })
        parser.onValue = ({ value }) => {
            if (isEmptyV1Record(value)) return
            try {
                const chat = normalizeV1Chat(value)
                local.addChat(chat)
                utc.addChat(chat)
                chats++
            } catch {
                skipped++
            }
        }

        const reader = file.stream().getReader()
        let bytesRead = 0
        while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            parser.write(chunk.value)
            bytesRead += chunk.value.byteLength
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
        parser.end()
    }

    worker.postMessage({
        type: 'complete',
        local: local.finish(),
        utc: utc.finish(),
        chats,
        skipped,
    } satisfies Complete)
}

function relativeName(file: File): string {
    return file.webkitRelativePath || file.name
}
