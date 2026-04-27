import type * as md from 'mdast'
import { remark } from 'remark'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { visit } from 'unist-util-visit'
import type { Falsey } from './util.js'

type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6
type FlatInput<T> = T | string | Falsey
type Input<T> = FlatInput<T> | Input<T>[]

function parseMarkdown(markdown: string) {
    return remark().use(remarkParse).parse(markdown)
}

export class Builder {
    private tree: md.Root
    private level = 0
    constructor(input?: string | md.Root) {
        if (!input) {
            this.tree = { type: 'root', children: [] }
        } else if (typeof input === 'string') {
            this.tree = parseMarkdown(input)
        } else {
            this.tree = input
        }
    }

    root(): md.Root {
        return this.tree
    }

    h(depth: HeadingDepth, children: Input<md.PhrasingContent>): this {
        this.tree.children.push({
            type: 'heading',
            depth,
            children: wrapToPhrasing(children),
        })
        this.level = depth
        return this
    }

    hr(): this {
        this.tree.children.push({
            type: 'thematicBreak',
        })
        if (this.level > 0) this.level--
        return this
    }

    p(children: Input<md.PhrasingContent>): this {
        this.tree.children.push(paragraph(wrapToPhrasing(children)))
        return this
    }

    codeblock(language: string | null, value: string): this {
        this.tree.children.push({
            type: 'code',
            lang: language ?? null,
            value,
        })
        return this
    }

    ul(items: readonly Input<md.BlockContent | md.PhrasingContent>[]): this {
        const children: md.ListItem[] = items.map(item => {
            return {
                type: 'listItem',
                children: wrapToDefblock(item),
            }
        })

        this.tree.children.push({
            type: 'list',
            ordered: false,
            spread: false,
            children,
        })

        return this
    }

    raw(node: md.RootContent[]): this {
        this.tree.children.push(...node)
        return this
    }

    parse(input: string): md.RootContent[]
    parse<Node extends md.RootContent>(
        input: string,
        allowNode: (type: md.RootContent) => type is Node,
    ): (Node | md.Text)[]
    parse<Node extends md.RootContent>(
        input: string,
        allowNode?: (type: md.RootContent) => type is Node,
    ): (Node | md.Text)[] {
        const imported = parseMarkdown(input)

        let oldh = 0
        let newh = 1 + this.level
        visit(imported, 'heading', (node: md.Heading) => {
            newh += node.depth - (oldh || node.depth)
            oldh = node.depth
            node.depth = clampDepth(newh)
        })
        return imported.children.map(c => {
            if (!allowNode || allowNode(c)) {
                return c as Node
            } else {
                return text(c.position ? input.slice(c.position.start.offset, c.position.end.offset) : '')
            }
        })
    }

    toString(): string {
        return remark()
            .use(remarkStringify, {
                bullet: '-',
                rule: '-',
            })
            .stringify(this.tree)
    }
}

export function link(
    { url, title }: { url: string; title?: string | null | undefined },
    children?: Input<md.PhrasingContent>,
): md.Link {
    return {
        type: 'link',
        children: wrapToPhrasing(children),
        url,
        title,
    }
}

export function code(value: string): md.InlineCode {
    return {
        type: 'inlineCode',
        value,
    }
}

export function time(timestamp: number): md.Html {
    const dt = new Date(timestamp)
    return {
        type: 'html',
        value: `<time datetime="${dt.toISOString()}">${dt.toLocaleString()}</time>`,
    }
}

function wrapToDefblock(
    node: Input<md.BlockContent | md.DefinitionContent | md.PhrasingContent>,
): (md.BlockContent | md.DefinitionContent)[] {
    return (
        !node ? []
        : typeof node === 'string' ? [paragraph([text(node)])]
        : Array.isArray(node) ? segmentDefblocks(node)
        : contentGuards.block(node) || contentGuards.definition(node) ? [node]
        : [paragraph([node])]
    )
}

function segmentDefblocks(nodes: Input<md.BlockContent | md.DefinitionContent | md.PhrasingContent>[]) {
    const blocks: (md.BlockContent | md.DefinitionContent)[] = []
    let phrasing: md.PhrasingContent[] = []
    for (const node of nodes) {
        if (!node) continue
        if (typeof node === 'string') {
            phrasing.push(text(node))
        } else if (Array.isArray(node)) {
            blocks.push(...segmentDefblocks(node))
        } else if (contentGuards.phrasing(node)) {
            phrasing.push(node)
            if (phrasing.length) {
                blocks.push(paragraph(phrasing))
                phrasing = []
            }
        } else {
            blocks.push(node)
        }
    }
    if (phrasing.length) {
        blocks.push(paragraph(phrasing))
    }
    return blocks
}

function wrapToPhrasing(node?: Input<md.PhrasingContent>): md.PhrasingContent[] {
    return (
        !node ? []
        : typeof node === 'string' ? [text(node)]
        : Array.isArray(node) ? node.flatMap(wrapToPhrasing)
        : [node]
    )
}

function text(value: string): md.Text {
    return { type: 'text', value }
}

function paragraph(children: md.PhrasingContent[]): md.Paragraph {
    return {
        type: 'paragraph',
        children: children,
    }
}

function clampDepth(x: number): HeadingDepth {
    return (
        x < 1 ? 1
        : x > 6 ? 6
        : (x as HeadingDepth)
    )
}

export const contentGuards = {
    block: guard<md.BlockContentMap>(
        'blockquote',
        'code',
        'heading',
        'html',
        'list',
        'paragraph',
        'table',
        'thematicBreak',
    ),
    definition: guard<md.DefinitionContentMap>('definition', 'footnoteDefinition'),
    frontmatter: guard<md.FrontmatterContentMap>('yaml'),
    list: guard<md.ListContentMap>('listItem'),
    phrasing: guard<md.PhrasingContentMap>(
        'break',
        'delete',
        'emphasis',
        'footnoteReference',
        'html',
        'image',
        'imageReference',
        'inlineCode',
        'link',
        'linkReference',
        'strong',
        'text',
    ),
    root: guard<md.RootContentMap>(
        'blockquote',
        'break',
        'code',
        'definition',
        'delete',
        'emphasis',
        'footnoteDefinition',
        'footnoteReference',
        'heading',
        'html',
        'image',
        'imageReference',
        'inlineCode',
        'link',
        'linkReference',
        'list',
        'listItem',
        'paragraph',
        'strong',
        'table',
        'tableCell',
        'tableRow',
        'text',
        'thematicBreak',
        'yaml',
    ),
    row: guard<md.RowContentMap>('tableCell'),
    tableContent: guard<md.TableContentMap>('tableRow'),
}

function guard<T extends Record<keyof T, md.RootContent>>(...values: readonly (keyof T)[]) {
    if (values.length === 1) return (n: md.RootContent): n is T[keyof T] => n.type === values[0]
    const set = new Set(values)
    return (n: md.RootContent): n is T[keyof T] => set.has(n.type as keyof T)
}
