import type { Writable } from "stream";
import type { ArtifactTree, Exporter } from "../../types.js";
import { isArtifactTree } from "../artifact-tree.js";

export type FlatExporterOptions = {
  stream: Writable;
};

export default class FlatExporter implements Exporter {
  private readonly stream: Writable;

  constructor(options: FlatExporterOptions) {
    this.stream = options.stream;
  }

  async export(artifacts: ArtifactTree): Promise<void> {
    const chunks: string[] = [];
    collectStrings(artifacts, chunks);
    await writeToStream(this.stream, chunks.join("\n\n"));
  }
}

function collectStrings(tree: ArtifactTree, chunks: string[]): void {
  for (const [, value] of tree) {
    if (isArtifactTree(value)) {
      collectStrings(value, chunks);
      continue;
    }
    chunks.push(value);
  }
}

export async function writeToStream(
  stream: Writable,
  content: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(content, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
