# Repository Guidelines

## Project Structure & Module Organization

This repository is a small TypeScript CLI for turning ChatGPT exports into Markdown.

- `src/cli.ts` is the current entry point.
- `src/input/` contains import and parsing logic for export formats.
- `src/output/` contains Markdown rendering and file-writing logic.
- `src/lib/` holds shared transformation helpers such as tree linearization and Markdown utilities.
- `src/types.ts` defines shared types.
- `dist/` is the build output from TypeScript and should not be edited manually.

Keep sample exports and generated output outside `src/` (for example `exports/` and `out/` as used by `src/cli.ts`).

## Build, Test, and Development Commands

- `pnpm build` — compile TypeScript from `src/` to `dist/`.
- `pnpm lint src` — run ESLint on the source tree.
- `node dist/cli.js` — run the built CLI after a successful build.

There is currently no real test script; `pnpm test` intentionally fails. Until a test suite exists, use `pnpm build` and `pnpm lint src` as the minimum validation before submitting changes.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. Follow the existing style in the repo:

- 4-space indentation.
- ES modules with explicit `.js` import specifiers in source files.
- Prefer `type` over `interface` where possible; ESLint enforces this.
- Use descriptive lower-case filenames with hyphens for utilities (for example `fast-markdown.ts`).
- Keep parsing, transformation, and output concerns separated by directory.

Do not hand-format around lint rules; run ESLint and keep changes minimal.

## Testing Guidelines

There is no committed test suite yet. When adding coverage, prefer focused tests close to the affected module, using names like `linearizer.test.ts` or `markdown.test.ts`. Verify edge cases around branching conversations, empty content, and export schema variations.

## Commit & Pull Request Guidelines

Recent commits use short, direct subjects such as `markdown output` and `fixed stack overflow and instruction link behavior`. Follow that pattern: brief imperative summaries, no prefix clutter unless the change genuinely needs it.

Pull requests should include:

- a short description of the behavior change,
- the commands used for validation,
- sample input/output notes when Markdown generation changes,
- screenshots only if rendered output or file layout is easier to review visually.

## Configuration Notes

Treat exported chat data as untrusted input. Preserve filename sanitization and avoid committing personal export files or generated Markdown unless the PR explicitly requires fixtures.
