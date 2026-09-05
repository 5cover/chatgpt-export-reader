import { mkdir, writeFile } from "fs/promises";
import p from "path";
import type { ArtifactTree, Exporter } from "../../types.js";
import { isArtifactTree } from "../artifact-tree.js";

export type FilesystemExporterOptions = {
  path: string;
};

export default class FilesystemExporter implements Exporter {
  private readonly path: string;

  constructor(options: FilesystemExporterOptions) {
    this.path = p.resolve(options.path);
  }

  async export(artifacts: ArtifactTree): Promise<void> {
    const entries = [...artifacts.entries()];
    if (entries.length === 1) {
      const [, value] = entries[0]!;
      if (!isArtifactTree(value)) {
        await mkdir(p.dirname(this.path), { recursive: true });
        await writeFile(this.path, value);
        return;
      }
    }

    await mkdir(this.path, { recursive: true });
    await writeTree(this.path, artifacts);
  }
}

async function writeTree(root: string, artifacts: ArtifactTree): Promise<void> {
  for (const [name, value] of artifacts) {
    const target = p.join(root, name);
    if (isArtifactTree(value)) {
      await mkdir(target, { recursive: true });
      await writeTree(target, value);
      continue;
    }
    await writeFile(target, value);
  }
}
