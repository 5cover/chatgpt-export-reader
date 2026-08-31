import type { ArtifactTree, Chat, OutputFormat } from '../../types.js'
import { artifactTree } from '../artifact-tree.js'

export default class JsonOutput implements OutputFormat {
    async render(chats: AsyncIterable<Chat>): Promise<ArtifactTree> {
        const root = artifactTree()

        for await (const chat of chats) {
            root.set(chat.id, JSON.stringify(chat, null, 2))
        }

        return root
    }
}
