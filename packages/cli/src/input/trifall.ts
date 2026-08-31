import * as fs from 'fs'
import * as path from 'path'
import * as z from 'zod'
import type * as my from '../types.js'
import { tersen, TITLE_MAXLEN } from '../lib/util.js'

const zExport = z.object({
    messages: z.array(
        z.object({
            role: z.string(),
            content: z.string(),
        }),
    ),
})

export default {
    parse,
    parseFile,
} satisfies my.Input

async function* parse(exportDir: string): AsyncGenerator<my.Chat> {
    const conversationFiles = fs.globSync('*.json', {
        cwd: exportDir,
        withFileTypes: true,
        exclude: entry => !entry.isFile(),
    })
    for (const ent of conversationFiles) {
        yield* parseFile(path.join(exportDir, ent.name))
    }
}

async function* parseFile(filename: fs.PathLike): AsyncGenerator<my.Chat> {
    const raw = await fs.promises.readFile(filename, 'utf8')
    const parsed = zExport.safeParse(JSON.parse(raw) as unknown)
    if (!parsed.success) {
        throw new Error(`invalid trifall export in ${filename.toString()}: ${parsed.error.message}`)
    }
    yield convertChat(parsed.data, filename.toString())
}

function convertChat(source: z.infer<typeof zExport>, filename: string): my.Chat {
    const messages: my.Message[] = source.messages.flatMap((message, index) => {
        const body = message.content.trim()
        if (!body) return []

        return [
            {
                id: `${path.basename(filename, path.extname(filename))}.${index + 1}`,
                role: message.role,
                body,
                weight: 1,
                children: [] as my.Message[],
            } satisfies my.Message,
        ]
    })

    for (let i = 0; i < messages.length - 1; i++) {
        messages[i]!.children.push(messages[i + 1]!)
    }

    const firstUserMessage = source.messages.find(message => message.role === 'user')?.content.trim()
    const fallbackTitle = path.basename(filename, path.extname(filename))

    return {
        id: fallbackTitle,
        title: firstUserMessage ? tersen(firstUserMessage, TITLE_MAXLEN) : fallbackTitle,
        createTime: 0,
        updateTime: 0,
        messages: messages[0] ? [messages[0]] : [],
        isArchived: false,
    }
}
