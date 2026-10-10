import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const cliRoot = new URL("..", import.meta.url);

test("recap is registered and emits separate filtered artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-recap-cli-"));
  try {
    const input = join(directory, "conversations.json");
    const output = join(directory, "out");
    await writeFile(input, JSON.stringify([fixture("included"), fixture("excluded")]), "utf8");

    const formats = await run(["--output-formats"]);
    assert.match(formats.stdout, /recap: Generate editable recap evidence YAML/);
    await run([
      input,
      "--output-format", "recap",
      "--export-format", "filesystem",
      "--fs-path", output,
      "--chat", "included",
      "--start-date", "2025-10-11",
      "--end-date", "2025-10-11",
      "--context-messages", "1",
      "--recap-style", "reflective",
    ]);
    assert.deepEqual((await readdir(output)).sort(), ["recap-context.yaml", "recap-prompt.md"]);
    const context = await readFile(join(output, "recap-context.yaml"), "utf8");
    const prompt = await readFile(join(output, "recap-prompt.md"), "utf8");
    assert.match(context, /id: included/);
    assert.doesNotMatch(context, /id: excluded/);
    assert.match(prompt, /thoughtful retrospective/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recap CLI reports invalid styles and context budgets", async () => {
  await assert.rejects(
    run(["ignored.json", "--output-format", "recap", "--recap-style", "unknown"]),
    /unknown recap style: unknown/,
  );
  await assert.rejects(
    run(["ignored.json", "--output-format", "recap", "--context-messages", "-1"]),
    /--context-messages must be a non-negative integer/,
  );
});

async function run(argumentsList) {
  return execFile(process.execPath, ["dist/cli.js", ...argumentsList], {
    cwd: new URL(".", cliRoot),
  });
}

function fixture(id) {
  return {
    id,
    title: `${id} title`,
    create_time: 1760090400,
    update_time: 1760176800,
    conversation_template_id: null,
    is_archived: false,
    mapping: {
      root: {
        id: "root",
        parent: null,
        message: {
          weight: 1,
          create_time: 1760090400,
          author: { role: "user" },
          content: { content_type: "text", parts: ["Earlier context"] },
        },
      },
      reply: {
        id: "reply",
        parent: "root",
        message: {
          weight: 1,
          create_time: 1760176800,
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Selected answer"] },
        },
      },
    },
  };
}
