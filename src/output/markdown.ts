import { mkdirSync, writeFileSync } from 'node:fs';
import type { Chat, Output } from '../types.js';
import { join } from 'node:path';
import { MarkdownDocument } from '../lib/MarkdownDocument.js';
import { linearizeChat, type LinearDocument } from '../lib/linearizer.js';
import { makeLabel } from '../lib/util.js';

export type Options = {
    directory: string;
};

export default class Markdown implements Output {
    constructor(private readonly options: Options) {}

    readonly write = (chat: Chat) => {
        const chatdir = makeLabel(chat.title);
        this.mkdir(chatdir);
        for (const doc of linearizeChat(chat)) {
            const markdown = toMarkdown(doc);
            writeFileSync(join(this.options.directory, chatdir, filename(doc)), markdown);
        }
    };

    private async mkdir(path: string) {
        try {
            mkdirSync(join(this.options.directory, path), { recursive: true });
        } catch (e: any) {
            // https://nodejs.org/docs/latest-v25.x/api/errors.html#class-systemerror
            if (e.code !== 'EEXIST') throw e;
        }
    }
}

function toMarkdown(lin: LinearDocument): string {
    const d = new MarkdownDocument();
    d.h(1, lin.title);
    if (lin.chat) {
        d.list([
            `Chat ID: ${lin.chat.id}`,
            `Created: ${datetime(lin.chat.createTime)}`,
            `Updated: ${datetime(lin.chat.updateTime)}`,
        ]);
    }
    if (lin.parent) {
        const p = lin.parent;
        d.list([
            `Branch: ${lin.id}`,
            [
                d.link(
                    {
                        url: `./${filename(p.document)}#${p.messageId}`,
                    },
                    `${p.document.title}@${p.messageId}`,
                ),
            ],
        ]);
    }
    for (const msg of lin.messages) {
        d.h(2, msg.id).p([
            `${msg.message.role} @ ${datetime(msg.message.createTime)} weight ${msg.message.weight}, id `,
            d.code(msg.message.id),
        ]);

        if (msg.branches) {
            d.p('Branches:');
            d.list(
                msg.branches.map(b => {
                    let title = b.title;
                    let url = filename(b);
                    if (b.messages[0]) {
                        title += ` - ${makeLabel(b.messages[0].message.body)}`;
                        url += `#${b.messages[0].id}`;
                    }
                    return d.link({ url: `./${url})` }, title);
                }),
            );
        }
        d.compose(msg.message.body);
    }
    return d.toString();
}

function filename(d: LinearDocument) {
    return `${d.title}${d.id ? `.${d.id}` : ''}.md`;
}

function datetime(timestamp: number) {
    return new Date(timestamp).toLocaleString();
}
