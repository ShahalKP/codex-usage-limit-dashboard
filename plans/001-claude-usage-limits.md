# Plan 001: Add Claude usage-limit support (CLI `claude-usage` + TUI + web UI)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 0458474..HEAD -- src/ web/src/ package.json`
> All "Current state" excerpts below were re-verified against commit
> `0458474`. If any in-scope file has changed since, compare this plan's
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.
>
> **Read Step 0 before anything else.** It is a one-command spike that
> decides whether the rest of this plan is buildable at all.

## Status

- **BLOCKED at Step 0** (2026-08-06, `claude` 2.1.223) — see "Step 0 outcome"
  below. Do not hand this plan to an executor as written; Steps 1-10 are dead
  work until the direction question is resolved.
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction (feature parity)
- **Planned at**: commit `6626f1c`, 2026-08-06
- **Reviewed at**: commit `0458474`, 2026-08-06 (excerpts re-verified; Step 0
  spike extracted; quota-cost constraint added; DB migration and server
  routing corrected — see "Review changelog" at the bottom)

## Why this matters

This dashboard currently reads only Codex/ChatGPT rate limits, via the
locally-authenticated `codex app-server` subprocess. The user wants the same
capability for Claude: a `claude-usage` CLI command, its Ink TUI, and a web
dashboard view, all reading the local user's own Claude subscription
rate-limit usage — mirroring how `usage`/`UsageApp.tsx`/`App.tsx` already work
for Codex.

Claude has no direct equivalent of Codex's free, read-only
`account/rateLimits/read` RPC. Research (Context7 docs for `code.claude.com`,
cross-checked against a live, zero-cost `claude auth status` call on this
machine) established the following, which this plan's design commits to:

- `claude auth status` is a free, instant, non-billable CLI subcommand that
  returns JSON account identity — confirmed empirically on this machine:
  `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"...","orgId":"...","orgName":"...","subscriptionType":"team"}`.
  This is the Claude analog of Codex's `account/read`.
- There is **no free, read-only way to check current rate-limit usage**. The
  only officially documented source of structured `{used_percentage,
  resets_at}` data for the `five_hour`/`seven_day` windows is the
  **statusLine JSON** Claude Code feeds to a configured `statusLine` script —
  populated "only for Claude.ai Pro/Max subscribers after their first API
  response" (`code.claude.com/docs/en/statusline`). Getting a fresh reading
  therefore requires spawning `claude` in headless mode (`-p`), which
  consumes a small amount of the user's real quota — there is no way around
  this, and it must be documented to the user (see Step 3 and the TUI/CLI
  help text).
  - **This is a genuine open question this plan cannot resolve from docs
    alone**: whether the `statusLine` command actually fires during headless
    `-p` mode is undocumented. Step 3 makes verifying this the *first* thing
    the executor does, with a concrete escape hatch if it doesn't.
  - This account (`subscriptionType: "team"`) may not even receive
    `rate_limits` data at all, per the "Pro/Max subscribers" restriction in
    the docs — the implementation must treat a missing/empty `rate_limits`
    object as a normal, non-error state (exactly like Codex's existing
    "no rate-limit bucket returned" path), not a crash.
  - The user was asked and explicitly chose this approach (spawning the
    local `claude` CLI directly) over using `@anthropic-ai/claude-agent-sdk`,
    because Anthropic's own SDK docs state: *"Anthropic generally does not
    allow third-party developers to offer claude.ai login or rate limits for
    their products, including agents built with the Claude Agent SDK, unless
    prior approval has been granted."* Shelling out to the user's own
    already-authenticated local `claude` binary (exactly how this repo
    already shells out to `codex app-server`) avoids that concern.
- `five_hour` and `seven_day` are fixed-duration windows (300 and 10,080
  minutes respectively) — the same durations already used by Codex's
  `primary`/`secondary` buckets in this codebase's tests
  (`src/usage.test.ts:47-57`). This lets Claude's rate-limit data reuse the
  existing `RateLimitWindow` type (`src/types.ts:25-29`) and every UI
  component built on it (`WindowCard` in both the TUI and web layers)
  **completely unchanged**.

## Hard constraint: every Claude reading costs the user real quota

Codex readings are free RPC calls, so this repo polls them on a 60-second
timer (`web/src/App.tsx:512-514`) and offers a `--watch` mode that refreshes
every 60 seconds (`src/tui/UsageApp.tsx:218`). **Claude readings are not
free** — each one spawns a headless `claude -p` turn that consumes the user's
own five-hour/seven-day quota. Copying Codex's polling behavior onto Claude
would spend a slice of the user's quota every minute, forever, purely to ask
how much quota is left. That is a self-defeating product.

Therefore, non-negotiable for every Claude surface:

- **No automatic polling.** The Claude web view fetches once on mount and
  thereafter only when the user clicks Refresh. Do not start a `setInterval`
  for the Claude provider (Step 9 says exactly where).
- **No `--watch` for `claude-usage`.** Step 6 registers `--json` only; the
  `-w/--watch` flag that `usage` has is deliberately absent.
- **Say so in the UI.** The Claude view and the `claude-usage` TUI both show
  a one-line note: `Each refresh spends a small amount of your Claude quota.`

If a reviewer or operator later wants Claude auto-refresh, that is a separate,
deliberate decision with a much longer interval — not something to inherit by
copy-paste from the Codex path.

## Current state

Relevant existing files and their roles:

- `src/codexRpc.ts` — spawns `codex app-server` as a persistent JSON-RPC
  subprocess. **Not the pattern to copy for Claude** — Claude has no
  app-server/JSON-RPC mode. Claude's client (`src/claudeCli.ts`, new) instead
  does one-shot `execFile` calls, which is simpler.
- `src/usage.ts` (full file read above) — `fetchCodexUsage()`: starts
  `CodexRpcClient`, calls `account/read` then `account/rateLimits/read`,
  validates both with zod, persists to history via `persistUsageSnapshot`,
  returns `UsageSnapshot`. `withHistoryPersistence()` (`src/usage.ts:98-119`)
  wraps persistence in try/catch so a broken DB never breaks the live
  snapshot — reuse this exact shape for Claude, but see Step 3 for why it
  needs to move to a shared, provider-agnostic location.
- `src/types.ts` — `RateLimitWindow` (lines 25-29) is already
  provider-agnostic (`usedPercent`, `windowDurationMins`, `resetsAt`) — reuse
  as-is, do not touch. `CodexAccount`, `CodexRateLimit`, `UsageSnapshotData`,
  `UsageSnapshot` are Codex-specific and must **not** be widened or edited —
  add new `Claude*` types alongside them instead (see Step 1).
- `src/schemas.ts` — zod schemas for Codex's RPC responses. Add Claude's
  schemas here too (same file, same role, per `CLAUDE.md`'s stated
  architecture: "schemas.ts — zod schemas for all ... API response shapes").
- `src/history/db.ts` — opens/migrates the SQLite DB. Schema is currently at
  `user_version = 1` (`HISTORY_SCHEMA_VERSION = 1`, `src/history/db.ts:9`).
  `CREATE_HISTORY_TABLE_SQL` (lines 11-42) has no `provider` column — every
  row today is implicitly Codex. `initializeHistorySchema` (lines 94-106)
  re-runs the idempotent `CREATE TABLE IF NOT EXISTS` and bumps
  `user_version` if below current; it does **not** currently handle adding a
  column to an already-existing table — Step 2 must do that explicitly.
- `src/history/store.ts` — `persistUsageSnapshot`/`listHistoryEvents`/
  `clearHistoryEvents`. The dedup/coalescing query
  (`src/history/store.ts:66-74`) reads `ORDER BY id DESC LIMIT 1` with **no
  provider filter** — if left unscoped, a Claude fetch would compare itself
  against the immediately-preceding Codex row (or vice versa) instead of the
  last row for its own provider, breaking coalescing whenever the two
  providers' polls interleave (which they will, once the web dashboard polls
  both every 60s). Step 2 must scope this query by `provider`.
- `src/cli.ts` (full file read above) — Commander program; `usage` and
  `history`/`history:clear` subcommands. `process.argv.length === 2` defaults
  to `usage` (line 109) — leave that default pointed at Codex's `usage`, do
  not change it to `claude-usage`.
- `src/server.ts` (full file read above) — Express app, binds `127.0.0.1`
  only. Routes: `GET /api/codex/rate-limits`, `GET /api/codex/history`,
  `DELETE /api/codex/history`.
- `src/tui/UsageApp.tsx` (full file read above) — defines `Spinner`, `Bar`,
  `WindowCard`, `formatResetTime`, `formatFetchTime` as **local, unexported**
  functions inside the same file as the `UsageApp` component (lines 1-166).
  These are 100% provider-agnostic (operate only on `RateLimitWindow`) —
  extract them to a shared module rather than duplicating ~150 lines for
  `ClaudeUsageApp.tsx`.
- `web/src/App.tsx` (998 lines, full file read above) — single component.
  `WindowCard` (202-255), `TrendChart` (257-358), and the formatting helpers
  (80-200) are provider-agnostic. `CLAUDE.md` explicitly instructs: *"when
  adding a substantial new view ... prefer a new component file over growing
  it further."* Step 7 extracts these into reusable pieces and replaces the
  bulk of `App.tsx`'s body with a parameterized `<UsageDashboard
  provider="codex" />` / `<UsageDashboard provider="claude" />`, rather than
  writing a near-duplicate 600-line Claude view.
- `src/history/store.test.ts`, `src/history/db.test.ts`, `src/server.test.ts`,
  `src/usage.test.ts` (all read above) — exemplars for the new tests. Note
  the mocking pattern in `src/usage.test.ts:8-16`
  (`vi.mock("./codexRpc.js", ...)`) — copy this shape exactly for
  `src/claudeUsage.test.ts` mocking `./claudeCli.js`.
- `package.json` (full file read above) — scripts `usage`/`usage:json` are
  `tsx src/cli.ts usage[--json]`. No `bin` field exists; "CLI command" in
  this repo means a Commander subcommand plus a matching pnpm script, not an
  installable binary.

Verified empirically on this development machine (not guessed):

```
$ claude auth status
{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"skp@pricesenz.com","orgId":"...","orgName":"Pricesenz","subscriptionType":"team"}
$ claude --version
2.1.222 (Claude Code)
$ npm view @anthropic-ai/claude-agent-sdk peerDependencies
{ zod: '^4.0.0', '@anthropic-ai/sdk': '>=0.93.0', ... }
```

Docs confirmed via Context7 (`code.claude.com`):

- Full statusLine JSON schema, including `rate_limits.five_hour` /
  `rate_limits.seven_day`, each `{ used_percentage, resets_at }`.
- `--settings <path-or-inline-json>` overrides settings **for the current
  session only** (does not touch the user's real `~/.claude/settings.json`).
- `--tools ""` disables all built-in tools for a headless run.
- `claude auth status` defaults to JSON output (confirmed live above).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|-----------------------------------|---------------------|
| Install   | `pnpm install`                    | exit 0              |
| Typecheck | `pnpm exec tsc -p tsconfig.json --noEmit` | exit 0, no errors |
| Tests     | `pnpm test`                       | all pass            |
| Tests (filtered) | `pnpm exec vitest run <path>` | pass |
| Build     | `pnpm run build`                  | exit 0, `dist/` + `dist-web/` produced |
| Dev server | `pnpm run dev`                   | API on :8787, web on :5173 |

## Scope

**In scope** (only files you should create or modify):

New:
- `src/claudeCli.ts`
- `src/claudeCli.test.ts`
- `src/claudeUsage.ts`
- `src/claudeUsage.test.ts`
- `src/history/persist.ts` (extracted, provider-agnostic `withHistoryPersistence`)
- `src/tui/shared.tsx`
- `src/tui/ClaudeUsageApp.tsx`
- `web/src/lib/usage-format.ts`
- `web/src/components/WindowCard.tsx`
- `web/src/components/TrendChart.tsx`
- `web/src/components/UsageDashboard.tsx`

Modified:
- `src/types.ts` (additive: new `Claude*` types only)
- `src/schemas.ts` (additive: new Claude zod schemas only)
- `src/history/db.ts` (schema migration to v2: `provider` column)
- `src/history/store.ts` (provider-scoped queries; provider-agnostic param type)
- `src/history/store.test.ts` (new `describe` blocks only — do not edit existing tests)
- `src/history/db.test.ts` (new test for the v1→v2 migration)
- `src/history/types.ts` (additive: `HistoryProvider`, `HistoryAccount`, `HistoryRateLimit`, `HistorySnapshotData`; widen option types)
- `src/usage.ts` (swap local `withHistoryPersistence` for the shared one from `src/history/persist.ts` — behavior-preserving)
- `src/usage.test.ts` (no changes expected; if the refactor changes its import surface, re-run and fix only if it breaks)
- `src/cli.ts` (add `claude-usage` subcommand; add `--provider` option to `history`/`history:clear`, default `"codex"`)
- `src/server.ts` (add `GET /api/claude/rate-limits`; generalize the two history routes to accept `?provider=`)
- `src/server.test.ts` (new tests only)
- `src/tui/UsageApp.tsx` (refactor to import from `src/tui/shared.tsx`; behavior-preserving)
- `web/src/App.tsx` (refactor to a thin shell rendering a Codex/Claude tab switcher over `<UsageDashboard>`)
- `package.json` (add `claude-usage`, `claude-usage:json` scripts)

**Out of scope** (do NOT touch):
- Any new "Claude login" flow. Unlike Codex, this repo must **not**
  reimplement OAuth/device-code login for Claude — `claude auth login`
  already exists as a standard CLI command the user runs themselves. If
  `claude auth status` reports `loggedIn: false`, surface a clear error
  telling the user to run `claude auth login`; do not build a login command.
- `src/login.ts`, `src/tui/LoginApp.tsx` — Codex-specific login flow, unrelated.
- Any change to `CodexRateLimit`, `CodexAccount`, `UsageSnapshotData`, or
  `UsageSnapshot` in `src/types.ts` — these must stay exactly as they are;
  Claude gets its own parallel types.
- Any change to the Codex dedup/fingerprint *algorithm* itself (only the
  provider *scoping* of its queries, per Step 2).
- Renaming or restructuring `web/src/components/ui/*` (shadcn primitives) or
  `web/src/components/kokonutui/*`.

## Git workflow

- Branch: `claude-usage-limits` (repo has no evident branch-naming
  convention from recent history — commits landed directly to `main`; use a
  descriptive branch name and let the operator decide on merge).
- Commit per step (this plan's steps are already sized as logical units).
  Match the repo's commit message style from `git log --oneline`:
  lowercase, imperative, `feat: ...` prefix for new functionality (e.g.
  `feat: add claude-usage rate limit fetching`, matching
  `feat: implement history management for codex usage`).
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 0: Spike — prove headless `statusLine` capture works (DO THIS FIRST)

Every other step in this plan is dead work if this fails. Write no source
files until it passes.

The whole design rests on one undocumented assumption: that a `statusLine`
command supplied via `--settings` actually fires during a headless `claude -p`
run, and that its stdin payload carries a `rate_limits` key. Run the exact
argv the implementation will use — not a simplified version, because
`--tools` is a *variadic* flag (`--tools <tools...>`), so `--tools ""` may be
parsed as the single tool name `""` and rejected. This spike is where you find
that out, cheaply.

This consumes a small amount of real quota on your own account. That is
expected and is the only such call in the plan.

```bash
node -e '
const { execFile } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const dir = mkdtempSync(path.join(tmpdir(), "claude-usage-test-"));
const scriptPath = path.join(dir, "capture.cjs");
const capturePath = path.join(dir, "statusline.json");
writeFileSync(scriptPath, "const fs=require(\"fs\");let d=\"\";process.stdin.on(\"data\",c=>{d+=c});process.stdin.on(\"end\",()=>{fs.writeFileSync(process.env.CLAUDE_USAGE_CAPTURE_FILE,d);process.stdout.write(\"ok\")});");
execFile("claude", ["--settings", JSON.stringify({statusLine:{type:"command",command:`node "${scriptPath}"`}}), "--tools", "", "-p", "ok", "--output-format", "json"], { env: { ...process.env, CLAUDE_USAGE_CAPTURE_FILE: capturePath }, timeout: 60000 }, (err, stdout, stderr) => {
  if (err) { console.error("claude exited with error:", err.message, stderr); return; }
  try { console.log("CAPTURED:", readFileSync(capturePath, "utf8")); }
  catch { console.log("NO CAPTURE FILE WRITTEN"); }
});
'
```

Interpret the result:

- **`CAPTURED: {...}` containing a `rate_limits` key** (even with an absent or
  empty value — this account may not be on a plan that receives the data):
  the design is confirmed. Record the exact captured JSON shape in your final
  report and proceed to Step 1.
- **`claude exited with error` mentioning `--tools`**: retry once with the
  `"--tools", ""` pair removed entirely from the argv array. If that captures
  successfully, note it and drop `--tools` from `src/claudeCli.ts` in Step 3.
- **`NO CAPTURE FILE WRITTEN`, or an error about `--settings`**: STOP and
  report the exact stdout/stderr. Do not redesign around
  `@anthropic-ai/claude-agent-sdk` (the policy concern in "Why this matters"
  still applies) and do not invent an undocumented workaround. This needs a
  human decision.

Verified during plan review (`0458474`, `claude 2.1.222`), so you do not need
to re-check these:

- `claude auth status` returns JSON on stdout, free and instantly:
  `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":…,"orgId":…,"orgName":…,"subscriptionType":"team"}`.
- `--settings <file-or-json>`, `--tools <tools...>`, `-p/--print` and
  `--output-format` all exist on this CLI version.
- There is **no** free local cache of usage percentages to read instead:
  `~/.claude.json` holds only rate-limit *tier* names
  (`userRateLimitTier`), and session transcripts under `~/.claude/projects/`
  carry no rate-limit fields. Do not go looking for a cheaper local source —
  it was already searched for and does not exist.

**Verify**: the spike prints `CAPTURED:` with a payload. Nothing else in this
plan starts until it does.

### Step 1: Add Claude types and zod schemas (additive only)

In `src/types.ts`, append (do not touch any existing type):

```ts
export type ClaudeAuthStatus = {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
};

export type ClaudeAccount = null | {
  type: "claude";
  email?: string;
  orgName?: string | null;
  subscriptionType?: string | null;
};

export type ClaudeRateLimit = {
  limitId: "claude";
  planType?: string | null;
  primary?: RateLimitWindow | null; // five_hour
  secondary?: RateLimitWindow | null; // seven_day
};

export type ClaudeUsageSnapshotData = {
  fetchedAt: string;
  account: ClaudeAccount;
  selectedLimit: ClaudeRateLimit | null;
  allLimits: ClaudeRateLimit[];
};

export type ClaudeUsageSnapshot = ClaudeUsageSnapshotData & {
  history?: UsageHistoryStatus; // reuse existing, provider-agnostic type
};
```

`allLimits` exists only so `ClaudeUsageSnapshotData` stays structurally
compatible with the history store's snapshot shape (Step 2) — Claude only
ever has one bucket, so callers always set `allLimits: selectedLimit ? [selectedLimit] : []`.

In `src/schemas.ts`, append:

```ts
export const ClaudeAuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  apiProvider: z.string().optional(),
  email: z.string().optional(),
  orgId: z.string().optional(),
  orgName: z.string().optional(),
  subscriptionType: z.string().optional(),
});

const ClaudeRateLimitWindowRawSchema = z.object({
  used_percentage: z.number(),
  resets_at: z.number(),
});

export const ClaudeStatuslinePayloadSchema = z.object({
  rate_limits: z
    .object({
      five_hour: ClaudeRateLimitWindowRawSchema.optional(),
      seven_day: ClaudeRateLimitWindowRawSchema.optional(),
    })
    .optional()
    .nullable(),
});
```

Use `safeParse` at call sites (Step 3), not `.parse()` directly — per
`CLAUDE.md`'s validation convention.

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0 (new types
compile; nothing else changed).

### Step 2: Add provider scoping to the history store (SQLite migration)

**2a. `src/history/types.ts`** — add:

```ts
// add to the existing `import type { ... } from "../types.js";` at the top
// of the file — this repo uses `import type`, never inline `import(...)`
// types (see CLAUDE.md, "Prefer `type` imports for types").
import type { RateLimitWindow } from "../types.js";

export const HISTORY_PROVIDER_VALUES = ["codex", "claude"] as const;
export type HistoryProvider = (typeof HISTORY_PROVIDER_VALUES)[number];

export type HistoryAccount =
  | null
  | { type: string; email?: string; planType?: string | null };

export type HistoryRateLimit = {
  limitId: string;
  limitName?: string | null;
  planType?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: unknown;
  rateLimitReachedType?: string | null;
};

export type HistorySnapshotData = {
  fetchedAt: string;
  account: HistoryAccount;
  selectedLimit: HistoryRateLimit | null;
  allLimits: HistoryRateLimit[];
};
```

These are intentionally *structural supertypes* of both `UsageSnapshotData`
(Codex, `src/types.ts`) and `ClaudeUsageSnapshotData` (Step 1) — TypeScript's
structural typing means both are assignable to `HistorySnapshotData` without
any changes to `src/types.ts`. Then widen the three option types in the same
file to add an optional provider:

```ts
export type HistoryStoreOptions = {
  databasePath?: string;
  now?: Date;
  provider?: HistoryProvider; // default "codex" at the call site, not here
};
```

(apply the same `provider?: HistoryProvider` addition to
`HistoryQueryOptions` and `HistoryDeleteOptions`, which already extend
`HistoryStoreOptions` — no further change needed there since they inherit it.)

Add `provider: HistoryProvider` to the `HistoryEvent` type (it currently
extends `UsageSnapshotData` — change that extends-clause to
`HistorySnapshotData`):

```ts
export type HistoryEvent = HistorySnapshotData & {
  fingerprint: string;
  firstSeenAt: string;
  id: number;
  lastSeenAt: string;
  occurrenceCount: number;
  provider: HistoryProvider;
};
```

**2b. `src/history/db.ts`** — bump the schema version and add a migration.
Replace:

```ts
const HISTORY_SCHEMA_VERSION = 1;
```

with:

```ts
const HISTORY_SCHEMA_VERSION = 2;
```

Add `provider TEXT NOT NULL DEFAULT 'codex'` as a column in
`CREATE_HISTORY_TABLE_SQL` (right after `id INTEGER PRIMARY KEY
AUTOINCREMENT,`) so brand-new databases get it from the start. Do **not** add
a `provider` index — this table is a local, single-user history log; the three
existing indexes are already more than it needs, and a fourth one in the same
SQL blob creates an ordering hazard (the index would be created before the
`ALTER TABLE` that adds its column on an existing database).

Then change `initializeHistorySchema` to migrate existing databases. Drive
the migration off **column existence, not the version number** — a
version-branching migration is not idempotent, and if the process dies
between the `ALTER TABLE` and the `user_version` bump, every subsequent open
throws `duplicate column name: provider` and the database is unusable:

```ts
function initializeHistorySchema(database: Database.Database): void {
  database.exec(CREATE_HISTORY_TABLE_SQL);

  const columns = database.pragma("table_info(usage_history_events)") as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "provider")) {
    database.exec(
      `ALTER TABLE usage_history_events ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex';`,
    );
  }

  database.pragma(`user_version = ${HISTORY_SCHEMA_VERSION}`);
}
```

This is shorter than the current function, always runs the idempotent
`CREATE TABLE IF NOT EXISTS` (preserving today's behavior of recreating any
missing index on every open), and is safe to interrupt at any point.

**Verify**: `pnpm exec vitest run src/history/db.test.ts` → the existing test
still passes.

Then add a new `describe("v1 → v2 migration", ...)` block to
`src/history/db.test.ts` (do not edit the existing one). A fresh database is
already v2, so it cannot exercise the migration — you must build a real v1
fixture. Model the temp-path setup on the existing "creates the database file
and schema idempotently" test (`src/history/db.test.ts:36-63`), then:

1. `const database = new Database(tempPath);` (import `Database` from
   `better-sqlite3` directly in the test).
2. `database.exec(...)` with a **literal copy, inlined in the test file**, of
   the v1 `CREATE TABLE usage_history_events (...)` statement — i.e. the
   current `CREATE_HISTORY_TABLE_SQL` body *without* the `provider` column.
   Inline it rather than importing it; the point is to pin the old shape even
   after `db.ts` changes.
3. `database.pragma("user_version = 1"); database.close();`
4. `const migrated = openHistoryDatabase(tempPath);`
5. Assert `(migrated.pragma("table_info(usage_history_events)") as Array<{ name: string }>).some((c) => c.name === "provider")` is `true`.
6. Assert `Number(migrated.pragma("user_version", { simple: true }))` is `2`.
7. Insert a row with no explicit `provider` and assert it reads back as
   `"codex"` (proves the column default applies to pre-existing rows too).
8. Close, reopen with `openHistoryDatabase` a second time, and assert it does
   not throw (proves the migration is idempotent — this is the case the
   original version-number branching got wrong).

**Verify**: `pnpm exec vitest run src/history/db.test.ts` → all pass,
including the new migration test.

**2c. `src/history/store.ts`** — thread `provider` through, defaulting to
`"codex"` everywhere so every existing call site and existing test keeps
working with zero edits:

- Change the function signature `persistUsageSnapshot(snapshot:
  UsageSnapshotData | UsageSnapshot, options: { databasePath?: string } = {})`
  to `persistUsageSnapshot(snapshot: HistorySnapshotData, options: {
  databasePath?: string; provider?: HistoryProvider } = {})`, and resolve
  `const provider = options.provider ?? "codex";` at the top.
- Scope the "latest row" lookup query (currently `src/history/store.ts:66-74`,
  `ORDER BY id DESC LIMIT 1` with no params) to
  `WHERE provider = ? ORDER BY id DESC LIMIT 1`, passing `[provider]` to
  `.get(...)`. This is the correctness-critical change described in "Current
  state" above — without it, interleaved Codex/Claude polling breaks
  coalescing.
- Add `provider` to `RowInsertPayload` and to the `INSERT INTO
  usage_history_events (...)` column list / `VALUES (...)` placeholder list
  (`@provider`).
- In `buildInsertPayload`, accept `provider` as a second parameter and set
  `provider` in the returned object.
- `listHistoryEvents(options: HistoryQueryOptions = {})`: resolve `const
  provider = options.provider ?? "codex";`. Change `whereClause` construction
  (`src/history/store.ts:158-159`) to always include `provider = ?` ANDed
  with the optional range clause:
  ```ts
  const conditions = ["provider = ?"];
  const params: unknown[] = [provider];
  if (since) {
    conditions.push("last_seen_at >= ?");
    params.push(since);
  }
  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  ```
  and use `params` (instead of the current ad-hoc `since ? [since] : []`) for
  both the count query and the select query.
- `clearHistoryEvents(options: HistoryDeleteOptions = {})`: same
  `provider` resolution; change the DELETE to always filter by provider
  (`WHERE provider = ?` plus optional `AND last_seen_at >= ?`), analogous to
  the `listHistoryEvents` change above.
- `toHistoryEvent(row)`: add `provider: row.provider as HistoryProvider` to
  the returned object; add `provider: string` to the `HistoryRow` type.
- Change every internal `UsageSnapshotData`/`UsageSnapshot`/`CodexAccount`/
  `CodexRateLimit` type reference inside this file to the new
  `HistorySnapshotData`/`HistoryAccount`/`HistoryRateLimit` types from
  `./types.js` (the file already imports types from `../types.js` — switch
  those imports to `./types.js` instead, since the generic versions now live
  there per Step 2a). Function bodies do not need logic changes beyond what's
  listed above — they already only read `.email`, `.planType`, `.type`,
  `.usedPercent`, `.windowDurationMins`, `.resetsAt`, `.limitId`,
  `.limitName`, `.rateLimitReachedType`, `.credits`, all of which exist
  identically on the generic types.

**Verify**: `pnpm exec vitest run src/history/store.test.ts` → all existing
tests still pass unmodified (they never pass `provider`, so they exercise the
`"codex"` default path end-to-end). Then add a new `describe("provider
scoping", ...)` block to the same file (do not touch the existing
`describe` blocks) with at least these cases, modeled on the existing
`makeSnapshot`/`makeDatabasePath` helpers:
  - Persisting a `"codex"` snapshot and a `"claude"` snapshot to the same
    database does not coalesce them together (both produce `action:
    "inserted"`, `listHistoryEvents({ databasePath, range: "all" })` — no
    provider filter, i.e. defaults to `"codex"` — returns only the Codex one).
  - `listHistoryEvents({ databasePath, range: "all", provider: "claude" })`
    returns only the Claude one.
  - Persisting two identical `"claude"` snapshots back-to-back after an
    intervening `"codex"` snapshot still coalesces the two Claude ones
    together (proves the `WHERE provider = ?` scoping on the dedup query
    works, not just that the two providers don't collide).
  - `clearHistoryEvents({ databasePath, provider: "claude", range: "all" })`
    only deletes Claude rows; a subsequent Codex `listHistoryEvents` call
    still finds its row.

**Verify**: `pnpm exec vitest run src/history/store.test.ts` → all pass
(existing + new).

### Step 3: `ClaudeCliClient` — spawn the local `claude` CLI

Create `src/claudeCli.ts`. This is the Claude analog of `src/codexRpc.ts`,
but far simpler: no persistent subprocess, no JSON-RPC framing — every call
is a one-shot `execFile`.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Reads the JSON piped to a statusLine command via stdin and writes it
// verbatim to CLAUDE_USAGE_CAPTURE_FILE. Plain CommonJS so it runs standalone
// via `node <path>` regardless of this package's "type": "module".
const CAPTURE_SCRIPT = `const fs=require("fs");let d="";process.stdin.on("data",c=>{d+=c});process.stdin.on("end",()=>{fs.writeFileSync(process.env.CLAUDE_USAGE_CAPTURE_FILE,d);process.stdout.write("ok")});`;

export class ClaudeCliClient {
  constructor(
    private readonly command = process.env.CLAUDE_BIN || "claude",
  ) {}

  async readAuthStatus(): Promise<unknown> {
    const { stdout } = await execFileAsync(this.command, ["auth", "status"], {
      timeout: 15_000,
    });
    return JSON.parse(stdout);
  }

  async readRateLimits(): Promise<unknown> {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-usage-"));
    const scriptPath = path.join(dir, "capture.cjs");
    const capturePath = path.join(dir, "statusline.json");
    writeFileSync(scriptPath, CAPTURE_SCRIPT);

    try {
      await execFileAsync(
        this.command,
        [
          "--settings",
          JSON.stringify({
            statusLine: {
              type: "command",
              command: `node "${scriptPath}"`,
            },
          }),
          "--tools",
          "",
          "-p",
          "ok",
          "--output-format",
          "json",
        ],
        {
          env: { ...process.env, CLAUDE_USAGE_CAPTURE_FILE: capturePath },
          timeout: 60_000,
        },
      );

      let raw: string;
      try {
        raw = readFileSync(capturePath, "utf8");
      } catch {
        throw new Error(
          "Claude Code did not report rate-limit data for this request. " +
            "This can happen if your plan doesn't receive rate-limit " +
            "telemetry (Pro/Max/Team subscribers only), or if the " +
            "installed `claude` CLI version doesn't run statusLine in " +
            "headless mode. Try `claude --version` to confirm you're on a " +
            "recent release.",
        );
      }

      return JSON.parse(raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
```

Match the argv to whatever Step 0 proved actually works — in particular, drop
the `"--tools", ""` pair from the array above if Step 0 showed the CLI
rejects it. Do not proceed here at all if Step 0 has not passed.

**Verify**: create `src/claudeCli.test.ts`
following the mocking-free, "hits a real fixture" style is not appropriate
here (this class shells out); instead mock `node:child_process`'s
`execFile` with `vi.mock("node:child_process", ...)` the way
`src/server.test.ts` uses real ports rather than mocks — but since
`ClaudeCliClient` is the boundary being tested here (not a caller of it),
mock `node:child_process` directly: assert `readAuthStatus()` parses stdout
as JSON, and `readRateLimits()` reads back a file your test double writes to
`process.env.CLAUDE_USAGE_CAPTURE_FILE` (simulate the statusLine script by
writing to that path yourself inside the mocked `execFile` implementation,
then asserting `readRateLimits()` returns the parsed contents and that the
temp directory is cleaned up afterward via `existsSync`).

**Verify**: `pnpm exec vitest run src/claudeCli.test.ts` → pass.

### Step 4: `src/history/persist.ts` — shared, provider-agnostic persistence wrapper

Extract `withHistoryPersistence` out of `src/usage.ts:98-119` into a new
file so both `src/usage.ts` and the new `src/claudeUsage.ts` can use it
without duplicating the try/catch/warning shape:

```ts
// src/history/persist.ts
import { persistUsageSnapshot } from "./store.js";
import type { HistoryProvider, HistorySnapshotData } from "./types.js";
import type { UsageHistoryStatus } from "../types.js";

export function withHistoryPersistence<T extends HistorySnapshotData>(
  snapshot: T,
  provider: HistoryProvider,
): T & { history: UsageHistoryStatus } {
  try {
    const result = persistUsageSnapshot(snapshot, { provider });
    return {
      ...snapshot,
      history: {
        action: result.action,
        persisted: true,
        warning: null,
      },
    };
  } catch (error) {
    return {
      ...snapshot,
      history: {
        action: null,
        persisted: false,
        warning: `History was not updated: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
```

In `src/usage.ts`: delete the local `withHistoryPersistence` function
(lines 98-119) and its now-unused type import if any, import the shared one
(`import { withHistoryPersistence } from "./history/persist.js";`), and
change its one call site (`src/usage.ts:72-77`) from
`withHistoryPersistence({...})` to
`withHistoryPersistence({...}, "codex")`.

**Verify**: `pnpm exec vitest run src/usage.test.ts` → all 4 existing tests
still pass unmodified (behavior is identical, only the function's location
and an explicit `"codex"` argument changed).

### Step 5: `fetchClaudeUsage()`

Create `src/claudeUsage.ts`:

```ts
import { ClaudeCliClient } from "./claudeCli.js";
import { withHistoryPersistence } from "./history/persist.js";
import {
  ClaudeAuthStatusSchema,
  ClaudeStatuslinePayloadSchema,
} from "./schemas.js";
import type {
  ClaudeAccount,
  ClaudeRateLimit,
  ClaudeUsageSnapshot,
} from "./types.js";
import type { RateLimitWindow } from "./types.js";

const FIVE_HOUR_MINUTES = 300;
const SEVEN_DAY_MINUTES = 10_080;

function toWindow(
  raw: { used_percentage: number; resets_at: number } | undefined,
  windowDurationMins: number,
): RateLimitWindow | null {
  if (!raw) return null;
  return {
    usedPercent: raw.used_percentage,
    windowDurationMins,
    resetsAt: raw.resets_at,
  };
}

export async function fetchClaudeUsage(): Promise<ClaudeUsageSnapshot> {
  const client = new ClaudeCliClient();
  const fetchedAt = new Date().toISOString();

  const rawAuth = await client.readAuthStatus();
  const authResult = ClaudeAuthStatusSchema.safeParse(rawAuth);
  if (!authResult.success) {
    throw new Error(
      `Unexpected \`claude auth status\` response: ${authResult.error.message}`,
    );
  }
  const auth = authResult.data;

  if (!auth.loggedIn) {
    return withHistoryPersistence(
      { fetchedAt, account: null, selectedLimit: null, allLimits: [] },
      "claude",
    );
  }

  const account: ClaudeAccount = {
    type: "claude",
    email: auth.email,
    orgName: auth.orgName ?? null,
    subscriptionType: auth.subscriptionType ?? null,
  };

  const rawLimits = await client.readRateLimits();
  const limitsResult = ClaudeStatuslinePayloadSchema.safeParse(rawLimits);
  if (!limitsResult.success) {
    throw new Error(
      `Unexpected Claude statusLine payload: ${limitsResult.error.message}`,
    );
  }
  const rateLimits = limitsResult.data.rate_limits;

  const selectedLimit: ClaudeRateLimit | null = rateLimits
    ? {
        limitId: "claude",
        planType: auth.subscriptionType ?? null,
        primary: toWindow(rateLimits.five_hour, FIVE_HOUR_MINUTES),
        secondary: toWindow(rateLimits.seven_day, SEVEN_DAY_MINUTES),
      }
    : null;

  return withHistoryPersistence(
    {
      fetchedAt,
      account,
      selectedLimit,
      allLimits: selectedLimit ? [selectedLimit] : [],
    },
    "claude",
  );
}
```

Note `auth.loggedIn === false` returns a snapshot with `account: null`
*without ever calling `readRateLimits()`* — this is deliberate: it avoids
spending quota on a headless call that can't succeed, and mirrors the "not
logged in" path in Codex's flow. This is also where the "run `claude auth
login`" guidance belongs — surface it in the CLI/TUI layer (Steps 6-7) by
checking `snapshot.account === null`, not by throwing here.

**Verify**: create `src/claudeUsage.test.ts` modeled exactly on
`src/usage.test.ts` (mock `./claudeCli.js`'s `ClaudeCliClient` the same way
`./codexRpc.js`'s `CodexRpcClient` is mocked there). Cover:
- Logged-in, both windows present → persists with `provider: "claude"`
  (assert via a mocked `persistUsageSnapshot` from `./history/store.js`,
  same pattern as `src/usage.test.ts:18-20`).
- Logged-in, `rate_limits` absent from the statusLine payload (simulates a
  non-Pro/Max plan) → `selectedLimit: null`, no error thrown.
- `loggedIn: false` → `account: null`, `selectedLimit: null`, and
  `readRateLimits` (the mock) is **not** called (`expect(readRateLimitsMock).not.toHaveBeenCalled()`).
- Malformed `claude auth status` output → throws with a message that does
  not leak the raw response body (mirror the "prolite" leak-prevention test
  in `src/usage.test.ts:146-182`).

**Verify**: `pnpm exec vitest run src/claudeUsage.test.ts` → all pass.

### Step 6: CLI — `claude-usage` subcommand + `--provider` on history

In `src/cli.ts`, add near the top:

```ts
import { fetchClaudeUsage } from "./claudeUsage.js";
import { renderClaudeUsage } from "./tui/ClaudeUsageApp.js"; // added in Step 7
```

Add a new subcommand, modeled directly on the existing `usage` command
(`src/cli.ts:22-35`):

```ts
program
  .command("claude-usage")
  .description(
    "Show current Claude usage and rate limits (each run spends a small amount of your Claude quota)",
  )
  .option("--json", "Output raw JSON (skips TUI)")
  .action(async (opts: { json?: boolean }) => {
    if (opts.json) {
      const snapshot = await fetchClaudeUsage();
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }
    const { waitUntilExit } = renderClaudeUsage();
    await waitUntilExit();
  });
```

Note the deliberate absence of `-w/--watch`: per the "Hard constraint"
section above, a 60-second auto-refresh loop against Claude would spend the
user's quota every minute indefinitely. Do not add it, and do not give
`renderClaudeUsage` a `watch` parameter.

Add it to the `addHelpText` examples block (`src/cli.ts:17-20`) alongside
the existing `usage` examples:
`\n  codex-usage claude-usage\n  codex-usage claude-usage --json`.

Do **not** change the `process.argv.length === 2` default (`src/cli.ts:109-111`)
— it must keep defaulting to `usage` (Codex), not `claude-usage`.

Add `--provider <provider>` to both `history` and `history:clear` commands
(default `"codex"`, matching the store's default so behavior is unchanged
unless explicitly requested):

```ts
.option("--provider <provider>", "Filter by codex or claude", "codex")
```

and pass it through: `listHistoryEvents({ limit: ..., range: ...,
provider: opts.provider === "claude" ? "claude" : "codex" })` (validate
loosely — reject anything else with a clear error, mirroring
`parseHistoryRange`'s style in `src/history/types.ts:44-51`; consider adding
a small `parseHistoryProvider` helper there for symmetry).

**Verify**: `pnpm exec tsx src/cli.ts claude-usage --json` → prints a JSON
snapshot (or a clear "run `claude auth login`" error if not logged in) —
run this manually once as a smoke test; it is not part of the automated
suite since it makes a real `claude` CLI call. `pnpm exec tsx src/cli.ts
history --provider claude --json` → prints `{"events":[],...}` on a fresh
DB (no Claude history yet) without error.

### Step 7: TUI — extract shared primitives, build `ClaudeUsageApp.tsx`

Create `src/tui/shared.tsx` containing everything from `src/tui/UsageApp.tsx`
that doesn't reference Codex-specific fields: `SPINNER_FRAMES`, `Spinner`,
`Bar`, `formatResetTime`, `formatFetchTime`, `WindowCard` (lines 9-148 of
the current file, exported instead of local). `WindowCard`'s prop type is
already just `{ label: string; window: RateLimitWindow }` — no change
needed to make it reusable.

Update `src/tui/UsageApp.tsx` to import these from `./shared.js` instead of
defining them locally; delete the now-duplicated definitions. The
`UsageApp` component's own logic (state machine, `fetchCodexUsage` call,
JSX) stays as-is.

Create `src/tui/ClaudeUsageApp.tsx`, modeled directly on `UsageApp.tsx`'s
structure (state machine, load/watch/countdown/keyboard handling are
identical — only the data source, header text, and the "5h Window"/"7d
Window" labels tied to `selectedLimit.primary`/`.secondary` differ, and the
account display, which has no `planType` equivalent from Codex's
`account/read` — use `subscriptionType` instead of `planType`, and there is
no `limitName`/`limitId` bucket concept to show since Claude only has one
bucket). Where `UsageApp.tsx` shows:

```tsx
{limit && (
  <Text dimColor>
    · bucket <Text color="blue">{limit.limitName ?? limit.limitId}</Text>
  </Text>
)}
```

omit this line entirely for Claude (there is no bucket/limitName concept —
don't invent one). Where it shows "No rate-limit bucket returned", change
the copy to something accurate for Claude's real failure mode, e.g. "No
rate-limit data returned (not all plans receive this)." Add a case for
`account === null` (not logged in) that prints a clear instruction:
`Not logged in. Run \`claude auth login\`, then retry.` instead of showing
empty windows.

Also drop the watch/countdown machinery entirely from `ClaudeUsageApp` — the
`Countdown` component (`src/tui/UsageApp.tsx:152`), the refresh
`setInterval` (line 218), and the `r`-to-refresh key handler. Per the "Hard
constraint" section, `claude-usage` is a one-shot read; a refresh loop would
spend quota every 60 seconds. Print the quota note in the header instead:
`Each run spends a small amount of your Claude quota.`

Export `renderClaudeUsage()` — no options object — at the bottom, otherwise
the same shape as `renderUsage` (`src/tui/UsageApp.tsx:387-391`).

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0.
**Verify**: `pnpm exec tsx src/cli.ts usage --json` still works (Codex path
untouched by the extraction) — run once manually.
**Verify**: `pnpm exec tsx src/cli.ts claude-usage` → renders the Ink TUI
without crashing (manual smoke test, terminal required).

### Step 8: Server routes

In `src/server.ts`, add:

```ts
import { fetchClaudeUsage } from "./claudeUsage.js";
```

```ts
app.get("/api/claude/rate-limits", async (_req, res) => {
  try {
    const usage = await fetchClaudeUsage();
    res.json(usage);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
```

Then add the two Claude history routes. **Do not add a `provider` query
param.** The web UI addresses each provider by path (`/api/codex/history` vs
`/api/claude/history`, per Step 9) and the CLI never speaks HTTP at all — it
calls the store directly — so a `?provider=` param would have no consumer.
Register the existing handlers a second time under the Claude path instead,
by extracting each handler into a small factory that closes over the
provider:

```ts
const historyHandler =
  (provider: HistoryProvider): express.RequestHandler =>
  (req, res) => {
    const parsed = HistoryQuerySchema.safeParse(req.query);
    // ...body identical to today's handler, but pass
    // `{ ...parsed.data, provider }` into listHistoryEvents
  };

app.get("/api/codex/history", historyHandler("codex"));
app.get("/api/claude/history", historyHandler("claude"));
```

Do the same for the DELETE handler (`clearHistoryEvents`). `HistoryQuerySchema`
and `HistoryDeleteSchema` are unchanged — no new fields.

**Verify**: `pnpm exec vitest run src/server.test.ts` → all 3 existing
tests pass unmodified. Add new tests (new `it(...)` blocks in the same
`describe`, do not edit existing ones):
- `GET /api/claude/rate-limits` with `fetchClaudeUsageMock` mocked (mock
  `./claudeUsage.js` the same way the file already mocks `./usage.js` at
  the top of `src/server.test.ts:8-12`) returns the mocked snapshot as JSON
  with status 200.
- After persisting one snapshot via `persistUsageSnapshot(..., {
  databasePath, provider: "claude" })`: `GET /api/claude/history` returns
  that event, and `GET /api/codex/history` returns zero events.
- `DELETE /api/claude/history` deletes only the Claude row (a Codex row
  persisted in the same test database survives).

**Verify**: `pnpm exec vitest run src/server.test.ts` → all pass.

### Step 9: Web — extract shared pieces, build `UsageDashboard`, refactor `App.tsx`

**9a.** Create `web/src/lib/usage-format.ts`: move these from
`web/src/App.tsx` verbatim (they are already provider-agnostic — none
reference Codex-specific fields beyond the generic `RateLimitWindow`/
`selectedLimit.primary`/`.secondary` shape):
`clampPercent`, `formatReset`, `formatFetchTime`, `windowTimeLeft`,
`formatWindowLabel`, `humanizeRateLimitType`, `formatObservedInterval`,
`historyRangeLabel`, `remainingForWindow`, `resolveHistoryWindowLabel`,
`buildTrendPoints`, plus the `TrendPoint`, `HistoryRange`,
`HistoryWindowSelection`, `RateLimitWindow` type aliases they depend on
(lines 16-23, 67-200 of the current file). `HISTORY_RANGES` (lines 73-78)
moves here too.

**9b.** Create `web/src/components/WindowCard.tsx`: move the `WindowCard`
function (`web/src/App.tsx:202-255`) here, exported, importing
`windowTimeLeft`/`clampPercent`/`formatReset` from `../lib/usage-format.js`
and `RateLimitWindow` from the same module.

**9c.** Create `web/src/components/TrendChart.tsx`: move `TrendChart`
(`web/src/App.tsx:257-358`) here, exported, importing `TrendPoint` and
`formatFetchTime` from `../lib/usage-format.js`.

**9d.** Create `web/src/components/UsageDashboard.tsx`. This takes the
entire body of `App`'s `return (...)` for the non-loading states
(`web/src/App.tsx:589-995`) plus the surrounding state/effects
(`web/src/App.tsx:360-587`, minus the top-of-file JSX-loading-state block
which stays generic) and parameterizes it:

```tsx
type UsageDashboardProps = { provider: "codex" | "claude" };
```

**One prop, not ten.** Every other value an earlier draft of this plan passed
as a prop is derivable from `provider`, and three of them were redundant on
their face (`historyEndpoint` and `historyDeleteEndpoint` are always the same
string; `loadingSubtitle` and `description` are identical for both
providers). Put the per-provider values in a single lookup table at the top
of the file, so adding a third provider is one entry rather than one more
call site with ten arguments:

```tsx
const PROVIDERS = {
  codex: {
    title: "Codex Usage Limits",
    eyebrow: "Local Codex Monitor",
    autoRefresh: true,
    quotaNote: null,
    accountLabel: (d: UsageSnapshot | null) =>
      d?.account ? (d.account.email ?? d.account.type) : "Not logged in",
    planLabel: (d: UsageSnapshot | null) => {
      const s = d?.selectedLimit;
      const plan = s?.planType ?? d?.account?.planType ?? null;
      if (!plan) return null;
      return s ? `${plan} · ${s.limitName ?? s.limitId}` : plan;
    },
  },
  claude: {
    title: "Claude Usage Limits",
    eyebrow: "Local Claude Monitor",
    autoRefresh: false,
    quotaNote: "Each refresh spends a small amount of your Claude quota.",
    accountLabel: (d: UsageSnapshot | null) =>
      d?.account ? (d.account.email ?? "Claude account") : "Not logged in",
    planLabel: (d: UsageSnapshot | null) => d?.selectedLimit?.planType ?? null,
  },
} as const;
```

Endpoints derive directly: `` `/api/${props.provider}/rate-limits` `` and
`` `/api/${props.provider}/history` `` (both GET and DELETE — same path).

**The `autoRefresh` flag is load-bearing, not cosmetic.** The current
60-second `window.setInterval` at `web/src/App.tsx:512-514` moves into
`UsageDashboard` and must become conditional:

```tsx
useEffect(() => {
  if (!config.autoRefresh) return;
  const interval = window.setInterval(() => { /* existing body */ }, 60_000);
  return () => window.clearInterval(interval);
}, [config.autoRefresh /* + existing deps */]);
```

Render `config.quotaNote` (when non-null) next to the Refresh button, so the
Claude view says out loud that refreshing costs quota.

Every `fetch("/api/codex/rate-limits", ...)` / `/api/codex/history...` call
inside the moved logic becomes `fetch(props.usageEndpoint, ...)` /
`` `${props.historyEndpoint}?range=...` ``, etc. The `UsageSnapshot`,
`CodexRateLimit`, `HistoryEvent`, `HistoryResponse`,
`UsageHistoryStatus` local types (`web/src/App.tsx:16-65`) move into this
file too, generalized the same way the backend types were in Step 1/2
(rename the bucket type to something provider-neutral, e.g.
`RateLimitBucket`, since Claude's bucket has no `credits`/
`rateLimitReachedType` — keep those fields optional, they'll just be
`undefined` for Claude and the existing conditional rendering
(`selected?.rateLimitReachedType ? <Alert>...` etc.) already treats absence
as "don't render", so no JSX logic changes needed there).

The account/plan header section (`web/src/App.tsx:624-655`) currently
hardcodes "Account" / "Plan / Bucket" labels reading `data.account.email`
and `selected.planType`/`limitName`/`limitId` — replace those two `<p>`
values with calls to `props.accountLabel(data)` / `props.planLabel(data)`
so each provider can format its own account identity string (Claude has no
`limitName`/`limitId` bucket to append — its `planLabel` should just return
`subscriptionType`).

**9e.** Rewrite `web/src/App.tsx` as a thin shell:

```tsx
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UsageDashboard } from "./components/UsageDashboard.js";
import { Button } from "./components/ui/button.js";
import "./styles.css";

type Provider = "codex" | "claude";

function App() {
  const [provider, setProvider] = useState<Provider>("codex");

  return (
    <main className="min-h-svh px-4 py-6">
      <div className="mx-auto mb-4 flex w-full max-w-6xl gap-2">
        <Button
          variant={provider === "codex" ? "secondary" : "ghost"}
          onClick={() => setProvider("codex")}
        >
          Codex
        </Button>
        <Button
          variant={provider === "claude" ? "secondary" : "ghost"}
          onClick={() => setProvider("claude")}
        >
          Claude
        </Button>
      </div>

      <UsageDashboard key={provider} provider={provider} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

(Treat the JSX above as the target shape, not literal final code — keep the
existing `sr-only` live-announcement region, the `Loader` initial-loading
screen, and exact Tailwind classes from the current `App.tsx` header/footer
by moving them into `UsageDashboard`, not dropping them. The point of this
step is: `App.tsx` no longer contains business logic or the ~600-line JSX
body — it only owns the tab switcher.)

The `key={provider}` is deliberate: it forces React to unmount and remount
`UsageDashboard` on every tab switch, so no state from the other provider
survives. Do not drop it — without it, a single `UsageDashboard` instance
would keep the previous provider's snapshot and history rows on screen while
the new fetch is in flight.

The history query-string construction (`web/src/App.tsx:430-435`, currently
hardcoded to `/api/codex/history?range=...&limit=12`) becomes
`` `/api/${props.provider}/history?range=${encodeURIComponent(range)}&limit=12` ``
inside `UsageDashboard`. No `provider=` query param is needed from the web UI
since each provider has its own path (Step 8), unlike the CLI (Step 6) which
needs an explicit `--provider` flag because it shares one `history` command
for both.

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0.
**Verify** (manual, required per `CLAUDE.md`'s frontend testing convention
— type checking does not verify UI correctness): run `pnpm run dev`, open
`http://127.0.0.1:5173`, confirm:
- The Codex tab renders identically to before this refactor (same numbers,
  same layout, history section works, cleanup buttons work).
- The Claude tab renders without crashing. If not logged in via `claude
  auth login`, it should show the "Not logged in" state cleanly, not a raw
  error or blank screen. If logged in, it should show real Claude quota
  numbers (this will consume a small amount of real quota on first load —
  expected).
- Switching tabs does not leave stale data from the other provider visible
  (the `key={provider}` remounts the component — confirm in the browser
  rather than assuming).
- **The Claude tab does not poll.** Open the browser devtools Network panel,
  sit on the Claude tab for three minutes, and confirm exactly one request
  to `/api/claude/rate-limits` (the mount fetch) and none after it. Then
  switch to the Codex tab and confirm it *does* fire once a minute. If the
  Claude tab issues a second unprompted request, the `autoRefresh` guard is
  wrong — fix it before continuing, since every such request spends the
  user's real quota.

### Step 10: `package.json` scripts

Add, alongside the existing `usage`/`usage:json` scripts:

```json
"claude-usage": "tsx src/cli.ts claude-usage",
"claude-usage:json": "tsx src/cli.ts claude-usage --json",
```

**Verify**: `pnpm run claude-usage:json` → prints a JSON snapshot or a
clear login-required error (manual smoke test).

## Test plan

Summary of all new automated tests (each already specified in its step
above):

- `src/claudeCli.test.ts` — `ClaudeCliClient` against a mocked
  `node:child_process`.
- `src/claudeUsage.test.ts` — `fetchClaudeUsage()`, modeled on
  `src/usage.test.ts`, mocking `./claudeCli.js`.
- `src/history/db.test.ts` — new migration test (v1 → v2 adds `provider`
  column, bumps `user_version` to 2).
- `src/history/store.test.ts` — new `describe("provider scoping", ...)`
  block (4 cases, listed in Step 2c).
- `src/server.test.ts` — new tests for `/api/claude/rate-limits` and
  `?provider=claude` on the existing history route.

Run the full suite at the end: `pnpm test` → all pass, including every new
test, with zero existing tests modified in their assertions (only import
paths may change where a function moved, e.g. `src/usage.ts`'s
`withHistoryPersistence` relocation in Step 4).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc -p tsconfig.json --noEmit` exits 0
- [ ] `pnpm test` exits 0; all new tests from the Test plan exist and pass
- [ ] `pnpm run build` exits 0
- [ ] `grep -rn "withHistoryPersistence" src/usage.ts` shows it's imported
      from `./history/persist.js`, not defined locally
- [ ] `grep -n "provider" src/history/db.ts` shows the migration and column
      definition
- [ ] `grep -n "setInterval" web/src/components/UsageDashboard.tsx` shows the
      interval guarded by `autoRefresh` (no unconditional Claude polling)
- [ ] `grep -rn "watch" src/tui/ClaudeUsageApp.tsx src/cli.ts | grep -i claude`
      returns nothing — `claude-usage` has no watch mode
- [ ] `grep -n "api/claude/history" src/server.ts` matches — the route the
      web UI calls actually exists
- [ ] No files outside the Scope section's list are modified (`git status`)
- [ ] `plans/README.md` status row for this plan updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at any "Current state" location doesn't match the excerpts in
  this plan (drift since `0458474`).
- Step 0's headless-`statusLine` spike fails (no capture file written, or
  `claude` rejects `--settings`) — this is the single assumption the entire
  rate-limit-fetching design rests on. Do not start Step 1 on the hope that
  it will work out later.
- You find yourself adding a timer, interval, or watch loop to any Claude
  code path. That is the plan being violated, not a detail — re-read the
  "Hard constraint" section.
- A step's verification command fails twice after a reasonable fix attempt.
- Implementing a step would require touching an out-of-scope file (e.g. if
  `CodexRateLimit` genuinely needs widening — it should not, per the
  structural-typing design in Step 2a, but if you find yourself needing to,
  stop rather than editing Codex's existing types).
- The current Claude subscription available for testing never returns a
  `rate_limits` object at all (e.g. because it's a Team/Enterprise plan, not
  Pro/Max) — this is not itself a bug (the code must already handle it
  gracefully per Step 5), but if you cannot find *any* account to verify the
  "windows present" path against, say so explicitly in your final report
  rather than claiming that path is verified when it isn't.

## Maintenance notes

- If Anthropic ships an official, documented, free way to read current
  rate-limit usage (e.g. a `claude usage` subcommand, or headless mode gets
  a lighter-weight flag), this plan's `ClaudeCliClient.readRateLimits()` is
  the only place that needs to change — `fetchClaudeUsage()`, the schemas,
  and every UI layer are already decoupled from *how* the raw `{
  used_percentage, resets_at }` pairs are obtained.
- The history table's `provider` column defaults to `'codex'` at the SQL
  level specifically so this migration is invisible to any external tooling
  or scripts that might query the SQLite file directly and don't know about
  Claude yet.
- If a third provider is ever added, `HISTORY_PROVIDER_VALUES` in
  `src/history/types.ts` is the single place to extend, plus one more
  `<UsageDashboard provider="..." />` instantiation in `App.tsx` — that's
  the intended payoff of the Step 9 refactor.
- A reviewer should specifically scrutinize, in this order:
  1. **Anything that repeats a Claude fetch on a timer.** This is the only
     defect in this change that costs the user money every minute until
     someone notices. Check the `autoRefresh` guard in `UsageDashboard` and
     confirm `ClaudeUsageApp` has no interval.
  2. The `WHERE provider = ?` scoping in Step 2c — easy to miss one query
     path and silently break cross-provider coalescing, and it only shows up
     under interleaved polling, not in a quick manual test.
  3. Whether Step 0's headless verification actually ran, and what it
     captured. It is the one step here that cannot be CI-checked.
- The DB migration is column-existence driven rather than version driven, so
  it is safe to re-run and safe to interrupt. Keep it that way if a v3 is
  ever added — add another `if (!columns.some(...))` block rather than a
  version branch.

## Step 0 outcome (2026-08-06, `claude` 2.1.223) — FAILED, plan blocked

The spike was run exactly as scripted, on branch `dev`, before any source file
was written. Result: **`NO CAPTURE FILE WRITTEN`**.

```
EXIT ERR: null
STDOUT: {"is_error":false,"duration_api_ms":3687,"num_turns":1,
  "stop_reason":"end_turn","total_cost_usd":0.127652,
  "usage":{"input_tokens":2,"cache_creation_input_tokens":10372,
  "cache_read_input_tokens":47244,"output_tokens":12},
  "result":"Ready. What are we doing?","type":"result"}
STDERR: Warning: no stdin data received in 3s, proceeding without it.
DIR CONTENTS: [ 'capture.cjs' ]        <- statusline.json never created
```

So `claude` accepted `--settings` **and** `--tools ""` (the first failure
branch, an argv rejection, does not apply), answered the prompt, spent real
quota — and never invoked the configured statusLine command. The plan's
central undocumented assumption is false on this version. This is consistent
with statusLine being a TUI-render feature: headless `-p` has no status line
to draw, so nothing feeds the hook.

The spike ran twice (~$0.25 total): once as scripted, then once augmented to
capture stdout/stderr, because the scripted version prints only
`CAPTURED:`/`NO CAPTURE FILE WRITTEN` and the diagnostics were needed. Noted
as a deviation from "the only such call in the plan".

Independently re-verified afterwards, at **zero** additional quota cost — do
not re-derive these:

- No `claude usage` or rate-limit subcommand on 2.1.223. Full command list:
  `agents, auth, auto-mode, doctor, gateway, import, install, mcp, plugin,
  project, setup-token, ultrareview, update`.
- `~/.claude.json`: only tier *names* (`userRateLimitTier`,
  `organizationRateLimitTier`) — no percentages, no reset timestamps.
- No file under `~/.claude` contains `used_percentage` or `resets_at`.
  `~/.claude/telemetry/` holds only failed-event dumps; session transcripts
  carry per-turn token counts (`input_tokens`, `output_tokens`,
  `cache_read_input_tokens`) and nothing rate-limit shaped.

### Direction options (human decision required)

- **A — pty-wrapped interactive session.** statusLine does fire in a real
  interactive session, so drive `claude` through a pseudo-terminal
  (`node-pty`, a new native dependency), capture the hook payload, quit.
  Only path to a true percentage gauge. Costs quota per reading, adds a
  native dep, and screen-scrapes TUI internals that carry no compatibility
  promise across `claude` releases. **Not recommended** — it is the same
  self-defeating shape the "Hard constraint" section above already rejects.
- **B — reframe the Claude panel around free data (recommended).** Ship
  `claude auth status` identity + `subscriptionType`, the tier names from
  `~/.claude.json`, and **actual consumption aggregated from local session
  transcripts** over rolling 5h / 7d windows (tokens and cost). Zero quota
  cost, no new dependency, no polling constraint needed. What it cannot show
  is percent-of-quota — there is no denominator available locally — so the UI
  shows real consumption trends instead of a gauge. Steps 2, 4, 7 and 9 of
  this plan (the provider-agnostic history/TUI/web refactor) survive intact
  and land first; only Steps 0, 3, 5 (the `claude -p` client) are discarded.
- **C — drop Claude, keep the refactor.** Land Steps 2, 4, 7, 9 as a
  standalone provider-agnostic cleanup and revisit Claude if Anthropic ships
  a documented free usage read.

## Review changelog (2026-08-06, at `0458474`)

Changes made during plan review, with the reason each was needed:

- **Added the "Hard constraint" section and rewired every Claude surface to
  manual refresh.** The original plan inherited Codex's 60-second poll into
  `UsageDashboard` and gave `claude-usage` a `--watch` flag, which would have
  spent the user's Claude quota once a minute, indefinitely, to report how
  much quota was left. This was the most serious defect found.
- **Extracted the headless-`statusLine` spike into Step 0.** It was buried in
  Step 3, after the type additions and a SQLite migration had already been
  written — all of which is dead work if the spike fails.
- **Rewrote the `db.ts` migration.** The original `else if (currentVersion
  === 1)` form had three problems: a v2 database never re-ran
  `CREATE_HISTORY_TABLE_SQL` (losing today's index-recreation behavior); the
  non-idempotent `ALTER TABLE` was not atomic with the `user_version` bump,
  so a crash between them would brick the database with `duplicate column
  name: provider` on every subsequent open; and the new composite index sat
  in the same SQL blob as the `CREATE TABLE`, creating an ordering hazard.
  The replacement is column-existence driven and shorter than the original
  function. The new index was dropped as unnecessary for a local
  single-user log.
- **Replaced Step 2b's migration test recipe.** As written it was
  self-contradictory and asserted nothing — it "simulated v1" by opening a
  fresh database, which is already v2. Replaced with a concrete v1 fixture.
- **Fixed a routing contradiction.** Step 9 fetched `/api/claude/history`,
  but Step 8 only added `/api/claude/rate-limits` plus a `?provider=` query
  param on the Codex routes — so the Claude tab's history panel would have
  404'd. Now the handlers are registered under both paths and the query
  param is gone (it had no consumer: the CLI calls the store directly).
- **Cut `UsageDashboard` from ten props to one.** Two props were always
  identical strings (`historyEndpoint` / `historyDeleteEndpoint`), two more
  were identical across providers, and the rest are derivable from
  `provider` via a lookup table. Added `key={provider}` to make the remount
  guarantee explicit rather than incidental.
- **Corrected the drift-check SHA** from `6626f1c` to `0458474`; the
  uncommitted `src/usage.ts` edits the plan described have since landed as
  commit `34b2a02`.
- **Fixed the inline `import("../types.js").RateLimitWindow` type** to a
  normal `import type`, per this repo's stated convention.
- Verified during review, so the executor need not re-derive: all cited line
  numbers still match at `0458474`; `--settings`, `--tools`, `-p` and
  `--output-format` exist on `claude 2.1.222`; `claude auth status` returns
  the documented JSON; and there is **no** free local cache of usage
  percentages anywhere under `~/.claude` (only tier names), so the
  quota-spending headless call really is the only known path.
