# AGENTS.md

## Project Overview

**Codex Usage Limit Dashboard** is a local TypeScript tool for reading your current Codex / ChatGPT rate-limit bucket through the official `codex app-server` JSON-RPC surface.

It has two modes:

- **CLI** (`src/cli.ts`) — one-shot commands (`usage`, `login`) run via `tsx`.
- **Dashboard** (`src/server.ts` + `web/`) — a local Express API (port 8787) with a Vite + React 19 frontend (port 5173) that polls `/api/codex/rate-limits` every 60 seconds.

### Key technologies

| Layer           | Tech                                                                  |
| --------------- | --------------------------------------------------------------------- |
| Runtime         | Node.js 20+, `tsx` (no compile step for dev)                          |
| Backend         | Express 5, JSON-RPC over stdio to `codex app-server`                  |
| Frontend        | React 19, Vite 7, plain CSS                                           |
| Language        | TypeScript 5 (strict, ESM, `NodeNext` resolution)                     |
| Package manager | **pnpm** (a `pnpm-lock.yaml` is present; use `pnpm` for all installs) |

### Architecture

```plaintext
src/
  cli.ts        — entry point for CLI commands (login / usage)
  server.ts     — Express API server; exposes /api/codex/rate-limits
  usage.ts      — fetches usage snapshot via CodexRpcClient
  login.ts      — device-code login flow via CodexRpcClient
  codexRpc.ts   — JSON-RPC client that spawns `codex app-server` subprocess
  types.ts      — shared TypeScript types (JsonRpc*, Account, RateLimit, UsageSnapshot)
web/
  vite.config.ts — Vite config; proxies /api → http://127.0.0.1:8787
  src/App.tsx    — single-component React dashboard; self-contained types
  src/styles.css — global CSS
```

## Prerequisites

- **Node.js 20+** — `node -v` to verify.
- **pnpm** — `npm i -g pnpm` if not installed.
- **Codex CLI** (`codex`) — must be on `PATH`. Verify with `codex --version`.
- A ChatGPT account with Codex access (Pro or higher).

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

# One-shot usage report (human-readable)
pnpm run usage

# Machine-readable JSON
pnpm run usage -- --json
```

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
- No Prettier or ESLint config is present; follow the conventions visible in existing files.
- Prefer `type` imports for types (`import type { Foo } from "./types.js"`).
- No barrel files (`index.ts`); import directly from the source file.

### React frontend (`web/src/`)

- The frontend duplicates some types from `src/types.ts` (e.g. `CodexRateLimit`, `UsageSnapshot`) — this is intentional to keep the frontend self-contained. Do not import from `src/` in the web layer.
- Keep all dashboard logic in `web/src/App.tsx` unless the file grows significantly.
- No CSS framework; use `web/src/styles.css` for all styles.

### Backend

- The Express server binds to `127.0.0.1` only (not `0.0.0.0`) — maintain this for local-only safety.
- Each request to `/api/codex/rate-limits` spawns a fresh `codex app-server` subprocess, runs the RPC calls, then shuts it down. Do not hold a persistent subprocess across requests.
- JSON-RPC IDs are sequential integers. Notifications (`notify()`) have no `id`.
- The `CODEX_BIN` environment variable overrides the `codex` binary path in `CodexRpcClient`.

## Testing

There is no test suite in this project. When adding tests:

- Use `vitest` (consistent with the Vite toolchain already present).
- Place test files alongside the source they test: `src/usage.test.ts`, etc.
- Unit-test `usage.ts` helpers (`remainingPercent`, `resetDate`, `pickCodexLimit`) with mocked `CodexRpcClient`.
- Integration tests should mock the `codex` binary subprocess, not require a live Codex account.

## Troubleshooting

| Symptom                              | Likely cause                       | Fix                                                                         |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------- |
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
