import { DefaultPrimitiveMap } from '@5cover/moremaps'
import { mkdir, writeFile } from 'fs/promises'
import p from 'path'
import { FastMarkdown, inlineCode, link, shiftMarkdownHeadings, time } from '../lib/fast-markdown.js'
import { linearizeChat, type LinearDocument } from '../lib/linearizer.js'
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
        const dir = file.name ? dirname : p.dirname(dirname)
        if (!dirsMade.has(dir)) await this.mkdir(dir)
        const final = file.ext ? path + file.ext : path
        void writeFile(final, content).catch((e: unknown) => console.error(`failed to write ${final}: ${String(e)}`))
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
    const d = new FastMarkdown()

    d.heading(1, lin.parent ? `${lin.id}: ${lin.parent.document.title}` : lin.title)

    if (lin.chat) {
        d.list([
            `Chat ID: ${inlineCode(lin.chat.id)}`,
            `Created: ${time(lin.chat.createTime)}`,
            `Updated: ${time(lin.chat.updateTime)}`,
        ])
    }
    if (lin.parent) {
        const p = lin.parent
        d.paragraph(link(`./${docFilename(p.document)}#${p.messageId}`, `${p.document.title}@${p.messageId}`))
    }

    for (const m of lin.messages) {
        const instructionNo = !m.message.customInstructions ? undefined : getInstructionNo(m.message.customInstructions)

        d.heading(2, m.id)
        d.paragraph([
            inlineCode(m.message.id),
            ` : ${m.message.role}`,
            m.message.model && ` (${m.message.model})`,
            ' @ ',
            m.message.createTime !== undefined && time(m.message.createTime),
            ` : w${m.message.weight}`,
            typeof instructionNo == 'number' ?
                [' : instruction ', link(`#instruction-${instructionNo}`, instructionNo.toString())]
            :   null,
        ])

        if (m.branches) {
            d.heading(3, 'Branches')
            d.list(
                m.branches.map(b => {
                    let title = b.title
                    let url = docFilename(b)
                    if (b.messages[0]) {
                        title += ` - ${b.messages[0].message.body.slice(0, 50)}`
                        url += `#${b.messages[0].id}`
                    }
                    return link(`./${url}`, title)
                }),
            )
        }
        if (m.message.thoughts) {
            d.heading(3, 'Thoughts')
            for (const thought of m.message.thoughts) {
                d.markdown(thought.summary, 3)
                d.markdown(thought.content, 3)
                d.list(thought.chunks.map(chunk => shiftMarkdownHeadings(chunk, 3).trimEnd()))
            }
        }
        if (m.branches || m.message.thoughts) {
            d.thematicBreak()
        }
        d.markdown(m.message.body, 2)
    }
    if (instructions.size) {
        d.heading(2, 'Instructions')
        for (const [instr, no] of instructions) {
            d.heading(3, `Instruction ${no}`)
            d.markdown(instr, 3)
        }
    }
    return d.toString()

    function getInstructionNo(instr: string) {
        const existing = instructions.get(instr)
        if (existing !== undefined) return existing

        const assigned = instructions.size + 1
        instructions.set(instr, assigned)
        return assigned
    }
}

function docFilename(d: LinearDocument) {
    return sanitize(`${d.id ? `${d.id}.` : ''}${d.title}`, '.md')
}
