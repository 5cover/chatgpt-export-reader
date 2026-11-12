import type {
  AnalyticsStatistics,
  ConversationDetail,
  MessageContent,
  RepeatedPhraseAnalysis,
  RecapContextFormat,
  RecapContextStrategy,
  TemporalConversation,
  TemporalMessageEvidence,
  TemporalMessageFilter,
  TemporalMessageSlice,
  TurnPage,
} from '@chatgpt-export-reader/core'
import type { AnalysisScope, Period } from './analysis-scope.js'
export type ImportSource = { kind: 'folder'; files: File[] } | { kind: 'zip'; archive: File }
export type ImportDiagnostic = { file: string; record: number; reason: string }
export type Dataset = {
  projects: string[]
  available?: Period
  skipped: number
  diagnostics: ImportDiagnostic[]
  durationMs: number
}
export type StatisticsResult = {
  stats: AnalyticsStatistics
  previous?: AnalyticsStatistics
  period?: Period
  previousPeriod?: Period
  comparisonCovered: boolean
  available?: Period
}
export type TemporalPage = {
  cacheKey: string
  filter: TemporalMessageFilter
  summary: TemporalMessageSlice['summary']
  conversations: TemporalConversation[]
  offset: number
  total: number
  messages: Omit<TemporalMessageEvidence, 'body'>[]
}
export type RecapEvidenceSettings = AnalysisScope & {
  contextStrategy: RecapContextStrategy
  contextMessages: number
  contextFormat: RecapContextFormat
  projectNames?: Record<string, string>
}
type Scoped = { scope: AnalysisScope }
export type RequestInput =
  | ({ type: 'import'; source: ImportSource } & Scoped)
  | ({ type: 'statistics' } & Scoped)
  | ({ type: 'conversation-detail'; id: string } & Scoped)
  | ({ type: 'conversation-outline'; id: string; offset: number; query?: string } & Scoped)
  | ({ type: 'message-content'; id: string; ids: string[] } & Scoped)
  | ({ type: 'conversation-repetitions'; id: string } & Scoped)
  | ({
      type: 'temporal-slice'
      filter: TemporalMessageFilter
      conversationId?: string
      order: 'newest' | 'oldest'
      offset: number
    } & Scoped)
  | { type: 'temporal-content'; cacheKey: string; ids: string[] }
  | { type: 'recap'; settings: RecapEvidenceSettings }
export type WorkerRequest = RequestInput & { requestId: number }
export type Results = {
  import: { type: 'import'; dataset: Dataset } & StatisticsResult
  statistics: { type: 'statistics' } & StatisticsResult
  'conversation-detail': { type: 'conversation-detail'; detail?: ConversationDetail }
  'conversation-outline': { type: 'conversation-outline'; page: TurnPage }
  'message-content': { type: 'message-content'; contents: MessageContent[] }
  'conversation-repetitions': { type: 'conversation-repetitions'; analysis: RepeatedPhraseAnalysis }
  'temporal-slice': { type: 'temporal-slice'; page: TemporalPage }
  'temporal-content': { type: 'temporal-content'; contents: MessageContent[] }
  recap: { type: 'recap'; context: Blob; contextFormat: RecapContextFormat }
}
export type Progress = { type: 'progress'; requestId: number; detail: string }
export type WorkerResponse =
  ((Results[keyof Results] | { type: 'failure'; message: string }) & { requestId: number }) | Progress
