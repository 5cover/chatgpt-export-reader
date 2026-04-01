import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import type * as md from 'mdast';

type SubdocumentInput = string | md.Root | MarkdownDocument;

type ListInput = Input<md.BlockContent | md.PhrasingContent, md.PhrasingContent>[];
type Input<T, U = T> = T | string | (U | string)[];

export class MarkdownDocument {
    private tree: md.Root;

    constructor(input?: string | md.Root) {
        if (!input) {
            this.tree = { type: 'root', children: [] };
        } else if (typeof input === 'string') {
            this.tree = MarkdownDocument.parse(input);
        } else {
            this.tree = structuredClone(input);
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
        return structuredClone(this.tree);
    }

    h(depth: number, value: string): this {
        this.tree.children.push(heading(depth, value));
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
        this.tree.children.push(structuredClone(node));
        return this;
    }

    compose(input: SubdocumentInput, options?: { mode?: 'relative' | 'absolute'; baseDepth?: number }): this {
        const imported = this.normalizeSubdocument(input);
        const offset =
            options?.mode === 'absolute'
                ? this.computeAbsoluteOffset(imported, options.baseDepth ?? 1)
                : this.computeRelativeOffset();

        const adjusted = structuredClone(imported);

        visit(adjusted, 'heading', (node: md.Heading) => {
            node.depth = clampHeadingDepth(node.depth + offset);
        });

        this.tree.children.push(...adjusted.children);
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

    private normalizeSubdocument(input: SubdocumentInput): md.Root {
        if (typeof input === 'string') return MarkdownDocument.parse(input);
        if (input instanceof MarkdownDocument) return input.root();
        return structuredClone(input);
    }

    private computeRelativeOffset(): number {
        const last = this.findLastHeadingDepth();
        return last ?? 0;
    }

    private computeAbsoluteOffset(imported: md.Root, baseDepth: number): number {
        const firstImportedHeading = this.findFirstHeadingDepth(imported);
        if (!firstImportedHeading) return 0;
        return baseDepth - firstImportedHeading;
    }

    private findLastHeadingDepth(): number | null {
        for (let i = this.tree.children.length - 1; i >= 0; i--) {
            const node = this.tree.children[i];
            if (node?.type === 'heading') return node.depth;
        }
        return null;
    }

    private findFirstHeadingDepth(root: md.Root): number | null {
        for (const node of root.children) {
            if (node.type === 'heading') return node.depth;
        }
        return null;
    }
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

function heading(depth: number, value: string): md.Heading {
    return {
        type: 'heading',
        depth: clampHeadingDepth(depth),
        children: [text(value)],
    };
}

function clampHeadingDepth(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
    return Math.max(1, Math.min(6, depth)) as 1 | 2 | 3 | 4 | 5 | 6;
}
