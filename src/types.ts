export type { Chat, Message, Thought } from '@chatgpt-export-reader/core'

export type ArtifactTree = Map<string, string | ArtifactTree>

export type Input = {
    readonly parseFile: (filename: string) => AsyncGenerator<Chat>
    readonly parse: (exportDir: string) => AsyncGenerator<Chat>
}

export type OutputFormat = {
    readonly render: (chats: AsyncIterable<Chat>) => Promise<ArtifactTree>
}

export type Exporter = {
    readonly export: (artifacts: ArtifactTree) => Promise<void>
}
