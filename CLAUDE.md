# CLAUDE.md

## Project Overview

**Codex Usage Limit Dashboard** is a local TypeScript tool for reading your current Codex / ChatGPT rate-limit bucket through the official `codex app-server` JSON-RPC surface.

It has two modes:

- **CLI** (`src/cli.ts`) — one-shot commands (`usage`, `login`) run via `tsx`.
- **Dashboard** (`src/server.ts` + `web/`) — a local Express API (port 8787) with a Vite + React 19 frontend (port 5173) that polls `/api/codex/rate-limits` every 60 seconds.

### Key technologies

| Layer           | Tech                                                                  |
| --------------- | --------------------------------------------------------------------- |
| Runtime         | Node.js 22 (pinned via .nvmrc), `tsx` (no compile step for dev)       |
| Backend         | Express 5, JSON-RPC over stdio to `codex app-server`                  |
| History storage | `better-sqlite3` (native module — see Prerequisites)                  |
| Frontend        | React 19, Vite 7, Tailwind CSS 4, shadcn/ui (radix-nova) + Radix UI    |
| TUI             | Ink 7 (React renderer for terminals), `date-fns`, `commander`         |
| Validation      | Zod 4 (runtime schema validation for API responses)                   |
| Language        | TypeScript 5 (strict, ESM, `NodeNext` resolution)                     |
| Testing         | Vitest 4 (`pnpm test`)                                                |
| Package manager | **pnpm** (a `pnpm-lock.yaml` is present; use `pnpm` for all installs) |

### Architecture

```plaintext
src/
  cli.ts          — entry point; commander program (usage / login subcommands)
  server.ts       — Express API server; exposes /api/codex/rate-limits
  usage.ts        — fetches usage snapshot via CodexRpcClient; validates with zod
  login.ts        — device-code login flow via CodexRpcClient
  codexRpc.ts     — JSON-RPC client that spawns `codex app-server` subprocess
  types.ts        — shared TypeScript types (JsonRpc*, Account, RateLimit, UsageSnapshot)
  schemas.ts      — zod schemas for all CodexRpc API response shapes
  history/
    db.ts         — opens/migrates the SQLite database (platform-specific data dir)
    store.ts       — dedup-by-fingerprint persistence + range/limit querying
    cli.ts        — `history` / `history:clear` subcommand implementations
    types.ts       — HistoryEvent, HistoryRange ("24h"|"7d"|"30d"|"all"), query/delete options
  tui/
    UsageApp.tsx  — Ink TUI: spinner, color-coded progress bars, reset times, watch mode
    LoginApp.tsx  — Ink TUI: device-code login flow with live status
    HistoryApp.tsx — Ink TUI: browse persisted usage history
web/
  vite.config.ts  — Vite config; proxies /api → http://127.0.0.1:8787; "@/*" alias → web/src/*
  src/App.tsx     — single-component React dashboard (~1000 lines); self-contained types
  src/components/ui/    — shadcn/ui primitives (alert, button, card, progress)
  src/components/kokonutui/ — components pulled from the kokonutui registry (see components.json)
  src/lib/utils.ts — shadcn `cn()` helper (clsx + tailwind-merge)
  src/styles.css  — Tailwind entrypoint + global styles
```

The `@/*` path alias (`web/src/*`) is defined in both `tsconfig.json` and `web/vite.config.ts` — keep them in sync if it changes.

## Prerequisites

- **Node.js 22, pinned via `.nvmrc`** — run `nvm use` in the repo root to select it.
  `better-sqlite3` compiles a native module against the Node ABI it was
  installed under, so mixing Node majors after install breaks it. If you do
  switch majors, run `pnpm rebuild better-sqlite3`.
- **pnpm** — `npm i -g pnpm` if not installed.
- **Codex CLI** (`codex`) — must be on `PATH`. Verify with `codex --version`.
- A ChatGPT account with Codex access (Pro or higher).
- A working native build toolchain (e.g. Xcode Command Line Tools on macOS) — `better-sqlite3` compiles a native module on `pnpm install`. `pnpm-workspace.yaml` allowlists it (and `esbuild`, `msw`) under `allowBuilds`.

## Setup

```bash
pnpm install
```

No environment variables are required for basic operation. To use a custom Codex binary path, set:

```bash
export CODEX_BIN=/path/to/codex   # default: "codex" (resolved from PATH)
export PORT=8787                  # default: 8787 (Express API port)
```

## Development Workflow

### Full dashboard (API + frontend, hot-reload)

```bash
pnpm run dev
```

Starts both servers concurrently via `concurrently`:

- Express API: `http://127.0.0.1:8787`
- Vite dev server: `http://127.0.0.1:5173` (proxies `/api` to the Express server)

Open `http://127.0.0.1:5173` in your browser.

### API server only

```bash
pnpm run server
```

### Vite frontend only (assumes API is already running)

```bash
pnpm run web
```

### CLI commands

```bash
# Authenticate via ChatGPT device-code flow
pnpm run login

# One-shot TUI usage report
pnpm run usage

# Live auto-refresh (60s interval); press r to force refresh, q to quit
pnpm run usage -- --watch

# Machine-readable JSON (bypasses TUI)
pnpm run usage -- --json
# or the dedicated alias
pnpm run usage:json

# Browse persisted usage history (Ink TUI)
pnpm exec tsx src/cli.ts history

# Clear persisted history
pnpm exec tsx src/cli.ts history:clear
```

### Tests

```bash
pnpm test
```

Runs `vitest run` over `src/**/*.test.ts` (see `vitest.config.ts`). No watch-mode script is defined; use `pnpm exec vitest` directly for watch mode.

## Build

```bash
pnpm run build
```

- TypeScript backend sources are compiled to `dist/` via `tsc -p tsconfig.json`.
- Vite frontend is bundled to `dist-web/` via `vite build --config web/vite.config.ts`.

Both outputs are produced in a single command. There is no separate watch-mode build; use `pnpm run dev` during development.

## Code Style and Conventions

### TypeScript

- **Strict mode** is enabled (`"strict": true` in `tsconfig.json`).
- **ESM only** — `"module": "NodeNext"` / `"moduleResolution": "NodeNext"`. All internal imports in `src/` must use the `.js` extension (e.g. `import { foo } from "./bar.js"`).
- `package.json` has `"type": "module"` (required by Ink/yoga-layout for top-level await support).
- `tsconfig.json` has `"jsx": "react-jsx"` and includes `src/**/*.tsx` for the TUI components.
- No Prettier or ESLint config is present; follow the conventions visible in existing files.
- Prefer `type` imports for types (`import type { Foo } from "./types.js"`).
- No barrel files (`index.ts`); import directly from the source file.

### TUI (`src/tui/`)

- Components use **Ink 7** (React 19 renderer for terminals). Write `.tsx` files; JSX is transformed via `"jsx": "react-jsx"` in `tsconfig.json`.
- Each TUI module exports a `renderXxx()` helper that calls `render(<Component />)` so `cli.ts` can stay `.ts` (no JSX).
- Use `useApp()` → `exit()` + `waitUntilRenderFlush()` to cleanly exit after the final render.
- Format dates with **date-fns** (`format`, `intervalToDuration`). Do not use `Date.toLocaleString()`.
- Progress bar colors: green < 60% used, yellow 60–80%, red > 80%.

### React frontend (`web/src/`)

- The frontend duplicates some types from `src/types.ts` (e.g. `CodexRateLimit`, `UsageSnapshot`) — this is intentional to keep the frontend self-contained. Do not import from `src/` in the web layer.
- `web/src/App.tsx` is already ~1000 lines; when adding a substantial new view (e.g. history), prefer a new component file over growing it further.
- Styling is **Tailwind CSS 4** (`@tailwindcss/vite` plugin, entrypoint in `web/src/styles.css`) plus **shadcn/ui** components (`web/src/components/ui/`, config in `components.json`, style `radix-nova`) built on Radix UI primitives. Icons come from `lucide-react`. Use the shadcn CLI (`pnpm exec shadcn add <component>`) to add new primitives rather than hand-rolling them.
- Use the `cn()` helper from `web/src/lib/utils.ts` (clsx + tailwind-merge) for conditional class names, and the `@/*` import alias (→ `web/src/*`) instead of relative paths across directories.

### Validation

- All raw RPC responses are validated through **zod** schemas defined in `src/schemas.ts` before being passed to business logic.
- Use `safeParse` and throw descriptive errors on failure; do not use `parse` directly on external data.
- The zod-inferred types are structurally compatible with the hand-written types in `src/types.ts`.

### Backend

- The Express server binds to `127.0.0.1` only (not `0.0.0.0`) — maintain this for local-only safety.
- Each request to `/api/codex/rate-limits` spawns a fresh `codex app-server` subprocess, runs the RPC calls, then shuts it down. Do not hold a persistent subprocess across requests.
- JSON-RPC IDs are sequential integers. Notifications (`notify()`) have no `id`.
- The `CODEX_BIN` environment variable overrides the `codex` binary path in `CodexRpcClient`.

### History (`src/history/`)

- Each fetched usage snapshot is persisted to a local SQLite database (`better-sqlite3`), in a platform-specific data directory resolved by `db.ts` (XDG data home on Linux, `AppData/Roaming` on Windows).
- `store.ts` dedupes snapshots by a content fingerprint — repeated identical snapshots bump `occurrenceCount`/`lastSeenAt` on the existing row instead of inserting a new one.
- Query/delete support a `HistoryRange` of `"24h" | "7d" | "30d" | "all"` (`types.ts`).
- Exposed three ways: CLI subcommands `history` / `history:clear` (`src/cli.ts`), REST routes `GET /api/codex/history` and `DELETE /api/codex/history` (`src/server.ts`), and the Ink TUI `src/tui/HistoryApp.tsx`.

## Testing

Test files live alongside the source they test (`*.test.ts`) and run via `pnpm test` (Vitest). Current coverage:

- `src/usage.test.ts` — usage snapshot helpers
- `src/server.test.ts` — Express API routes
- `src/history/db.test.ts`, `src/history/store.test.ts`, `src/history/cli.test.ts` — SQLite persistence, dedup logic, and CLI subcommands

When adding tests:

- Mock `CodexRpcClient` / the `codex` subprocess rather than requiring a live Codex account.
- Unit-test `src/schemas.ts` with valid and invalid fixture objects.
- TUI components (`src/tui/`) can be tested with `ink-testing-library` against snapshot output (not yet used in this repo).

## Troubleshooting

| Symptom                              | Likely cause                       | Fix                                                                         |
| ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------- |
| `codex: command not found`           | Codex CLI not on `PATH`            | Install Codex CLI or set `CODEX_BIN`                                        |
| `Not logged in` in CLI output        | Codex app-server has no auth token | Run `pnpm run login`                                                        |
| API returns 500 with timeout message | `codex app-server` took > 30 s     | Check Codex CLI version; ensure network connectivity                        |
| Frontend shows stale data            | Browser cached previous response   | Click the Refresh button in the dashboard                                   |
| Port 8787 already in use             | Another process bound to the port  | Set `PORT=<other>` and update the Vite proxy target in `web/vite.config.ts` |

## Important Behavior Notes

- This tool **does not** scrape the ChatGPT or Codex web UI. It uses the official `codex app-server` JSON-RPC methods: `account/read` and `account/rateLimits/read`.
- The API may return multiple rate-limit buckets via `rateLimitsByLimitId`. The implementation prefers the `codex` bucket and falls back to the backward-compatible `rateLimits` field.
- Usage is returned as percentages and reset timestamps — not absolute message counts.
- The dashboard auto-refreshes every 60 seconds via `setInterval`.

## Other Docs

`PRODUCT.md`, `prd.md`, `codebase-improvement-audit.md`, and `issue-drafts.md` at the repo root hold product/planning context — check them for the "why" behind a feature before assuming it's undocumented intent.
