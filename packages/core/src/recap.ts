import { encode } from '@toon-format/toon'
import { stringify } from 'yaml'
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

export type RecapContextStrategy = 'full' | 'rolling-window'
export type RecapContextFormat = 'yaml' | 'toon'

export type RecapOptions = AnalyticsOptions & {
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
  omittedUntimestampedMessages: number
  preWindowContext: Array<RecapMessage | RecapOmission>
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
  if (strategy !== 'full' && strategy !== 'rolling-window')
    throw new RangeError('context.strategy must be "full" or "rolling-window".')
  const maxMessages = options.context?.maxMessages ?? 20
  if (!Number.isInteger(maxMessages) || maxMessages < 0)
    throw new RangeError('context.maxMessages must be a non-negative integer.')
  const minimumScorePercentile = options.repeatedPhrases?.minimumScorePercentile ?? 90
  if (
    !Number.isFinite(minimumScorePercentile) ||
    minimumScorePercentile < 0 ||
    minimumScorePercentile > 100
  )
    throw new RangeError('repeatedPhrases.minimumScorePercentile must be a number from 0 to 100.')

  const analyticsOptions: AnalyticsOptions = {
    timeZone,
    startDate: resolvedStart,
    endDate: resolvedEnd,
    sessionGapMinutes: options.sessionGapMinutes,
  }
  const analytics = collectAnalytics(source, analyticsOptions)
  if (analytics.summary.messages === 0)
    throw new RangeError(`no timestamped messages fall between ${resolvedStart} and ${resolvedEnd} in ${timeZone}.`)
  const repeatedPhrases = filterRepeatedPhrases(
    collectRepeatedPhrases(source, analyticsOptions),
    minimumScorePercentile
  )

  return {
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
      .map(chat => evidenceFor(chat, resolvedStart, resolvedEnd, timeZone, strategy, maxMessages))
      .filter((conversation): conversation is RecapConversationEvidence => conversation !== undefined),
  }
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

function filterRolePhrases<T extends { score: number }>(
  phrases: T[],
  minimumScorePercentile: number
): T[] {
  if (phrases.length === 0) return []
  const scores = phrases.map(phrase => phrase.score).sort((left, right) => left - right)
  const position = (scores.length - 1) * (minimumScorePercentile / 100)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const threshold = scores[lower]! + (scores[upper]! - scores[lower]!) * (position - lower)
  return phrases.filter(phrase => phrase.score >= threshold)
}

export function serializeRecapYaml(document: RecapDocument): string {
  const yaml = stringify(compactForTransport(document), {
    indent: 1,
    lineWidth: 0,
    blockQuote: true,
    aliasDuplicateObjects: false,
  })
  return yaml.endsWith('\n') ? yaml : `${yaml}\n`
}

export function serializeRecapToon(document: RecapDocument): string {
  const toon = unquoteNumericToonKeys(encode(compactForTransport(document)))
  return toon.endsWith('\n') ? toon : `${toon}\n`
}

export function createRecapPrompt(contextFormat: RecapContextFormat = 'yaml'): string {
  if (contextFormat !== 'yaml' && contextFormat !== 'toon')
    throw new RangeError(`unknown recap context format: ${contextFormat}`)
  return `# ChatGPT Usage Recap: Investigator Prompt

- Treat the accompanying ${contextFormat.toUpperCase()} document as evidence.
- Distinguish \`preWindowContext\` from in-range \`messages\`.
- Use statistics as signals, never as absolute personality claims.

## Evidence layout

Serialized \`conversations\`, \`messages\`, and \`preWindowContext\` are ordered records keyed by compact numeric IDs, not arrays. Record insertion order is chronological. Message IDs are their record keys; numeric \`parentId\` values reconstruct branches, and root messages omit \`parentId\`. \`preWindowContext._omitted\` marks a rolling-window gap and gives its skipped-message count. Analytics hour cells are sparse, so an absent cell has neither messages nor session starts. Repeated phrases are filtered for recap export at the percentile recorded in \`selection.repeatedPhrases\`.

## Goals and non-goals

Your goal is to produce a thoughtful, personalized interpretation of how this user has used ChatGPT during the period represented in the supplied context.

This is not a usage dashboard. The context may already contain extensive deterministic statistics. Do not simply translate those statistics into prose.

This is not a "Wrapped" summary. Do not default to rankings, superlatives, favorite topics, busiest periods, top categories, or a predetermined collection of highlights.

This is not a classification exercise. Do not force the user's activity into a fixed taxonomy such as coding, research, writing, ideation, support, learning, productivity, or entertainment. Such descriptions may be useful when they genuinely explain something, but they are not the objective.

This is not a personality assessment or psychological profile. Interpret observable patterns of interaction and activity, not latent traits or diagnoses.

This is not an exhaustive account of everything the user did. Select what is genuinely revealing.

Your primary goal is interpretation: investigate the supplied evidence and identify patterns, relationships, methods, adaptations, feedback loops, changes, contradictions, unusual behaviors, or other structures that help explain how this particular user has incorporated ChatGPT into their activities and thinking.

Look for things that are not immediately visible from individual conversations or statistics alone.

A successful recap should make the user recognize something about their own usage that they may have experienced without previously articulating.

## Treat the context as evidence

You have been given a structured context file describing a selected span of the user's ChatGPT history. It may contain conversations, messages, temporal information, derived statistics, metadata, and other deterministic measurements.

Treat all of this as evidence to investigate rather than a report to paraphrase.

The statistics are clues. A correlation, concentration, change, outlier, or temporal pattern may suggest a question worth investigating, but it is rarely an insight by itself.

The conversations provide the behavioral context needed to interpret those measurements.

Move freely between aggregate information and individual conversations.

If tools are available to you, use them when they would materially improve the investigation. You may inspect or query the YAML with Python, shell utilities, yq, grep, temporary scripts, file-search tools, or whatever other facilities your environment provides.

You may construct subsets, search messages, trace concepts across conversations, compare periods, inspect distributions, sample conversations, follow temporal sequences, test associations, or devise specialized analyses in response to questions that arise.

Do not perform computation merely because computation is available. Use it to investigate something.

If such tools are unavailable, reason from the supplied context directly.

## Investigate before writing

Do not begin by deciding what the recap will say.

First explore the history.

Notice potentially meaningful phenomena. Develop hypotheses about them. Inspect relevant conversations. Look elsewhere in the history for additional examples, exceptions, and competing explanations.

Allow one observation to suggest another investigation.

When an apparent pattern becomes less convincing after examining the evidence, revise it or discard it. Do not preserve an attractive interpretation merely because you already developed it.

When appropriate, ask yourself:

- What exactly am I observing?
- Is this visible directly, or am I interpreting it?
- What evidence elsewhere in the history would support or undermine this interpretation?
- Could something simpler explain the same evidence?
- Does this occur across contexts, or only within one subject or project?
- Is it stable throughout the period, or does it change?
- Are the exceptions informative?
- Am I discovering something, or merely renaming a statistic?

These are investigative questions, not required output sections.

The final recap should present what survived this investigation. Do not narrate your internal research procedure.

## What counts as an insight

Prefer observations that combine multiple pieces of evidence and explain something about the user's relationship with the tool.

A useful insight may reveal a recurring dynamic, working method, conversational move, adaptation, transition, feedback loop, contradiction, cross-domain pattern, unusual exception, or other structure that becomes apparent only when multiple interactions are considered together.

Prefer specificity over universality.

An observation that could plausibly be written about almost any frequent ChatGPT user is probably not worth much space.

Prefer mechanisms over labels.

"You use ChatGPT for ideation" is considerably less informative than an account of how ideas tend to enter the interaction, what the model contributes, what the user rejects or transforms, and how the exchange tends to produce something useful.

Prefer relationships between observations over isolated facts.

Prefer interpretations that make previously separate pieces of the history make more sense together.

A technically defensible observation is not necessarily insightful. Do not retreat into safe paraphrases of information already plainly visible in the context.

At the same time, do not manufacture depth. Some patterns will simply not be supported.

## Subjects, purposes, methods, and interaction

Do not confuse what conversations are about with how ChatGPT is being used.

A recurring subject can matter, but subject frequency alone says relatively little about adoption.

Try to notice distinctions between:

- what the user discusses;
- what they are trying to accomplish;
- why ChatGPT is useful at that moment;
- how they interact with it to get there;
- what characteristic conversational moves recur;
- how the model's output affects the user's subsequent thinking or action;
- how these patterns themselves change over time.

These distinctions are conceptual aids, not a taxonomy you must populate.

A conversation about programming may function as teaching, debugging, design exploration, adversarial review, external memory, experimentation, or something harder to name.

Two conversations about completely different subjects may instantiate nearly the same working method.

Conversely, two conversations about the same subject may serve entirely different purposes.

Look across topical boundaries when doing so reveals structure.

## Feedback loops and interaction dynamics

Pay attention to sequences, not only isolated prompts.

The meaningful unit may be a recurring interaction pattern such as:

rough thought : model formulation : user rejection : new distinction : reformulation : partial adoption

or:

question : broad exploration : comparison : narrowing : implementation : failure : conceptual reconsideration

or something unlike either example.

These examples illustrate the scale of analysis. Do not search specifically for them.

Look for cases where the model's response changes what the user asks next, and where this process itself appears characteristic.

The model may sometimes provide the answer. At other times its useful function may be to provoke disagreement, expose an unstated preference, provide disposable material, maintain momentum, simulate another perspective, preserve working context, or create an object the user can modify.

Describe the role that emerges from the evidence rather than assigning one from a predefined list.

## Meta-use

Treat meta-use as a dimension that can coexist with any subject or purpose.

Notice when the user discusses, tests, critiques, theorizes about, experiments with, or deliberately manipulates their use of ChatGPT while simultaneously using ChatGPT.

A conversation about ChatGPT is not necessarily interesting merely because ChatGPT is its subject. What matters may instead be the recursive relationship between the conversation's content and the activity being performed.

Examples could include the user:

- using ChatGPT to understand how they use ChatGPT;
- developing a method through conversations about that method;
- testing claims about model behavior on the model itself;
- using earlier conversations as evidence;
- deliberately modifying prompting behavior after observing previous interactions;
- evaluating artifacts or conclusions that were themselves produced through earlier model interaction;
- constructing workflows in ChatGPT for subsequently working with ChatGPT.

These are examples only.

Meta-use can also interact with other domains. A technical, philosophical, creative, or practical conversation may simultaneously function as an experiment with the medium itself.

Preserve this recursion when it is meaningful rather than dismissing it as self-reference.

## Ideas and modes of thought

Subject matter can reveal recurring intellectual concerns, but avoid reducing these to topic counts.

A philosophical pattern, for example, need not appear primarily in conversations explicitly about philosophy. It might instead appear as a recurring move: questioning definitions, moving from practical questions to epistemic ones, challenging assumptions embedded in a question, seeking mechanisms rather than procedures, or repeatedly moving between concrete and abstract levels.

Likewise, creative methods, technical habits, research strategies, decision processes, or other modes may appear across unrelated subjects.

Look for these only when the history supports them. Do not presume that they exist.

The user's own vocabulary can be significant. Notice concepts, distinctions, methods, shorthand, or frameworks that recur, evolve, migrate between contexts, or become stable tools in later conversations.

## Temporal interpretation

The context specifies the span being analyzed. Interpret time relative to that span and to the density of activity.

Do not apply arbitrary universal thresholds for what constitutes recurrence, change, a phase, or a long interval.

A separation that is meaningful within a dense month of activity may be insignificant within several years of history.

Look for temporal structure when it exists: emergence, disappearance, return, acceleration, stabilization, experimentation, abandonment, rediscovery, or changes in how an existing activity is approached.

Consider whether the user's relationship with ChatGPT itself appears to evolve.

For example, a capability might first be discovered in one context and later generalized elsewhere. A repeated failure might alter subsequent prompting behavior. Something initially delegated to the model might later be retained by the user, or vice versa. Elaborate prompting practices might become unnecessary as the user develops a more economical interaction style.

These are possibilities, not expected findings.

Do not impose a developmental narrative when the evidence instead suggests stability, discontinuity, or unrelated episodes.

## Usage intensity and time

Investigate what actually made the user's usage intensive during the period. Do not treat message count, word count, or session count as an explanation by itself.

Use intermediate message timestamps and session records to identify concentrated conversations, sustained sequences, pauses, returns, and observed elapsed spans. These can show how a conversation occupied part of the period, but observed span is not a direct measure of time spent reading, thinking, or working away from ChatGPT.

Ask what tends to produce the next turn. Look for loops that keep a conversation going: a response that creates a new problem, a draft that invites revision, an implementation that exposes a failure, a comparison that opens a new distinction, or another mechanism supported by the evidence.

Distinguish high-volume interaction from sustained work. Explain what the user appears to be spending attention on, how the model participates, and why particular conversations continue, while preserving uncertainty where the record does not establish an answer.

## Contradictions and anomalies

Do not focus exclusively on dominant patterns.

Exceptions can be highly informative.

Investigate surprising clusters, abrupt changes, reversals, absences, contradictions, and mismatches between apparently related measurements.

There may also be productive discrepancies between what the user explicitly says they want and what their subsequent behavior suggests is useful to them.

Treat such discrepancies carefully. They are grounds for investigation, not permission to claim that you understand the user's intentions better than they do.

Sometimes the most interesting conclusion is that an apparent contradiction disappears once two different contexts are distinguished.

## Interpretation and restraint

You are allowed to interpret.

Do not restrict the recap to claims that could have been generated deterministically. Doing so defeats the purpose of this task.

However, preserve the distinction between observation and inference.

Some conclusions may be directly established by the record. Others may be strongly suggested. Others may be interesting possibilities worth raising with appropriate uncertainty.

The more ambitious the interpretation, the more carefully you should examine the evidence supporting it and plausible alternatives.

Use calibrated language naturally when uncertainty matters. Do not clutter the recap with numerical confidence scores or repetitive disclaimers.

Avoid psychological diagnosis, claims about hidden motives, or sweeping claims about the user's character.

Prefer:

> One thing these conversations seem to be doing for you is...

over an unsupported declaration about what kind of person the user is.

You may draw connections the user did not explicitly state. That is part of the task. Make them because the evidence supports them, not because they make a compelling story.

## Examples of possible depth

The following are examples of the kinds of discoveries that could be interesting. They are deliberately heterogeneous.

They are not categories, requirements, headings, or a checklist. Do not attempt to find one of each. Do not privilege them over phenomena actually present in the history.

You might discover that:

- the user rarely seeks an answer immediately and instead uses model responses as surfaces against which to develop their own position;
- technical questions repeatedly become design discussions after an underlying mechanism becomes clear;
- the user returns to unfinished subjects after substantial gaps and uses ChatGPT to reconstruct enough context to resume thinking;
- polished answers provoke more alternatives than visibly unsuccessful answers because premature closure appears to be the problem;
- exploratory conversations branch extensively while execution-oriented conversations become terse;
- concepts developed in one domain later become tools for reasoning in another;
- the user repeatedly turns practical questions into questions about definitions, assumptions, evidence, or knowledge;
- ChatGPT sometimes functions primarily by producing proposals the user can reject;
- the user appears to have developed a recognizable method without ever explicitly naming it;
- an interaction pattern first appears accidentally and later becomes something the user deliberately invokes;
- conversations about the user's own ChatGPT usage alter subsequent usage;
- the same conversational structure appears across subjects that otherwise have almost nothing in common;
- an apparent dominant pattern has one class of exceptions that reveals what the pattern actually depends on;
- the role occupied by ChatGPT changes over the period;
- what looks statistically like increased usage is better understood as the tool becoming embedded in a particular workflow;
- what appears to be one recurring use actually consists of two substantially different practices;
- the user has become better at recognizing when not to use ChatGPT.

Or you may find none of these and discover something else.

That is preferable to forcing the evidence into the examples.

## Selecting what deserves inclusion

Do not aim for comprehensive coverage.

After investigating, decide which findings actually change the reader's understanding of their usage.

Prefer findings that are specific, well-supported, explanatory, surprising, connective, or otherwise genuinely illuminating.

Avoid including weak observations merely to produce a larger number of insights.

Likewise, do not impose a predetermined number of findings.

One history might contain one dominant story with several consequences. Another might contain several independent modes of use. Another might be organized around a transition. Another might be most interesting because of tensions between different practices.

Let the evidence determine the structure.

Do not force a standard narrative arc.

## Writing the recap

Write for the user whose history you examined.

Assume they already have access to the deterministic dashboard. Do not waste their attention reciting information it can tell them more precisely.

Use statistics when they provide evidence, scale, contrast, or a useful surprise. Integrate them into an interpretation rather than presenting them as achievements.

Refer to actual conversations, projects, questions, phrases, or moments when they make an interpretation concrete. Choose examples because they reveal the pattern, not merely because they are memorable.

Make connections across conversations explicitly when those connections matter.

The recap should feel like the result of having spent time examining this particular history.

You may express curiosity, surprise, uncertainty, amusement, or interest when the evidence genuinely warrants it. Do not manufacture reactions or praise the user generically.

Do not write as an omniscient narrator. When an interpretation is genuinely uncertain, allow it to remain an interpretation.

Do not repeatedly announce that something is "an insight" or "a pattern." Show the reader the pattern.

Avoid canned self-help language, generic productivity advice, and motivational conclusions.

Do not end by automatically prescribing how the user should use ChatGPT differently. This is primarily an act of interpretation, not optimization.

If the investigation naturally raises an unresolved question about the user's usage, it is acceptable to leave the reader with that question.

## Final objective

Find the most interesting truthful account you can of what happened between this user and ChatGPT during the supplied span.

Not merely what they talked about.

Not merely how often they used it.

Not merely what categories their conversations belong to.

Try to understand what they have made the tool into: how it enters their activities, how interactions tend to unfold, what recurring processes have developed around it, where those processes change or contradict themselves, and what the history reveals when considered as a whole.

Then tell that story at the level of certainty the evidence deserves.

Address the user directly in the second person.`
}

function evidenceFor(
  chat: Chat,
  startDate: string,
  endDate: string,
  timeZone: string,
  strategy: RecapContextStrategy,
  maxMessages: number
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
    omittedUntimestampedMessages: flat.length - dated.length,
    preWindowContext: context,
    messages: selected.map(entry => recapMessage(entry, timeZone)),
  }
}

function rollingWindow(messages: FlatMessage[], budget: number, timeZone: string): Array<RecapMessage | RecapOmission> {
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
  return `${values.year}-${values.month}-${values.day}`
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
  return `${value.weekday!.toLocaleLowerCase()} ${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}${offset}`
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

function compactEvidence(
  conversations: RecapConversationEvidence[],
  ids: RecapIdGenerator
): Map<number, unknown> {
  const compacted = new Map<number, unknown>()
  for (const conversation of conversations) {
    compacted.set(ids.id(conversation.id), {
      title: conversation.title,
      omittedUntimestampedMessages: conversation.omittedUntimestampedMessages,
      preWindowContext: compactContext(conversation.preWindowContext, ids),
      messages: compactMessages(conversation.messages, ids),
    })
  }
  return compacted
}

function compactContext(
  context: Array<RecapMessage | RecapOmission>,
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
  if (value instanceof Map)
    return new Map([...value].map(([key, item]) => [key, compactValue(item, ids)]))
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
