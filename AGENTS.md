# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript workspace for reading and investigating ChatGPT exports.

- `packages/core/src/` owns normalization, analytics, timing, evidence, and recap semantics.
- `packages/cli/src/` owns command-line import and output.
- `apps/dashboard/src/` owns browser-local exploration and worker orchestration.
- Core and CLI tests live in their package's `test/` directories. Dashboard browser regressions live in `apps/dashboard/test/`.
- `apps/dashboard/ROADMAP.md` records the dashboard's design rationale and completion evidence.
- `dist/` is generated output and must not be edited manually.

Keep personal exports and generated output outside source and version control.

## Build, Test, and Development Commands

- `pnpm build` - compile the core and CLI workspace packages.
- `pnpm lint` - run strict ESLint checks across all workspace code, tests, and tooling, including dashboard CSS and HTML.
- `pnpm lint:fix` - apply automatic ESLint fixes across the workspace.
- `pnpm test:lint` - verify lint rule enforcement and ignored paths.
- `pnpm --filter @chatgpt-export-reader/dashboard test` - run dashboard interaction and accessibility regressions using an installed Chromium. Set `BROWSER_PATH` when it is not at `/usr/bin/chrome`; never download a browser automatically.
- `node packages/cli/dist/cli.js` - run the built CLI.

Use `pnpm build:all` before `pnpm lint` so workspace package declarations are available for type-aware linting. Run `pnpm test:lint`, `pnpm --filter @chatgpt-export-reader/core test`, and `pnpm --filter chatgpt-export-reader test` as the minimum validation before submitting changes. For dashboard behavior changes, also run the dashboard browser suite. It starts a localhost server and may need an environment that permits local sockets.

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
- Treat period, timezone, and project as one analysis scope. Keep scope separate from chart zoom, preserve it through evidence drill-downs, and make recap overrides explicit. A project filter must not silently shrink the comparison period.
- Distinguish message-date filtering from calendar padding. Inactive days belong in comparable periods, but missing export history must not be presented as proven inactivity.
- Keep metric meaning, aggregation, units, and precision consistent through shared definitions and value components. Label cumulative first-reply delay separately from typical latency or compute time.
- Use native controls with visible labels, announced selected states, keyboard alternatives for charts, and predictable focus restoration. Test rendered accessibility as well as source lint rules.
- Keep independent message requests independent. Cancel stale view queries on scope changes or navigation; share a typed worker protocol and surface worker failures with a recovery path.
- Validate every project-name write through the same rules. Preserve valid stored names when recovering malformed entries, and surface storage failures.
- Bound table and plot rendering for large exports. Run expensive optional analysis only on demand, and give aggregate views a clear path to their underlying evidence.
- Dashboard regression fixtures must be synthetic. Cover reset and clearing semantics, independent loads, data-changing measure switches, zoom, naming, recap artifact lifetime, and narrow layouts. Do not validate only labels or mirror implementation internals.

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
