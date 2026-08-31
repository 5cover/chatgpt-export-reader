import { isEmptyV1Record, normalizeV1Chat } from '@chatgpt-export-reader/core'
import * as fs from 'fs'
import * as path from 'path'
import chain from 'stream-chain'
import { parser } from 'stream-json'
import streamArray, { type StreamArrayItem } from 'stream-json/streamers/stream-array.js'
import type { Chat, Input } from '../types.js'

export default {
    parse,
    parseFile,
} satisfies Input

async function* parse(exportDir: string): AsyncGenerator<Chat> {
    const conversationFiles = fs.globSync('conversations*.json', {
        cwd: exportDir,
        withFileTypes: true,
        exclude: entry => !entry.isFile(),
    })
    for (const entry of conversationFiles) yield* parseFile(path.join(exportDir, entry.name))
}

async function* parseFile(filename: fs.PathLike): AsyncGenerator<Chat> {
    const pipeline = chain([
        fs.createReadStream(filename, { encoding: 'utf8' }),
        parser(),
        streamArray(),
    ]) as AsyncIterable<StreamArrayItem>

    for await (const chunk of pipeline) {
        const raw = chunk.value as unknown
        if (isEmptyV1Record(raw)) continue
        try {
            yield normalizeV1Chat(raw)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`Invalid chat at array index ${String(chunk.key)}: ${message}`)
        }
    }
}
