# Plan 002: Claude usage panel from local transcript data (CLI `claude-usage` + TUI + web view)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Touch only the files listed in Scope. If anything in "STOP
> conditions" occurs, stop and report — do not improvise.
>
> **Drift check (run first)**:
> `git diff --stat 0458474..HEAD -- src/ web/src/ package.json`
> All "Current state" excerpts were verified against commit `0458474`. If any
> in-scope file changed since, compare this plan's excerpts against the live
> code first; on a mismatch, treat it as a STOP condition.
>
> This plan supersedes **plan 001**, which is BLOCKED. You do not need to read
> 001 — this file is self-contained. (001's approach — capturing Claude's
> `statusLine` JSON from a headless `claude -p` run — was proven not to work;
> see 001's "Step 0 outcome" if you want the history.)

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (read-only local file aggregation; no DB migration, no quota spend)
- **Depends on**: none. Supersedes plan 001 (BLOCKED).
- **Category**: direction (feature parity)
- **Planned at**: commit `0458474`, 2026-08-06
- **Branch**: work on `dev` (already checked out; created for the 001 attempt,
  which left it identical to `main` — no commits, no source changes)

## Why this matters

The dashboard reads Codex/ChatGPT rate limits and the user wants the same for
Claude. Plan 001 tried to read Claude's real quota percentages and **failed at
its go/no-go spike**: the `statusLine` hook that carries
`{used_percentage, resets_at}` does not fire during a headless `claude -p` run
(it is a TUI-render feature; headless has no status line to draw). Verified
again independently afterwards, at zero quota cost:

- No `claude usage`/rate-limit subcommand exists on `claude` 2.1.223. Full
  command list: `agents, auth, auto-mode, doctor, gateway, import, install,
  mcp, plugin, project, setup-token, ultrareview, update`.
- No file under `~/.claude` contains `used_percentage` or `resets_at`.

**So percent-of-quota is not obtainable.** There is no local denominator, and
Anthropic does not publish per-tier token quotas. This plan therefore ships
what *is* freely and reliably available, and is honest about what that is:

1. **Account identity** — from `claude auth status` (free, instant, no quota).
2. **Plan/tier metadata** — from `~/.claude.json`.
3. **Actual consumption** — aggregated from the local session transcripts under
   `~/.claude/projects/`, over rolling 5-hour and 7-day lookbacks: token
   counts, API-response counts, and a per-model breakdown.

This costs **zero** Claude quota, needs no new dependency, and gives the user
something the percentage gauge never would have: which models and how many
tokens actually burned the quota.

## Hard constraint: do not imply this is percent-of-quota

The numbers this feature produces are a **rolling lookback over local logs**.
They are not the real quota windows and not a percentage. Two specific traps:

- **The window anchor is unknowable.** Anthropic's real 5-hour window is
  anchored to first use within it. This plan measures "the last 5 hours from
  now". Label it exactly that way — `Last 5 hours`, `Last 7 days`. Never
  render a "resets in …" countdown for Claude, and never a percentage bar or
  `usedPercent` field. There is no denominator; inventing one would be a
  fabricated number on a dashboard whose whole purpose is accuracy.
- **Local logs are not the account's full usage.** Only work done through
  Claude Code *on this machine, under `~/.claude/projects/`* is visible. Usage
  from claude.ai web, other machines, or other tools is invisible. The UI must
  say so in one line: `Local Claude Code activity on this machine only.`

A reviewer should reject any diff that adds `usedPercent`, a progress bar, a
reset countdown, or a "% of limit" string to a Claude surface.

## Hard constraint: transcripts are private conversation logs

`~/.claude/projects/` holds the full text of the user's Claude Code
conversations across **every** project on this machine (~300 MB here). The
aggregator must read **only** these fields per record:

`type`, `timestamp`, `isSidechain`, `message.id`, `message.model`, `message.usage`

Never read, return, log, or persist `message.content`, and never echo a raw
line into an error message. On a malformed line, skip it silently and count it
— do not include the line in any thrown error. Do not add a per-project
breakdown in this version: project directory names are derived from filesystem
paths and are not needed for the feature.

## Verified facts (measured on this machine — do not re-derive)

`claude` version 2.1.223. All of the following was confirmed empirically at
plan time; the numbers are this machine's real data.

**`claude auth status`** (free, instant, exit 0, JSON on stdout):

```json
{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty",
 "email":"…","orgId":"…","orgName":"Pricesenz","subscriptionType":"team"}
```

**Tier metadata** lives in `~/.claude.json` but is **nested**, not top-level
(a top-level lookup finds nothing — this cost time to discover):

```
oauthAccount.userRateLimitTier         = "default_claude_max_5x"
oauthAccount.organizationRateLimitTier = "default_raven"
```

**Transcript record shape.** A usage-bearing record looks like this (keys
verified):

```
top level: type, timestamp, isSidechain, requestId, sessionId, uuid,
           parentUuid, cwd, gitBranch, version, message, …
message:   id, model, role, usage, content, stop_reason, …
message.usage: { input_tokens, output_tokens, cache_creation_input_tokens,
                 cache_read_input_tokens, service_tier, … }
```

- `type === "assistant"` and `message.usage` present ⇒ one API response.
- `timestamp` is ISO-8601 UTC.
- `message.model` e.g. `claude-sonnet-5`.
- **There is no cost field.** Do not compute dollars — that needs a hardcoded
  price table that silently goes stale. Report tokens only.

**Two measured facts that will break a naive implementation:**

1. **Records duplicate per API response.** The same response is written once
   per content block: 45 usage-bearing records collapsed to 19 unique
   `message.id`s in one file. In all 16 multi-record groups the usage numbers
   were **byte-identical** across copies (not partial, not cumulative), with
   one `message.id` per group. ⇒ **Dedup by `message.id`, then count it once.
   Never sum the copies** — doing so overcounted by ~2.4× in the sample.
2. **Subagent transcripts are nested one level deeper.** Files live at both
   `projects/<slug>/<session>.jsonl` **and**
   `projects/<slug>/<session>/subagents/agent-*.jsonl`. A one-level scan finds
   134 files; a recursive walk finds **329**. Subagent turns are 52% of all
   responses (2728 of 5226 in the 7-day window) — skipping them undercounted
   output tokens by ~15% and cache-read tokens by ~33%. ⇒ **The walk must be
   recursive.**

**Performance, measured** (so you do not build a cache that isn't needed):
recursive walk + `mtime` filter + a `line.includes('"usage"')` substring
pre-filter before `JSON.parse`, over the 7-day window = **147 files, 145 MB,
620 ms**. That is acceptable for a manual-refresh dashboard. **Do not build a
SQLite cache, a byte-offset tail reader, or an incremental index.** If it ever
gets slow, that is the upgrade path — not this version.

Nothing outside `~/.claude/projects/` carries usage data (`~/.claude/sessions`,
`tasks`, `jobs` were each checked: zero files with a `usage` key).

## Current state

- **`src/usage.ts`** — Codex's `fetchCodexUsage()`. Note its shape: build a
  snapshot object, validate raw input with a zod `safeParse` and throw a
  descriptive error on failure. `fetchClaudeUsage()` mirrors this shape but
  shares no code with it (different data source entirely). Its local
  `withHistoryPersistence` (lines 98-119) is Codex-only — **leave it alone**;
  this plan does not persist Claude data (see "Deliberately not doing").
- **`src/cli.ts`** — Commander program. The `usage` command (lines 22-35) is
  the exact template for `claude-usage`:

  ```ts
  program
    .command("usage")
    .description("Show current usage and rate limits")
    .option("--json", "Output raw JSON (skips TUI)")
    .option("-w, --watch", "Stay open and auto-refresh every 60 seconds")
    .action(async (opts: { json?: boolean; watch?: boolean }) => {
      if (opts.json) {
        const snapshot = await fetchCodexUsage();
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }
      const { waitUntilExit } = renderUsage({ watch: opts.watch ?? false });
      await waitUntilExit();
    });
  ```

  `addHelpText` examples are at lines 17-20. Lines 109-111 default a bare
  invocation to `usage` — **do not change that**.
- **`src/server.ts`** — `createServerApp()` returns the Express app; routes are
  registered inside it. The Codex rate-limits route (lines 36-45) is the
  template:

  ```ts
  app.get("/api/codex/rate-limits", async (_req, res) => {
    try {
      const usage = await fetchCodexUsage();
      res.json(usage);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  ```

  Binds `127.0.0.1` only (line 100) — keep it that way.
- **`src/tui/UsageApp.tsx`** — Ink TUI. Its render helper at the bottom is the
  pattern to copy:

  ```tsx
  import { render } from "ink";

  export function renderUsage(opts: {
    watch: boolean;
  }): ReturnType<typeof render> {
    return render(<UsageApp watch={opts.watch} />);
  }
  ```

  It also defines local `Spinner`, `Bar`, `WindowCard`, `formatResetTime`,
  `formatFetchTime` helpers. **Do not extract or refactor them** — `Bar` and
  `WindowCard` render percentage gauges, which Claude has none of, so there is
  nothing worth sharing. Leave this file untouched.
- **`web/src/App.tsx`** — 998 lines, one big `App()` component ending with:

  ```tsx
        <footer className="flex items-center justify-between border-t border-border/30 pt-4 font-sans text-[11px] text-muted-foreground">
          <span>Auto-refreshes every 60s</span>
          <span>Last fetch: {formatFetchTime(data?.fetchedAt)}</span>
        </footer>
      </div>
    </main>
  );
  }

  createRoot(document.getElementById("root")!).render(<App />);
  ```

  Imports at lines 1-14 include `Loader` from `./components/kokonutui/loader.js`,
  `Alert`/`AlertDescription`/`AlertTitle` and `Button` from `./components/ui/`.
  Step 6 adds a tab switcher with a ~20-line diff and **no restructuring of the
  existing component** — see that step for exactly why.
- **`src/usage.test.ts`** — the mocking exemplar. Copy this shape (module mock
  declared at top level, handles cleared in `beforeEach`):

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";

  const requestMock = vi.fn();

  vi.mock("./codexRpc.js", () => ({
    CodexRpcClient: vi.fn(function MockCodexRpcClient() {
      return { request: requestMock, start: startMock, stop: stopMock };
    }),
  }));

  describe("fetchCodexUsage", () => {
    beforeEach(() => {
      vi.resetModules();
      requestMock.mockReset();
      // …
  ```
- **`package.json`** scripts — `"usage": "tsx src/cli.ts usage"`,
  `"usage:json": "tsx src/cli.ts usage --json"`. No `bin` field: a "CLI
  command" here means a Commander subcommand plus a matching pnpm script.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc -p tsconfig.json --noEmit` | exit 0, no errors |
| Tests | `pnpm test` | all pass |
| Tests (filtered) | `pnpm exec vitest run <path>` | pass |
| Build | `pnpm run build` | exit 0, `dist/` + `dist-web/` produced |
| Dev server | `pnpm run dev` | API on :8787, web on :5173 |

`node_modules` is already installed — no `pnpm install` needed.

## Scope

**In scope.** New:
- `src/claudeUsage.ts`
- `src/claudeUsage.test.ts`
- `src/tui/ClaudeUsageApp.tsx`
- `web/src/components/ClaudeUsageView.tsx`

Modified:
- `src/types.ts` (additive: new `Claude*` types only)
- `src/schemas.ts` (additive: `ClaudeAuthStatusSchema` only)
- `src/cli.ts` (add `claude-usage` subcommand + help text example)
- `src/server.ts` (add `GET /api/claude/usage`)
- `src/server.test.ts` (new `it(...)` blocks only)
- `web/src/App.tsx` (add tab switcher; see Step 6 for the exact minimal diff)
- `package.json` (add two scripts)

**Out of scope — do NOT touch:**
- `src/history/**` — **no** `provider` column, no SQLite migration, no
  provider-scoped queries, no persistence of Claude data at all. See
  "Deliberately not doing" for why.
- `src/usage.ts`, `src/usage.test.ts`, `src/codexRpc.ts` — Codex path stays
  exactly as-is. Do not extract `withHistoryPersistence`.
- `src/tui/UsageApp.tsx` — no shared-primitive extraction.
- Any restructuring of `web/src/App.tsx`'s existing `App` body beyond the
  rename in Step 6. Do not extract `WindowCard`/`TrendChart`, do not build a
  parameterized `UsageDashboard`.
- `src/login.ts`, `src/tui/LoginApp.tsx`. No Claude login flow — `claude auth
  login` already exists; if `loggedIn` is false, tell the user to run it.
- `web/src/components/ui/*`, `web/src/components/kokonutui/*`.
- Any change to `CodexAccount`, `CodexRateLimit`, `UsageSnapshotData`,
  `UsageSnapshot` in `src/types.ts`.

## Deliberately not doing (and why)

Plan 001 specified a large refactor to share code between the two providers.
Under this design most of it stops paying for itself — **do not reintroduce
it**, and do not treat its absence as an oversight:

- **No `provider` column / SQLite migration / provider-scoped store queries.**
  Claude's source of truth is the transcript files, which are already durable
  history on disk. Any window can be recomputed in ~620 ms. Persisting a
  derived aggregate would add a schema migration and a dedup-scoping bug class
  for data we can recompute for free.
- **No shared `withHistoryPersistence` module** — follows from the above.
- **No TUI shared-primitive extraction** — the shareable pieces (`Bar`,
  `WindowCard`) render percentage gauges that Claude does not have.
- **No `UsageDashboard` parameterization of `App.tsx`.** Under 001 both
  providers rendered the same percentage-gauge layout, so one parameterized
  component made sense. Claude's view is a different shape (token totals, model
  breakdown, no gauges, no countdown), so parameterizing would mean a
  component with two mutually exclusive halves. A separate component plus a tab
  switcher is smaller and clearer.
- **No dollar/cost figures** — transcripts carry no cost field, so this would
  need a hardcoded price table that goes stale silently.
- **No `--watch` on `claude-usage` and no web auto-poll for Claude.** Readings
  are free of quota now, but each one re-reads ~145 MB. Mount-plus-manual-
  refresh is plenty. (If someone later wants auto-refresh, it is defensible
  here in a way it was not under 001 — but it is a separate decision, not a
  copy-paste from the Codex path.)

## Git workflow

- You are already on branch `dev`. Do not switch or create branches. Do not
  push, do not open a PR, do not touch `main`.
- Commit per step. Match the repo's style (lowercase, imperative, `feat:`
  prefix — e.g. `feat: add claude usage aggregation from local transcripts`).
- Never `git add -A` — stage explicit paths so `plans/` stays untracked. Do
  **not** commit `plans/`.

## Steps

### Step 1: Types and schema (additive)

Append to `src/types.ts` — do not modify any existing type:

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
  userRateLimitTier?: string | null;
  organizationRateLimitTier?: string | null;
};

export type ClaudeModelUsage = {
  model: string;
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

/** A rolling lookback over local logs — NOT a quota window. */
export type ClaudeUsageWindow = {
  label: string; // e.g. "Last 5 hours"
  lookbackMins: number; // 300 | 10080
  since: string; // ISO
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  byModel: ClaudeModelUsage[]; // sorted by outputTokens desc
};

export type ClaudeUsageSnapshot = {
  fetchedAt: string;
  account: ClaudeAccount;
  windows: ClaudeUsageWindow[]; // [5h, 7d]
  scan: {
    filesScanned: number;
    responsesCounted: number;
    malformedLines: number;
    elapsedMs: number;
  };
};
```

Note there is deliberately no `usedPercent` and no `resetsAt` anywhere — see
the first Hard constraint.

Append to `src/schemas.ts`:

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
```

Use `safeParse` at call sites, never `.parse()` on external data (per
`CLAUDE.md`).

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: `src/claudeUsage.ts` — the aggregator

Create `src/claudeUsage.ts`. Everything below is load-bearing; the two facts
that will silently corrupt the numbers if you get them wrong are the recursive
walk and the `message.id` dedup.

Exports:

1. `readClaudeAuthStatus(command?: string): Promise<unknown>` — `execFile` the
   `claude` binary with `["auth", "status"]`, 15 s timeout, `JSON.parse` stdout.
   Binary path from `process.env.CLAUDE_BIN || "claude"` (mirrors how
   `CODEX_BIN` works for Codex).
2. `readClaudeTiers(configPath?: string)` — read `~/.claude.json`, return
   `{ userRateLimitTier, organizationRateLimitTier }` from the nested
   **`oauthAccount`** object (top level does not have them). Any failure —
   missing file, unparseable JSON, missing key — returns `{}`. This is
   best-effort metadata and must never fail the request.
3. `scanClaudeUsage(options?: { root?: string; now?: Date }): {...}` — the
   aggregation. `root` defaults to `path.join(os.homedir(), ".claude",
   "projects")` and **must be injectable** so tests can point at a fixture
   tree. `now` defaults to `new Date()` so windows are testable.
4. `fetchClaudeUsage(): Promise<ClaudeUsageSnapshot>` — composes 1-3.

`scanClaudeUsage` algorithm — implement exactly this:

```
windows      := [{ label: "Last 5 hours", lookbackMins: 300 },
                 { label: "Last 7 days",  lookbackMins: 10080 }]
maxLookback  := 10080 min
cutoff       := now - maxLookback

files := recursive walk of `root`, every *.jsonl at ANY depth
         (readdirSync withFileTypes, recurse into directories)
         keep only files whose statSync().mtimeMs >= cutoff
         a walk error on any directory is skipped, not thrown

seen := Set<string>        // GLOBAL across all files, not per-file
for each file, read line by line (createInterface over createReadStream):
    if !line.includes('"usage"')  -> skip        // cheap pre-filter
    JSON.parse; on throw -> malformedLines++, continue
    if record.type !== "assistant" -> skip
    usage := record.message?.usage; if !usage -> skip
    key := record.message.id ?? record.requestId
    if !key or seen.has(key) -> skip             // dedup: count once
    seen.add(key)
    ts := Date.parse(record.timestamp); if NaN -> malformedLines++, continue
    for each window whose (now - ts) <= lookbackMins:
        accumulate responses + the four token counts
        accumulate the same into that window's per-model bucket
                                  (model := record.message.model ?? "unknown")
sort each window's byModel by outputTokens desc
```

Notes that matter:

- **Recursive walk, not one level.** Subagent transcripts live at
  `projects/<slug>/<session>/subagents/agent-*.jsonl` and are 52% of all
  responses. One-level scanning silently undercounts.
- **Dedup by `message.id`, count once, never sum copies.** Duplicate records
  for one response carry identical usage numbers.
- **`seen` is global**, so a response cannot be double-counted if it appears in
  more than one file.
- **Include `isSidechain` records.** Subagent turns consume real quota. The
  field is read only so you know not to filter on it.
- Read only the fields listed in the privacy constraint. Never touch
  `message.content`; never put a raw line in an error.
- `elapsedMs` measured with `Date.now()` around the scan.

`fetchClaudeUsage()`:

```ts
export async function fetchClaudeUsage(): Promise<ClaudeUsageSnapshot> {
  const fetchedAt = new Date().toISOString();
  const raw = await readClaudeAuthStatus();
  const parsed = ClaudeAuthStatusSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Unexpected \`claude auth status\` response: ${parsed.error.message}`,
    );
  }
  const auth = parsed.data;
  const scan = scanClaudeUsage();

  if (!auth.loggedIn) {
    return { fetchedAt, account: null, windows: scan.windows, scan: scan.scan };
  }

  const tiers = readClaudeTiers();
  return {
    fetchedAt,
    account: {
      type: "claude",
      email: auth.email,
      orgName: auth.orgName ?? null,
      subscriptionType: auth.subscriptionType ?? null,
      userRateLimitTier: tiers.userRateLimitTier ?? null,
      organizationRateLimitTier: tiers.organizationRateLimitTier ?? null,
    },
    windows: scan.windows,
    scan: scan.scan,
  };
}
```

The error message must not include the raw response body — a malformed
`claude auth status` output could contain account details. Mention the schema
failure only.

Note that the scan still runs when `loggedIn` is false: the local logs are
there regardless, and the UI shows them alongside a "run `claude auth login`"
notice. This is deliberate, not a bug.

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: `src/claudeUsage.test.ts`

Create the test file. Mock `node:child_process`'s `execFile` for the auth call
(follow `src/usage.test.ts`'s top-level `vi.mock` + `beforeEach` reset shape,
shown in "Current state"). For the scan, **build a real fixture transcript
tree** in a temp dir via `mkdtempSync` and point `scanClaudeUsage({ root })` at
it — do not mock `fs`.

The fixture must include, at minimum:

- A flat `projects/<slug>/<session>.jsonl`.
- A **nested** `projects/<slug>/<session>/subagents/agent-x.jsonl` with usage
  records. This is the regression test for the recursive walk.
- Three records sharing one `message.id` with identical usage (the duplicate
  case).
- One record with `isSidechain: true`.
- One record older than 5 hours but inside 7 days.
- One record older than 7 days (must be excluded from both windows — note the
  file's `mtime` will be recent, so this proves the per-record timestamp filter
  works independently of the `mtime` pre-filter).
- One malformed line (not JSON) and one non-assistant record.
- Two different `message.model` values.

Required assertions:

- Nested subagent file's tokens **are** included (fails if the walk is not
  recursive).
- The triplicate `message.id` is counted **once**, and its tokens appear once —
  not 3×.
- The 5-hour window excludes the >5h record; the 7-day window includes it.
- The >7-day record appears in neither window.
- `byModel` has one entry per model, sorted by `outputTokens` descending, and
  its per-model token sums equal the window totals.
- `malformedLines` counts the bad line and the scan still succeeds.
- `fetchClaudeUsage()` with `loggedIn: false` → `account === null`, and the
  window data is still populated.
- Malformed `claude auth status` output → throws, and the thrown message does
  **not** contain the raw body (assert on a distinctive token from the fixture
  body being absent from `error.message`).
- `readClaudeTiers` on a config file with no `oauthAccount` → returns `{}`,
  does not throw.

Pass `now` explicitly in window tests so they don't depend on wall-clock time.
Clean up temp dirs in `afterEach`.

**Verify**: `pnpm exec vitest run src/claudeUsage.test.ts` → all pass.

### Step 4: CLI subcommand

In `src/cli.ts` add the import and the subcommand, modeled on `usage`:

```ts
import { fetchClaudeUsage } from "./claudeUsage.js";
import { renderClaudeUsage } from "./tui/ClaudeUsageApp.js"; // Step 5
```

```ts
program
  .command("claude-usage")
  .description("Show local Claude Code token consumption (last 5h / 7d)")
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

No `-w/--watch` — deliberate (see "Deliberately not doing"). Add two lines to
the `addHelpText` examples block (lines 17-20):
`\n  codex-usage claude-usage\n  codex-usage claude-usage --json`.

Do **not** change the bare-invocation default at lines 109-111 — it stays
`usage`.

**Verify**: `pnpm exec tsx src/cli.ts claude-usage --json` → prints a JSON
snapshot with populated `windows` and a non-zero `scan.filesScanned`. This is
free (no quota). Sanity-check the numbers are plausible, not zero.

### Step 5: Ink TUI

Create `src/tui/ClaudeUsageApp.tsx`. Keep it simple — this is a one-shot
report, not a live monitor. No spinner-driven watch loop, no interval, no
`r`-to-refresh, no `Countdown`. Structure:

- On mount, call `fetchClaudeUsage()`; show a brief loading line while pending
  (a scan takes well under a second, so a static `Reading local Claude
  activity…` is enough — do not import `UsageApp`'s `Spinner`).
- On error, print the message and exit non-zero.
- Header: account email, `subscriptionType`, and `userRateLimitTier` when
  present. If `account === null`, print
  `Not logged in. Run \`claude auth login\`, then retry.` and still show the
  local window data below it.
- Per window: the label (`Last 5 hours` / `Last 7 days`), response count, and
  the four token totals. Then the `byModel` rows, indented.
- Footer, verbatim — both lines are required by the Hard constraints:
  `Rolling lookback over local logs — not a quota percentage.`
  `Local Claude Code activity on this machine only.`
- Format numbers with `toLocaleString()` for thousands separators. Use
  **date-fns** for any date formatting (`CLAUDE.md` forbids
  `Date.toLocaleString()` for dates — number formatting is unaffected).
- Use `useApp()` → `exit()` after the final render, as the other TUIs do.

Export the render helper at the bottom, matching `renderUsage`'s shape:

```tsx
import { render } from "ink";

export function renderClaudeUsage(): ReturnType<typeof render> {
  return render(<ClaudeUsageApp />);
}
```

No progress bars — there is no percentage to bar.

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0.
**Verify** (manual, needs a terminal): `pnpm exec tsx src/cli.ts claude-usage`
renders and exits cleanly. If you cannot run an interactive terminal, say so
explicitly in your report rather than claiming it passed.

### Step 6: Server route

In `src/server.ts` add the import and one route inside `createServerApp()`,
next to the Codex one:

```ts
import { fetchClaudeUsage } from "./claudeUsage.js";
```

```ts
app.get("/api/claude/usage", async (_req, res) => {
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

Path is `/api/claude/usage`, not `/rate-limits` — it is not rate-limit data.
No history routes for Claude (nothing is persisted).

Add to `src/server.test.ts` as new `it(...)` blocks in the existing `describe`
— do not edit existing tests. Mock `./claudeUsage.js` the same way the file
already mocks `./usage.js`. Cover: 200 with the mocked snapshot as JSON, and
500 with the error message when `fetchClaudeUsage` rejects.

**Verify**: `pnpm exec vitest run src/server.test.ts` → all pass, existing
tests unmodified.

### Step 7: Web view

**7a.** Create `web/src/components/ClaudeUsageView.tsx`:

- `useEffect` on mount → `fetch("/api/claude/usage")`; a Refresh button
  refetches. **No `setInterval`.**
- Reuse the existing shadcn primitives via the `@/*` alias or relative
  `./ui/*.js` imports, matching how `App.tsx` imports them (`Button`, `Alert`,
  `AlertDescription`, `AlertTitle`, and `Loader` from
  `./kokonutui/loader.js`). Use the `cn()` helper from `@/lib/utils` for
  conditional classes. Do not hand-roll new primitives.
- Layout: account header (email, subscription type, tier), then one card per
  window with the response count and four token totals, then a per-model table
  inside each card.
- Show `scan.filesScanned` / `scan.elapsedMs` as small dim text — it makes the
  local-only nature legible.
- If `account === null`, render an `Alert` telling the user to run
  `claude auth login`, and still show the window data.
- Include both required disclosure lines from Step 5's footer.
- Declare the types this component needs locally in this file (the web layer
  is intentionally self-contained — `CLAUDE.md` forbids importing from `src/`).
- **No progress bars, no percentages, no reset countdowns.**

**7b.** Wire the tab switcher into `web/src/App.tsx` with a minimal diff.
Rename the existing `function App()` to `function CodexDashboard()` — change
**nothing** inside it — then add a new shell above the `createRoot` line:

```tsx
function App() {
  const [provider, setProvider] = useState<"codex" | "claude">("codex");
  return (
    <>
      <div className="mx-auto flex w-full max-w-6xl gap-2 px-4 pt-6">
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
      {provider === "codex" ? <CodexDashboard /> : <ClaudeUsageView />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

Add the `ClaudeUsageView` import. `useState` and `Button` are already imported
(lines 1-14). Treat the classes above as a starting point — match the
surrounding Tailwind conventions.

This unmounts `CodexDashboard` when the Claude tab is active, which stops its
60-second poll while the user is on the Claude tab. That is fine and
intentional; it resumes on switching back.

**Verify**: `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0.
**Verify** (manual, per `CLAUDE.md` — typechecking does not verify UI): run
`pnpm run dev`, open `http://127.0.0.1:5173`, and confirm:
- The Codex tab is unchanged from before (same numbers, layout, history panel,
  cleanup buttons).
- The Claude tab renders real token numbers, with no percentage bar and no
  reset countdown anywhere.
- Both disclosure lines are visible on the Claude tab.
- **The Claude tab issues exactly one `/api/claude/usage` request.** Watch the
  devtools Network panel for two minutes on the Claude tab: one request, none
  after. Then confirm the Codex tab still polls once a minute.

If you cannot drive a browser, run the API check headlessly instead
(`curl -s localhost:8787/api/claude/usage | head -c 400` with the server
running) and state plainly in your report that the browser checks were not
performed and remain for a human.

### Step 8: `package.json` scripts

Add alongside `usage`/`usage:json`:

```json
"claude-usage": "tsx src/cli.ts claude-usage",
"claude-usage:json": "tsx src/cli.ts claude-usage --json",
```

**Verify**: `pnpm run claude-usage:json` → prints the JSON snapshot.

## Test plan

New automated tests:

- `src/claudeUsage.test.ts` — the aggregator against a real fixture transcript
  tree plus a mocked `execFile`. Full assertion list in Step 3. The three that
  guard the measured failure modes: nested-subagent inclusion, `message.id`
  dedup counted once, and per-record window boundaries.
- `src/server.test.ts` — new `it(...)` blocks for `GET /api/claude/usage`
  (200 and 500).

Run `pnpm test` at the end: all pass, with **zero** existing test assertions
modified.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc -p tsconfig.json --noEmit` exits 0
- [ ] `pnpm test` exits 0, including the new tests from the Test plan
- [ ] `pnpm run build` exits 0
- [ ] `pnpm exec tsx src/cli.ts claude-usage --json` prints a snapshot whose
      `scan.filesScanned` and `windows[1].responses` are both > 0
- [ ] `grep -c "usedPercent\|resetsAt\|%" src/claudeUsage.ts` → no
      percentage/reset concepts in the Claude aggregator
- [ ] `grep -rn "setInterval" web/src/components/ClaudeUsageView.tsx` returns
      nothing
- [ ] `grep -rn "watch" src/tui/ClaudeUsageApp.tsx` returns nothing
- [ ] `grep -n "api/claude/usage" src/server.ts` matches
- [ ] `git status --short` shows no modified file outside the Scope list, and
      `plans/` still untracked
- [ ] `git diff --stat main..dev -- src/history/` is empty (history layer
      untouched)

## STOP conditions

Stop and report — do not improvise — if:

- A "Current state" excerpt does not match the live code (drift since
  `0458474`).
- `~/.claude/projects/` does not exist, or a recursive walk finds zero
  `*.jsonl` files. The feature has no data source; report rather than
  inventing a fallback.
- The transcript record shape differs from "Verified facts" (e.g. no
  `message.usage`, or `message.id` absent across the board). The dedup and
  aggregation design depends on that shape.
- You find yourself adding a percentage, a `usedPercent` field, a progress
  bar, or a reset countdown to any Claude surface. Re-read the first Hard
  constraint — there is no denominator, so any such number is fabricated.
- You find yourself needing a cache, index, or byte-offset reader for
  performance. Measured cost is 620 ms; if you are seeing much worse, report
  the measurement instead of building an index.
- A step's verification fails twice after a reasonable fix attempt.
- Implementing a step would require touching an out-of-scope file — in
  particular anything under `src/history/`.

## Maintenance notes

- **If Anthropic ships a documented free way to read real quota percentages**
  (a `claude usage` subcommand, or a headless-friendly rate-limit read), that
  supersedes this feature's core premise. `scanClaudeUsage` would become a
  secondary "what consumed it" breakdown alongside a real gauge. Revisit plan
  001's Step 0 spike at that point — its failure is version-specific
  (`claude` 2.1.223).
- **The transcript record shape is not a public API.** It is an internal
  on-disk format that can change without notice. `scanClaudeUsage` is the only
  place that touches it, and it is written to degrade rather than throw
  (unknown fields ignored, malformed lines counted and skipped). Keep that
  property. If a future version stops writing `message.id`, the `requestId`
  fallback keeps dedup working.
- A reviewer should scrutinize, in this order:
  1. **The recursive walk.** A one-level regression silently undercounts by
     ~52% of responses and nothing fails loudly. Check the nested-fixture test
     still exists and actually asserts on the nested file's tokens.
  2. **The `message.id` dedup.** Summing duplicate copies overcounts ~2.4×,
     also silently. Check the triplicate-id test.
  3. **Any percentage or countdown that crept into a Claude surface.**
  4. **Whether `message.content` is read anywhere** in the aggregator. It must
     not be.
- Performance headroom: cost scales with bytes written in the last 7 days
  (145 MB / 620 ms here). If a heavy user hits multiple seconds, the upgrade
  path is a per-file `(path, mtime, size) → aggregate` cache, since transcripts
  are append-only. Do not pre-build it.
