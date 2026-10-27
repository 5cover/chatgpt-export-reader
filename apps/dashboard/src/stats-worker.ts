import { JSONParser } from '@streamparser/json'
import { Unzip, UnzipInflate } from 'fflate'
import {
  buildRecap,
  collectAnalytics,
  collectConversationDetail,
  collectRepeatedPhrases,
  collectTemporalMessageSlice,
  findConversationTurns,
  getMessageContents,
  isEmptyV1Record,
  normalizeV1Chat,
  type AnalyticsStatistics,
  type Chat,
  type ConversationDetail,
  type MessageContent,
  type RepeatedPhraseAnalysis,
  type RecapContextFormat,
  type RecapContextStrategy,
  type TemporalConversation,
  type TemporalMessageEvidence,
  type TemporalMessageFilter,
  type TemporalMessageSlice,
  type TurnPage,
  createRecapPrompt,
  serializeRecapToon,
  serializeRecapYaml,
} from '@chatgpt-export-reader/core'

type SharedOptions = { localTimeZone: string; startDate?: string; sessionGapMinutes: number }
type ImportSource = { kind: 'folder'; files: File[] } | { kind: 'zip'; archive: File }
type ImportRequest = { type: 'import'; requestId: number; source: ImportSource } & SharedOptions
type StatisticsRequest = { type: 'statistics'; requestId: number } & SharedOptions
type DetailRequest = {
  type: 'conversation-detail'
  requestId: number
  id: string
  timeZone: string
  startDate?: string
  sessionGapMinutes: number
}
type OutlineRequest = {
  type: 'conversation-outline'
  requestId: number
  id: string
  timeZone: string
  startDate?: string
  sessionGapMinutes: number
  offset: number
  limit: number
  query?: string
}
type ContentRequest = {
  type: 'message-content'
  requestId: number
  id: string
  timeZone: string
  startDate?: string
  sessionGapMinutes: number
  ids: string[]
}
type ConversationRepetitionsRequest = {
  type: 'conversation-repetitions'
  requestId: number
  id: string
  timeZone: string
  startDate?: string
}
type TemporalSliceRequest = {
  type: 'temporal-slice'
  requestId: number
  timeZone: string
  startDate?: string
  filter: TemporalMessageFilter
  conversationId?: string
  order: 'newest' | 'oldest'
  offset: number
  limit: number
}
type TemporalContentRequest = {
  type: 'temporal-content'
  requestId: number
  cacheKey: string
  ids: string[]
}
type RecapRequest = {
  type: 'recap'
  requestId: number
  timeZone: string
  startDate?: string
  endDate?: string
  sessionGapMinutes: number
  contextStrategy: RecapContextStrategy
  contextMessages: number
  contextFormat: RecapContextFormat
}
type Request =
  | ImportRequest
  | StatisticsRequest
  | DetailRequest
  | OutlineRequest
  | ContentRequest
  | ConversationRepetitionsRequest
  | TemporalSliceRequest
  | TemporalContentRequest
  | RecapRequest

type Progress = {
  type: 'progress'
  requestId: number
  fileName: string
  fileIndex: number
  fileCount?: number
  bytesRead: number
  bytesTotal?: number
  chats: number
  skipped: number
  archiveName?: string
}
type Complete = {
  type: 'complete'
  requestId: number
  local: AnalyticsStatistics
  utc: AnalyticsStatistics
  chats: number
  skipped: number
  durationMs: number
  startDate?: string
  sessionGapMinutes: number
}
type Statistics = {
  type: 'statistics'
  requestId: number
  local: AnalyticsStatistics
  utc: AnalyticsStatistics
  startDate?: string
  sessionGapMinutes: number
}
type Detail = { type: 'conversation-detail'; requestId: number; id: string; detail?: ConversationDetail }
type Outline = { type: 'conversation-outline'; requestId: number; id: string; page: TurnPage }
type Content = { type: 'message-content'; requestId: number; id: string; contents: MessageContent[] }
type ConversationRepetitions = {
  type: 'conversation-repetitions'
  requestId: number
  id: string
  analysis: RepeatedPhraseAnalysis
}
type TemporalMessagePreview = Omit<TemporalMessageEvidence, 'body'>
type TemporalSlicePage = {
  type: 'temporal-slice'
  requestId: number
  cacheKey: string
  filter: TemporalMessageFilter
  summary: TemporalMessageSlice['summary']
  conversations: TemporalConversation[]
  offset: number
  total: number
  messages: TemporalMessagePreview[]
}
type TemporalContent = {
  type: 'temporal-content'
  requestId: number
  contents: MessageContent[]
}
type Recap = {
  type: 'recap'
  requestId: number
  context: Blob
  contextFormat: RecapContextFormat
  prompt: string
}
type Failure = { type: 'failure'; requestId: number; operation: Request['type']; message: string }

const worker = globalThis
const retainedChats: Chat[] = []
const retainedChatsById = new Map<string, Chat[]>()
const repeatedPhraseCache = new Map<string, RepeatedPhraseAnalysis>()
let temporalCache: { key: string; slice: TemporalMessageSlice } | undefined
const MAX_ARCHIVE_EXTRACTED_BYTES = 1_000_000_000

worker.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data
  const operation =
    request.type === 'import'
      ? importExport(request)
      : request.type === 'statistics'
        ? recalculateStatistics(request)
        : request.type === 'conversation-detail'
          ? loadConversationDetail(request)
          : request.type === 'conversation-outline'
            ? loadConversationOutline(request)
            : request.type === 'message-content'
              ? loadMessageContents(request)
              : request.type === 'conversation-repetitions'
                ? loadConversationRepeatedPhrases(request)
                : request.type === 'temporal-slice'
                  ? loadTemporalSlice(request)
                  : request.type === 'temporal-content'
                    ? loadTemporalContent(request)
                    : generateRecap(request)
  void operation.catch(error =>
    worker.postMessage({
      type: 'failure',
      requestId: request.requestId,
      operation: request.type,
      message: error instanceof Error ? error.message : String(error),
    } satisfies Failure)
  )
})

async function importExport(request: ImportRequest): Promise<void> {
  const state = { chats: 0, skipped: 0, lastProgressAt: 0 }
  const startedAt = performance.now()
  retainedChats.length = 0
  retainedChatsById.clear()
  repeatedPhraseCache.clear()
  temporalCache = undefined

  if (request.source.kind === 'folder') await importFolder(request, request.source.files, state)
  else await importZip(request, request.source.archive, state)

  const statistics = statisticsFor(request)
  worker.postMessage({
    type: 'complete',
    requestId: request.requestId,
    ...statistics,
    chats: state.chats,
    skipped: state.skipped,
    durationMs: Math.round(performance.now() - startedAt),
    startDate: request.startDate,
    sessionGapMinutes: request.sessionGapMinutes,
  } satisfies Complete)
}

async function importFolder(request: ImportRequest, folderFiles: File[], state: ImportState): Promise<void> {
  const files = folderFiles
    .filter(file => isConversationFile(file.name))
    .sort((a, b) => relativeName(a).localeCompare(relativeName(b)))
  if (files.length === 0) throw new Error('No conversations*.json files were found in the selected folder.')

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]!
    const parser = createConversationParser(relativeName(file), file.size, request, state, {
      fileIndex: fileIndex + 1,
      fileCount: files.length,
    })
    try {
      const reader = file.stream().getReader()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        parser.write(chunk.value)
      }
      parser.end()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to parse ${relativeName(file)} after ${formatBytes(parser.bytesRead)} of ${formatBytes(file.size)}: ${message}`
      )
    }
  }
}

async function importZip(request: ImportRequest, archive: File, state: ImportState): Promise<void> {
  let entries = 0
  let extractedBytes = 0
  let failure: Error | undefined
  const unzipper = new Unzip(file => {
    if (!isConversationFile(file.name)) return
    entries++
    if (file.originalSize !== undefined && file.originalSize > MAX_ARCHIVE_EXTRACTED_BYTES) {
      failure = new Error(
        `Archive entry ${file.name} expands beyond the ${formatBytes(MAX_ARCHIVE_EXTRACTED_BYTES)} safety limit.`
      )
      return
    }
    const parser = createConversationParser(file.name, file.originalSize, request, state, {
      fileIndex: entries,
      archiveName: archive.name,
    })
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) {
        failure = new Error(`Failed to extract ${file.name}: ${error.message}`)
        return
      }
      try {
        extractedBytes += chunk.byteLength
        if (extractedBytes > MAX_ARCHIVE_EXTRACTED_BYTES) {
          failure = new Error(
            `Archive contents expand beyond the ${formatBytes(MAX_ARCHIVE_EXTRACTED_BYTES)} safety limit.`
          )
          return
        }
        parser.write(chunk)
        if (final) parser.end()
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        failure = new Error(
          `Failed to parse ${file.name} after ${formatBytes(parser.bytesRead)}${file.originalSize === undefined ? '' : ` of ${formatBytes(file.originalSize)}`}: ${message}`
        )
      }
    }
    try {
      file.start()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      failure = new Error(`Cannot extract ${file.name} from ${archive.name}: ${message}`)
    }
  })
  unzipper.register(UnzipInflate)

  let archiveBytesRead = 0
  try {
    const reader = archive.stream().getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        unzipper.push(new Uint8Array(), true)
        break
      }
      archiveBytesRead += chunk.value.byteLength
      unzipper.push(chunk.value)
      if (failure) break
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      `Failed to read ZIP archive ${archive.name} after ${formatBytes(archiveBytesRead)} of ${formatBytes(archive.size)}: ${message}`
    )
  }
  if (failure) throw failure
  if (entries === 0) throw new Error(`No conversations*.json files were found in ZIP archive ${archive.name}.`)
}

type ImportState = { chats: number; skipped: number; lastProgressAt: number }
type ProgressFile = { fileIndex: number; fileCount?: number; archiveName?: string }

function createConversationParser(
  name: string,
  bytesTotal: number | undefined,
  request: ImportRequest,
  state: ImportState,
  progressFile: ProgressFile
) {
  const parser = new JSONParser({ paths: ['$.*'], keepStack: false })
  let bytesRead = 0
  parser.onValue = ({ value }) => {
    if (isEmptyV1Record(value)) return
    try {
      const chat = normalizeV1Chat(value)
      retainedChats.push(chat)
      const records = retainedChatsById.get(chat.id) ?? []
      records.push(chat)
      retainedChatsById.set(chat.id, records)
      state.chats++
    } catch {
      state.skipped++
    }
  }
  return {
    get bytesRead() {
      return bytesRead
    },
    write(chunk: Uint8Array) {
      parser.write(chunk)
      bytesRead += chunk.byteLength
      if (performance.now() - state.lastProgressAt >= 250) {
        state.lastProgressAt = performance.now()
        worker.postMessage({
          type: 'progress',
          requestId: request.requestId,
          fileName: name,
          bytesRead,
          bytesTotal,
          chats: state.chats,
          skipped: state.skipped,
          ...progressFile,
        } satisfies Progress)
      }
    },
    end() {
      if (!parser.isEnded) parser.end()
    },
  }
}

async function recalculateStatistics(request: StatisticsRequest): Promise<void> {
  temporalCache = undefined
  worker.postMessage({
    type: 'statistics',
    requestId: request.requestId,
    ...statisticsFor(request),
    startDate: request.startDate,
    sessionGapMinutes: request.sessionGapMinutes,
  } satisfies Statistics)
}

async function generateRecap(request: RecapRequest): Promise<void> {
  const document = buildRecap(retainedChats, {
    timeZone: request.timeZone,
    startDate: request.startDate,
    endDate: request.endDate,
    sessionGapMinutes: request.sessionGapMinutes,
    context: { strategy: request.contextStrategy, maxMessages: request.contextMessages },
  })
  const content = request.contextFormat === 'yaml' ? serializeRecapYaml(document) : serializeRecapToon(document)
  worker.postMessage({
    type: 'recap',
    requestId: request.requestId,
    context: new Blob([content], { type: request.contextFormat === 'yaml' ? 'text/yaml' : 'text/plain' }),
    contextFormat: request.contextFormat,
    prompt: createRecapPrompt(request.contextFormat),
  } satisfies Recap)
}

async function loadConversationDetail(request: DetailRequest): Promise<void> {
  const chats = chatsFor(request.id)
  const detail = collectConversationDetail(
    chats,
    analyticsOptions(request.timeZone, request.startDate, request.sessionGapMinutes)
  )
  worker.postMessage({
    type: 'conversation-detail',
    requestId: request.requestId,
    id: request.id,
    detail,
  } satisfies Detail)
}

async function loadConversationOutline(request: OutlineRequest): Promise<void> {
  const page = findConversationTurns(
    chatsFor(request.id),
    analyticsOptions(request.timeZone, request.startDate, request.sessionGapMinutes),
    request.offset,
    request.limit,
    request.query
  )
  worker.postMessage({
    type: 'conversation-outline',
    requestId: request.requestId,
    id: request.id,
    page,
  } satisfies Outline)
}

async function loadMessageContents(request: ContentRequest): Promise<void> {
  const contents = getMessageContents(
    chatsFor(request.id),
    analyticsOptions(request.timeZone, request.startDate, request.sessionGapMinutes),
    request.ids
  )
  worker.postMessage({
    type: 'message-content',
    requestId: request.requestId,
    id: request.id,
    contents,
  } satisfies Content)
}

async function loadConversationRepeatedPhrases(request: ConversationRepetitionsRequest): Promise<void> {
  const key = `${request.id}\u0000${repetitionKey(request.timeZone, request.startDate)}`
  const analysis =
    repeatedPhraseCache.get(key) ??
    collectRepeatedPhrases(chatsFor(request.id), { timeZone: request.timeZone, startDate: request.startDate })
  repeatedPhraseCache.set(key, analysis)
  worker.postMessage({
    type: 'conversation-repetitions',
    requestId: request.requestId,
    id: request.id,
    analysis,
  } satisfies ConversationRepetitions)
}

async function loadTemporalSlice(request: TemporalSliceRequest): Promise<void> {
  if (!Number.isInteger(request.offset) || request.offset < 0)
    throw new RangeError('offset must be a non-negative integer.')
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100)
    throw new RangeError('limit must be an integer between 1 and 100.')
  const cacheKey = temporalKey(request.timeZone, request.startDate, request.filter)
  if (temporalCache?.key !== cacheKey) {
    temporalCache = {
      key: cacheKey,
      slice: collectTemporalMessageSlice(
        retainedChats,
        { timeZone: request.timeZone, startDate: request.startDate },
        request.filter
      ),
    }
  }
  const slice = temporalCache.slice
  const filtered = request.conversationId
    ? slice.messages.filter(message => message.conversationId === request.conversationId)
    : slice.messages
  const ordered = request.order === 'newest' ? filtered : [...filtered].reverse()
  worker.postMessage({
    type: 'temporal-slice',
    requestId: request.requestId,
    cacheKey,
    filter: slice.filter,
    summary: slice.summary,
    conversations: slice.conversations,
    offset: request.offset,
    total: ordered.length,
    messages: ordered.slice(request.offset, request.offset + request.limit).map(temporalPreview),
  } satisfies TemporalSlicePage)
}

async function loadTemporalContent(request: TemporalContentRequest): Promise<void> {
  if (temporalCache?.key !== request.cacheKey) throw new Error('The selected time slice is no longer available.')
  const wanted = new Set(request.ids)
  const contents = temporalCache.slice.messages
    .filter(message => wanted.has(message.id))
    .map(message => ({ id: message.id, body: message.body }))
  worker.postMessage({ type: 'temporal-content', requestId: request.requestId, contents } satisfies TemporalContent)
}

function statisticsFor(request: SharedOptions): { local: AnalyticsStatistics; utc: AnalyticsStatistics } {
  return {
    local: collectAnalytics(
      retainedChats,
      analyticsOptions(request.localTimeZone, request.startDate, request.sessionGapMinutes)
    ),
    utc: collectAnalytics(retainedChats, analyticsOptions('UTC', request.startDate, request.sessionGapMinutes)),
  }
}
function analyticsOptions(timeZone: string, startDate: string | undefined, sessionGapMinutes: number) {
  return { timeZone, startDate, sessionGapMinutes }
}
function repetitionKey(timeZone: string, startDate: string | undefined): string {
  return `${timeZone}\u0000${startDate ?? ''}`
}
function temporalKey(timeZone: string, startDate: string | undefined, filter: TemporalMessageFilter): string {
  return `${timeZone}\u0000${startDate ?? ''}\u0000${filter.role}\u0000${filter.weekday ?? 'all'}\u0000${filter.hour}`
}
function temporalPreview(message: TemporalMessageEvidence): TemporalMessagePreview {
  return {
    id: message.id,
    conversationId: message.conversationId,
    conversationTitle: message.conversationTitle,
    role: message.role,
    createTime: message.createTime,
    text: message.text,
    preview: message.preview,
  }
}
function chatsFor(id: string): Chat[] {
  const chats = retainedChatsById.get(id)
  if (chats === undefined) throw new Error(`Conversation no longer exists in this browser session: ${id}`)
  return chats
}
function relativeName(file: File): string {
  return file.webkitRelativePath || file.name
}
function isConversationFile(name: string): boolean {
  return /^conversations(?:-[^/]+)?\.json$/i.test(name.slice(name.lastIndexOf('/') + 1))
}
function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en', { style: 'unit', unit: 'byte', unitDisplay: 'short' }).format(bytes)
}
