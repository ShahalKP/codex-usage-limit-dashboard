# Codebase Improvement Audit

Date: 2026-05-30  
Repository: `/Users/shahalkp/Documents/Github/codex-usage-limit-dashboard`

## Executive Summary

This repository is a local TypeScript tool for inspecting Codex / ChatGPT rate-limit state through `codex app-server`. The product has three primary surfaces:

- CLI/TUI commands for usage, login, history listing, and history cleanup.
- A local Express API bound to `127.0.0.1`.
- A Vite + React dashboard that polls current usage and renders local SQLite history.

The existing test and build checks are healthy: `pnpm test` passed 5 test files / 18 tests, and `pnpm run build` completed successfully. The highest-priority improvement is still correctness/reliability: `CodexRpcClient` does not listen for child-process `error`, and a missing `codex` binary currently crashes with an unhandled event instead of surfacing a normal CLI/API error.

Top priorities:

1. Now: handle `spawn` errors in `CodexRpcClient`.
2. Now: align CLI history limit validation with API validation.
3. Now: fix root install/workspace dependency ambiguity around the web-only `motion` package.
4. Next: make dashboard API response parsing resilient to non-JSON errors.
5. Next: sequence dashboard refresh so freshly persisted history is visible immediately.

## Repository Map

### Stack and Package Manager

- Package manager: `pnpm`; evidence: `pnpm-lock.yaml` exists, README install command uses `pnpm install`, and `package.json` scripts are pnpm-oriented (`README.md:27-38`, `package.json:3-12`).
- Runtime and language: Node.js 20+, TypeScript 5 strict ESM; evidence: README requirements (`README.md:14-18`), `package.json` dependency list (`package.json:13-34`), and `tsconfig.json` sets `module` / `moduleResolution` to `NodeNext` with `strict: true`.
- Backend/API: Express 5; evidence: dependency in `package.json:22`, server entry in `src/server.ts`.
- Frontend: Vite 7 + React 19 + Tailwind CSS v4; evidence: `package.json:14-34`, `web/vite.config.ts:1-24`, `web/src/App.tsx`.
- TUI: Ink 7 + React 19; evidence: `package.json:23`, `src/tui/UsageApp.tsx`, `src/tui/LoginApp.tsx`, `src/tui/HistoryApp.tsx`.
- Persistence: better-sqlite3 local SQLite history; evidence: `package.json:16`, schema in `src/history/db.ts:11-42`.
- Runtime validation: Zod schemas for external RPC responses; evidence: `src/schemas.ts:1-36`.

### Entry Points and Commands

- `pnpm run usage`: `tsx src/cli.ts usage` (`package.json:6`).
- `pnpm run usage:json`: machine-readable usage output (`package.json:7`).
- `pnpm run login`: device-code login (`package.json:8`).
- `pnpm run server`: Express API (`package.json:9`).
- `pnpm run web`: Vite dev server on `127.0.0.1:5173` (`package.json:10`, `web/vite.config.ts:9-14`).
- `pnpm run dev`: concurrent API + web (`package.json:11`).
- `pnpm test`: `vitest run` (`package.json:5`, `vitest.config.ts`).
- `pnpm run build`: TypeScript compile plus Vite build (`package.json:4`).

### Product Surface

- Product purpose: one local developer can answer "am I near the limit?" at a glance (`PRODUCT.md:7-13`).
- Design goal: precise, terminal-native, polished, low-noise (`PRODUCT.md:15-33`).
- History behavior: successful usage fetches persist coalesced local history in SQLite (`README.md:176-186`).
- Dashboard history controls: range selection, primary/secondary trend views, recent intervals, cleanup (`README.md:210-218`).

### Notable Local Architecture

- `src/codexRpc.ts`: JSON-RPC client over stdio to `codex app-server`.
- `src/usage.ts`: validates `account/read` and `account/rateLimits/read`, selects the Codex bucket, persists history.
- `src/server.ts`: local Express routes for health, rate limits, history query, and history deletion.
- `src/history/db.ts`, `src/history/store.ts`, `src/history/types.ts`, `src/history/cli.ts`: SQLite schema, coalescing, range parsing, and CLI formatting.
- `src/tui/*.tsx`: Ink renderers.
- `web/src/App.tsx`: single-file React dashboard with local duplicated API types.

## Verification Commands Attempted

| Command | Result |
| --- | --- |
| `pwd && rg --files -g '!*node_modules*' -g '!dist*' -g '!dist-web*'` | Mapped source, docs, lockfiles, tests, frontend, and history files. |
| `git status --short` | Clean before the audit file was created. |
| `node -v && pnpm -v && codex --version` | `v20.19.5`, `10.33.3`, `codex-cli 0.135.0`. |
| `pnpm test` | Passed: 5 files, 18 tests. |
| `pnpm run build` | Passed: TypeScript compile and Vite production build. Note: this command writes ignored `dist/` and `dist-web/` outputs. |
| `CODEX_BIN=/definitely/not/codex pnpm run usage:json` | Failed as expected with unhandled `ChildProcess` `error` event, proving missing-binary crash path. |
| `pnpm list --depth -1 --recursive` | Listed only the repo root, supporting the workspace dependency hypothesis for `web/package.json`. |

Skipped checks:

- Live browser validation was skipped because the requested output is a source-backed audit, not a UI change.
- Live `codex app-server` happy-path usage was not required because tests/build and source evidence were sufficient for this audit.
- Clean-checkout install verification was not run; related dependency finding is labeled as a hypothesis.

## Prioritization

### Now

1. Handle `codex app-server` spawn errors.
2. Validate CLI history `--limit` consistently with the API.
3. Resolve fresh-install ambiguity for `motion`.
4. Fix the README dashboard code fence.

### Next

1. Make frontend API response handling resilient to non-JSON error responses.
2. Sequence dashboard usage/history refreshes to avoid stale first-load history.
3. Add non-watch TUI error exit behavior and tests.
4. Add local request protection for side-effecting API routes.

### Later

1. Add history export.
2. Add threshold warnings.
3. Add history delta summaries.
4. Add a compact multi-bucket view.
5. Add first-class global CLI packaging.

## Bugs and Edge Cases

### Now: Missing Codex Binary Crashes the Process

Category: subprocess error handling  
Severity: High  
Impact: If `codex` is missing or `CODEX_BIN` points to a bad path, CLI/API execution can terminate with an unhandled `ChildProcess` error instead of a useful message.

Evidence:

- `CodexRpcClient.start()` spawns `this.command` at `src/codexRpc.ts:29-32`.
- The child process registers `stderr` and `exit` handlers at `src/codexRpc.ts:34-46`, but no `error` handler.
- Targeted command output from `CODEX_BIN=/definitely/not/codex pnpm run usage:json`:

```text
Error: spawn /definitely/not/codex ENOENT
Emitted 'error' event on ChildProcess instance
Node.js v20.19.5
```

Confidence: High.

Implementation outline:

- Add `this.proc.on("error", ...)` in `CodexRpcClient.start()`.
- Clear pending request timeouts, reject pending promises, close the readline interface, and reset `this.proc`.
- Convert `ENOENT` / `EACCES` into a message that points to installing Codex CLI or setting `CODEX_BIN`.
- Add unit tests around a bad command and an API route returning a controlled 500.

Residual risk: Early app-server exits after spawn still need clear classification separately from OS-level spawn errors.

### Now: CLI History Silently Accepts Invalid Limits

Category: CLI validation  
Severity: Low  
Impact: Script mistakes like `--limit nope` silently return the default 10 rows instead of failing, while the HTTP API rejects equivalent invalid input.

Evidence:

- CLI passes `Number(opts.limit)` directly into `listHistoryEvents()` (`src/cli.ts:63-66`).
- `normalizeHistoryLimit()` defaults non-finite values to 10 (`src/history/types.ts:53-56`).
- HTTP query validation rejects non-integer or out-of-range limits (`src/server.ts:10-20`).
- Explorer probe: `pnpm exec tsx src/cli.ts history --range all --limit nope --json` exited 0 and returned history JSON.

Confidence: High.

Implementation outline:

- Add a shared `parseHistoryLimit()` helper or commander custom parser enforcing integer `1..200`.
- Use it in CLI history command before calling `listHistoryEvents()`.
- Add negative tests for non-numeric, zero, and >200 values.

Residual risk: Some existing personal scripts may rely on the forgiving fallback.

### Next: One-Shot TUI Error Path May Not Exit

Category: TUI state transition  
Severity: Medium  
Impact: In non-watch mode, a failed fetch can render an error but not call `exit()` or set a non-zero process status.

Evidence:

- Non-watch auto-exit only runs for `state.phase === "done"` (`src/tui/UsageApp.tsx:230-235`).
- The error branch renders an error (`src/tui/UsageApp.tsx:267-288`) but does not exit.
- CLI waits for Ink `waitUntilExit()` (`src/cli.ts:33-34`).

Confidence: Medium. This is code-evidence based; direct runtime reproduction was not conclusive in non-TTY execution.

Implementation outline:

- Add an effect that handles `!watch && state.phase === "error"` by setting `process.exitCode = 1`, flushing, and exiting.
- Add an Ink test with a mocked failing `fetchCodexUsage()`.

Residual risk: Ink behavior can differ in TTY and non-TTY contexts; test both where practical.

### Next: Side-Effecting Local GET Route Has No Request Protection

Category: local API safety  
Severity: Medium  
Impact: Any local webpage able to hit `http://127.0.0.1:8787/api/codex/rate-limits` may trigger a token-refreshing Codex RPC read and local history write if the server is running.

Evidence:

- `GET /api/codex/rate-limits` calls `fetchCodexUsage()` (`src/server.ts:36-45`).
- `fetchCodexUsage()` calls `account/read` with `{ refreshToken: true }` (`src/usage.ts:45-54`).
- The same successful fetch persists history (`src/usage.ts:67-72`).
- The server binds to `127.0.0.1`, which reduces exposure, but there is no Origin/Host/token check (`src/server.ts:100-101`).

Confidence: Medium.

Implementation outline:

- Add strict Host and Origin checks for browser routes, or generate a local session token printed by the server and required by the Vite client.
- Consider separating read-only current snapshot retrieval from history-persisting refresh operations if the product needs browser polling.
- Add server tests for rejected foreign Origin and accepted local dashboard calls.

Residual risk: Protection needs to remain ergonomic for local-only usage and Vite proxy development.

## Improvements to Existing Functionality

### Now: Fresh Root Install May Miss the Web-Only `motion` Dependency

Category: developer workflow  
Impact: A clean setup following root-level `pnpm install` may not install `web/package.json` dependencies, while the root Vite build imports a component that depends on `motion/react`.

Evidence:

- `web/src/components/kokonutui/loader.tsx` imports `motion/react` (`web/src/components/kokonutui/loader.tsx:3`).
- `motion` is declared only in `web/package.json:4-7`, not root `package.json:13-34`.
- `pnpm-workspace.yaml` contains `allowBuilds` only, no `packages` entry (`pnpm-workspace.yaml:1-4`).
- `pnpm list --depth -1 --recursive` listed only the repository root.

Confidence: Medium. Current local `web/node_modules` can mask this; clean-checkout install would verify.

Implementation outline:

- Either add `packages: ["web"]` to `pnpm-workspace.yaml` and keep `web/package.json` as a real workspace package, or move `motion` to root dependencies because root scripts build the web app.
- Run a clean install/build in a temporary checkout or container.
- Add a short note to README if the workspace layout remains multi-package.

Residual risk: Moving dependencies may require lockfile updates and a decision about whether `web/package.json` is intended to be authoritative.

### Now: README Dashboard Code Fence Is Broken

Category: docs maintainability  
Impact: The dashboard run instructions render poorly and reduce copy/paste trust.

Evidence:

- README uses ````bashUpdat` instead of ````bash` at `README.md:234-238`.

Confidence: High.

Implementation outline:

- Replace the fence marker with `bash`.
- Optionally add markdown linting if docs continue to grow.

Residual risk: None beyond ordinary documentation drift.

### Next: Frontend Error Handling Assumes JSON Before Checking Status

Category: API ergonomics / UX  
Impact: If the API, Vite proxy, or an intermediate error returns plain text/HTML, the dashboard reports a low-level JSON parse message instead of the HTTP status and useful endpoint context.

Evidence:

- `refreshUsage()` calls `response.json()` before checking `response.ok` (`web/src/App.tsx:384-392`).
- `refreshHistory()` does the same (`web/src/App.tsx:429-440`).
- `handleCleanup()` does the same (`web/src/App.tsx:470-480`).
- Explorer probe for a text 502 response produced: `Unexpected token 'o', "not json" is not valid JSON`.

Confidence: High.

Implementation outline:

- Add a small `readApiResponse(response, fallbackMessage)` helper in `web/src/App.tsx`.
- Check `Content-Type`; parse JSON when available, otherwise read text.
- Include `response.status` / `response.statusText` in thrown errors.
- Use the helper for all three fetch paths.

Residual risk: Successful but malformed JSON can still flow through because frontend API types are duplicated but not runtime-validated.

### Next: Initial Dashboard History Can Lag Behind Current Fetch

Category: UX reliability  
Impact: On first page load, current usage persistence and history fetch run independently, so history can display stale data until manual refresh or the next 60-second poll.

Evidence:

- `refreshUsage()` starts in one `useEffect` (`web/src/App.tsx:495-501`).
- `refreshHistory(historyRange)` starts independently in a second `useEffect` (`web/src/App.tsx:503-509`).
- Usage persistence happens before `fetchCodexUsage()` returns (`src/usage.ts:67-72`).
- `refreshAll()` already sequences usage before history (`web/src/App.tsx:451-454`), but initial load does not use it.

Confidence: Medium. This is a timing hypothesis backed by code structure.

Implementation outline:

- Use `refreshAll()` for initial load, or make initial history refresh await the first usage fetch.
- Add a test/harness with artificial API delay to prove the latest row appears after first load.
- Keep abort behavior intact for navigation/range changes.

Residual risk: Sequencing may make first-load history appear slightly later; loaders should communicate that.

### Next: Test Coverage Does Not Cover RPC Client or Frontend

Category: reliability / test gaps  
Impact: The most failure-prone integration points, subprocess JSON-RPC and browser fetch handling, are currently unprotected by focused tests.

Evidence:

- Vitest includes only `src/**/*.test.ts` (`vitest.config.ts`), and current tests cover usage, server, and history (`src/usage.test.ts`, `src/server.test.ts`, `src/history/*.test.ts`).
- There is no `src/codexRpc.test.ts` in `rg --files` output.
- No frontend tests are included by `vitest.config.ts`.

Confidence: High.

Implementation outline:

- Add `src/codexRpc.test.ts` with a tiny fake child process command or injected spawn adapter.
- Add tests for spawn `error`, timeout cleanup, malformed JSON lines, JSON-RPC error responses, and process exit.
- If frontend logic grows further, extract API read helpers and pure trend helpers for unit testing without adding a full browser stack.

Residual risk: Testing child processes can become brittle; prefer dependency injection over shelling out where possible.

## Potential New Capabilities

### Later: Export History Snapshots

Category: CLI/API/history  
Impact: Lets the user archive or script quota history without querying SQLite directly.

Evidence:

- CLI already supports `history --json` with range/limit/window options (`src/cli.ts:45-79`).
- History rows preserve raw validated snapshots (`src/history/db.ts:11-32`).
- README documents JSON history output (`README.md:188-201`).

Confidence: High.

Implementation outline:

- Add `codex-usage history:export --range 30d --format json|csv --output <path>`.
- Reuse `listHistoryEvents()` and keep stdout output available when `--output` is omitted.
- Define stable CSV columns for account, selected bucket, primary/secondary remaining, reset times, and interval metadata.

Residual risk: CSV shape must handle missing windows and future unknown `credits` payloads.

### Later: Threshold Warnings in Watch Mode and Dashboard

Category: alerting  
Impact: Makes the tool more useful while passively running beside the editor, without requiring a daemon or notification integration.

Evidence:

- TUI watch mode refreshes every 60 seconds and supports keyboard controls (`src/tui/UsageApp.tsx:177-241`).
- Dashboard auto-refreshes every 60 seconds (`web/src/App.tsx:511-519`).
- Current UI already computes remaining quota in both TUI and dashboard (`src/tui/UsageApp.tsx:98-111`, `web/src/App.tsx:202-250`).

Confidence: High.

Implementation outline:

- Add options such as `--warn-below 20` for TUI and a local dashboard setting.
- Surface status through existing alert/card patterns, not browser notifications initially.
- Suppress repeated warning noise for unchanged coalesced snapshots.

Residual risk: Threshold semantics should distinguish primary and secondary windows.

### Later: History Delta Summary

Category: history insight  
Impact: Answers "what changed since the previous observation?" without requiring the user to compare adjacent intervals manually.

Evidence:

- History returns recent-first coalesced events (`src/history/store.ts:149-187`).
- Web trend currently computes latest/lowest/average only (`web/src/App.tsx:550-571`).
- CLI history renders each event independently (`src/tui/HistoryApp.tsx:124-152`).

Confidence: High.

Implementation outline:

- Derive deltas between adjacent events in a shared helper: quota remaining change, reset timestamp change, and duration of prior state.
- Label reset-driven increases separately from ordinary quota recovery.
- Render compact delta text in CLI history and dashboard recent interval cards.

Residual risk: Reset boundaries can make usage look better suddenly; labels must avoid misleading interpretation.

### Later: Compact Multi-Bucket View

Category: domain model / dashboard  
Impact: Makes the dashboard more future-proof if Codex returns multiple relevant buckets.

Evidence:

- `UsageSnapshotData` includes `allLimits` (`src/types.ts`).
- `fetchCodexUsage()` returns both `selectedLimit` and `allLimits` (`src/usage.ts:67-72`).
- Dashboard currently renders only `selectedLimit` windows (`web/src/App.tsx:521-543`).
- The implementation already filters one internal-looking bucket ID, suggesting curation is needed (`src/usage.ts:34-39`).

Confidence: Medium.

Implementation outline:

- Keep `codex` as the default selected bucket.
- Add a compact all-buckets list or selector below the primary cards.
- Centralize bucket display filtering so TUI and dashboard use the same policy.

Residual risk: Upstream bucket IDs may be internal, unstable, or confusing without labels.

### Later: First-Class Global CLI Packaging

Category: distribution  
Impact: Removes the manual wrapper script and makes `codex-usage` available from any directory.

Evidence:

- README explicitly says the repo is not packaged as a global CLI and documents a wrapper workaround (`README.md:40-111`).
- `package.json` has scripts but no `bin` entry (`package.json:1-12`).

Confidence: Medium.

Implementation outline:

- Add a `bin` entry and a small executable shim.
- Decide whether global usage runs built JS from `dist/` or uses `tsx` as a runtime dependency.
- Add a package smoke test for `codex-usage --help`.

Residual risk: Packaging TypeScript source directly can make installs slower or more fragile; built JS is cleaner but requires release/build discipline.

## Hypotheses and Evidence Needed

1. Fresh root install misses `motion`.
   - Current evidence: `motion` is only in `web/package.json`, no workspace `packages`, and recursive pnpm listing saw only root.
   - Needed verification: clean checkout/container with only root `pnpm install`, then `pnpm run build`.

2. Initial dashboard history can race behind current fetch.
   - Current evidence: independent `useEffect`s for usage and history plus persistence inside usage fetch.
   - Needed verification: test/harness with delayed `/api/codex/rate-limits` and immediate `/api/codex/history`, asserting whether first render includes the new history row.

3. Non-watch TUI error path hangs or exits incorrectly.
   - Current evidence: code exits only on `done`, not `error`.
   - Needed verification: Ink test or TTY harness with mocked failing `fetchCodexUsage()`.

## Subagent Coverage

Three read-only explorer subagents were used after repository mapping:

- Correctness explorer: subprocess failure handling, local API side effects, CLI validation, TUI error states.
- Existing-functionality explorer: reliability, dependency/workspace setup, API error UX, refresh ordering, docs.
- Capability explorer: export, threshold warnings, deltas, multi-bucket view, global CLI packaging.

All subagents reported no file edits.
