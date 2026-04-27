import { DefaultPrimitiveMap } from '@5cover/moremaps'
import { mkdir, writeFile } from 'fs/promises'
import p from 'path'
import { linearizeChat, type LinearDocument } from '../lib/linearizer.js'
import * as md from '../lib/markdown-builder.js'
import { mapfilter, sanitize, type Falsey } from '../lib/util.js'
import type { Chat, Output } from '../types.js'
export type Options = {
    directory: string
}

const dirsMade = new Set<string>()

export default class Markdown implements Output {
    private readonly dir: string
    constructor(options: Options) {
        this.dir = p.resolve(options.directory)
    }

    private readonly seenPaths = new DefaultPrimitiveMap<string, number>(() => 0)

    async write(chats: AsyncIterable<Chat>) {
        for await (const chat of chats) {
            console.log(chat.title)
            this.writeChat(chat)
        }
    }

    private writeChat(chat: Chat) {
        const docs = linearizeChat(chat)
        const dirname = this.deduplicatePath(
            p.join(
                this.dir,
                ...mapfilter<string | Falsey, string | Falsey, string>(
                    [chat.isArchived && 'archived', chat.projectName, chat.title],
                    d => d && sanitize(d),
                    (d): d is string => !!d,
                ),
            ),
        )
        if (docs.length === 0) throw new Error(`no documents linearized for chat: ${chat.title}`)
        if (docs.length === 1) {
            void this.writeFile(dirname, { ext: '.md' }, toMarkdown(docs[0]!))
        } else {
            void docs.map(doc => this.writeFile(dirname, { name: docFilename(doc) }, toMarkdown(doc)))
        }
    }

    private async writeFile(dirname: string, file: { name?: string; ext?: string }, content: string) {
        const path = file.name ? p.join(dirname, file.name) : dirname
        await this.mkdir(file.name ? dirname : p.dirname(dirname))
        await writeFile(path + (file.ext ?? ''), content)
    }

    private deduplicatePath(name: string) {
        const n = this.seenPaths.get(name)
        const prepared = `${name}${
            n ?
                name ? ` ${n}`
                :   n
            :   ''
        }`
        this.seenPaths.map(prepared, n => n + 1)
        return prepared
    }

    private async mkdir(path: string) {
        if (dirsMade.has(path)) return
        try {
            await mkdir(path, { recursive: true })
        } catch (e: unknown) {
            // https://nodejs.org/docs/latest-v25.x/api/errors.html#class-systemerror
            if ((e as { code: string }).code !== 'EEXIST') throw e
        }
        dirsMade.add(path)
    }
}

function toMarkdown(lin: LinearDocument): string {
    const instructions = new Map<string, number>()
    const d = new md.Builder()
    d.h(
        1,
        lin.parent ?
            [`${lin.id}: `, d.parse(lin.parent.document.title, md.contentGuards.phrasing)]
        :   d.parse(lin.title, md.contentGuards.phrasing),
    )
    if (lin.chat) {
        d.ul([
            ['Chat ID: ', md.code(lin.chat.id)],
            ['Created: ', md.time(lin.chat.createTime)],
            ['Updated: ', md.time(lin.chat.updateTime)],
        ])
    }
    if (lin.parent) {
        const p = lin.parent
        d.p(
            md.link(
                {
                    url: `./${docFilename(p.document)}#${p.messageId}`,
                },
                `${p.document.title}@${p.messageId}`,
            ),
        )
    }
    for (const m of lin.messages) {
        const instructionNo =
            m.message.customInstructions !== undefined && instructions.get(m.message.customInstructions)
        if (m.message.customInstructions !== undefined)
            instructions.set(m.message.customInstructions, instructions.size + 1)

        d.h(2, m.id).p([
            md.code(m.message.id),
            ` : ${m.message.role}`,
            m.message.model && ` (${m.message.model})`,
            ' @ ',
            m.message.createTime !== undefined && md.time(m.message.createTime),
            ` : w${m.message.weight}`,
            typeof instructionNo == 'number' ?
                [
                    ' : instruction ',
                    md.link(
                        { url: `#instruction-${instructionNo}`, title: m.message.customInstructions },
                        instructionNo.toString(),
                    ),
                ]
            :   null,
        ])

        if (m.branches) {
            d.h(3, 'Branches')
            d.ul(
                m.branches.map(b => {
                    let title = b.title
                    let url = docFilename(b)
                    if (b.messages[0]) {
                        title += ` - ${b.messages[0].message.body.slice(0, 50)}`
                        url += `#${b.messages[0].id}`
                    }
                    return md.link({ url: `./${url})` }, title)
                }),
            )
        }
        if (m.message.thoughts) {
            d.h(3, 'Thoughts')
            for (const thought of m.message.thoughts) {
                d.raw(d.parse(thought.summary))
                d.raw(d.parse(thought.content))
                d.ul(
                    thought.chunks.map(chunk =>
                        d.parse(chunk, n => md.contentGuards.phrasing(n) || md.contentGuards.block(n)),
                    ),
                )
            }
        }
        if (m.branches || m.message.thoughts) {
            d.hr()
        }
        d.raw(d.parse(m.message.body))
    }
    if (instructions.size) {
        d.h(2, 'Instructions')
        for (const [instr, no] of instructions) {
            d.h(3, `Instruction ${no}`)
            d.raw(d.parse(instr))
        }
    }
    return d.toString()
}

function docFilename(d: LinearDocument) {
    return sanitize(`${d.id ? `${d.id}.` : ''}${d.title}`, '.md')
}
