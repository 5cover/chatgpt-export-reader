import { encode } from '@toon-format/toon'
import { intern } from 'interner'
import { parse, Scalar, stringify } from 'yaml'
import * as z from 'zod'
import {
  collectAnalytics,
  collectRepeatedPhrases,
  type AnalyticsOptions,
  type AnalyticsStatistics,
  type RepeatedPhraseAnalysis,
  type TextMetrics,
} from './analytics.js'
import { deriveAnalyticsMetrics, type AnalyticsDerivedMetrics, type Distribution } from './derived-metrics.js'
import type { Chat, Message } from './types.js'
import { recapContextSchema } from './recap-schema.js'

export type RecapContextStrategy = 'full' | 'rolling-window'
export type RecapContextFormat = 'yaml' | 'yaml-anchors' | 'toon'

export type RecapOptions = AnalyticsOptions & {
  projectNames?: Readonly<Record<string, string>>
  context?: {
    strategy?: RecapContextStrategy
    maxMessages?: number
  }
  repeatedPhrases?: {
    minimumScorePercentile?: number
  }
}

export type RecapMessage = {
  id: string
  parentId: string
  branchPath: string
  role: string
  at: string
  text: string
  textMetrics: TextMetrics
  model?: string
  weight?: number
  thoughts?: Message['thoughts']
}

export type RecapOmission = {
  kind: 'omission'
  skippedMessages: number
  reason: 'rolling-window'
}

export type RecapConversationEvidence = {
  id: string
  title: string
  projectId?: string
  projectName?: string
  omittedUntimestampedMessages: number
  preWindowContext: (RecapMessage | RecapOmission)[]
  messages: RecapMessage[]
}

export type RecapDerivedMetrics = AnalyticsDerivedMetrics
export type { Distribution }

export type RecapDocument = {
  schema: 'chatgpt-export-reader/recap/v1'
  selection: {
    timezone: string
    requestedDateRange: { startDate: string; endDate: string }
    resolvedDateRange: { startDate: string; endDate: string }
    context: { strategy: RecapContextStrategy; maxMessages: number }
    repeatedPhrases: { minimumScorePercentile: number }
  }
  analytics: AnalyticsStatistics & { repeatedPhrases: RepeatedPhraseAnalysis }
  metrics: RecapDerivedMetrics
  conversations: RecapConversationEvidence[]
}

const recapDocumentSchema = z.object({
  schema: z.literal('chatgpt-export-reader/recap/v1'),
  selection: z.object({
    timezone: z.string(),
    requestedDateRange: z.object({ startDate: z.string(), endDate: z.string() }),
    resolvedDateRange: z.object({ startDate: z.string(), endDate: z.string() }),
    context: z.object({ strategy: z.enum(['full', 'rolling-window']), maxMessages: z.number().int().nonnegative() }),
    repeatedPhrases: z.object({ minimumScorePercentile: z.number().min(0).max(100) }),
  }),
  analytics: z.custom<RecapDocument['analytics']>(
    value => value !== null && typeof value === 'object' && !Array.isArray(value)
  ),
  metrics: z.custom<RecapDerivedMetrics>(value => value !== null && typeof value === 'object' && !Array.isArray(value)),
  conversations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      projectId: z.string().optional(),
      projectName: z.string().optional(),
      omittedUntimestampedMessages: z.number().int().nonnegative(),
      preWindowContext: z.array(
        z.union([
          z.object({
            id: z.string(),
            parentId: z.string(),
            branchPath: z.string(),
            role: z.string(),
            at: z.string(),
            text: z.string(),
            textMetrics: z.object({ characters: z.number(), words: z.number() }),
          }),
          z.object({
            kind: z.literal('omission'),
            skippedMessages: z.number().int().nonnegative(),
            reason: z.literal('rolling-window'),
          }),
        ])
      ),
      messages: z.array(
        z.object({
          id: z.string(),
          parentId: z.string(),
          branchPath: z.string(),
          role: z.string(),
          at: z.string(),
          text: z.string(),
          textMetrics: z.object({ characters: z.number(), words: z.number() }),
          model: z.string().optional(),
          weight: z.number().optional(),
          thoughts: z
            .array(z.object({ summary: z.string(), content: z.string(), chunks: z.array(z.string()) }))
            .optional(),
        })
      ),
    })
  ),
})

type FlatMessage = {
  message: Message
  parentId: string
  branchPath: string
  order: number
}

/**
 * Builds a portable evidence document for a selected local-calendar range.
 * The analytics section deliberately receives only in-range messages.
 */
export function buildRecap(chats: Iterable<Chat>, options: RecapOptions = {}): RecapDocument {
  const timeZone = options.timeZone ?? 'UTC'
  validateTimeZone(timeZone)
  const requestedStart = options.startDate === undefined ? '' : validateDate(options.startDate, 'start')
  const requestedEnd = options.endDate === undefined ? '' : validateDate(options.endDate, 'end')
  if (requestedStart && requestedEnd && requestedStart > requestedEnd)
    throw new RangeError('startDate must be on or before endDate.')

  const source = [...chats]
  const dated = source.flatMap(chat =>
    flattenMessages(chat.messages).flatMap(entry =>
      entry.message.createTime === undefined ? [] : [entry.message.createTime]
    )
  )
  if (dated.length === 0) throw new RangeError('recap requires at least one timestamped message.')
  const sortedTimes = [...dated].sort((left, right) => left - right)
  const resolvedStart = requestedStart || dayKey(sortedTimes[0]!, timeZone)
  const resolvedEnd = requestedEnd || dayKey(sortedTimes.at(-1)!, timeZone)
  if (resolvedStart > resolvedEnd) throw new RangeError('startDate must be on or before endDate.')

  const strategy = options.context?.strategy ?? 'rolling-window'
  if (!['full', 'rolling-window'].includes(strategy))
    throw new RangeError('context.strategy must be "full" or "rolling-window".')
  const maxMessages = options.context?.maxMessages ?? 20
  if (!Number.isInteger(maxMessages) || maxMessages < 0)
    throw new RangeError('context.maxMessages must be a non-negative integer.')
  const minimumScorePercentile = options.repeatedPhrases?.minimumScorePercentile ?? 90
  if (!Number.isFinite(minimumScorePercentile) || minimumScorePercentile < 0 || minimumScorePercentile > 100)
    throw new RangeError('repeatedPhrases.minimumScorePercentile must be a number from 0 to 100.')

  const analyticsOptions: AnalyticsOptions = {
    timeZone,
    startDate: resolvedStart,
    endDate: resolvedEnd,
    sessionGapMinutes: options.sessionGapMinutes,
  }
  const analytics = collectAnalytics(source, analyticsOptions)
  if (options.projectNames) {
    analytics.projects = analytics.projects.map(project => ({
      ...project,
      name: options.projectNames?.[project.id] ?? (project.id || 'Unassigned'),
    }))
    analytics.timing.projects = analytics.timing.projects.map(project => ({
      ...project,
      title: options.projectNames?.[project.id] ?? project.title,
    }))
    analytics.timing.projectDays = analytics.timing.projectDays.map(day => ({
      ...day,
      title: options.projectNames?.[day.projectId] ?? day.title,
    }))
  }
  if (analytics.summary.messages === 0)
    throw new RangeError(`no timestamped messages fall between ${resolvedStart} and ${resolvedEnd} in ${timeZone}.`)
  const repeatedPhrases = filterRepeatedPhrases(
    collectRepeatedPhrases(source, analyticsOptions),
    minimumScorePercentile
  )

  const document = {
    schema: 'chatgpt-export-reader/recap/v1',
    selection: {
      timezone: timeZone,
      requestedDateRange: { startDate: requestedStart, endDate: requestedEnd },
      resolvedDateRange: { startDate: resolvedStart, endDate: resolvedEnd },
      context: { strategy, maxMessages },
      repeatedPhrases: { minimumScorePercentile },
    },
    analytics: { ...analytics, repeatedPhrases },
    metrics: deriveAnalyticsMetrics(analytics, { timeZone }),
    conversations: source
      .map(chat => evidenceFor(chat, resolvedStart, resolvedEnd, timeZone, strategy, maxMessages, options.projectNames))
      .filter((conversation): conversation is RecapConversationEvidence => conversation !== undefined),
  } satisfies z.output<typeof recapDocumentSchema>
  return recapDocumentSchema.parse(document)
}

function filterRepeatedPhrases(
  analysis: RepeatedPhraseAnalysis,
  minimumScorePercentile: number
): RepeatedPhraseAnalysis {
  return {
    user: filterRolePhrases(analysis.user, minimumScorePercentile),
    assistant: filterRolePhrases(analysis.assistant, minimumScorePercentile),
  }
}

function filterRolePhrases<T extends { score: number }>(phrases: T[], minimumScorePercentile: number): T[] {
  if (phrases.length === 0) return []
  const scores = phrases.map(phrase => phrase.score).sort((left, right) => left - right)
  const position = (scores.length - 1) * (minimumScorePercentile / 100)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const threshold = scores[lower]! + (scores[upper]! - scores[lower]!) * (position - lower)
  return phrases.filter(phrase => phrase.score >= threshold)
}

export function serializeRecapYaml(document: RecapDocument): string {
  return serializeRecapYamlValue(compactForTransport(document), false)
}

export function serializeRecapYamlWithAnchors(document: RecapDocument): string {
  return serializeRecapYamlValue(intern(prepareYamlInternGraph(compactForTransport(document))), true)
}

function serializeRecapYamlValue(value: unknown, aliasDuplicateObjects: boolean): string {
  const yaml = stringify(preserveYamlBooleanStrings(restoreYamlMaps(value)), {
    indent: 2,
    lineWidth: 0,
    blockQuote: true,
    aliasDuplicateObjects,
  })
  const output = yaml.endsWith('\n') ? yaml : `${yaml}\n`
  recapContextSchema.parse(parse(output, { maxAliasCount: output.length }))
  return output
}

export function serializeRecapToon(document: RecapDocument): string {
  const toon = unquoteNumericToonKeys(encode(compactForTransport(document)))
  return toon.endsWith('\n') ? toon : `${toon}\n`
}

export {
  createRecapPrompt,
  recapPromptModules,
  recapPromptModuleDefinitions,
  type RecapPromptModule,
  type RecapPromptModuleDefinition,
} from './recap-prompt.js'

function evidenceFor(
  chat: Chat,
  startDate: string,
  endDate: string,
  timeZone: string,
  strategy: RecapContextStrategy,
  maxMessages: number,
  projectNames?: Readonly<Record<string, string>>
): RecapConversationEvidence | undefined {
  const flat = flattenMessages(chat.messages)
  const dated = flat.filter(entry => entry.message.createTime !== undefined)
  const selected = dated.filter(entry => {
    const date = dayKey(entry.message.createTime!, timeZone)
    return date >= startDate && date <= endDate
  })
  if (selected.length === 0) return undefined
  const before = dated.filter(entry => dayKey(entry.message.createTime!, timeZone) < startDate)
  const context =
    strategy === 'full'
      ? before.map(entry => recapMessage(entry, timeZone))
      : rollingWindow(before, maxMessages, timeZone)
  return {
    id: chat.id,
    title: chat.title,
    projectId: chat.projectName,
    projectName: chat.projectName ? (projectNames?.[chat.projectName] ?? chat.projectName) : undefined,
    omittedUntimestampedMessages: flat.length - dated.length,
    preWindowContext: context,
    messages: selected.map(entry => recapMessage(entry, timeZone)),
  }
}

function rollingWindow(messages: FlatMessage[], budget: number, timeZone: string): (RecapMessage | RecapOmission)[] {
  if (messages.length <= budget) return messages.map(entry => recapMessage(entry, timeZone))
  const firstCount = Math.ceil(budget / 2)
  const lastCount = Math.floor(budget / 2)
  const first = messages.slice(0, firstCount)
  const last = lastCount === 0 ? [] : messages.slice(-lastCount)
  return [
    ...first.map(entry => recapMessage(entry, timeZone)),
    { kind: 'omission', skippedMessages: messages.length - first.length - last.length, reason: 'rolling-window' },
    ...last.map(entry => recapMessage(entry, timeZone)),
  ]
}

function recapMessage(entry: FlatMessage, timeZone = 'UTC'): RecapMessage {
  const message = entry.message
  return {
    id: message.id,
    parentId: entry.parentId,
    branchPath: entry.branchPath,
    role: message.role,
    at: message.createTime === undefined ? '' : formatLocalTimestamp(message.createTime, timeZone),
    text: message.body,
    textMetrics: textMetrics(message.body),
    ...(message.model === undefined || message.model === '' ? {} : { model: message.model }),
    ...(message.weight === 1 ? {} : { weight: message.weight }),
    ...(message.thoughts === undefined || message.thoughts.length === 0 ? {} : { thoughts: message.thoughts }),
  }
}

function flattenMessages(roots: readonly Message[]): FlatMessage[] {
  const result: FlatMessage[] = []
  const seen = new Set<Message>()
  let order = 0
  const visit = (message: Message, parentId: string, branchPath: string): void => {
    if (seen.has(message)) return
    seen.add(message)
    result.push({ message, parentId, branchPath, order: order++ })
    message.children.forEach((child, index) => visit(child, message.id, `${branchPath}.${index + 1}`))
  }
  roots.forEach((message, index) => visit(message, '', String(index + 1)))
  return result
}

function textMetrics(text: string): TextMetrics {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  let words = 0
  for (const part of segmenter.segment(text)) if (part.isWordLike) words++
  return { characters: text.length, words }
}
function validateDate(value: string, kind: 'start' | 'end'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError(`Invalid ${kind} date: ${value}. Expected YYYY-MM-DD.`)
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new RangeError(`Invalid ${kind} date: ${value}. Expected a real calendar date.`)
  return value
}
function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
  } catch {
    throw new RangeError(`Invalid time zone: ${timeZone}.`)
  }
}
function dayKey(timestamp: number, timeZone: string): string {
  const values = parts(timestamp, timeZone)
  return `${values.year!}-${values.month!}-${values.day!}`
}
function formatLocalTimestamp(timestamp: number, timeZone: string): string {
  const value = parts(timestamp, timeZone)
  const localAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute)
  )
  const offsetMinutes = Math.round((localAsUtc - timestamp) / 60_000)
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  return `${value.weekday!.toLocaleLowerCase()} ${value.year!}-${value.month!}-${value.day!}T${value.hour!}:${value.minute!}${offset}`
}
function parts(timestamp: number, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(timestamp)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  )
}
/**
 * Allocates compact, document-local IDs while retaining repeated-reference
 * semantics. Source GUIDs are globally unique in the emitted document, so one
 * map keeps every reference short.
 */
class RecapIdGenerator {
  readonly seen = new Map<string, number>()

  id(guid: string): number {
    const existing = this.seen.get(guid)
    if (existing !== undefined) return existing
    const value = this.seen.size + 1
    this.seen.set(guid, value)
    return value
  }
}

type YamlTextMetrics = { wc: string }

function compactForTransport(document: RecapDocument): unknown {
  const ids = new RecapIdGenerator()
  for (const conversation of document.conversations) {
    ids.id(conversation.id)
    for (const item of [...conversation.preWindowContext, ...conversation.messages]) {
      if ('skippedMessages' in item) continue
      ids.id(item.id)
    }
  }
  return compactValue(
    {
      ...document,
      analytics: {
        ...document.analytics,
        hours: document.analytics.hours.filter(cell => cell.messages > 0 || cell.sessionsStarted > 0),
      },
      conversations: compactEvidence(document.conversations, ids),
    },
    ids
  )
}

function compactEvidence(conversations: RecapConversationEvidence[], ids: RecapIdGenerator): Map<number, unknown> {
  const compacted = new Map<number, unknown>()
  for (const conversation of conversations) {
    compacted.set(ids.id(conversation.id), {
      title: conversation.title,
      ...(conversation.projectId ? { projectId: conversation.projectId, projectName: conversation.projectName } : {}),
      omittedUntimestampedMessages: conversation.omittedUntimestampedMessages,
      preWindowContext: compactContext(conversation.preWindowContext, ids),
      messages: compactMessages(conversation.messages, ids),
    })
  }
  return compacted
}

function compactContext(
  context: (RecapMessage | RecapOmission)[],
  ids: RecapIdGenerator
): Map<number | '_omitted', unknown> {
  const compacted = new Map<number | '_omitted', unknown>()
  for (const item of context) {
    if ('skippedMessages' in item) {
      compacted.set('_omitted', { skippedMessages: item.skippedMessages })
      continue
    }
    compacted.set(ids.id(item.id), compactEvidenceMessage(item))
  }
  return compacted
}

function compactMessages(messages: RecapMessage[], ids: RecapIdGenerator): Map<number, unknown> {
  const compacted = new Map<number, unknown>()
  for (const message of messages) compacted.set(ids.id(message.id), compactEvidenceMessage(message))
  return compacted
}

function compactEvidenceMessage(message: RecapMessage): Omit<RecapMessage, 'id' | 'branchPath'> {
  const { id: _id, branchPath: _branchPath, ...compacted } = message
  return compacted
}

function compactValue(value: unknown, ids: RecapIdGenerator): unknown {
  if (isTextMetrics(value)) return { wc: `${value.words} ${value.characters}` } satisfies YamlTextMetrics
  if (Array.isArray(value)) return value.map(item => compactValue(item, ids))
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, compactValue(item, ids)]))
  if (value === undefined || value === null) return ''
  if (typeof value !== 'object') return value

  const compacted: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === 'kind' && childValue === 'message') continue
    if (childKey === 'model' && (childValue === '' || childValue === undefined)) continue
    if (childKey === 'weight' && childValue === 1) continue
    if (childKey === 'thoughts' && Array.isArray(childValue) && childValue.length === 0) continue
    if (childKey === 'other' && isEmptyTextMetrics(childValue)) continue
    if (childKey === 'parentId' && childValue === '') continue
    if (childKey === 'textMetrics' && isTextMetrics(childValue)) {
      compacted.wc = `${childValue.words} ${childValue.characters}`
      continue
    }
    if (isIdentifierKey(childKey) && typeof childValue === 'string' && childValue !== '') {
      compacted[childKey] = ids.id(childValue)
      continue
    }
    compacted[childKey] = compactValue(childValue, ids)
  }
  return compacted
}

/**
 * TOON accepts bare numeric keys, but its encoder quotes every object key after
 * normalizing Map keys to strings. Keep compact evidence IDs visibly numeric,
 * matching the YAML transport and numeric parent references.
 */
function unquoteNumericToonKeys(toon: string): string {
  return toon.replace(/^(\s*)"(\d+)":/gm, '$1$2:')
}

function isTextMetrics(value: unknown): value is TextMetrics {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2 && typeof record.characters === 'number' && typeof record.words === 'number'
}

function isEmptyTextMetrics(value: unknown): value is TextMetrics {
  return isTextMetrics(value) && value.words === 0 && value.characters === 0
}

function isIdentifierKey(key: string): key is 'id' | 'parentId' | 'conversationId' {
  return key === 'id' || key === 'parentId' || key === 'conversationId'
}

const yamlMapMarker = Symbol('yaml-map')

function prepareYamlInternGraph(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  if (Array.isArray(value)) {
    const output: unknown[] = []
    seen.set(value, output)
    output.push(...value.map(child => prepareYamlInternGraph(child, seen)))
    return output
  }
  const output = Object.create(value instanceof Map ? null : Reflect.getPrototypeOf(value)) as Record<
    PropertyKey,
    unknown
  >
  seen.set(value, output)
  if (value instanceof Map) {
    Object.defineProperty(output, yamlMapMarker, { value: true, enumerable: true })
    for (const [key, child] of value) {
      Object.defineProperty(output, String(key), {
        value: prepareYamlInternGraph(child, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(output, key, {
        value: prepareYamlInternGraph(child, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  }
  return output
}

function restoreYamlMaps(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  if (Array.isArray(value)) {
    const output: unknown[] = []
    seen.set(value, output)
    output.push(...value.map(child => restoreYamlMaps(child, seen)))
    return output
  }
  if (value instanceof Map) {
    const output = new Map<unknown, unknown>()
    seen.set(value, output)
    for (const [key, child] of value) output.set(key, restoreYamlMaps(child, seen))
    return output
  }
  const isMap = Object.hasOwn(value, yamlMapMarker)
  const output: Record<PropertyKey, unknown> | Map<string | number, unknown> = isMap
    ? new Map()
    : (Object.create(Reflect.getPrototypeOf(value)) as Record<PropertyKey, unknown>)
  seen.set(value, output)
  for (const [key, child] of Object.entries(value)) {
    const restored = restoreYamlMaps(child, seen)
    if (output instanceof Map) {
      output.set(/^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : key, restored)
    } else {
      Object.defineProperty(output, key, { value: restored, enumerable: true, writable: true, configurable: true })
    }
  }
  return output
}

function preserveYamlBooleanStrings(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string' && /^(?:y|yes|n|no|true|false|on|off)$/iu.test(value)) {
    const scalar = new Scalar(value)
    scalar.type = Scalar.QUOTE_SINGLE
    return scalar
  }
  if (value === null || typeof value !== 'object' || value instanceof Scalar || seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = preserveYamlBooleanStrings(value[index], seen)
  } else if (value instanceof Map) {
    for (const [key, child] of value) value.set(key, preserveYamlBooleanStrings(child, seen))
  } else {
    for (const [key, child] of Object.entries(value))
      Object.defineProperty(value, key, {
        value: preserveYamlBooleanStrings(child, seen),
        enumerable: true,
        writable: true,
        configurable: true,
      })
  }
  return value
}
