import v1 from './input/v1.js';
import Markdown from './output/markdown.js';

const y = v1.parse('exports/conversation.single.json');

const o = new Markdown({
    directory: 'out',
});
for (const chat of y) {
    o.write(chat);
}
