export type Chat = {
    id: string
    title: string
    createTime: number
    updateTime: number
    projectName?: string
    messages: Message[]
    isArchived: boolean
}

export type Message = {
    id: string
    role: string
    body: string
    weight: number
    createTime?: number
    model?: string
    customInstructions?: string
    children: Message[]
    thoughts?: Thought[]
}

export type Thought = {
    summary: string
    content: string
    chunks: string[]
}

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
