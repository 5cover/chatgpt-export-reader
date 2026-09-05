import type { ArtifactTree } from "../types.js";

export function artifactTree(): ArtifactTree {
  return new Map();
}

export function isArtifactTree(
  value: string | ArtifactTree,
): value is ArtifactTree {
  return value instanceof Map;
}

export function addArtifact(
  root: ArtifactTree,
  path: readonly string[],
  artifact: string | ArtifactTree,
): void {
  if (path.length === 0) throw new Error("artifact path cannot be empty");

  let current = root;
  for (const segment of path.slice(0, -1)) {
    const existing = current.get(segment);
    if (existing === undefined) {
      const next = artifactTree();
      current.set(segment, next);
      current = next;
      continue;
    }
    if (!isArtifactTree(existing))
      throw new Error(`artifact path conflict at ${segment}`);
    current = existing;
  }

  const leaf = path[path.length - 1]!;
  if (current.has(leaf))
    throw new Error(`duplicate artifact path: ${path.join("/")}`);
  current.set(leaf, artifact);
}

export function deduplicateName(
  parent: ArtifactTree,
  preferred: string,
): string {
  if (!parent.has(preferred)) return preferred;

  let index = 1;
  while (parent.has(suffixedName(preferred, index))) index++;
  return suffixedName(preferred, index);
}

function suffixedName(name: string, index: number) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name} ${index}`;
  return `${name.slice(0, dot)} ${index}${name.slice(dot)}`;
}
