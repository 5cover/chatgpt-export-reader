import * as fs from 'fs'
import * as path from 'path'
import { exit } from 'process'
import chain from 'stream-chain'
import { parser } from 'stream-json'
import streamArray, { type StreamArrayItem } from 'stream-json/streamers/stream-array.js'
import * as z from 'zod'
import type * as my from '../types.js'

const zId = z.string()
const zTimestamp = z.number().transform(x => x * 1000)

type MessagePayload = z.infer<typeof MessagePayload>
const MessagePayload = z.object({
    weight: z.number(),
    create_time: zTimestamp.nullable(),
    author: z.object({
        role: z.string(),
    }),
    content: z.union([
        z.object({
            content_type: z.literal('text'),
            parts: z.array(z.string()),
        }),
        z.object({
            content_type: z.literal('user_editable_context'),
            user_instructions: z.string(),
        }),
        z.object({
            content_type: z.literal('thoughts'),
            thoughts: z.array(
                z.object({
                    summary: z.string(),
                    content: z.string(),
                    chunks: z.array(z.string()),
                }),
            ),
        }),
        z.object({
            // just the thinking duration: ignored
            content_type: z.literal('reasoning_recap'),
            content: z.string(),
        }),
        z.object({
            content_type: z.literal('code'),
            language: z.string(),
            text: z.string(),
        }),
        z.object({
            content_type: z.literal('execution_output'),
            text: z.string(),
        }),
        z.object({
            // todo: for later: images
            content_type: z.literal('multimodal_text'),
        }),
        z.object({
            // custom formats for source files provided by the user
            content_type: z.enum(['tether_browsing_display', 'tether_quote', 'system_error']),
        }),
    ]),
    metadata: z.object({
        model_slug: z.string().optional(),
        thinking_effort: z.string().optional(),
    }),
})

type Message = z.infer<typeof zMessage>
const zMessage = z.object({
    id: zId,
    parent: zId.nullable(),
    children: z.array(zId),
    message: MessagePayload.nullable(),
})

type Chat = z.infer<typeof zChat>
const zChat = z.object({
    id: zId,
    title: z.string(),
    create_time: zTimestamp,
    update_time: zTimestamp,
    mapping: z.record(zId, zMessage),
    conversation_template_id: z.string().nonempty().nullable(),
    is_archived: z.boolean().nullish(),
})

export default {
    parse,
    parseFile,
} satisfies my.Input

async function* parse(exportDir: string) {
    const conversationFiles = fs.globSync('conversations*.json', {
        cwd: exportDir,
        withFileTypes: true,
        exclude: f => !f.isFile(),
    })
    for (const ent of conversationFiles) {
        yield* parseFile(path.join(exportDir, ent.name))
    }
}
async function* parseFile(filename: fs.PathLike): AsyncGenerator<my.Chat> {
    const pipeline = chain([
        fs.createReadStream(filename, { encoding: 'utf8' }),
        parser(),
        streamArray(),
    ]) as AsyncIterable<StreamArrayItem>
    for await (const chunk of pipeline) {
        const raw = chunk.value as unknown
        const result = zChat.safeParse(raw)
        if (!result.success) {
            console.error('Invalid chat at array index', chunk.key, result.error, JSON.stringify(raw))
            continue
        }
        try {
            yield convertChat(result.data)
        } catch (e) {
            console.error('failed to convert:', chunk.key, e, JSON.stringify(raw))
            exit()
        }
    }
}
function convertChat(m: Chat): my.Chat {
    const root = findRoot(m.mapping)
    return {
        id: m.id,
        title: m.title,
        createTime: m.create_time,
        updateTime: m.update_time,
        messages: convertMessages(m.mapping, root),
        projectName: m.conversation_template_id ?? undefined,
        isArchived: m.is_archived ?? false,
    }
}

function findRoot(m: Chat['mapping']) {
    let rootId: string | null = null
    let root: Message | null = null
    for (const id in m) {
        const msg = m[id]!
        const parentId = msg.parent
        if (parentId === null) {
            if (root !== null) throwf(`root already found at ${rootId}, but ${id} also has null parent`)
            rootId = id
            root = msg
        }
    }
    return root ?? throwf(`no root message found`)
}

function convertMessages(msgs: Chat['mapping'], root: Message): my.Message[] {
    type Ctx = { customInstructions?: string }
    type Frame = {
        msg: Message
        ctx: Ctx
        childIndex: number | null
        parent?: Frame
        state: 'enter' | 'exit'
        childrenCtx?: Ctx
        childResults?: my.Message[][]
        result?: my.Message[]
    }

    const stack: Frame[] = [{ msg: root, ctx: {}, childIndex: null, state: 'enter' }]
    const path = new Set<string>()
    let finalResult: my.Message[] | undefined

    while (stack.length > 0) {
        const frame = stack.pop()!
        if (frame.state === 'enter') {
            if (path.has(frame.msg.id)) throwf(`message cycle on ${frame.msg.id}`)
            path.add(frame.msg.id)

            const childrenCtx = nextContext(frame.msg, frame.ctx)
            frame.state = 'exit'
            frame.childrenCtx = childrenCtx
            frame.childResults = new Array(frame.msg.children.length)
            stack.push(frame)

            for (let i = frame.msg.children.length - 1; i >= 0; i--) {
                const childId = frame.msg.children[i]!
                const child = msgs[childId] ?? throwf(`children message not found: ${childId}`)
                stack.push({ msg: child, ctx: childrenCtx, childIndex: i, parent: frame, state: 'enter' })
            }
            continue
        }

        path.delete(frame.msg.id)
        if (frame.childResults === undefined) throwf(`missing child results for ${frame.msg.id}`)

        const children = frame.childResults.flatMap(x => x)
        frame.result = materializeMessage(frame.msg, frame.ctx, children)

        if (stack.length === 0) {
            finalResult = frame.result
            continue
        }

        const parent = frame.parent
        if (parent === undefined) throwf(`missing parent for ${frame.msg.id}`)
        if (parent.state !== 'exit' || parent.childResults === undefined) {
            throwf(`invalid traversal state for ${frame.msg.id}`)
        }
        if (frame.childIndex === null) throwf(`missing child index for ${frame.msg.id}`)
        parent.childResults[frame.childIndex] = frame.result
    }

    return finalResult ?? []
}

function nextContext(m: Message, ctx: { customInstructions?: string }) {
    if (m.message?.content.content_type === 'user_editable_context') {
        return {
            ...ctx,
            customInstructions: m.message.content.user_instructions.replaceAll('```', ''),
        }
    }
    return ctx
}

function materializeMessage(m: Message, ctx: { customInstructions?: string }, children: my.Message[]): my.Message[] {
    switch (m.message?.content.content_type) {
        case 'text':
            return messages(m.message.content.parts.join(''))
        case 'execution_output':
            return messages(m.message.content.text)
        case 'code':
            return messages(`\`\`\`${m.message.content.language}
${m.message.content.text}
\`\`\``)
        case 'thoughts':
            if (children[0]) children[0].thoughts = m.message.content.thoughts
            return children
        default:
            return children
    }

    function messages(body: string): my.Message[] {
        return m.message && body ?
                [
                    {
                        id: m.id,
                        body,
                        customInstructions: ctx.customInstructions,
                        createTime: m.message.create_time ?? undefined,
                        weight: m.message.weight,
                        model:
                            [m.message.metadata.model_slug, m.message.metadata.thinking_effort]
                                .filter(x => x !== undefined)
                                .join(' ') || undefined,
                        role: m.message.author.role,
                        children,
                    },
                ]
            :   children
    }
}

function throwf(x: unknown): never {
    throw typeof x === 'string' ? new Error(x) : x
}
