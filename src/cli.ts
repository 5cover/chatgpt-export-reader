import v1 from './input/v1.js';
import Markdown from './output/markdown.js';

const chats = v1.parse('exports/conversations.json');

const o = new Markdown({
    directory: 'out',
});
for await (const chat of chats) {
    console.log(chat.title);
    o.write(chat);
}
