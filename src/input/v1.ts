import * as z from 'zod';
import type * as my from '../types.js';
import { createReadStream } from 'node:fs';
import chain from 'stream-chain';
import { parser } from 'stream-json';
import streamArray from 'stream-json/streamers/stream-array.js';
import { exit } from 'node:process';

const zId = z.string();
const zTimestamp = z.number().transform(x => x * 1000);

type MessagePayload = z.infer<typeof MessagePayload>;
const MessagePayload = z.object({
    id: zId,
    weight: z.number(),
    create_time: zTimestamp.nullable(),
    author: z.object({
        role: z.string(),
    }),
    content: z.union([
        z.object({
            content_type: z.literal('text'),
            parts: z.tuple([z.string()]),
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
});

type Message = z.infer<typeof zMessage>;
const zMessage = z.object({
    parent: zId.nullable(),
    children: z.array(zId),
    message: MessagePayload.nullable(),
});

type Chat = z.infer<typeof zChat>;
const zChat = z.object({
    id: zId,
    title: z.string(),
    create_time: zTimestamp,
    update_time: zTimestamp,
    mapping: z.record(zId, zMessage),
});

export default {
    async *parse(filename: string): AsyncGenerator<my.Chat> {
        const pipeline = chain([createReadStream(filename, { encoding: 'utf8' }), parser(), streamArray()]);
        for await (const chunk of pipeline) {
            const raw = chunk.value;
            const result = zChat.safeParse(raw);
            if (!result.success) {
                console.error('Invalid chat at array index', chunk.key, result.error, JSON.stringify(raw));
                continue;
                exit();
            }
            try {
                yield convertChat(result.data);
            } catch (e) {
                console.error('failed to convert:', chunk.key, e, JSON.stringify(raw));
                exit();
            }
        }
    },
} satisfies my.Input;

function convertChat(m: Chat): my.Chat {
    const root = findRoot(m.mapping);
    const { messages, userInstructions } = convertMessage(m.mapping, root);
    return {
        id: m.id,
        title: m.title,
        createTime: m.create_time,
        updateTime: m.update_time,
        firstMessage: single(messages),
        userInstructions,
    };
}

function findRoot(m: Chat['mapping']) {
    let rootId: string | null = null;
    let root: Message | null = null;
    for (const id in m) {
        const msg = m[id]!;
        const parentId = msg.parent;
        if (parentId === null) {
            if (root !== null) throwf(`root already found at ${rootId}, but ${id} also has null parent`);
            rootId = parentId;
            root = msg;
        }
    }
    return root ?? throwf(`no root message found`);
}

function convertMessage(
    msgs: Chat['mapping'],
    m: Message,
): {
    messages: my.Message[];
    userInstructions?: string;
} {
    const children = m.children.map(id =>
        convertMessage(msgs, msgs[id] ?? throwf(`children message not found: ${id}`)),
    );
    const userInstructions = children.reduce<string | undefined>(
        (cur, c) =>
            c.userInstructions === undefined
                ? cur
                : cur === undefined
                  ? c.userInstructions
                  : throwf('multiple user instructions detected'),
        undefined,
    );
    const childrenMessages = children.flatMap(c => c.messages);
    switch (m.message?.content.content_type) {
        case 'text':
            return messageObject(m.message, m.message.content.parts.join(''));
        case 'execution_output':
            return messageObject(m.message, m.message.content.text);
        case 'code':
            return messageObject(
                m.message,
                `\`\`\`${m.message.content.language}
${m.message.content.text}
\`\`\``,
            );
        case 'user_editable_context':
            return {
                messages: childrenMessages,
                userInstructions: m.message.content.user_instructions,
            };
        case 'thoughts':
            // assert one children, attach thoughts to next message
            if (childrenMessages.length !== 0) {
                if (childrenMessages.length !== 1) {
                    throwf('thoughts message has !=1 children');
                }
                childrenMessages[0]!.thoughts = m.message.content.thoughts;
            }
        default:
            return { messages: childrenMessages, userInstructions: userInstructions };
    }
    function messageObject(m: MessagePayload, body: string) {
        return {
            userInstructions,
            messages: body
                ? [
                      {
                          id: m.id,
                          body,
                          createTime: m.create_time ?? undefined,
                          weight: m.weight,
                          model:
                              [m.metadata.model_slug, m.metadata.thinking_effort]
                                  .filter(x => x !== undefined)
                                  .join(' ') || undefined,
                          role: m.author.role,
                          children: childrenMessages,
                      },
                  ]
                : childrenMessages,
        };
    }
}

function throwf(x: unknown): never {
    throw typeof x === 'string' ? new Error(x) : x;
}

// Only 1 iteration, no scratch array
function filtermap<T, U>(src: readonly T[], map: (item: T, i: number, array: readonly T[]) => U | undefined) {
    const dst: U[] = [];
    src.forEach((x, i, src) => {
        const y = map(x, i, src);
        if (y !== undefined) dst.push(y);
    });
    return dst;
}

function single<T>(src: readonly T[]) {
    const y = src[0];
    if (y === undefined || src.length !== 1) throw new Error(`array is not singleton: ${src}`);
    return y;
}
