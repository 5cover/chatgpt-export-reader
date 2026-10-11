import {
  buildRecap,
  createRecapPrompt,
  serializeRecapToon,
  serializeRecapYaml,
  type RecapContextFormat,
  type RecapOptions,
} from "@chatgpt-export-reader/core";
import type { ArtifactTree, Chat, OutputFormat } from "../../types.js";
import { artifactTree } from "../artifact-tree.js";

export default class RecapOutput implements OutputFormat {
  constructor(
    private readonly options: RecapOptions,
    private readonly contextFormat: RecapContextFormat = "yaml",
  ) {}

  async render(chats: AsyncIterable<Chat>): Promise<ArtifactTree> {
    const source: Chat[] = [];
    for await (const chat of chats) source.push(chat);
    const document = buildRecap(source, this.options);
    const root = artifactTree();
    const contextName = `recap-context.${this.contextFormat}`;
    const context =
      this.contextFormat === "yaml"
        ? serializeRecapYaml(document)
        : serializeRecapToon(document);
    root.set(contextName, context);
    root.set(
      "recap-prompt.md",
      createRecapPrompt(this.options.promptStyle, this.contextFormat),
    );
    return root;
  }
}
