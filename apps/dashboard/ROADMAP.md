# Dashboard roadmap implementation record

Implemented on 2026-11-12. The original audit below is retained as design rationale; its old line references describe the audited version, not the current source.

## Completed

- [x] Fix all ten correctness defects: explicit reset and search clearing, independent message loads, uniform project-name validation and recovery, responsive chart sizing, domain-aware zoom, recap evidence lifetime, safe route parsing, timezone-consistent timestamps, and timeline-to-outline disclosure.
- [x] Introduce shared analysis scope with inclusive dates, timezone, project, session definition, URL serialization, and visible applied scope. Keep chart viewport separate. Keep sparse projects on the same calendar and preserve untimed all-history activity.
- [x] Compare equal-length periods, distinguish active-day frequency from prompting depth, show project-share changes, and warn about insufficient export coverage. Remove the arbitrary two-hour threshold rather than implying a universal excessive-use limit.
- [x] Reduce Overview to four primary indicators; move text volume, cumulative reply delay, and data coverage to supporting views. Use shared metric definitions, related-unit displays, and nonzero duration precision.
- [x] Organize Overview, Time and rhythm, Projects, Conversations, and Recap around investigation and evidence, not a hierarchy of accordions. Compact the repeated hero and remove redundant headings.
- [x] Provide native labelled choices, current navigation state, route focus and titles, announced statuses, keyboard date selection, daily data alternatives, focus-safe inline renaming, and keyboard mapping import.
- [x] Preserve disclosure contents and exploration state; make message disclosures truly expandable, including empty content. Associate prompt-module descriptions without overriding visible names.
- [x] Replace the unreadable narrow-screen calendar with a seven-column month view and explicit evidence links. Bound and label the session plot; link sessions to every contributing conversation rather than only one.
- [x] Make projects addressable and sortable, offer a dashboard-wide project lens, and carry friendly project identity into conversations and recap evidence.
- [x] Separate recap scope/evidence settings from prompt composition, place downloads next to generation, and retain copy feedback only for the prompt actually copied.
- [x] Split application orchestration from pages, domain components, routing, formatting, worker protocol/client, and metric definitions. Share chart, evidence, project identity, file-button, choice, and table behavior.
- [x] Add bounded tables with optional columns, bounded plots and analysis caches, on-demand repeated-language analysis, debounced search, bounded import diagnostics, and recoverable worker failures.
- [x] Add browser interaction and accessibility regressions using synthetic exports and an installed browser, plus core regressions for calendar padding, timezone boundaries, project identity, and punctuation-independent phrase evidence.
- [x] Update repository guidance and validation documentation to preserve these domain and interaction rules.

## Sources of truth and validation

- Scope: [analysis-scope.ts](src/analysis-scope.ts), [scope-controls.tsx](src/scope-controls.tsx).
- Chart and metric semantics: [daily-series-chart.tsx](src/daily-series-chart.tsx), [metric-definitions.ts](src/metric-definitions.ts), [methodology.tsx](src/methodology.tsx).
- Evidence: [conversation-view.tsx](src/conversation-view.tsx), [temporal-view.tsx](src/temporal-view.tsx), [session-evidence.tsx](src/session-evidence.tsx), [worker-message.tsx](src/worker-message.tsx).
- Identity and composition: [project-identity.tsx](src/project-identity.tsx), [projects.tsx](src/projects.tsx), [recap-view.tsx](src/recap-view.tsx).
- Regression suite: [dashboard.test.mjs](test/dashboard.test.mjs). Run `pnpm --filter @chatgpt-export-reader/dashboard test`; set `BROWSER_PATH` for an existing Chromium outside the documented default. No browser downloads are performed.
- The deployment workflow also runs core, CLI, and production-dashboard interaction/accessibility regressions using an installed Chromium.
- Minimum checks: `pnpm build:all`, `pnpm lint`, `pnpm test:lint`, core and CLI tests, and the dashboard browser suite.

Final verification passed: workspace build, strict lint, lint-configuration tests, core and CLI regressions, formatting, and all 11 production-browser tests. The browser suite was also verified with the GitHub Pages base path; it includes axe checks on every page and the narrow calendar. Synthetic desktop and narrow viewport screenshots were visually reviewed.

No major product decision remains necessary for this roadmap. Personal budgets, normative usage limits, and automatic judgments about productivity or wellbeing are deliberately not inferred from timestamps.

---

## Original audit

## Overall assessment

**The dashboard currently exposes its calculations more successfully than it supports an investigation.** A power user can inspect many statistics, but answering “What changed, what drove it, and which conversations explain it?” requires manually connecting views that do not share enough context.

This needs more than visual cleanup. The main opportunities are:

1. Make scope and selection consistent.
2. Make metrics interpretable and comparable.
3. Connect every useful aggregate to evidence.
4. Establish reusable domain components that enforce those behaviors.

I reviewed all dashboard source files, CSS, HTML, and configuration, and exercised key workflows in Chromium with synthetic exports. No repository files were changed.

## Project-specific audit criteria

| Criterion                  | What correctness means for this dashboard                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope integrity**        | Period, timezone, project, and selected day remain explicit and consistent across summaries, charts, tables, and exports.                |
| **Metric honesty**         | Counts, estimated interaction time, cumulative reply delay, session span, and conversation lifetime cannot be mistaken for one another.  |
| **Diagnostic usefulness**  | A view helps answer a usage question, not merely display an available calculation.                                                       |
| **Evidence continuity**    | A trend leads to contributing projects, conversations, and messages without losing the investigation context.                            |
| **Comparison quality**     | Changes account for period length, inactive days, and incomplete evidence; raw lifetime totals are not the only perspective.             |
| **Project identity**       | Friendly names are validated, persisted, and resolved consistently wherever projects appear.                                             |
| **Interaction integrity**  | Reset clears, selection is visible, independent requests do not cancel each other, and presentation changes preserve exploration state.  |
| **Accessible exploration** | Keyboard and nonvisual users can select dates, understand selected measures, inspect chart values, rename projects, and import mappings. |
| **Power-user scale**       | Thousands of conversations remain searchable, sortable, navigable, and responsive without overwhelming markup or controls.               |
| **Maintainable semantics** | Shared components encode these rules; markup, worker contracts, formatting, and regression tests reinforce them.                         |

## 1. Confirmed correctness defects

### High priority

**1. “All time” does not clear the date filter.**

`applyOptions(nextStartDate = startDate)` treats explicitly passing `undefined` as “reuse the existing date.” Both the reset button and clearing the date input take that path.

Browser reproduction: filtering to February reduced the fixture to 29 chats; clicking All time retained both the filter and 29 chats.

Fix the distinction between “argument omitted” and “clear this value.” Prefer an explicit options object over positional defaults.

Evidence: [app.tsx:422](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:422), [reset handlers](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:565).

**2. Clearing message search leaves the previous filter applied.**

`loadOutline` defaults an undefined query to `outlineQueryRef.current`. The search handler passes undefined when clearing, before that ref reflects the new empty state.

Browser reproduction: search for a nonexistent phrase, then clear the field. The textbox becomes empty while the outline still reports zero matches.

Evidence: [app.tsx:139](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:139), [search handler](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:623).

**3. Independent message loads incorrectly cancel each other.**

All message-content requests share one `activeContent` request ID. Opening a second message before the first response arrives causes the first response to be discarded. Temporal evidence uses the same approach.

Browser reproduction: opening two messages quickly expanded only the second.

“Latest request wins” is appropriate for replacing a search result, not independently loading multiple messages. These need per-message pending state or batched requests.

Evidence: [request creation](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:446), [response handling](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:304).

**4. Inline project naming can invalidate the entire stored mapping.**

Import/read validation rejects names longer than 200 characters, but inline editing accepts and saves them. The next read catches that validation failure and returns an empty mapping.

Browser reproduction: a 201-character name saved and displayed, then all friendly names disappeared after leaving and reopening Projects. The stored mapping remains recoverable, but becomes unreadable to the application.

Use the same validation for every write path; do not silently discard all valid entries because one entry is invalid.

Evidence: [projects.tsx:15](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/projects.tsx:15), [validation and persistence](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/projects.tsx:17).

### Other significant defects

**5. Charts do not resize with their containers.**

Both charts read width only when constructed. Neither observes subsequent container resizing.

In Chromium, resizing from desktop to a 390px viewport left a 1,293px plot inside a 305px container. CSS clips it, so users lose access to part of the chart.

Evidence: [daily-chart.tsx:35](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/daily-chart.tsx:35), [timing-chart.tsx:17](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/timing-chart.tsx:17).

**6. Zoom preservation is incomplete and sometimes inappropriate.**

Zoom is restored without checking whether the underlying date range changed. Conversely, closing an accordion unmounts the chart and loses its metric and zoom state entirely.

The intended rule should be explicit: preserve exploration when changing presentation; reconcile or reset it when changing scope.

Evidence: [daily-chart.tsx:81](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/daily-chart.tsx:81), [Accordion unmounting](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:900).

**7. Changing prompt modules unnecessarily invalidates recap evidence.**

Every recap setting change revokes the generated download, including module toggles that only affect the prompt. Confirmed in Chromium.

The download also appears after the potentially very long prompt preview, spatially separating generation from its result.

Separate evidence-generation settings from prompt-composition settings, and keep the generated artifact beside its generation controls.

Evidence: [app.tsx:475](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:475), [results placement](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:838).

**8. Malformed conversation URLs can blank the application.**

`decodeURIComponent(section)` is unguarded. Loading `#/conversations/%` produced an uncaught exception and an empty application.

Evidence: [app.tsx:1879](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1879).

**9. Some displayed dates ignore the selected timezone.**

Session cards and tables use `formatDate`, which always uses the browser timezone, while the surrounding dashboard can be in UTC mode.

Evidence: [session cards](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1692), [formatter](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1919).

**10. Timeline selection does not reliably reveal the promised evidence.**

Selecting a timeline bin loads an outline page but does not open the collapsed Message outline section. An existing search also remains active, although bin indices refer to the unfiltered timeline.

This can make a successful click appear ineffective or show evidence unrelated to the selected bin.

Evidence: [timeline handler](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1350), [outline](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1352).

## 2. Accessibility and semantic markup

### Primary chart exploration is mouse-only

Daily selection depends on a click listener over the plot. There is no equivalent keyboard date selector or accessible daily data view covering both measures.

Adding an accessible name to a canvas container does not expose the plotted values or its interaction.

Provide a shared selected-day control and an accessible table representation of the same data.

Evidence: [daily-chart.tsx:61](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/daily-chart.tsx:61), [timing-chart.tsx:19](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/timing-chart.tsx:19).

### Selected controls expose state visually, not semantically

Calendar mode, daily measure, timing measure, and message order use an `.active` class without corresponding selected/pressed state. Navigation likewise lacks `aria-current`.

Chromium’s accessibility tree exposed these as ordinary buttons and links without their selection state.

Use a shared, labelled single-choice control, preferably native radio inputs where appropriate.

Evidence: [calendar controls](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:693), [measure controls](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:939), [navigation](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:638).

### Project import is not keyboard-operable

Import names is a label around a `display:none` file input. Neither element provides a keyboard-focusable action. It was absent from the browser’s accessible controls.

The main export importer already uses a real button connected to a hidden input; reuse that implementation.

Evidence: [projects.tsx:57](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/projects.tsx:57), [style.css:97](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/style.css:97).

### Inline editing loses focus

After saving a project name with Enter, focus moved to the document body. Escape should also restore focus predictably.

An inline editor needs a full lifecycle: enter, focus/select, validate, save/cancel, announce errors, restore focus.

Evidence: [projects.tsx:8](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/projects.tsx:8).

### Loading, errors, and navigation lack announcement/focus management

Most status updates are ordinary text. Route changes do not move focus to the new page heading or update the document title. Users can remain focused on navigation while the page changes elsewhere.

Evidence: [worker initialization and routing](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:192), [Status](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1788).

### Disclosure and document structure are inconsistent

- Accordion headings and their contents repeatedly use the same `h2` level.
- Repeated-language analysis nests accordions at that same level.
- Message buttons indicate expansion but cannot collapse loaded content.
- Empty loaded messages can report expanded without rendering a content panel.
- Search fields rely on placeholders rather than persistent visible labels.
- Recap checkbox `aria-label`s override richer visible names such as “Room portrait”; descriptions are not separately associated.

These are not all invalid HTML. They are failures to express the actual information and interaction hierarchy.

Evidence: [Accordion](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:877), [message disclosure](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1373), [module controls](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:840).

## 3. Design and ergonomics critique

### The overview does not establish a hierarchy

There are still **eight** headline cards, so the earlier fewer-than-eight requirement was not fulfilled.

More importantly, chats, sessions, estimated use, cumulative delay, prompts, text volume, and output/input ratio receive almost equal visual weight. Their importance to understanding usage is very different.

The large persistent masthead, import actions, toolbar, and cards consume much of the first screen before showing an actual trend.

Evidence: [Overview](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:920).

**Recommendation:** prioritize estimated interaction time, prompting activity, active-day rhythm, and project allocation. Treat output volume and reply delay as secondary analytical lenses.

### There is no dependable shared scope

The main dashboard has a start date but no end date. Recap has its own period and timezone, initialized only once. Project selection is local component state. Chart zoom is another independent period.

Consequently, “the period I am studying” has several competing meanings.

**Recommendation:** establish a visible scope consisting of period, timezone, and optional project. Distinguish scope from chart viewport. Allow recap to inherit that scope, with an explicit override.

### The design favors totals over explanations

Lifetime totals tell users how much history they imported. They say much less about current behavior.

There is no first-class previous-period comparison, project-share evolution, or easy distinction between “more active days” and “more intense active days.”

The fixed “2 hours or more” sentence introduces a significance threshold without explaining why it matters to this user.

Evidence: [time summary](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:932).

**Recommendation:** compare equivalent periods and expose drivers. If a time budget exists, make it a personal reference, not an implied universal threshold for excessive use.

### Projects are treated as an administrative table, not an analytical lens

The main project table cannot sort by time or volume. All overview project links lead to the generic Projects page, not the named project. Details appear below the table without navigation or focus feedback.

Conversation views do not carry the project context forward.

Evidence: [project links](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:934), [Projects](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/projects.tsx:60).

**Recommendation:** give projects addressable detail views and make project selection a reusable filter throughout the dashboard.

### “Patterns” mostly means session statistics

The name promises behavioral understanding, but the page concentrates on session size, start times, and continuation.

The scatter plot has no numeric axis labels, uses tiny overlapping links, and opens the first conversation of a potentially multi-conversation session. Repeated phrases elsewhere primarily support copying, not investigating occurrences.

Evidence: [Patterns](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:974), [scatter](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1631), [phrase interaction](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1448).

These views need clearer questions and evidence paths, not additional indicators.

### Units and terminology still drift

- Words and characters remain separate temporal-summary cards.
- Conversation tables separate word and character quantities differently.
- Projects use rounded minutes; other views use hours/minutes.
- Small nonzero durations display as `0m`.
- “Reply latency” is a cumulative duration, not a typical latency.
- “Longest sessions” actually means sessions with the most prompts.

Evidence: [temporal indicators](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1163), [conversation columns](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1960), [duration formatting](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:1931).

A metric needs a shared definition, aggregation label, unit formatting, and explanation.

### Responsive behavior sacrifices usability

At 390px, navigation overflowed the page. Calendar cells were approximately 7px wide, their numbers transparent, and their tooltips available only through nonfocusable cells. Avoiding horizontal scrolling has removed practical access to values.

Evidence: [navigation CSS](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/style.css:360), [calendar CSS](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/style.css:641).

A compact calendar should have a usable selected-day inspector or an alternative layout, not merely smaller cells.

## 4. Architecture and reusable capabilities

The most valuable extractions are domain components, not a generic collection of cards.

| Capability                              | Responsibility it should enforce                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **AnalysisScope**                       | Applied period, timezone, project, reset semantics, and scope serialization.                                     |
| **MetricDefinition / MetricValue**      | Meaning, aggregation, related units, duration precision, missing values, and methodology links.                  |
| **DailySeriesChart**                    | Shared sizing, date mapping, zoom policy, selection, rolling mean, empty state, and accessible data alternative. |
| **ProjectIdentity / ProjectNameEditor** | One reactive name store, consistent validation, focus restoration, persistence errors, and project links.        |
| **MessageEvidence**                     | Metadata, independent loading state, expandable content, errors, and stable message identity.                    |
| **EvidenceTable**                       | Existing sorting plus labels, empty state, pagination, consistent numeric formatting, and optional columns.      |
| **RecapComposer**                       | Separate evidence settings, prompt settings, generation state, artifact availability, and copy feedback.         |

Specific structural concerns:

- **`app.tsx` owns too many responsibilities:** routing, worker orchestration, all page states, formatting, chart adapters, tables, and most views.
- **Worker contracts are duplicated:** request/response types are separately maintained, while the UI casts received messages. Share a typed protocol and request client. [app.tsx:2080](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:2080), [stats-worker.ts:30](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/stats-worker.ts:30).
- **Worker lifecycle failures are not handled:** there is no worker `error`/`messageerror` recovery path.
- **Import failures lose useful diagnostics:** normalization catches every exception and retains only a skipped count. Users cannot distinguish unsupported records from malformed data or investigate their effect. [stats-worker.ts:350](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/stats-worker.ts:350).
- **Expensive work is unnecessarily eager:** repeated-language analysis starts on conversation entry even when its section remains closed. [app.tsx:237](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/app.tsx:237).
- **Large collections are rendered wholesale:** conversation tables and scatter points have no bounded rendering strategy.
- **CSS encodes structural accidents:** accordion rules strip styling from nested cards instead of components expressing their intended presentation. Multiple control variants duplicate almost identical styles. [style.css:607](/home/raphael/repos/chatgpt-export-reader/apps/dashboard/src/style.css:607).

The existing `SortableTable` and `HeatmapTable` are useful foundations. Local worker processing, escaped message text, archive expansion limits, and separation of core analytics are also worth preserving.

## 5. Recommended coherent ensemble

Organize the experience around this investigation:

**Choose a period → understand change → identify contributors → inspect evidence → prepare a recap.**

Suggested responsibilities:

- **Overview:** a small synthesis of the selected period, comparisons, and major contributors.
- **Time and rhythm:** interaction-time estimates, daily/weekly patterns, and clearly distinguished session structure.
- **Projects:** thematic allocation, project trends, and contributing conversations.
- **Conversations:** a searchable evidence library with project and period context.
- **Recap:** export the current investigation into configurable evidence and instructions.

Accordions should disclose optional detail, not define the entire information architecture.

## Validation and next priorities

Passed:

- `pnpm build:all`
- `pnpm lint`
- `pnpm test:lint`
- Core and CLI tests

Browser checks included desktop/narrow layouts, accessibility-tree inspection, import, filtering, recap generation, message loading, naming, and malformed routes. This was not a full assistive-technology conformance assessment.

**Recommended sequence:** fix reset/search/request/name defects first; establish shared scope and metric semantics second; consolidate chart and evidence interactions third. Add dashboard interaction regressions around those behaviors. The current linting is valuable, but the confirmed failures demonstrate the missing behavioral coverage.
