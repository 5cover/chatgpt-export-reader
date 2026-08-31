import { renderLinearChatArtifacts, type LinearDocument } from '../../lib/linearizer.js'
import { mapfilter, sanitize, type Falsey } from '../../lib/util.js'
import type { ArtifactTree, Chat, OutputFormat } from '../../types.js'
import { addArtifact, artifactTree, deduplicateName, isArtifactTree } from '../artifact-tree.js'

export type PromptOptions = {
    rolePrefixes?: Readonly<Record<string, string>>
}

const DEFAULT_ROLE_PREFIXES = {
    user: '',
    assistant: '>',
} as const satisfies Readonly<Record<string, string>>

export default class PromptOutput implements OutputFormat {
    private readonly rolePrefixes: Readonly<Record<string, string>>

    constructor(options: PromptOptions = {}) {
        this.rolePrefixes = {
            ...DEFAULT_ROLE_PREFIXES,
            ...options.rolePrefixes,
        }
    }

    async render(chats: AsyncIterable<Chat>): Promise<ArtifactTree> {
        const root = artifactTree()

        for await (const chat of chats) {
            const { name, artifact } = renderLinearChatArtifacts(chat, document => toPrompt(document, this.rolePrefixes), '.md')
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

function toPrompt(document: LinearDocument, rolePrefixes: Readonly<Record<string, string>>): string {
    const chunks = document.messages
        .map(entry => {
            const prefix = rolePrefixes[entry.message.role]
            if (prefix === undefined) return null

            const body = entry.message.body.trim()
            if (!body) return null

            if (!prefix) return body

            return body
                .split('\n')
                .map(line => `${prefix}${line}`)
                .join('\n')
        })
        .filter((value): value is string => value !== null)

    return chunks.length ? `${chunks.join('\n\n').trimEnd()}\n` : ''
}
