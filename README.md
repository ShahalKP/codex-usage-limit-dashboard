# Codex Usage Limit Dashboard

A local TypeScript tool for reading your current Codex / ChatGPT rate-limit bucket through the official `codex app-server` JSON-RPC surface.

It supports:

- `pnpm run usage` — one-shot TUI usage report (powered by [Ink](https://github.com/vadimdemedes/ink)).
- `pnpm run usage -- --watch` — live dashboard that auto-refreshes every 60 seconds.
- `pnpm exec tsx src/cli.ts history --range 24h` — inspect recent coalesced history from the terminal.
- `pnpm exec tsx src/cli.ts history:clear --range 7d` — explicitly delete saved history after confirmation.
- `pnpm run login` — ChatGPT device-code login through Codex app-server.
- `pnpm run dev` — local Express API + Vite React dashboard.

## Requirements

- Node.js 22 (see `.nvmrc`)
- Codex CLI installed and available as `codex`
- A Codex-capable ChatGPT plan/account

Check:

```bash
node -v
codex --version
```

Run `nvm use` in the repo root before the setup commands below to select the pinned Node version.

## Install

```bash
pnpm install
```

If your `pnpm` configuration blocks install scripts, approve the native SQLite
and bundler builds once:

```bash
pnpm approve-builds
```

## Optional global command

This repo is not packaged as a global CLI yet. For personal use, create a small
wrapper script on your `PATH` so `codex-usage` works from any directory without
changing this repo.

First verify the CLI works from the repo:

```zsh
pnpm --dir /Users/shahalkp/Documents/Github/codex-usage-limit-dashboard exec tsx src/cli.ts --help
```

Create a user-local bin directory:

```zsh
mkdir -p ~/.local/bin
```

Create the wrapper script:

```zsh
cat > ~/.local/bin/codex-usage << 'EOF'
#!/bin/zsh
exec pnpm --dir /Users/shahalkp/Documents/Github/codex-usage-limit-dashboard exec tsx src/cli.ts "$@"
EOF
```

Make it executable:

```zsh
chmod +x ~/.local/bin/codex-usage
```

Ensure `~/.local/bin` is on your shell `PATH`:

```zsh
echo $PATH | tr ':' '\n' | grep "$HOME/.local/bin"
```

If nothing prints, add this to `~/.zshrc`:

```zsh
export PATH="$HOME/.local/bin:$PATH"
```

Then reload your shell config:

```zsh
source ~/.zshrc
```

Verify the command:

```zsh
codex-usage --help
```

Usage:

```zsh
codex-usage
codex-usage usage
codex-usage usage --watch
codex-usage usage --json
codex-usage history --range 7d
codex-usage history:clear --range 24h --yes
codex-usage login
```

The wrapper intentionally runs the real CLI entrypoint directly instead of
`pnpm run usage`. This keeps all subcommands working because `"$@"` forwards
the arguments you type after `codex-usage`.

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

## Historical tracking

Every successful usage fetch now attempts to persist a local history event in
SQLite before the CLI command or API request completes.

- Consecutive identical snapshots are coalesced into one observed interval by
 updating `last_seen_at` and the occurrence count instead of inserting a new
 row.
- Failed fetches do not create history rows.
- If the live fetch succeeds but history persistence fails, the current snapshot
 still renders and includes a visible warning.

### CLI history

Readable history output:

```bash
pnpm exec tsx src/cli.ts history --range 24h
pnpm exec tsx src/cli.ts history --range all --window secondary
```

JSON output for scripting:

```bash
pnpm exec tsx src/cli.ts history --range 30d --limit 25 --json
```

Manual cleanup with confirmation:

```bash
pnpm exec tsx src/cli.ts history:clear --range 24h
pnpm exec tsx src/cli.ts history:clear --range all --yes
```

### Dashboard history

The web dashboard keeps the live snapshot primary and adds a history section
with:

- recent range controls (`24h`, `7d`, `30d`, `all`)
- primary/secondary remaining-quota trend views
- recent coalesced intervals with local timestamps
- scoped cleanup for the selected range and full-history cleanup

## History database location

By default, history is stored locally at:

- macOS: `~/Library/Application Support/codex-usage-limit-dashboard/history.sqlite`
- Linux: `~/.local/share/codex-usage-limit-dashboard/history.sqlite`
- Windows: `%APPDATA%\codex-usage-limit-dashboard\history.sqlite`

Override the location for advanced workflows or testing:

```bash
export CODEX_USAGE_DB_PATH="$HOME/tmp/codex-history.sqlite"
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

History queries and cleanup stay local as well:

- `GET /api/codex/history?range=24h&limit=12`
- `DELETE /api/codex/history` with `{ "range": "all" }` or another supported range

## Important behavior

This does **not** scrape the ChatGPT or Codex web UI. It uses the Codex app-server JSON-RPC method `account/rateLimits/read`.

The response may expose usage as percentages and reset timestamps, not absolute weekly message counts. OpenAI can return multiple buckets through `rateLimitsByLimitId`; this implementation prefers the `codex` bucket and falls back to the backward-compatible `rateLimits` bucket.

Historical rows preserve the raw validated snapshot payload for forward
compatibility, but the fingerprint used for coalescing ignores transient fields
such as fetch time.

## Security notes

- The dashboard binds to localhost only.
- It stores history in a local SQLite file only.
- It does not store tokens or credentials in that database.
- It does not expose Codex app-server WebSocket transport.
- Do not deploy this API publicly.
