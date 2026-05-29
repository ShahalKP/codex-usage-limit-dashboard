# Issue drafts: Historical usage tracking

These drafts map 1:1 to the approved user stories in
[prd.md](./prd.md). They are written so they can be pasted into GitHub issues
with minimal editing.

## HIS-001: Persist successful usage snapshots

Suggested labels: `enhancement`, `backend`, `p0`

Suggested dependencies: HIS-003

### Summary

Persist every successful usage fetch to a local SQLite history store so the
tool can expose historical quota changes later.

### Scope

- Hook persistence into the canonical successful fetch path.
- Save only validated successful usage payloads.
- Persist enough normalized data for querying plus the raw validated payload for
  forward compatibility.
- Ensure the behavior applies to both CLI-driven fetches and web API-driven
  fetches.

### Acceptance criteria

- A successful fetch from the CLI or local API triggers a persistence attempt
  before the command or request completes.
- Only validated successful usage payloads are eligible for persistence.
- Each saved event includes `first_seen_at`, `last_seen_at`, occurrence count,
  account identity, selected bucket details, window values, limit state, and
  raw payload.
- Failed fetches and transport errors do not create history rows.

## HIS-002: Coalesce identical consecutive snapshots

Suggested labels: `enhancement`, `backend`, `p0`

Suggested dependencies: HIS-001, HIS-003

### Summary

Coalesce repeated identical consecutive snapshots into a single observed
interval so polling noise does not flood history.

### Scope

- Define a stable equality rule for meaningful snapshot identity.
- Ignore transient fields such as fetch time and request source.
- Update the latest historical event when the next successful snapshot is
  identical.
- Prevent duplicate adjacent rows during near-simultaneous CLI and web writes.

### Acceptance criteria

- If the newest successful snapshot is identical to the latest saved event
  under the defined equality rule, the product updates that event instead of
  inserting a new one.
- Coalescing updates at least `last_seen_at` and occurrence count.
- Equality ignores transient fields such as fetch timestamp and request source.
- If a different event occurs between two otherwise identical snapshots, the
  later identical snapshot is saved as a new event.
- Near-simultaneous identical fetches from separate local processes do not
  create duplicate adjacent rows.

## HIS-003: Initialize and maintain the local SQLite store

Suggested labels: `enhancement`, `backend`, `infrastructure`, `p0`

Suggested dependencies: none

### Summary

Set up the local SQLite database and schema so the history feature works
without manual user setup.

### Scope

- Choose and document the default database location.
- Add schema creation or migration logic.
- Support an override path for advanced users.
- Configure SQLite for safe local multi-process access.

### Acceptance criteria

- On first successful use, the product creates the SQLite database and schema
  automatically.
- Repeated startup or migration execution is safe and idempotent.
- The database path is documented and can be overridden.
- The storage layer supports concurrent local access without corrupting data.

## HIS-004: Query history for recent ranges and details

Suggested labels: `enhancement`, `backend`, `api`, `p0`

Suggested dependencies: HIS-003

### Summary

Create a shared history query layer that returns recent ranges and detailed
coalesced event data for both CLI and web UI consumers.

### Scope

- Add shared read functions for recent-first queries.
- Support recent-range filtering and entry limits.
- Expose coalesced interval data needed by both product surfaces.
- Preserve account and selected bucket identity in query results.

### Acceptance criteria

- History queries support recent-first ordering.
- History queries support at least range filtering and entry limits.
- Query results expose `first_seen_at`, `last_seen_at`, occurrence count, and
  window metrics needed by both surfaces.
- Query results can distinguish different accounts or selected buckets when
  those values change over time.

## HIS-005: View historical data in the CLI

Suggested labels: `enhancement`, `cli`, `p1`

Suggested dependencies: HIS-004

### Summary

Add a dedicated CLI history command so terminal-first users can inspect recent
quota changes without opening the browser.

### Scope

- Add a new CLI command for history output.
- Support a default human-readable view and JSON output.
- Add common filters such as range, window, and entry limit.
- Keep the live current-snapshot command focused and concise.

### Acceptance criteria

- The CLI provides a dedicated history command.
- The default output shows a concise recent-events view that fits within a
  typical terminal window.
- The command supports JSON output for scripting.
- The command supports at least range filtering, window filtering, and entry
  limits.
- If no history exists, the CLI shows an informative empty state.

## HIS-006: View historical data in the web UI

Suggested labels: `enhancement`, `frontend`, `backend`, `p1`

Suggested dependencies: HIS-004

### Summary

Add a history section to the dashboard so users can see trend context and
recent coalesced events next to the current live snapshot.

### Scope

- Keep the current live snapshot as the primary dashboard section.
- Add a recent-range selector and default time window.
- Add a trend visualization for quota remaining.
- Add a recent-events list or table with coalesced interval semantics.

### Acceptance criteria

- The current live snapshot remains the primary dashboard content.
- The dashboard includes a history section with a default recent range.
- The history section includes a trend visualization for quota remaining and a
  recent-events list or table.
- Coalesced events are labeled as observed intervals rather than as raw poll
  counts alone.
- The history section has independent loading, empty, and error states.

## HIS-007: Clean up history manually and safely

Suggested labels: `enhancement`, `cli`, `frontend`, `backend`, `p1`

Suggested dependencies: HIS-004

### Summary

Add explicit manual cleanup workflows so the user can delete local history on
purpose without any automatic retention behavior.

### Scope

- Add a CLI cleanup command with confirmation.
- Add a web cleanup control with confirmation.
- Support deleting all history and at least one scoped subset.
- Return deletion counts so the user knows what changed.

### Acceptance criteria

- The CLI and web UI both provide a manual cleanup workflow.
- Cleanup supports deleting all history and at least one scoped subset.
- Cleanup requires explicit confirmation before deletion occurs.
- The product reports how many coalesced events were deleted.
- No automatic cleanup runs in the background.

## HIS-008: Handle valid but partial upstream data

Suggested labels: `enhancement`, `backend`, `frontend`, `cli`, `p1`

Suggested dependencies: HIS-001, HIS-004

### Summary

Support valid but partial upstream usage payloads so history reflects real API
states instead of dropping them.

### Scope

- Persist successful responses even when a primary or secondary window is
  missing.
- Render unavailable values safely in CLI and web history views.
- Preserve account and bucket identity when they change over time.
- Keep storage timestamps stable and machine-readable.

### Acceptance criteria

- If a successful validated response omits a primary or secondary window, the
  event is still persisted.
- CLI and web history views render missing window fields as unavailable rather
  than crashing.
- Events preserve account and bucket identity even when the selected limit or
  account changes over time.
- Stored timestamps remain machine-readable even if rendered output uses local
  human-friendly formatting.

## HIS-009: Surface persistence failures without silent data loss

Suggested labels: `enhancement`, `backend`, `cli`, `frontend`, `p0`

Suggested dependencies: HIS-001, HIS-003

### Summary

Make persistence failures visible when fetching succeeds so users do not assume
history is complete when a save actually failed.

### Scope

- Separate live fetch success from history save success.
- Surface save failures in CLI and web UI without hiding the current snapshot
  when possible.
- Recover cleanly on the next successful persistence event.

### Acceptance criteria

- If fetching current usage succeeds but SQLite persistence fails, the product
  surfaces a visible save failure message.
- The product does not silently mark the fetch as historically recorded.
- When technically feasible, the current live snapshot remains visible even if
  persistence failed.
- Subsequent successful saves recover normal behavior without requiring data
  repair.

## HIS-010: Preserve local-only security and privacy expectations

Suggested labels: `enhancement`, `security`, `backend`, `p0`

Suggested dependencies: none

### Summary

Keep the new history capability local-first and free of secret material so it
does not expand the product's security footprint unnecessarily.

### Scope

- Keep the history store local to the machine.
- Preserve localhost-only API exposure for the dashboard.
- Ensure the database does not store secrets.
- Make destructive cleanup explicit and confirmed.

### Acceptance criteria

- The history store is a local SQLite file and is not synced to a remote
  service by the product.
- The web API exposing history remains bound to localhost only.
- The history database does not store authentication tokens or other secrets.
- Cleanup actions are explicit and destructive by design, with confirmation in
  user-facing flows.
