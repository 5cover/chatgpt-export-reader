import v1 from './input/v1.js'
import Markdown from './output/markdown.js'

const chats = v1.parseFile('exports/callstack.json')

const o = new Markdown({
    directory: 'out/2',
})

await o.write(chats)
