# PRD: Historical Usage Tracking for Codex Usage Limit Dashboard

## 1. Product overview

This document defines the first version of local historical usage tracking for
the project. The feature adds durable SQLite-backed storage for successful
usage fetches and exposes that history in both the CLI and the web UI.

### 1.1 Document title and version

This subsection identifies the document that engineering will implement.

- PRD: Historical Usage Tracking for Codex Usage Limit Dashboard
- Version: 1.0

### 1.2 Product summary

The project currently shows only the latest Codex usage snapshot. Each CLI
fetch and each web refresh discards prior state after rendering, which makes it
impossible to answer questions such as when quota dropped, how long a bucket
stayed unchanged, or whether a limit has been trending toward exhaustion.

This feature adds a local SQLite history store that records every successful
usage fetch while coalescing identical consecutive snapshots into a single
historical event. The result is a timeline of meaningful quota changes rather
than a noisy log of polling intervals. The CLI and web UI will both let the
user inspect that history, and the product will provide explicit manual cleanup
controls without any automatic retention deletion.

## 2. Goals

This section captures the intended outcomes for the feature and the boundaries
that keep the first release focused.

### 2.1 Business goals

These goals describe the product value of adding historical tracking.

- Make the tool materially more useful than a one-glance current-status panel.
- Increase trust in the tool by preserving quota changes instead of requiring
  the user to watch in real time.
- Keep the project local-first and lightweight, with no cloud dependency for
  storage or analytics.
- Preserve the project's terminal-native and low-friction character while
  expanding the use cases for the CLI and dashboard.

### 2.2 User goals

These goals describe what the developer using the tool needs to accomplish.

- See how quota changed over time without leaving the local tool.
- Tell whether a value is a new change or a long-running unchanged state.
- Inspect recent history quickly from the terminal.
- Visualize trends and recent change events in the browser dashboard.
- Remove saved history manually when desired.
- Avoid history noise from repeated identical refreshes across watch mode and
  the web dashboard.

### 2.3 Non-goals

These items are intentionally out of scope for the first release.

- Persisting failed fetches, unauthenticated responses, or transport errors as
  history rows.
- Adding cloud sync, multi-device sharing, or remote backups.
- Introducing automatic retention cleanup by age, row count, or database size.
- Building a general analytics platform or predictive quota forecasting.
- Exposing the SQLite database over a network or making the local API suitable
  for public deployment.

## 3. User personas

This section identifies the people and access patterns the feature must serve.

### 3.1 Key user types

The product remains focused on a narrow local-user audience.

- Solo developer using Codex locally throughout the day.
- Heavy watch-mode user who keeps the terminal or browser open during coding.
- Occasional reviewer who wants to inspect historical changes after a quota
  incident or suspected limit reset.

### 3.2 Basic persona details

The persona details describe the most important expectations for each user.

- **Primary developer**: Wants immediate current-state visibility and quick
  access to the last several meaningful quota changes.
- **Terminal-first user**: Prefers concise text summaries, flags, and JSON
  output over browser-only workflows.
- **Dashboard-oriented user**: Wants trend visibility, readable timestamps, and
  safe cleanup controls in a local web interface.

### 3.3 Role-based access

The product is local-only, but role expectations still matter for handling
destructive actions and data visibility.

- **Local operator**: Full access to current data, historical views, and manual
  cleanup on the machine where the tool runs.
- **Local browser session**: Read and cleanup access through the localhost web
  server only; no remote or multi-user access model is introduced.

## 4. Functional requirements

This section defines the feature slices engineering must deliver.

- **Snapshot persistence and coalescing** (Priority: P0)

  - Every successful usage fetch must invoke persistence before the request or
    command lifecycle completes.
  - Persistence must save a new historical event when the newly fetched usage
    state differs from the most recent saved event for the same local database.
  - Persistence must coalesce identical consecutive snapshots by updating the
    existing event's `last_seen_at` and occurrence count rather than inserting a
    new row.
  - Equality for coalescing must ignore transient fields such as fetch time,
    request identifiers, and call source, but must include meaningful account,
    bucket, window, reset, and rate-limit state fields.
  - A snapshot that matches an older non-consecutive event must be stored as a
    new event once an intervening different event exists.

- **Local SQLite storage management** (Priority: P0)

  - The product must automatically create the SQLite database and required
    schema on first successful use.
  - The database location must be local to the user's machine, outside any
    network service requirement, and configurable through a documented override
    for advanced users.
  - The storage layer must support safe concurrent access from separate CLI and
    web server processes by using SQLite settings appropriate for local
    multi-process reads and writes.
  - The schema must preserve both query-friendly columns and the raw validated
    payload needed for forward compatibility and debugging.

- **Historical query layer** (Priority: P0)

  - The project must provide a shared history read path that both CLI and web
    layers can use without duplicating query logic.
  - Queries must support recent-first ordering and time-range filtering.
  - Queries must expose coalesced event semantics, including `first_seen_at`,
    `last_seen_at`, and occurrence count.
  - Queries must return enough data to power both summary views and detailed
    event listings.

- **CLI history experience** (Priority: P1)

  - The CLI must add a dedicated history command instead of overloading the
    current snapshot command with dense historical output.
  - The history command must support a readable table or list view, JSON output,
    time-range filtering, window filtering, and entry limits.
  - The CLI must clearly distinguish the current live snapshot from saved
    historical events.
  - The CLI must present empty states and degraded states without crashing.

- **Web history experience** (Priority: P1)

  - The web UI must preserve the current snapshot as the primary at-a-glance
    view.
  - The web UI must add a history section with range controls, trend
    visualization, and a recent events list.
  - The web UI must explain coalesced rows as observed intervals rather than as
    individual fetches.
  - The web UI must show loading, empty, and error states for historical data
    independently from the current snapshot state.

- **Manual cleanup workflows** (Priority: P1)

  - The product must support explicit user-initiated cleanup only.
  - Cleanup must be available from both the CLI and the web UI.
  - Cleanup must include a full-history option and at least one scoped option,
    such as deleting a selected time range.
  - Cleanup must require confirmation and must report the number of deleted
    coalesced events.

- **Failure visibility and degraded mode** (Priority: P0)

  - Failed fetches must not create history rows.
  - If usage fetch succeeds but SQLite persistence fails, the product must not
    fail silently.
  - The user must still be able to see the current fetched snapshot when
    possible, but the UI or CLI must clearly communicate that history was not
    updated.
  - History read failures must surface as separate errors without corrupting the
    current snapshot experience.

## 5. User experience

This section describes the intended end-user behavior across entry points and
interaction modes.

### 5.1 Entry points & first-time user flow

The first-time flow must make history feel automatic rather than like an extra
setup task.

- The user runs `codex-usage usage`, `codex-usage usage --watch`, or opens the
  local dashboard as they do today.
- On the first successful fetch, the tool creates the SQLite database and stores
  the first coalesced event without requiring an onboarding step.
- The current snapshot remains visible immediately after fetch.
- Once at least one event exists, the CLI and web UI expose history views using
  defaults that favor recent meaningful changes.
- If no history exists yet, the product shows a clear empty state instead of an
  error.

### 5.2 Core experience

The core experience must answer both "what is my quota now" and "how did it get
here" with minimal interaction.

- **Capture and store**: A successful fetch is written as a new event or merged
  into the latest coalesced event, preserving `first_seen_at`, `last_seen_at`,
  and occurrence count.

  - This keeps history meaningful even when watch mode and the dashboard poll at
    the same time.

- **Inspect recent history in the CLI**: The user runs a dedicated history
  command to see recent events, durations, quota remaining, and reset times.

  - This keeps the current snapshot command terse while still making history
    available in terminal-native form.

- **Inspect trends in the web UI**: The dashboard adds a history section with a
  recent-range selector, a trend view for quota remaining, and a recent events
  table.

  - This complements the live cards instead of replacing them and makes quota
    drift visible at a glance.

- **Clean up manually**: The user can delete all history or a selected slice of
  it from either surface after a confirmation step.

  - This satisfies privacy and data hygiene needs without introducing automatic
    retention surprises.

### 5.3 Advanced features & edge cases

The feature must handle unusual but realistic local-tool conditions cleanly.

- Consecutive identical snapshots fetched seconds apart by different processes
  must merge into one event.
- A long unchanged state must remain visible through its growing observation
  window instead of generating repeated duplicate rows.
- If the upstream response is valid but missing a primary or secondary window,
  the event is still stored and rendered with unavailable values.
- If the user changes accounts locally, history must preserve account identity
  per event instead of blending different accounts into indistinguishable rows.
- If the history store is unavailable or locked beyond retry limits, the product
  must show a persistence warning rather than pretending the save succeeded.
- If the user deletes history while the dashboard is open, the history view must
  refresh to the new empty or reduced state without requiring a restart.
- Time presentation must use local time in the UI while storing timestamps in a
  stable machine-readable form.

### 5.4 UI/UX highlights

The final experience must stay aligned with the project's signal-first design.

- Keep the current snapshot visually primary in both CLI and web UI.
- Use coalesced history rows described as observed intervals, for example,
  "seen from 2:10 PM to 2:26 PM," instead of implying every poll is stored.
- Favor recent preset ranges such as 24 hours, 7 days, 30 days, and all time.
- Show quota remaining trends rather than only raw used percentages so the
  historical view matches the current product language.
- Put destructive cleanup behind explicit confirmation with precise copy about
  what will be deleted.
- Show record counts and last successful save information where useful, but do
  not turn the screen into a database admin tool.

## 6. Narrative

This narrative summarizes how the feature should feel in practice.

The developer opens the tool as usual to see the current Codex quota state, but
now every successful fetch also contributes to a local timeline of meaningful
changes. If the quota stays unchanged for several refreshes, the product treats
that as one continuous observed state rather than spammy repetition. When the
developer wants more context, the terminal shows recent intervals and the web
UI shows trend lines and recent events. Cleanup remains a deliberate local
action, and any failure to save history is visible instead of silently losing
data.

## 7. Success metrics

This section defines how the team will judge whether the first release is
working well.

### 7.1 User-centric metrics

These metrics focus on whether the feature is useful and understandable.

- A user can answer "when did my quota last change" in under 10 seconds from
  either the CLI or web UI.
- The default CLI history view shows the last 10 meaningful events in one
  terminal screen on a typical laptop.
- The default web history view makes the last 24 hours of quota movement
  understandable without requiring custom filters.
- Empty, degraded, and cleanup states are understandable without consulting
  documentation.

### 7.2 Business metrics

These metrics focus on product value for the local tool.

- Increased repeat use of the dashboard and watch mode because history makes the
  tool useful even after the fact.
- Fewer manual attempts to reconstruct quota changes from memory or ad hoc
  screenshots.
- Improved perceived reliability because the product can explain both current
  status and recent history.

### 7.3 Technical metrics

These metrics focus on correctness and local performance.

- 100% of successful fetches attempt persistence.
- 100% of identical consecutive snapshots are coalesced under the defined
  equality rule.
- History queries for the default 24-hour and 7-day views complete quickly
  enough to feel instantaneous on a local machine, targeting sub-200 ms query
  time excluding fresh network fetches.
- SQLite initialization and migration are idempotent across repeated launches.
- Concurrent CLI and web usage do not corrupt history data.

## 8. Technical considerations

This section highlights the implementation constraints and integration points
that shape the design.

### 8.1 Integration points

The feature must fit the current architecture rather than replacing it.

- `src/usage.ts` remains the canonical fetch path and becomes the shared place
  where successful snapshots are handed to persistence.
- `src/cli.ts` adds history and cleanup commands while keeping current snapshot
  behavior intact.
- `src/tui/UsageApp.tsx` may optionally surface save warnings for live fetches,
  but it should not become the primary history browser.
- `src/server.ts` adds history read and cleanup endpoints for the web UI.
- `web/src/App.tsx` adds a history section, not a separate application shell.
- New shared modules are expected for database access, migrations, history
  queries, and snapshot fingerprinting.

### 8.2 Data storage & privacy

The storage model must stay local, explicit, and safe.

- Use a local SQLite database as the system of record for history.
- Store timestamps in a stable machine-readable format and render them in local
  time.
- Keep queryable columns for account, selected bucket, window values, reset
  times, and limit state.
- Preserve the raw validated snapshot payload for forward compatibility.
- Do not store authentication tokens or secrets in the history database.
- Document the default database path and provide an override mechanism for power
  users.

### 8.3 Scalability & performance

The project is local and single-user, but performance still matters because the
tool may poll frequently.

- Enable SQLite settings appropriate for multi-process local access, such as WAL
  mode and a reasonable busy timeout.
- Index time-based queries and the latest-event lookup used for coalescing.
- Keep the default history queries bounded by recent ranges and entry limits.
- Use coalescing to reduce unnecessary row growth during unchanged polling.
- Ensure cleanup operations remain explicit and predictable even for larger
  local databases.

### 8.4 Potential challenges

The following risks need explicit handling during implementation.

- Defining snapshot equality correctly so meaningful changes are not lost and
  noisy duplicates are not stored.
- Handling concurrent writes from separate CLI and server processes without
  duplicate adjacent rows.
- Deciding how much history to show in the CLI without making it unreadable.
- Rendering useful web trends from coalesced interval data rather than from raw
  every-poll samples.
- Communicating persistence failure clearly while still preserving access to the
  just-fetched live snapshot.
- Managing schema evolution if Codex adds new limit fields later.

## 9. Milestones & sequencing

This section suggests a practical rollout order for a small local-tool team.

### 9.1 Project estimate

The feature is a medium-sized enhancement because it touches storage, CLI,
server APIs, and the web UI.

- Medium: 1.5 to 2.5 engineering weeks

### 9.2 Team size & composition

The work is small enough for a focused implementation team.

- 1 engineer: TypeScript full-stack implementation across CLI, server, and web
  UI
- 1 part-time product or design reviewer: Requirement validation and UX review

### 9.3 Suggested phases

The phases below sequence the work to deliver value early and reduce risk.

- **Phase 1**: Storage foundation and coalescing rules (3 to 4 days)

  - Key deliverables: SQLite access layer, schema creation or migration,
    snapshot fingerprinting, successful-fetch persistence, persistence warning
    plumbing, and unit tests for coalescing logic.

- **Phase 2**: Historical query APIs and CLI workflows (2 to 3 days)

  - Key deliverables: shared history query service, CLI history command, CLI
    cleanup command, JSON output, and empty or degraded states.

- **Phase 3**: Web history experience (2 to 3 days)

  - Key deliverables: history endpoints, range controls, trend visualization,
    recent events table, and cleanup controls with confirmation.

- **Phase 4**: Hardening and release polish (1 to 2 days)

  - Key deliverables: concurrency validation, migration rerun safety, manual QA,
    documentation updates, and regression checks for existing current-snapshot
    flows.

## 10. User stories

This section defines the testable user stories required for the first release.

### 10.1 Persist successful usage snapshots

This story covers the core act of saving history whenever the product fetches a
valid current snapshot.

- **ID**: HIS-001
- **Description**: As a developer, I want every successful usage fetch to be
  persisted locally so I can inspect quota history later.
- **Acceptance criteria**:

  - A successful fetch from the CLI or local API triggers a persistence attempt
    before the command or request finishes.
  - Only validated successful usage payloads are eligible for persistence.
  - Each saved event includes `first_seen_at`, `last_seen_at`, occurrence count,
    account identity, selected bucket details, window values, and raw payload.
  - Failed fetches and transport errors do not create history rows.

### 10.2 Coalesce identical consecutive snapshots

This story ensures that unchanged repeated polling becomes one meaningful event
rather than many duplicates.

- **ID**: HIS-002
- **Description**: As a developer, I want repeated identical snapshots to merge
  into one observed interval so history stays readable.
- **Acceptance criteria**:

  - If the newest successful snapshot is identical to the latest saved event
    under the defined equality rule, the product updates that event instead of
    inserting a new one.
  - Coalescing updates at least `last_seen_at` and occurrence count.
  - Equality ignores transient fields such as fetch timestamp and request
    source.
  - If a different event occurs between two otherwise identical snapshots, the
    later identical snapshot is saved as a new event.
  - Near-simultaneous identical fetches from separate local processes do not
    create duplicate adjacent rows.

### 10.3 Initialize and maintain the local SQLite store

This story defines the storage substrate the rest of the feature depends on.

- **ID**: HIS-003
- **Description**: As a developer, I want the local history database to be
  created and maintained automatically so I do not need manual setup.
- **Acceptance criteria**:

  - On first successful use, the product creates the SQLite database and schema
    automatically.
  - Repeated startup or migration execution is safe and idempotent.
  - The database path is documented and can be overridden.
  - The storage layer supports concurrent local access without corrupting data.

### 10.4 Query history for recent ranges and details

This story defines the reusable read model needed by both product surfaces.

- **ID**: HIS-004
- **Description**: As a developer, I want recent history queries to return both
  summary and detailed event data so the CLI and web UI can render consistent
  history views.
- **Acceptance criteria**:

  - History queries support recent-first ordering.
  - History queries support at least range filtering and entry limits.
  - Query results expose `first_seen_at`, `last_seen_at`, occurrence count, and
    window metrics needed by both surfaces.
  - Query results can distinguish different accounts or selected buckets when
    those values change over time.

### 10.5 View historical data in the CLI

This story defines the terminal-native history workflow.

- **ID**: HIS-005
- **Description**: As a terminal-first user, I want a dedicated CLI history
  command so I can inspect recent quota changes without opening the browser.
- **Acceptance criteria**:

  - The CLI provides a dedicated history command.
  - The default output shows a concise recent-events view that fits within a
    typical terminal window.
  - The command supports JSON output for scripting.
  - The command supports at least range filtering, window filtering, and entry
    limits.
  - If no history exists, the CLI shows an informative empty state.

### 10.6 View historical data in the web UI

This story defines the dashboard history workflow.

- **ID**: HIS-006
- **Description**: As a dashboard user, I want a web history section with trend
  context so I can understand quota movement visually.
- **Acceptance criteria**:

  - The current live snapshot remains the primary dashboard content.
  - The dashboard includes a history section with a default recent range.
  - The history section includes a trend visualization for quota remaining and a
    recent-events list or table.
  - Coalesced events are labeled as observed intervals rather than as raw poll
    counts alone.
  - The history section has independent loading, empty, and error states.

### 10.7 Clean up history manually and safely

This story covers destructive data management without introducing automatic
retention behavior.

- **ID**: HIS-007
- **Description**: As a local operator, I want to delete saved history on
  demand so I can manage privacy and local disk usage myself.
- **Acceptance criteria**:

  - The CLI and web UI both provide a manual cleanup workflow.
  - Cleanup supports deleting all history and at least one scoped subset.
  - Cleanup requires explicit confirmation before deletion occurs.
  - The product reports how many coalesced events were deleted.
  - No automatic cleanup runs in the background.

### 10.8 Handle valid but partial upstream data

This story ensures history remains robust even when Codex returns unusual but
valid shapes.

- **ID**: HIS-008
- **Description**: As a developer, I want valid but partial usage responses to
  remain visible in history so the product does not hide real upstream states.
- **Acceptance criteria**:

  - If a successful validated response omits a primary or secondary window, the
    event is still persisted.
  - CLI and web history views render missing window fields as unavailable rather
    than crashing.
  - Events preserve account and bucket identity even when the selected limit or
    account changes over time.
  - Stored timestamps remain machine-readable even if rendered output uses local
    human-friendly formatting.

### 10.9 Surface persistence failures without silent data loss

This story defines how the product behaves when the fetch succeeds but the save
does not.

- **ID**: HIS-009
- **Description**: As a developer, I want save failures to be visible so I do
  not assume my history is complete when it is not.
- **Acceptance criteria**:

  - If fetching current usage succeeds but SQLite persistence fails, the product
    surfaces a visible save failure message.
  - The product does not silently mark the fetch as historically recorded.
  - When technically feasible, the current live snapshot remains visible even if
    persistence failed.
  - Subsequent successful saves recover normal behavior without requiring data
    repair.

### 10.10 Preserve local-only security and privacy expectations

This story defines the security posture for the feature.

- **ID**: HIS-010
- **Description**: As a local user, I want historical usage data to stay local
  and free of secret material so the new feature does not expand the product's
  security risk unnecessarily.
- **Acceptance criteria**:

  - The history store is a local SQLite file and is not synced to a remote
    service by the product.
  - The web API exposing history remains bound to localhost only.
  - The history database does not store authentication tokens or other secrets.
  - Cleanup actions are explicit and destructive by design, with confirmation in
    user-facing flows.

## 11. Approval

This section closes the document with the expected review decision.

If this PRD matches the intended scope, approve it as written. After approval,
the next step is to turn the user stories into GitHub issues for implementation.
