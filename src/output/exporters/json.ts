import type { Writable } from 'stream'
import type { ArtifactTree, Exporter } from '../../types.js'
import { isArtifactTree } from '../artifact-tree.js'
import { writeToStream } from './flat.js'

export type JsonExporterOptions = {
    stream: Writable
}

export default class JsonArtifactExporter implements Exporter {
    private readonly stream: Writable

    constructor(options: JsonExporterOptions) {
        this.stream = options.stream
    }

    async export(artifacts: ArtifactTree): Promise<void> {
        await writeToStream(this.stream, JSON.stringify(toJsonValue(artifacts), null, 2))
    }
}

function toJsonValue(artifacts: ArtifactTree): Record<string, string | Record<string, unknown>> {
    return Object.fromEntries(
        [...artifacts].map(([key, value]) => [
            key,
            isArtifactTree(value) ? toJsonValue(value) : value,
        ]),
    )
}
