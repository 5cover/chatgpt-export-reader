type Part = string | false | null | undefined | readonly Part[];

export class FastMarkdown {
  private readonly out: string[] = [];

  heading(depth: number, text: string): this {
    this.out.push(`${"#".repeat(depth)} ${escapeText(text)}\n\n`);
    return this;
  }

  paragraph(parts: Part | readonly Part[]): this {
    this.out.push(flatten(parts).join(""), "\n\n");
    return this;
  }

  list(items: readonly Part[]): this {
    for (const item of items) {
      this.out.push(
        "- ",
        flatten(item).join("").replaceAll("\n", "\n  "),
        "\n",
      );
    }
    this.out.push("\n");
    return this;
  }

  thematicBreak(): this {
    this.out.push("-\n\n");
    return this;
  }

  markdown(content: string, parentHeadingDepth: number): this {
    const shifted = trimLineEnds(
      shiftMarkdownHeadings(content, parentHeadingDepth),
    ).trimEnd();
    if (shifted) this.out.push(shifted, "\n\n");
    return this;
  }

  toString(): string {
    return this.out.join("").trimEnd() + "\n";
  }
}

export function inlineCode(value: string) {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

export function time(timestamp: number) {
  const dt = new Date(timestamp);
  return `<time datetime="${dt.toISOString()}">${dt.toLocaleString()}</time>`;
}

export function link(url: string, text: string) {
  return `[${escapeLinkText(text)}](<${url.replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`;
}

export function shiftMarkdownHeadings(
  content: string,
  parentHeadingDepth: number,
) {
  const lines = content.split("\n");
  let fenced = false;
  let fence: string | undefined;

  return lines
    .map((line) => {
      const fenceMatch = /^( {0,3})(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[2]![0]!;
        if (!fenced) {
          fenced = true;
          fence = marker;
        } else if (fence === marker) {
          fenced = false;
          fence = undefined;
        }
        return line;
      }

      if (fenced) return line;

      return line.replace(
        /^( {0,3})(#{1,6})(?=\s|$)/,
        (_, indent: string, hashes: string) => {
          return `${indent}${"#".repeat(Math.min(6, hashes.length + parentHeadingDepth))}`;
        },
      );
    })
    .join("\n");
}

function flatten(part: Part | readonly Part[]): string[] {
  if (!part) return [];
  if (typeof part === "string") return [part];
  return part.flatMap(flatten);
}

function trimLineEnds(content: string) {
  return content.replaceAll(/[ \t]+$/gm, "");
}

function escapeText(text: string) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function escapeLinkText(text: string) {
  return escapeText(text).replaceAll("\n", " ");
}
