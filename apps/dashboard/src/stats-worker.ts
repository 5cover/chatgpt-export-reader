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
  serializeRecapToon,
  serializeRecapYaml,
  serializeRecapYamlWithAnchors,
  type Chat,
  type RepeatedPhraseAnalysis,
  type TemporalMessageSlice,
} from '@chatgpt-export-reader/core'
import { period, previousPeriod, type AnalysisScope } from './analysis-scope.js'
import type {
  WorkerRequest,
  WorkerResponse,
  Progress,
  StatisticsResult,
  Dataset,
  ImportDiagnostic,
} from './worker-protocol.js'
const worker = globalThis
const retainedChats: Chat[] = []
const retainedChatsById = new Map<string, Chat[]>()
const repeatedPhraseCache = new Map<string, RepeatedPhraseAnalysis>()
let temporalCache: { key: string; slice: TemporalMessageSlice } | undefined
const MAX_ARCHIVE_EXTRACTED_BYTES = 1_000_000_000
const availablePeriods = new Map<string, ReturnType<typeof period>>()
worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  void handle(request).catch((error: unknown) =>
    post({
      type: 'failure',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  )
})
function post(message: WorkerResponse) {
  worker.postMessage(message)
}
async function handle(request: WorkerRequest): Promise<void> {
  const requestId = request.requestId
  switch (request.type) {
    case 'import': {
      const started = performance.now()
      availablePeriods.clear()
      retainedChats.length = 0
      retainedChatsById.clear()
      repeatedPhraseCache.clear()
      temporalCache = undefined
      const state: ImportState = { chats: 0, skipped: 0, lastProgressAt: 0, diagnostics: [], record: 0 }
      if (request.source.kind === 'folder') await importFolder(request, request.source.files, state)
      else await importZip(request, request.source.archive, state)
      if (!retainedChats.length)
        throw new Error(
          `No supported conversations were imported. ${state.skipped} records were skipped. ${state.diagnostics[0]?.reason ?? 'Check that the export contains conversations JSON files.'}`
        )
      const all = collectAnalytics(retainedChats, { timeZone: request.scope.timeZone })
      const dataset: Dataset = {
        projects: [...new Set(retainedChats.map(chat => chat.projectName ?? ''))].sort(),
        available: period(all.days[0]?.date, all.days.at(-1)?.date),
        skipped: state.skipped,
        diagnostics: state.diagnostics,
        durationMs: Math.round(performance.now() - started),
      }
      availablePeriods.set(request.scope.timeZone, dataset.available)
      const statistics = statisticsFor(request.scope)
      dataset.durationMs = Math.round(performance.now() - started)
      post({ type: 'import', requestId, dataset, ...statistics })
      return
    }
    case 'statistics':
      temporalCache = undefined
      post({ type: request.type, requestId, ...statisticsFor(request.scope) })
      return
    case 'conversation-detail':
      post({
        type: request.type,
        requestId,
        detail: collectConversationDetail(chatsFor(request.id, request.scope), request.scope),
      })
      return
    case 'conversation-outline':
      post({
        type: request.type,
        requestId,
        page: findConversationTurns(
          chatsFor(request.id, request.scope),
          request.scope,
          request.offset,
          50,
          request.query,
          request.queryMode
        ),
      })
      return
    case 'message-content':
      post({
        type: request.type,
        requestId,
        contents: getMessageContents(chatsFor(request.id, request.scope), request.scope, request.ids),
      })
      return
    case 'conversation-repetitions': {
      const key = JSON.stringify([request.id, request.scope])
      const analysis =
        repeatedPhraseCache.get(key) ?? collectRepeatedPhrases(chatsFor(request.id, request.scope), request.scope)
      if (repeatedPhraseCache.size >= 10) repeatedPhraseCache.delete(repeatedPhraseCache.keys().next().value!)
      repeatedPhraseCache.set(key, analysis)
      post({ type: request.type, requestId, analysis })
      return
    }
    case 'temporal-slice': {
      const cacheKey = JSON.stringify([request.scope, request.filter])
      if (temporalCache?.key !== cacheKey)
        temporalCache = {
          key: cacheKey,
          slice: collectTemporalMessageSlice(scopedChats(request.scope), request.scope, request.filter),
        }
      const slice = temporalCache.slice
      const filtered = request.conversationId
        ? slice.messages.filter(message => message.conversationId === request.conversationId)
        : slice.messages
      const ordered = request.order === 'newest' ? filtered : [...filtered].reverse()
      post({
        type: request.type,
        requestId,
        page: {
          cacheKey,
          filter: slice.filter,
          summary: slice.summary,
          conversations: slice.conversations,
          offset: request.offset,
          total: ordered.length,
          messages: ordered.slice(request.offset, request.offset + 50).map(({ body: _body, ...message }) => message),
        },
      })
      return
    }
    case 'temporal-content': {
      if (temporalCache?.key !== request.cacheKey)
        throw new Error('This time slice is no longer available. Return to Time and rhythm and select it again.')
      const ids = new Set(request.ids)
      post({
        type: request.type,
        requestId,
        contents: temporalCache.slice.messages
          .filter(message => ids.has(message.id))
          .map(message => ({ id: message.id, body: message.body })),
      })
      return
    }
    case 'recap': {
      const document = buildRecap(scopedChats(request.settings), {
        ...request.settings,
        context: { strategy: request.settings.contextStrategy, maxMessages: request.settings.contextMessages },
      })
      const content = request.settings.contextFormat === 'yaml'
        ? serializeRecapYaml(document)
        : request.settings.contextFormat === 'yaml-anchors'
          ? serializeRecapYamlWithAnchors(document)
          : serializeRecapToon(document)
      const contentType = request.settings.contextFormat === 'toon' ? 'text/plain' : 'text/yaml'
      post({
        type: request.type,
        requestId,
        contextFormat: request.settings.contextFormat,
        context: new Blob([content], { type: contentType }),
      })
      return
    }
  }
}
function scopedChats(scope: AnalysisScope): Chat[] {
  return scope.projectId === undefined
    ? retainedChats
    : retainedChats.filter(chat => (chat.projectName ?? '') === scope.projectId)
}
function chatsFor(id: string, scope: AnalysisScope): Chat[] {
  return (retainedChatsById.get(id) ?? []).filter(
    chat => scope.projectId === undefined || (chat.projectName ?? '') === scope.projectId
  )
}
function statisticsFor(scope: AnalysisScope): StatisticsResult {
  if (!availablePeriods.has(scope.timeZone)) {
    const history = collectAnalytics(retainedChats, { timeZone: scope.timeZone })
    availablePeriods.set(scope.timeZone, period(history.days[0]?.date, history.days.at(-1)?.date))
  }
  const available = availablePeriods.get(scope.timeZone)
  const calendarRange = period(scope.startDate ?? available?.startDate, scope.endDate ?? available?.endDate)
  const chats = scopedChats(scope)
  const stats = collectAnalytics(chats, { ...scope, calendarRange })
  const current = period(stats.days[0]?.date, stats.days.at(-1)?.date)
  if (!current) return { stats, available, comparisonCovered: false }
  const previous = previousPeriod(current)
  return {
    stats,
    available,
    period: current,
    previousPeriod: previous,
    previous: collectAnalytics(chats, { ...scope, ...previous }),
    comparisonCovered: !!available && available.startDate <= previous.startDate && current.endDate <= available.endDate,
  }
}

async function importFolder(
  request: Extract<WorkerRequest, { type: 'import' }>,
  folderFiles: File[],
  state: ImportState
): Promise<void> {
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

async function importZip(
  request: Extract<WorkerRequest, { type: 'import' }>,
  archive: File,
  state: ImportState
): Promise<void> {
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

type ImportState = {
  chats: number
  skipped: number
  lastProgressAt: number
  diagnostics: ImportDiagnostic[]
  record: number
}
type ProgressFile = { fileIndex: number; fileCount?: number; archiveName?: string }

function createConversationParser(
  name: string,
  bytesTotal: number | undefined,
  request: Extract<WorkerRequest, { type: 'import' }>,
  state: ImportState,
  progressFile: ProgressFile
) {
  const parser = new JSONParser({ paths: ['$.*'], keepStack: false })
  let bytesRead = 0
  parser.onValue = ({ value }) => {
    state.record++
    if (isEmptyV1Record(value)) return
    try {
      const chat = normalizeV1Chat(value)
      retainedChats.push(chat)
      const records = retainedChatsById.get(chat.id) ?? []
      records.push(chat)
      retainedChatsById.set(chat.id, records)
      state.chats++
    } catch (error) {
      state.skipped++
      if (state.diagnostics.length < 10)
        state.diagnostics.push({
          file: name,
          record: state.record,
          reason: (error instanceof Error ? error.message : String(error)).replaceAll(/\s+/g, ' ').slice(0, 600),
        })
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
          detail: `${progressFile.archiveName ?? ''} ${progressFile.fileIndex}: ${name}: ${formatBytes(bytesRead)}${bytesTotal === undefined ? '' : ` / ${formatBytes(bytesTotal)}`} - ${state.chats} conversations`,
        } satisfies Progress)
      }
    },
    end() {
      if (!parser.isEnded) parser.end()
    },
  }
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
