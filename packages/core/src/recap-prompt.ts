import { recapContextSchemaYaml } from './recap-schema.js'
import type { RecapContextFormat } from './recap.js'

export type RecapPromptModuleDefinition = {
  description: string
  prompt: string | readonly string[]
}

export const recapPromptModuleDefinitions = {
  context: {
    description: 'Documents the evidence schema and shared YAML anchor references. Always included.',
    prompt: contextFormatPrompt(),
  },
  interpretation: {
    description: 'Develop a reflective account rather than a factual inventory. Omit for a simple activity list.',
    prompt: [
      'Goals and non-goals',
      'What counts as an insight',
      'Interpretation and restraint',
      'Examples of possible depth',
    ],
  },
  investigation: {
    description: 'Test hypotheses, exceptions, and competing explanations. Omit for a quick recap.',
    prompt: ['Treat the context as evidence', 'Investigate before writing', 'Contradictions and anomalies'],
  },
  interaction: {
    description: 'Trace methods, feedback loops, and collaboration. Omit for topic-only coverage.',
    prompt: [
      'Subjects, purposes, methods, and interaction',
      'Feedback loops and interaction dynamics',
      'Meta-use',
      'Ideas and modes of thought',
    ],
  },
  temporal: {
    description: 'Explain changes over time. Omit when the period is too brief to establish change.',
    prompt: ['Temporal interpretation', 'Usage intensity and time'],
  },
  writing: {
    description: 'Shape findings into a coherent written story. Omit for lists or image-only output.',
    prompt: ['Selecting what deserves inclusion', 'Writing the recap', 'Final objective'],
  },
  themes: {
    description: 'Identify recurring subjects and projects. Omit when topics are not the focus.',
    prompt:
      '## Recurring themes\nIdentify distinctive recurring subjects and projects, supported by concrete examples. Explain meaningful changes rather than producing only frequency rankings.',
  },
  behavior: {
    description: 'Find repeated user and assistant moves. Omit for a subject-only summary.',
    prompt:
      '## Interaction patterns\nTrace repeated behaviors by the user or assistant, including revisions, feedback loops, and changes in working method. Distinguish what conversations concern from how ChatGPT is used.',
  },
  friction: {
    description: 'Investigate corrections and costly loops without assuming frustration. Omit if these are outside your purpose.',
    prompt:
      '## Friction points\nIdentify recurrent misunderstandings, corrections, abandoned approaches, or costly loops. Include counterexamples and avoid inferring frustration without evidence.',
  },
  prompting: {
    description: 'Examine languages, formats, and instruction habits. Omit if prompt craft is irrelevant.',
    prompt:
      '## Prompting style\nAnalyze languages, recurring formats, constraints, instruction patterns, and how prompting changes across the period. Ground claims in actual prompts.',
  },
  recommendations: {
    description: 'Suggest evidence-based workflow alternatives and their tradeoffs. Omit for a descriptive recap.',
    prompt:
      '## Workflow opportunities\nSuggest practical alternative approaches or improvements only where the evidence supports a likely benefit. Explain tradeoffs; do not prescribe a universal ideal usage pattern.',
  },
  room: {
    description: 'Generate a visual room portrait. Attach a room image to preserve its architecture, or allow a new room. Omit for text-only output.',
    prompt:
      '## Room portrait\nCreate an image representing the period as a coherent inhabited room. If an empty-room image is attached, preserve its architecture, perspective, and layout while furnishing it from the evidence; otherwise create a room from scratch. Use recognizable objects, arrangements, and subtle visual references to represent activities and projects. Avoid infographic elements, explanatory labels, statistics, and large text in the image. Make the image the primary recap and accompany it with a concise explanation tying significant visual choices to evidence.',
  },
  analysis: {
    description: 'Investigate the structured context systematically with tools and verify conclusions against source messages.',
    prompt: `# Analyzing the recap context

The supplied recap context is a structured dataset of conversations, not a document that must be read sequentially.

Use the accompanying schema documentation to understand its fields, relationships, coverage, and limitations.

## Use tools to investigate the data

When tools are available, use them proactively to inspect and navigate the context. Do not rely solely on the portions of the file that are immediately visible or convenient to read.

Depending on the environment and the question being investigated, useful techniques include:

- Parsing YAML with Python or JavaScript to access records programmatically.
- Converting parsed YAML to JSON for inspection with tools such as \`yq\` or \`jq\`.
- Extracting conversation inventories, message counts, roles, and branch relationships.
- Creating temporary files containing selected conversations or message ranges.
- Extracting user messages for an initial overview, then retrieving surrounding exchanges to understand their meaning.
- Searching for exact terms, recurring subjects, or references to earlier work.
- Comparing related messages or alternative branches.
- Checking extracted records against the statistics supplied in the export.
- Returning to original message text to verify significant findings.

These are examples, not an exhaustive list or a prescribed sequence. Use other techniques when they are more appropriate. Do not limit the investigation to the tools, operations, or patterns mentioned here.

## Adapt the investigation to the task

Start by understanding the structure and scope of the available evidence.

Establish broad coverage of the conversations before selecting material for deeper analysis. Do not assume that the largest conversations, earliest visible messages, or conversation titles identify everything important.

Allocate detailed attention according to the recap objective. Some questions require inspecting conversational sequences and branches; others benefit from comparing projects, tracing recurring subjects, or examining particular artifacts.

You do not need to read every assistant response in full. However, user messages must be interpreted in context: a short instruction can depend on a long preceding exchange.

Use temporary intermediate representations when they help, but do not mistake those representations for the original evidence.

## Handle structured data correctly

Preserve the distinctions established by the schema, especially message identity, conversation branches, selected-period activity, earlier context, and omitted material.

YAML may contain anchors and aliases. Use a parser that supports them. Resolve references before partitioning or converting the data when necessary. Do not treat aliases as missing content or independent events.

Do not assume that a successful parse establishes complete extraction. Where practical, verify record counts and investigate discrepancies.

## Keep conclusions grounded

Distinguish what the user supplied, what the assistant generated, and what emerged through their interaction.

Verify consequential interpretations against relevant original messages. Look beyond the first supporting example, and consider evidence that complicates an emerging conclusion.

If the available tools, missing context, or corpus size prevent a sufficiently thorough investigation, acknowledge the resulting limits rather than implying comprehensive coverage.

The objective is to investigate the supplied evidence efficiently and reliably—not to follow a fixed checklist, reproduce the dataset at smaller scale, or perform every example operation listed above.
`,
  },
} as const satisfies Record<string, RecapPromptModuleDefinition>

export type RecapPromptModule = keyof typeof recapPromptModuleDefinitions

export const recapPromptModules = Object.freeze(
  Object.keys(recapPromptModuleDefinitions) as RecapPromptModule[]
)

export function createRecapPrompt(
  contextFormat: RecapContextFormat = 'yaml',
  modules?: readonly RecapPromptModule[]
): string {
  if (!['yaml', 'yaml-anchors', 'toon'].includes(contextFormat))
    throw new RangeError(`unknown recap context format: ${contextFormat}`)
  if (modules === undefined) return legacyRecapPrompt(contextFormat)
  const unknown = modules.find(module => !Object.hasOwn(recapPromptModuleDefinitions, module))
  if (unknown) throw new RangeError(`unknown recap module: ${unknown}`)
  const core = `# ChatGPT Usage Recap

Treat the accompanying ${contextFormatName(contextFormat)} file as evidence. Its conversations, messages, and preWindowContext are ordered records keyed by numeric IDs, not arrays; evidence message order follows source-tree traversal, not chronological order. Follow parentId to reconstruct branches. preWindowContext is earlier context, not activity in the selected period; _omitted marks missing history. Statistics support investigation but are not definitive descriptions of the user. Inspect specific conversations before drawing conclusions, distinguish observation from inference, and do not invent unsupported traits.\n\n`
  const sections = legacyRecapPrompt(contextFormat)
    .split(/(?=^## )/m)
    .slice(2)
  return (
    core +
    analysisProcedurePrompt() +
    '\n\n' +
    recapPromptModules
      .filter(module => module === 'context' || modules.includes(module))
      .map(module => {
        const body = recapPromptModuleDefinitions[module].prompt
        return typeof body === 'string'
          ? body
          : sections.filter(section => body.some(heading => section.startsWith(`## ${heading}\n`))).join('\n')
      })
      .join('\n\n') +
    '\n'
  )
}

function contextFormatPrompt(): string {
  return `## Context format

The following JSON Schema is the contract for the attached context. YAML record keys may be numeric; treat them as identifiers, not list indexes. Compact message IDs are document-local and reused by parent references. The \`messages\` records contain selected-range evidence in source-tree traversal order, not chronological order; \`preWindowContext\` contains earlier evidence and an optional \`_omitted\` count marking missing history. The analytics section describes only selected-range messages and counts each source message object once per conversation. YAML anchors and aliases mark shared equivalent structures, not duplicate conversations or messages. The \`wc\` scalar contains word count followed by character count.

\`\`\`yaml
${recapContextSchemaYaml.trimEnd()}
\`\`\``
}

function analysisProcedurePrompt(): string {
  return `## Analysis procedure

Understand the schema and selection metadata first. Establish the export's date coverage and identify missing context, including \`preWindowContext._omitted\` and untimestamped-message counts. Before forming an interpretation, review user messages across every conversation in the selected range and build a coverage inventory; do not choose a few conversations arbitrarily and generalize from them. Then inspect assistant replies, preceding context, and branch paths selectively to understand relevant exchanges, keeping user-authored activity distinct from assistant output.

If the context is too large to inspect directly, use available tools to partition it into manageable temporary views, initially by conversation and then at message boundaries as needed. Preserve message IDs and parent references, and process every partition before deciding what matters; arbitrary sampling is not a substitute for coverage. Revisit source passages that support important conclusions, check for counterexamples, and distinguish observation from inference.`
}

function legacyRecapPrompt(contextFormat: RecapContextFormat): string {
  return `# ChatGPT Usage Recap: Investigator Prompt

- Treat the accompanying ${contextFormatName(contextFormat)} document as evidence.
- Distinguish \`preWindowContext\` from in-range \`messages\`.
- Use statistics as signals, never as absolute personality claims.

## Evidence layout

Serialized \`conversations\`, \`messages\`, and \`preWindowContext\` are ordered records keyed by compact numeric IDs, not arrays. Evidence message order follows source-tree traversal, not chronological order. Numeric \`parentId\` values reconstruct branches, and root messages omit \`parentId\`. \`preWindowContext._omitted\` marks a rolling-window gap and gives its skipped-message count. Analytics count each source message object once per conversation; repeated references to the same object are deduplicated. Analytics hour cells are sparse, so an absent cell has neither messages nor session starts. Repeated phrases are filtered for recap export at the percentile recorded in \`selection.repeatedPhrases\`.

${contextFormatPrompt()}

${analysisProcedurePrompt()}

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

function contextFormatName(format: RecapContextFormat): string {
  return format === 'yaml-anchors' ? 'YAML with anchors' : format.toUpperCase()
}
