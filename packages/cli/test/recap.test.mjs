import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const cliRoot = new URL("..", import.meta.url);

test("recap emits separate filtered YAML artifacts by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-recap-cli-"));
  try {
    const input = join(directory, "conversations.json");
    const output = join(directory, "out");
    await writeFile(input, JSON.stringify([fixture("included"), fixture("excluded")]), "utf8");

    await run([
      "recap",
      input,
      "--export-format", "filesystem",
      "--fs-path", output,
      "--chat", "included",
      "--start-date", "2025-10-11",
      "--end-date", "2025-10-11",
      "--context-messages", "1",
      "--recap-style", "reflective",
      "--repeated-phrase-percentile", "100",
    ]);
    assert.deepEqual((await readdir(output)).sort(), ["recap-context.yaml", "recap-prompt.md"]);
    const context = await readFile(join(output, "recap-context.yaml"), "utf8");
    const prompt = await readFile(join(output, "recap-prompt.md"), "utf8");
    assert.match(context, /included title/);
    assert.match(context, /minimumScorePercentile: 100/);
    assert.doesNotMatch(context, /excluded title/);
    assert.match(prompt, /thoughtful retrospective/);
    assert.match(prompt, /accompanying YAML/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recap emits TOON context and updates its prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-recap-cli-"));
  try {
    const input = join(directory, "conversations.json");
    const output = join(directory, "out");
    await writeFile(input, JSON.stringify([fixture("included")]), "utf8");

    await run([
      "recap",
      input,
      "--export-format", "filesystem",
      "--fs-path", output,
      "--context-format", "toon",
    ]);
    assert.deepEqual((await readdir(output)).sort(), ["recap-context.toon", "recap-prompt.md"]);
    assert.match(await readFile(join(output, "recap-context.toon"), "utf8"), /conversations\[1\]/);
    assert.match(await readFile(join(output, "recap-prompt.md"), "utf8"), /accompanying TOON/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recap CLI reports invalid scoped options", async () => {
  await assert.rejects(
    run(["recap", "ignored.json", "--recap-style", "unknown"]),
    /unknown recap style: unknown/,
  );
  await assert.rejects(
    run(["recap", "ignored.json", "--context-messages", "-1"]),
    /--context-messages must be a non-negative integer/,
  );
  await assert.rejects(
    run(["recap", "ignored.json", "--context-format", "unknown"]),
    /unknown recap context format: unknown/,
  );
  await assert.rejects(
    run(["recap", "ignored.json", "--repeated-phrase-percentile", "101"]),
    /--repeated-phrase-percentile must be a number from 0 to 100/,
  );
  await assert.rejects(
    run(["stats", "ignored.json", "--recap-style", "narrative"]),
  );
  await assert.rejects(
    run(["recap", "ignored.json", "--output-format", "recap"]),
  );
});

async function run(argumentsList) {
  try {
    return await execFile(process.execPath, ["dist/cli.js", ...argumentsList], {
      cwd: new URL(".", cliRoot),
    });
  } catch (error) {
    if (error instanceof Error && "stderr" in error)
      error.message += `\n${String(error.stderr)}`;
    throw error;
  }
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
