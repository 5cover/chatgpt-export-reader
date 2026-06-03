import { createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { stdout } from 'process'
import type { Writable } from 'stream'
import v1 from './input/v1.js'
import type { Chat, Exporter, Input, OutputFormat } from './types.js'
import FilesystemExporter from './output/exporters/filesystem.js'
import FlatExporter from './output/exporters/flat.js'
import JsonArtifactExporter from './output/exporters/json.js'
import JsonOutput from './output/formats/json.js'
import MarkdownOutput from './output/formats/markdown.js'
import PromptOutput from './output/formats/prompt.js'
import { program } from 'commander'

const inputFormats = {
    v1,
} as const satisfies Record<string, Input>

const outputFormatNames = ['markdown', 'json', 'prompt'] as const
const exporterNames = ['filesystem', 'flat', 'json'] as const

program
    .name('chatgpt-export-reader')
    .description('Turn ChatGPT exports into markdown, prompt, or JSON artifacts.')
    .argument('<input-path>', 'Input export file or directory')
    .option('--input-format <name>', 'Input format', 'v1')
    .option('-o, --output-format <name>', 'Output format', 'markdown')
    .option('-e, --export-format <name>', 'Export format', 'flat')
    .option('-c, --chat <uuid>', 'Keep only specific chat IDs', collect, [] as string[])
    .option('--fs-path <path>', 'Filesystem exporter destination path')
    .option('--stream-file <path|->', 'Stream exporter destination, use - for stdout', '-')
    .showHelpAfterError()
    .action(async (input, options) => {
        const inputF = getInputFormat(options.inputFormat)
        const outputF = getOutputFormat(options.outputFormat)
        const exportF = createExporter(options.exportFormat, {
            fsPath: options.fsPath,
            streamFile: options.streamFile,
        })
        const artifacts = await outputF.render(filterChats(readInput(inputF, input), new Set(options.chat)))
        await exportF.export(artifacts)
    })
    .parse()

function getInputFormat(name: string): Input {
    if (name !== 'v1') throw new Error(`unknown input format: ${name}`)
    return inputFormats.v1
}

function getOutputFormat(name: string): OutputFormat {
    switch (name) {
        case outputFormatNames[0]:
            return new MarkdownOutput()
        case outputFormatNames[1]:
            return new JsonOutput()
        case outputFormatNames[2]:
            return new PromptOutput()
        default:
            throw new Error(`unknown output format: ${name}`)
    }
}

function createExporter(
    name: string,
    options: {
        fsPath?: string
        streamFile: string
    }
): Exporter {
    switch (name) {
        case exporterNames[0]:
            if (!options.fsPath) throw new Error('--fs-path is required for the filesystem exporter')
            return new FilesystemExporter({ path: options.fsPath })
        case exporterNames[1]:
            return new FlatExporter({ stream: openStream(options.streamFile) })
        case exporterNames[2]:
            return new JsonArtifactExporter({ stream: openStream(options.streamFile) })
        default:
            throw new Error(`unknown export format: ${name}`)
    }
}

async function* readInput(input: Input, path: string): AsyncGenerator<Chat> {
    const info = await stat(path)
    if (info.isDirectory()) {
        yield* input.parse(path)
        return
    }
    yield* input.parseFile(path)
}

async function* filterChats(chats: AsyncIterable<Chat>, ids: ReadonlySet<string>): AsyncGenerator<Chat> {
    for await (const chat of chats) {
        if (ids.size && !ids.has(chat.id)) continue
        yield chat
    }
}

function openStream(path: string): Writable {
    if (path === '-') return stdout
    return createWriteStream(path, { encoding: 'utf8' })
}

function collect(value: string, previous: string[]) {
    previous.push(value)
    return previous
}
