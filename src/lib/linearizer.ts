import type { Chat, Message } from '../types.js'
import type { ArtifactTree } from '../types.js'
import { sanitize, tersen, TITLE_MAXLEN } from './util.js'
import { artifactTree } from '../output/artifact-tree.js'

export type LinearDocument = {
    id: string
    title: string
    parent?: { document: LinearDocument; messageId: string }
    messages: LinearMessage[]
    chat?: Chat
}

export type LinearMessage = {
    id: string
    message: Message
    branches?: LinearDocument[]
}

export function linearizeChat(chat: Chat): LinearDocument[] {
    const docs: LinearDocument[] = []
    const subtreeSizes = new WeakMap<Message, number>()

    const mainDoc: LinearDocument = {
        id: '',
        title: tersen(chat.title, TITLE_MAXLEN),
        messages: [],
        chat,
    }

    docs.push(mainDoc)

    for (const message of chat.messages) {
        walk(message, {
            docs,
            currentDoc: mainDoc,
            prefix: '', // "", "3a", "3a.2a"
            counter: 1,
            subtreeSizes,
        })
    }

    return docs
}

export function renderLinearChatArtifacts(
    chat: Chat,
    renderDocument: (document: LinearDocument) => string,
    extension: string,
): { name: string; artifact: string | ArtifactTree } {
    const docs = linearizeChat(chat)
    if (docs.length === 0) throw new Error(`no documents linearized for chat: ${chat.title}`)

    if (docs.length === 1) {
        return {
            name: sanitize(chat.title, extension),
            artifact: renderDocument(docs[0]!),
        }
    }

    const tree = artifactTree()
    for (const doc of docs) {
        tree.set(documentFilename(doc, extension), renderDocument(doc))
    }

    return {
        name: sanitize(chat.title),
        artifact: tree,
    }
}

type Ctx = {
    docs: LinearDocument[]
    currentDoc: LinearDocument
    prefix: string // branch prefix
    counter: number // local message counter
    subtreeSizes: WeakMap<Message, number>
}

function walk(node: Message, ctx: Readonly<Ctx>): void {
    const id = ctx.prefix ? `${ctx.prefix}.${ctx.counter}` : ctx.counter.toString()

    const linearMsg: LinearMessage = {
        id,
        message: node,
    }

    ctx.currentDoc.messages.push(linearMsg)

    if (!node.children.length) return

    if (node.children.length === 1) {
        walk(node.children[0]!, {
            ...ctx,
            counter: ctx.counter + 1,
        })
        return
    }

    // multiple children → branching
    const sorted = [...node.children].sort(
        (a, b) => subtreeSize(b, ctx.subtreeSizes) - subtreeSize(a, ctx.subtreeSizes),
    )

    const mainChild = sorted[0]!
    const altChildren = sorted.slice(1)

    // create branch docs
    linearMsg.branches = []

    altChildren.forEach((child, i) => {
        const branchId = makeBranchId(ctx.prefix, ctx.counter, i)

        const doc: LinearDocument = {
            id: branchId,
            title: tersen(child.body, TITLE_MAXLEN),
            parent: { document: ctx.currentDoc, messageId: id },
            messages: [],
        }

        ctx.docs.push(doc)

        linearMsg.branches!.push(doc)

        walk(child, {
            ...ctx,
            currentDoc: doc,
            prefix: branchId,
            counter: 1,
        })
    })

    // continue main branch
    walk(mainChild, {
        ...ctx,
        counter: ctx.counter + 1,
    })
}

function subtreeSize(node: Message, memo: WeakMap<Message, number>): number {
    const cached = memo.get(node)
    if (cached !== undefined) return cached

    let count = 1
    for (const child of node.children) {
        count += subtreeSize(child, memo)
    }
    memo.set(node, count)
    return count
}

function makeBranchId(prefix: string, index: number, altIdx: number): string {
    const letter = String.fromCharCode(97 + altIdx) // a, b, c...
    const base = prefix ? `${prefix}.${index}` : String(index)
    return `${base}${letter}`
}

function documentFilename(document: LinearDocument, extension: string) {
    return sanitize(`${document.id ? `${document.id}.` : ''}${document.title}`, extension)
}
