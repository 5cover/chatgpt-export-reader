import * as z from 'zod';
import type * as my from '../types.js';
import { readFileSync } from 'node:fs';

const zId = z.string().nonempty();

type Message = z.infer<typeof zMessage>;
const zMessage = z.object({
    children: z.array(zId),
    message: z
        .object({
            id: zId,
            weight: z.number(),
            create_time: z.number().nullable(),
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
            ]),
        })
        .nullable(),
});

type Chat = z.infer<typeof zChat>;
const zChat = z.object({
    id: zId,
    title: z.string(),
    create_time: z.number(),
    update_time: z.number(),
    mapping: z.record(zId, zMessage).and(
        z.object({
            'client-created-root': zMessage,
        }),
    ),
});

export default {
    parse: filename => {
        const data = JSON.parse(readFileSync(filename, 'utf8'));

        const schema = z.array(zChat);

        return schema.parse(data).map(m => convertChat(m));
    },
} satisfies my.Input;

function convertChat(m: Chat): my.Chat {
    const { messages, userInstructions } = convertMessage(m.mapping, m.mapping['client-created-root']);
    return {
        id: m.id,
        title: m.title,
        createTime: m.create_time,
        updateTime: m.update_time,
        firstMessage: single(messages),
        userInstructions,
    };
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
            const body = m.message.content.parts.join('');
            return {
                userInstructions,
                messages: body
                    ? [
                          {
                              id: m.message.id,
                              body: m.message.content.parts.join(''),
                              createTime: m.message.create_time ?? throwf('create_time null'),
                              weight: m.message.weight,
                              role: m.message.author.role,
                              children: childrenMessages,
                          },
                      ]
                    : childrenMessages,
            };
        case 'user_editable_context':
            return {
                messages: childrenMessages,
                userInstructions: m.message.content.user_instructions,
            };
        default:
            return { messages: childrenMessages, userInstructions: userInstructions };
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
