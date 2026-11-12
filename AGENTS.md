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
- `pnpm lint` - run strict ESLint checks across all workspace code, tests, and tooling, including dashboard CSS and HTML.
- `pnpm lint:fix` - apply automatic ESLint fixes across the workspace.
- `pnpm test:lint` - verify lint rule enforcement and ignored paths.
- `node dist/cli.js` — run the built CLI after a successful build.

Use `pnpm build:all` before `pnpm lint` so workspace package declarations are available for type-aware linting. Run `pnpm test:lint`, `pnpm --filter @chatgpt-export-reader/core test`, and `pnpm --filter chatgpt-export-reader test` as the minimum validation before submitting changes.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. Follow the existing style in the repo:

- Use the global Prettier configuration in the root `package.json` for formatting, including 2-space indentation.
- ES modules with explicit `.js` import specifiers in source files.
- Prefer `type` over `interface` where possible; ESLint enforces this.
- Use descriptive lower-case filenames with hyphens for utilities (for example `fast-markdown.ts`).
- Keep parsing, transformation, and output concerns separated by directory.

## Dashboard UI Guidelines

- Use a consistent sans-serif default for controls, metrics, tables, and routine UI copy. Reserve serif typography for editorial hero text or substantial prose where it adds meaning.
- Reuse shared visual patterns for indicators, project names, buttons, and lists. Related units of one quantity belong in one indicator, with a clear primary and secondary value.
- Keep overview indicators focused on user-facing insights. Put coverage, missing-data, and algorithm details near the relevant chart or in secondary notes.
- Avoid nested headings, repeated section labels, and one-item accordions. Related content should follow the control or chart that drives it.
- When a chart setting changes, update the plotted data and retain the user's zoom unless the underlying date range changes. Check behavior, not only labels, when validating chart controls.
- Check full-width and narrow layouts for dense tables and prompt builders. Keep the recap prompt visible beside module controls on wide screens, and explain each optional module.

Do not hand-format around lint rules; run ESLint and keep changes minimal.

## Testing Guidelines

Core and CLI regression tests live in their package's `test/` directories; lint configuration tests live in the root `test/` directory. When adding coverage, prefer focused tests close to the affected module. Verify edge cases around branching conversations, empty content, and export schema variations.

## Commit & Pull Request Guidelines

Recent commits use short, direct subjects such as `markdown output` and `fixed stack overflow and instruction link behavior`. Follow that pattern: brief imperative summaries, no prefix clutter unless the change genuinely needs it.

Pull requests should include:

- a short description of the behavior change,
- the commands used for validation,
- sample input/output notes when Markdown generation changes,
- screenshots only if rendered output or file layout is easier to review visually.

## Configuration Notes

Treat exported chat data as untrusted input. Preserve filename sanitization and avoid committing personal export files or generated Markdown unless the PR explicitly requires fixtures.
