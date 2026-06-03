import { FastMarkdown, inlineCode, link, shiftMarkdownHeadings, time } from '../../lib/fast-markdown.js'
import { renderLinearChatArtifacts, type LinearDocument } from '../../lib/linearizer.js'
import { mapfilter, sanitize, type Falsey } from '../../lib/util.js'
import type { ArtifactTree, Chat, OutputFormat } from '../../types.js'
import { addArtifact, artifactTree, deduplicateName, isArtifactTree } from '../artifact-tree.js'

export default class MarkdownOutput implements OutputFormat {
    async render(chats: AsyncIterable<Chat>): Promise<ArtifactTree> {
        const root = artifactTree()

        for await (const chat of chats) {
            const { name, artifact } = renderLinearChatArtifacts(chat, toMarkdown, '.md')
            const directory = ensureDirectory(
                root,
                mapfilter<string | Falsey, string | Falsey, string>(
                    [chat.isArchived && 'archived', chat.projectName],
                    segment => segment && sanitize(segment),
                    (segment): segment is string => !!segment,
                ),
            )
            addArtifact(directory, [deduplicateName(directory, name)], artifact)
        }

        return root
    }
}

function ensureDirectory(root: ArtifactTree, path: readonly string[]): ArtifactTree {
    let current = root
    for (const segment of path) {
        const existing = current.get(segment)
        if (existing === undefined) {
            const next = artifactTree()
            current.set(segment, next)
            current = next
            continue
        }
        if (!isArtifactTree(existing)) throw new Error(`artifact path conflict at ${segment}`)
        current = existing
    }
    return current
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
