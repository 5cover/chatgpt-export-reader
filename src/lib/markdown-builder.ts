import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import type * as md from 'mdast';

type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;
type Falsey = false | null | undefined | 0 | 0n;
type FlatInput<T> = T | string | Falsey;
type Input<T> = FlatInput<T> | FlatInput<T>[];

function parseMarkdown(markdown: string) {
    return remark().use(remarkParse).parse(markdown);
}

export class Builder {
    private tree: md.Root;
    private level = 0;
    constructor(input?: string | md.Root) {
        if (!input) {
            this.tree = { type: 'root', children: [] };
        } else if (typeof input === 'string') {
            this.tree = parseMarkdown(input);
        } else {
            this.tree = input;
        }
    }

    root(): md.Root {
        return this.tree;
    }

    h(depth: HeadingDepth, children: Input<md.PhrasingContent>): this {
        this.tree.children.push({
            type: 'heading',
            depth,
            children: wrapToPhrasing(children),
        });
        this.level = depth;
        return this;
    }

    hr(): this {
        this.tree.children.push({
            type: 'thematicBreak',
        });
        if (this.level > 0) this.level--;
        return this;
    }

    p(children: Input<md.PhrasingContent>): this {
        this.tree.children.push(paragraph(wrapToPhrasing(children)));
        return this;
    }

    codeblock(language: string | null, value: string): this {
        this.tree.children.push({
            type: 'code',
            lang: language ?? null,
            value,
        });
        return this;
    }

    ul(items: readonly Input<md.BlockContent | md.PhrasingContent>[]): this {
        const children: md.ListItem[] = items.map(item => {
            return {
                type: 'listItem',
                children: wrapToDefblock(item),
            };
        });

        this.tree.children.push({
            type: 'list',
            ordered: false,
            spread: false,
            children,
        });

        return this;
    }

    raw(node: md.RootContent[]): this {
        this.tree.children.push(...node);
        return this;
    }

    parse(input: string): md.RootContent[];
    parse<Node extends keyof md.RootContentMap>(
        input: string,
        allowNode: (type: keyof md.RootContentMap) => type is Node,
    ): (md.RootContentMap[Node] | md.Text)[];
    parse<Node extends keyof md.RootContentMap>(
        input: string,
        allowNode?: (type: keyof md.RootContentMap) => type is Node,
    ): (md.RootContentMap[Node] | md.Text)[] {
        const imported = parseMarkdown(input);

        let oldh = 0;
        let newh = 1 + this.level;
        visit(imported, 'heading', (node: md.Heading) => {
            newh += node.depth - (oldh || node.depth);
            oldh = node.depth;
            node.depth = clampDepth(newh);
        });
        return imported.children.map(c => {
            if (!allowNode || allowNode(c.type)) {
                return c as md.RootContentMap[Node];
            } else {
                return text(c.position ? input.slice(c.position.start.offset, c.position.end.offset) : '');
            }
        });
    }

    toString(): string {
        return remark()
            .use(remarkStringify, {
                bullet: '-',
                rule: '-',
            })
            .stringify(this.tree);
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
    };
}

export function code(value: string): md.InlineCode {
    return {
        type: 'inlineCode',
        value,
    };
}

export function time(timestamp: number): md.Html {
    const dt = new Date(timestamp);
    return {
        type: 'html',
        value: `<time datetime="${dt.toISOString()}">${dt.toLocaleString()}</time>`,
    };
}

function wrapToDefblock(
    node: Input<md.BlockContent | md.DefinitionContent | md.PhrasingContent>,
): (md.BlockContent | md.DefinitionContent)[] {
    return !node
        ? []
        : typeof node === 'string'
          ? [paragraph([text(node)])]
          : Array.isArray(node)
            ? segmentDefblocks(node)
            : isDefblock(node)
              ? [node]
              : [paragraph([node])];
}

function segmentDefblocks(nodes: FlatInput<md.BlockContent | md.DefinitionContent | md.PhrasingContent>[]) {
    const blocks: (md.BlockContent | md.DefinitionContent)[] = [];
    let phrasing: md.PhrasingContent[] = [];
    for (const node of nodes) {
        if (!node) {
        } else if (typeof node === 'string') {
            phrasing.push(text(node));
        } else if (isDefblock(node)) {
            if (phrasing.length) {
                blocks.push(paragraph(phrasing));
                phrasing = [];
            }
            blocks.push(node);
        } else {
            phrasing.push(node);
        }
    }
    if (phrasing.length) {
        blocks.push(paragraph(phrasing));
    }
    return blocks;
}

function wrapToPhrasing(node?: Input<md.PhrasingContent>): md.PhrasingContent[] {
    return !node
        ? []
        : typeof node === 'string'
          ? [text(node)]
          : Array.isArray(node)
            ? node.flatMap(wrapToPhrasing)
            : [node];
}

function text(value: string): md.Text {
    return { type: 'text', value };
}

function paragraph(children: md.PhrasingContent[]): md.Paragraph {
    return {
        type: 'paragraph',
        children: children,
    };
}

function clampDepth(x: number): HeadingDepth {
    return x < 1 ? 1 : x > 6 ? 6 : (x as HeadingDepth);
}

function isDefblock(node: md.RootContent): node is md.BlockContent | md.DefinitionContent {
    return (
        node.type === 'paragraph' ||
        node.type === 'heading' ||
        node.type === 'code' ||
        node.type === 'blockquote' ||
        node.type === 'list' ||
        node.type === 'html' ||
        node.type === 'thematicBreak' ||
        node.type === 'table' ||
        node.type === 'definition' ||
        node.type === 'footnoteDefinition'
    );
}
