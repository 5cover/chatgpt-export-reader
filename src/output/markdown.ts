import { mkdirSync, writeFileSync } from 'node:fs';
import type { Chat, Output } from '../types.js';
import { join } from 'node:path';
import * as md from '../lib/markdown-builder.js';
import { linearizeChat, type LinearDocument } from '../lib/linearizer.js';
import { makeLabel } from '../lib/util.js';
import { DefaultPrimitiveMap } from '@5cover/moremaps';
export type Options = {
    directory: string;
};

export default class Markdown implements Output {
    constructor(private readonly options: Options) {}

    private readonly seenFilename = new DefaultPrimitiveMap<string, number>(() => 0);

    readonly write = (chat: Chat) => {
        const chatprefix = join(this.options.directory, makeLabel(chat.title));
        const n = this.seenFilename.get(chatprefix);
        const filename = `${chatprefix}${n ? ` ${n}` : ''}`;
        this.seenFilename.map(chatprefix, n => n + 1);

        const docs = linearizeChat(chat);
        if (docs.length === 0) throw new Error(`no documents linearized for chat: ${chat.title}`);
        if (docs.length === 1) {
            writeFileSync(chatprefix + '.md', toMarkdown(docs[0]!));
        } else {
            this.mkdir(filename);
            for (const doc of docs) {
                const markdown = toMarkdown(doc);
                writeFileSync(join(filename, docFilename(doc)), markdown);
            }
        }
    };

    private async mkdir(path: string) {
        try {
            mkdirSync(path, { recursive: true });
        } catch (e: any) {
            // https://nodejs.org/docs/latest-v25.x/api/errors.html#class-systemerror
            if (e.code !== 'EEXIST') throw e;
        }
    }
}

function toMarkdown(lin: LinearDocument): string {
    const d = new md.Builder();
    d.h(1, lin.title);
    if (lin.chat) {
        d.ul([
            ['Chat ID: ', md.code(lin.chat.id)],
            ['Created: ', md.time(lin.chat.createTime)],
            ['Updated: ', md.time(lin.chat.updateTime)],
        ]);
    }
    if (lin.parent) {
        const p = lin.parent;
        d.ul([
            `Branch: ${lin.id}`,
            [
                md.link(
                    {
                        url: `./${docFilename(p.document)}#${p.messageId}`,
                    },
                    `${p.document.title}@${p.messageId}`,
                ),
            ],
        ]);
    }
    for (const m of lin.messages) {
        d.h(2, m.id).p([
            md.code(m.message.id),
            ` : ${m.message.role}`,
            m.message.model && ` (${m.message.model})`,
            ' @ ',
            m.message.createTime !== undefined && md.time(m.message.createTime),
            ` : weight ${m.message.weight}`,
        ]);

        if (m.branches) {
            d.h(3, 'Branches');
            d.ul(
                m.branches.map(b => {
                    let title = b.title;
                    let url = docFilename(b);
                    if (b.messages[0]) {
                        title += ` - ${makeLabel(b.messages[0].message.body)}`;
                        url += `#${b.messages[0].id}`;
                    }
                    return md.link({ url: `./${url})` }, title);
                }),
            );
        }
        if (m.message.thoughts) {
            d.h(3, 'Thoughts');
            for (const thought of m.message.thoughts) {
                d.raw(d.parse(thought.summary));
                d.raw(d.parse(thought.content));
                d.ul(
                    thought.chunks.map(chunk =>
                        d.parse(
                            chunk,
                            t =>
                                t !== 'footnoteDefinition' &&
                                t !== 'definition' &&
                                t !== 'listItem' &&
                                t !== 'tableCell' &&
                                t !== 'tableRow' &&
                                t !== 'yaml',
                        ),
                    ),
                );
            }
        }
        if (m.branches || m.message.thoughts) {
            d.hr();
        }
        d.raw(d.parse(m.message.body));
    }
    return d.toString();
}

function docFilename(d: LinearDocument) {
    return `${makeLabel(d.title)}${d.id ? `.${d.id}` : ''}.md`;
}
