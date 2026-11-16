import { intern } from 'interner'
import { stringify } from 'yaml'
import * as z from 'zod'

export const recapContextStrategies = ['full', 'rolling-window'] as const
export type RecapContextStrategy = (typeof recapContextStrategies)[number]

export const recapContextFormats = ['yaml', 'yaml-anchors', 'toon'] as const
export type RecapContextFormat = (typeof recapContextFormats)[number]

export const recapContextSchema = z.object({
  schema: z.literal('stemmatic/recap/v1').describe('Format version for this recap context.'),
  selection: z.object({
    timezone: z.string().describe('Timezone used for the inclusive calendar-date selection.'),
    requestedDateRange: z
      .object({ startDate: z.string(), endDate: z.string() })
      .describe('Requested bounds; an empty string means the bound was not specified.'),
    resolvedDateRange: z
      .object({ startDate: z.string(), endDate: z.string() })
      .describe('Inclusive date bounds actually used.'),
    context: z
      .object({ strategy: z.enum(recapContextStrategies), maxMessages: z.number().int().nonnegative() })
      .describe('Policy for earlier context included before the selected range.'),
    repeatedPhrases: z
      .object({ minimumScorePercentile: z.number().min(0).max(100) })
      .describe('Minimum retained repeated-phrase score percentile.'),
  }),
  analytics: z
    .record(z.string(), z.unknown())
    .describe(
      'Aggregate statistics for in-range messages only. Each source Message object is counted once per conversation; repeated references to the same object are deduplicated. Conversation identifiers in analytics refer to source conversations; evidence identifiers below are compact document-local numeric keys.'
    ),
  metrics: z.record(z.string(), z.unknown()).describe('Derived summary measures calculated from analytics.'),
  conversations: z
    .record(
      z.string(),
      z.object({
        title: z
          .string()
          .describe('Conversation title, which may be stale; use message text as the evidence of subject.'),
        projectId: z.string().optional(),
        projectName: z.string().optional(),
        omittedUntimestampedMessages: z
          .number()
          .int()
          .nonnegative()
          .describe('Messages without timestamps, excluded from date filtering and analytics.'),
        preWindowContext: z
          .record(
            z.string(),
            z.union([
              z.object({
                at: z.string(),
                role: z.string(),
                text: z.string(),
                wc: z.string().describe('Word and character counts as two space-separated integers.'),
                parentId: z.number().int().optional().describe('Numeric key of the parent message, when present.'),
                model: z.string().optional(),
                weight: z.number().optional(),
                thoughts: z.array(z.unknown()).optional(),
              }),
              z
                .object({ skippedMessages: z.number().int().nonnegative() })
                .describe(
                  'The _omitted entry marks a gap before retained context; skippedMessages quantifies the gap.'
                ),
            ])
          )
          .describe(
            'Earlier messages, keyed by compact numeric message ID, plus an optional _omitted gap record. Not activity in the selected date range.'
          ),
        messages: z
          .record(
            z.string(),
            z.object({
              at: z.string(),
              role: z.string(),
              text: z.string(),
              wc: z.string().describe('Word and character counts as two space-separated integers.'),
              parentId: z
                .number()
                .int()
                .optional()
                .describe('Numeric key of the parent message; absent on root messages.'),
              model: z.string().optional(),
              weight: z.number().optional(),
              thoughts: z.array(z.unknown()).optional(),
            })
          )
          .describe(
            'In-range messages keyed by compact numeric message ID in source-tree traversal order, not chronological order. Branches are reconstructed by following parentId.'
          ),
      })
    )
    .describe(
      'Conversation evidence keyed by compact numeric conversation ID. Message keys are unique within this document and parent references point to message keys.'
    ),
})

export const recapContextSchemaYaml = stringify(intern(z.toJSONSchema(recapContextSchema)), {
  indent: 2,
  lineWidth: 0,
  aliasDuplicateObjects: true,
})
