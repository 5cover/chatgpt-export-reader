import * as z from 'zod'
import type { UsageConversationInput, UsageMessageInput } from './usage-stats.js'
import type { Chat, Message, Thought } from './types.js'

const zId = z.string()
const zTimestamp = z.number().transform(value => value * 1000)

const V1MessagePayload = z.object({
    weight: z.number().optional(),
    create_time: zTimestamp.nullable(),
    author: z.object({ role: z.string() }),
    content: z.union([
        z.object({ content_type: z.literal('text'), parts: z.array(z.string()) }),
        z.object({ content_type: z.literal('user_editable_context'), user_instructions: z.string() }),
        z.object({
            content_type: z.literal('thoughts'),
            thoughts: z.array(z.object({ summary: z.string(), content: z.string(), chunks: z.array(z.string()) })),
        }),
        z.object({ content_type: z.literal('reasoning_recap'), content: z.string() }),
        z.object({ content_type: z.literal('code'), language: z.string(), text: z.string() }),
        z.object({ content_type: z.literal('execution_output'), text: z.string() }),
        z.object({ content_type: z.literal('multimodal_text') }),
        z.object({ content_type: z.enum(['tether_browsing_display', 'tether_quote', 'system_error']) }),
    ]),
    metadata: z.object({ model_slug: z.string().optional(), thinking_effort: z.string().optional() }).optional(),
})

const V1Message = z.object({
    id: zId,
    parent: zId.nullable(),
    message: V1MessagePayload.nullable(),
})

const V1Chat = z.object({
    id: zId,
    title: z.string(),
    create_time: zTimestamp,
    update_time: zTimestamp,
    mapping: z.record(zId, V1Message),
    conversation_template_id: z.string().nonempty().nullable(),
    is_archived: z.boolean().nullish(),
})

type RawChat = z.infer<typeof V1Chat>
type RawMessage = z.infer<typeof V1Message>

export function isEmptyV1Record(value: unknown): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0
}

export function normalizeV1Chat(raw: unknown): Chat {
    const result = V1Chat.safeParse(raw)
    if (!result.success) throw new Error(result.error.message)

    const source = result.data
    const root = findRoot(source.mapping)
    const childrenByParent = indexChildren(source.mapping)
    return {
        id: source.id,
        title: source.title,
        createTime: source.create_time,
        updateTime: source.update_time,
        messages: convertMessages(source.mapping, root, childrenByParent),
        projectName: source.conversation_template_id ?? undefined,
        isArchived: source.is_archived ?? false,
    }
}

/**
 * Extract only the fields required for statistics. This avoids validating and
 * materializing message bodies when an interactive dashboard needs counts only.
 */
export function extractV1UsageConversation(raw: unknown): UsageConversationInput {
    const chat = asRecord(raw, 'chat')
    const id = asString(chat.id, 'chat.id')
    const title = asString(chat.title, 'chat.title')
    const mapping = asRecord(chat.mapping, 'chat.mapping')
    const messages: UsageMessageInput[] = []

    for (const [nodeId, node] of Object.entries(mapping)) {
        const envelope = asRecord(node, `chat.mapping.${nodeId}`)
        if (envelope.message === null) continue
        const message = asRecord(envelope.message, `chat.mapping.${nodeId}.message`)
        const author = asRecord(message.author, `chat.mapping.${nodeId}.message.author`)
        const content = asRecord(message.content, `chat.mapping.${nodeId}.message.content`)
        const role = asString(author.role, `chat.mapping.${nodeId}.message.author.role`)
        if (!isCountableContent(content)) continue

        const createTime = message.create_time
        messages.push({
            role,
            createTime: createTime === null || createTime === undefined ? undefined : asNumber(createTime, `chat.mapping.${nodeId}.message.create_time`) * 1000,
        })
    }

    return { id, title, messages }
}

function findRoot(mapping: RawChat['mapping']): RawMessage {
    let root: RawMessage | undefined
    for (const message of Object.values(mapping)) {
        if (message.parent !== null) continue
        if (root !== undefined) throw new Error(`multiple root messages: ${root.id}, ${message.id}`)
        root = message
    }
    if (root === undefined) throw new Error('no root message found')
    return root
}

function indexChildren(mapping: RawChat['mapping']): Map<string, string[]> {
    const childrenByParent = new Map<string, string[]>()
    for (const id of Object.keys(mapping)) childrenByParent.set(id, [])
    for (const message of Object.values(mapping)) {
        if (message.parent === null) continue
        const children = childrenByParent.get(message.parent)
        if (children === undefined) throw new Error(`parent message not found: ${message.parent}`)
        children.push(message.id)
    }
    return childrenByParent
}

function convertMessages(
    messages: RawChat['mapping'],
    root: RawMessage,
    childrenByParent: ReadonlyMap<string, readonly string[]>,
): Message[] {
    type Context = { customInstructions?: string }
    type Frame = {
        message: RawMessage
        context: Context
        state: 'enter' | 'exit'
        children?: Message[]
    }

    const stack: Frame[] = [{ message: root, context: {}, state: 'enter' }]
    const path = new Set<string>()
    const results = new Map<string, Message[]>()

    while (stack.length > 0) {
        const frame = stack.pop()!
        if (frame.state === 'enter') {
            if (path.has(frame.message.id)) throw new Error(`message cycle on ${frame.message.id}`)
            path.add(frame.message.id)
            stack.push({ ...frame, state: 'exit' })
            const childContext = nextContext(frame.message, frame.context)
            const childIds = childrenByParent.get(frame.message.id) ?? []
            for (let index = childIds.length - 1; index >= 0; index--) {
                const childId = childIds[index]!
                const child = messages[childId]
                if (child === undefined) throw new Error(`child message not found: ${childId}`)
                stack.push({ message: child, context: childContext, state: 'enter' })
            }
            continue
        }

        path.delete(frame.message.id)
        const children = (childrenByParent.get(frame.message.id) ?? []).flatMap(childId => results.get(childId) ?? [])
        results.set(frame.message.id, materializeMessage(frame.message, frame.context, children))
    }

    return results.get(root.id) ?? []
}

function nextContext(message: RawMessage, context: { customInstructions?: string }): { customInstructions?: string } {
    if (message.message?.content.content_type !== 'user_editable_context') return context
    return {
        ...context,
        customInstructions: message.message.content.user_instructions.replaceAll('```', ''),
    }
}

function materializeMessage(message: RawMessage, context: { customInstructions?: string }, children: Message[]): Message[] {
    const payload = message.message
    if (payload === null) return children

    let body: string | undefined
    let thoughts: Thought[] | undefined
    switch (payload.content.content_type) {
        case 'text':
            body = payload.content.parts.join('')
            break
        case 'execution_output':
            body = payload.content.text
            break
        case 'code':
            body = `\`\`\`${payload.content.language}\n${payload.content.text}\n\`\`\``
            break
        case 'thoughts':
            thoughts = payload.content.thoughts
            break
        default:
            return children
    }

    if (thoughts !== undefined) {
        if (children[0]) children[0].thoughts = thoughts
        return children
    }
    if (!body) return children

    return [
        {
            id: message.id,
            body,
            customInstructions: context.customInstructions,
            createTime: payload.create_time ?? undefined,
            weight: payload.weight ?? 1,
            model:
                [payload.metadata?.model_slug, payload.metadata?.thinking_effort]
                    .filter((value): value is string => value !== undefined)
                    .join(' ') || undefined,
            role: payload.author.role,
            children,
        },
    ]
}

function isCountableContent(content: Record<string, unknown>): boolean {
    const type = content.content_type
    if (type === 'code') return typeof content.language === 'string' && typeof content.text === 'string'
    if (type === 'execution_output') return typeof content.text === 'string' && content.text.length > 0
    if (type !== 'text' || !Array.isArray(content.parts)) return false
    return content.parts.every(part => typeof part === 'string') && content.parts.join('').length > 0
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
    return value as Record<string, unknown>
}

function asString(value: unknown, path: string): string {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`)
    return value
}

function asNumber(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
    return value
}
