import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import type * as md from 'mdast';

type SubdocumentInput = string | md.Root | MarkdownDocument;
type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;
type ListInput = Input<md.BlockContent | md.PhrasingContent, md.PhrasingContent>[];
type Input<T, U = T> = T | string | (U | string)[];

export class MarkdownDocument {
    private tree: md.Root;
    private lastHeadingDepth = 0;
    constructor(input?: string | md.Root) {
        if (!input) {
            this.tree = { type: 'root', children: [] };
        } else if (typeof input === 'string') {
            this.tree = MarkdownDocument.parse(input);
        } else {
            this.tree = input;
        }
    }

    static create(): MarkdownDocument {
        return new MarkdownDocument();
    }

    static parse(markdown: string): md.Root {
        return remark().use(remarkParse).parse(markdown) as md.Root;
    }

    static from(markdown: string): MarkdownDocument {
        return new MarkdownDocument(markdown);
    }

    root(): md.Root {
        return this.tree;
    }

    h(depth: HeadingDepth, value: string): this {
        this.tree.children.push(heading(depth, value));
        this.lastHeadingDepth = depth;
        return this;
    }

    p(children: Input<md.PhrasingContent>): this {
        this.tree.children.push(paragraph(wrapPhrasing(children)));
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

    list(items: ListInput, ordered = false): this {
        const children: md.ListItem[] = items.map(item => {
            return {
                type: 'listItem',
                children: wrapBlock(item),
            };
        });

        this.tree.children.push({
            type: 'list',
            ordered,
            spread: false,
            children,
        });

        return this;
    }

    raw(node: md.RootContent): this {
        this.tree.children.push(node);
        return this;
    }

    compose(input: SubdocumentInput, options?: { mode?: 'relative' | 'absolute'; baseDepth?: number }): this {
        const imported = normalizeSubdocument(input);

        let oldh = 0;
        let newh = 1 + this.lastHeadingDepth;
        visit(imported, 'heading', (node: md.Heading) => {
            newh += node.depth - (oldh || node.depth);
            oldh = node.depth;
            node.depth = clampDepth(newh);
        });

        this.tree.children.push(...imported.children);
        return this;
    }

    toString(): string {
        return remark()
            .use(remarkStringify, {
                bullet: '-',
                fences: true,
                incrementListMarker: false,
            })
            .stringify(this.tree);
    }

    // phrasing

    link(
        { url, title }: { url: string; title?: string | null | undefined },
        children?: Input<md.PhrasingContent>,
    ): md.Link {
        return {
            type: 'link',
            children: wrapPhrasing(children),
            url,
            title,
        };
    }

    code(value: string): md.InlineCode {
        return {
            type: 'inlineCode',
            value,
        };
    }
}
function normalizeSubdocument(input: SubdocumentInput): md.Root {
    if (typeof input === 'string') return MarkdownDocument.parse(input);
    if (input instanceof MarkdownDocument) return input.root();
    return input;
}
function wrapBlock(node: Input<md.BlockContent | md.PhrasingContent, md.PhrasingContent>): md.BlockContent[] {
    return typeof node === 'string'
        ? [paragraph([text(node)])]
        : Array.isArray(node)
          ? [paragraph(node.flatMap(wrapPhrasing))]
          : node.type === 'paragraph' ||
              node.type === 'heading' ||
              node.type === 'code' ||
              node.type === 'blockquote' ||
              node.type === 'list' ||
              node.type === 'html' ||
              node.type === 'thematicBreak' ||
              node.type === 'table'
            ? [node]
            : [paragraph([node])];
}

function wrapPhrasing(node?: Input<md.PhrasingContent>): md.PhrasingContent[] {
    return node === undefined
        ? []
        : typeof node === 'string'
          ? [text(node)]
          : Array.isArray(node)
            ? node.flatMap(wrapPhrasing)
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

function heading(depth: HeadingDepth, value: string): md.Heading {
    return {
        type: 'heading',
        depth,
        children: [text(value)],
    };
}

function clampDepth(x: number): HeadingDepth {
    return x < 1 ? 1 : x > 6 ? 6 : (x as HeadingDepth);
}
