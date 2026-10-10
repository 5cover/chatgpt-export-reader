import {
  buildRecap,
  createRecapPrompt,
  serializeRecapYaml,
  type RecapOptions,
} from "@chatgpt-export-reader/core";
import type { ArtifactTree, Chat, OutputFormat } from "../../types.js";
import { artifactTree } from "../artifact-tree.js";

export default class RecapOutput implements OutputFormat {
  constructor(private readonly options: RecapOptions) {}

  async render(chats: AsyncIterable<Chat>): Promise<ArtifactTree> {
    const source: Chat[] = [];
    for await (const chat of chats) source.push(chat);
    const document = buildRecap(source, this.options);
    const root = artifactTree();
    root.set("recap-context.yaml", serializeRecapYaml(document));
    root.set("recap-prompt.md", createRecapPrompt(this.options.promptStyle));
    return root;
  }
}
