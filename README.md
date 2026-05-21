# Codex Usage Limit Dashboard

A local TypeScript tool for reading your current Codex / ChatGPT rate-limit bucket through the official `codex app-server` JSON-RPC surface.

It supports:

- `pnpm run usage` — one-shot TUI usage report (powered by [Ink](https://github.com/vadimdemedes/ink)).
- `pnpm run usage -- --watch` — live dashboard that auto-refreshes every 60 seconds.
- `pnpm run login` — ChatGPT device-code login through Codex app-server.
- `pnpm run dev` — local Express API + Vite React dashboard.

## Requirements

- Node.js 20+
- Codex CLI installed and available as `codex`
- A Codex-capable ChatGPT plan/account

Check:

```bash
node -v
codex --version
```

## Install

```bash
pnpm install
```

## Authenticate

If your Codex CLI/app is already logged in, you can skip this.

```bash
pnpm run login
```

This starts the official Codex app-server device-code flow and prints a verification URL and user code. Complete the login in your browser. The script exits when the app-server reports success.

## Fetch current usage from CLI

```bash
pnpm run usage
```

This opens an interactive TUI showing color-coded progress bars for each rate-limit window, reset times in human-readable form, and account info:

```plaintext
 ⚡ Codex Usage Limits

 Account you@example.com · pro · bucket codex

 ╭─────────────────────────────────────────────────────────╮
 │  5h Window                                              │
 │                                                         │
 │  █░░░░░░░░░░░░░░░░░░░░░░░░░░░  5% used                  │
 │    95% remaining · resets in 3h 1m (May 22 at 12:28 AM) │
 ╰─────────────────────────────────────────────────────────╯

 ╭─────────────────────────────────────────────────────────╮
 │  7d Window                                              │
 │                                                         │
 │  ███████░░░░░░░░░░░░░░░░░░░░░  26% used                 │
 │    74% remaining · resets in 5d 2h (May 27 at 12:06 AM) │
 ╰─────────────────────────────────────────────────────────╯

 Fetched May 21, 9:27 PM
```

Progress bars are color-coded: green below 60% used, yellow 60–80%, red above 80%.

### Watch mode (auto-refresh)

```bash
pnpm run usage -- --watch
# or
pnpm run usage -- -w
```

Stays open, counts down to the next 60-second refresh, and responds to keyboard shortcuts:

- `r` — force an immediate refresh
- `q` / `Esc` — quit

### Machine-readable JSON

```bash
pnpm run usage -- --json
# or the dedicated alias
pnpm run usage:json
```

## Run dashboard

```bashUpdat
pnpm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The browser talks only to the local Express API at `http://127.0.0.1:8787/api/codex/rate-limits`. The API spawns `codex app-server`, initializes the JSON-RPC connection, calls `account/read`, calls `account/rateLimits/read`, then shuts down the local app-server child process.

## Important behavior

This does **not** scrape the ChatGPT or Codex web UI. It uses the Codex app-server JSON-RPC method `account/rateLimits/read`.

The response may expose usage as percentages and reset timestamps, not absolute weekly message counts. OpenAI can return multiple buckets through `rateLimitsByLimitId`; this implementation prefers the `codex` bucket and falls back to the backward-compatible `rateLimits` bucket.

## Security notes

- The dashboard binds to localhost only.
- It does not store tokens or credentials.
- It does not expose Codex app-server WebSocket transport.
- Do not deploy this API publicly.
