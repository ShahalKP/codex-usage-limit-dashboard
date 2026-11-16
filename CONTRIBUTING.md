# Contributing

Follow the [README quick start](README.md#quick-start) to select Node 22 and install
with pnpm 10.34.9. All frontend and backend dependencies belong to the root
`package.json`; `web/` is a source directory, not a separate package.

## Development workflow

- `pnpm run dev`: TypeScript API plus Vite frontend at `http://127.0.0.1:5173`.
  Vite hot-reloads frontend edits; restart after backend edits.
- `pnpm run server`: API only, bound to `127.0.0.1:8787` by default.
- `pnpm run web`: frontend only; requires the API in another terminal.
- `pnpm exec vitest`: tests in watch mode.

Set `PORT` consistently for the API and frontend if overriding it. See
[configuration](README.md#configuration) for other environment variables.

## Architecture and conventions

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | Commander commands, JSON output, TUI entry points |
| `src/codexRpc.ts` | Spawn and stop Codex app-server; JSON-RPC over stdio |
| `src/usage.ts`, `src/schemas.ts` | Fetch, validate, select buckets, persist snapshots |
| `src/history/` | SQLite schema, persistence/coalescing, range queries and cleanup |
| `src/server.ts` | Local Express API and history routes |
| `src/tui/` | Ink terminal views |
| `web/src/` | React dashboard, Tailwind CSS 4, shadcn/Radix components, Motion |
| `web/vite.config.ts` | Frontend build, loopback servers and API proxy |

Use strict TypeScript, ESM, type-only imports where appropriate, and `.js` suffixes
for internal backend imports. Validate external RPC results using Zod `safeParse`
before using them. Keep frontend types self-contained. Extract substantial new
views into components instead of expanding `web/src/App.tsx` indefinitely.
There is no code formatter or JavaScript linter configured; follow nearby style.

Keep the API bound to loopback. Each live fetch owns and closes its app-server
subprocess. Tests must mock Codex responses and use temporary history databases;
they must not require credentials or modify a user's saved history.

## Build and local preview

```sh
pnpm run build
pnpm run preview
```

- TypeScript emits into `dist/`, preserving `src/` and `web/src/` paths.
  The compiled API is `dist/src/server.js`; the CLI is `dist/src/cli.js`.
- Vite bundles browser assets into `dist-web/`.
- `pnpm run preview` starts the compiled API and a loopback-only Vite preview
  server at `http://127.0.0.1:4173`.
- `pnpm run server:built` and `pnpm run web:preview` start those parts separately.

Build outputs are ignored by Git. Keep the installed runtime dependencies and
`package.json` alongside compiled code. These directories are not standalone
installers. The package is private and is not published to npm.

## Checks before a pull request

```sh
pnpm test
pnpm run build
pnpm run check:docs
pnpm run check:links
pnpm run smoke
```

Vitest covers usage fetching, API routes, history database setup, coalescing,
queries, and cleanup. Place tests beside their source as `*.test.ts`.
The smoke check verifies CLI help plus the development and compiled-preview
servers, including a non-default API port and frontend proxy. It uses temporary
storage and never calls the live account endpoint.

Markdown checks cover the maintained user/contributor/agent guides. Historical
planning documents remain outside lint scope. Link checks cover those guides and
run weekly as well as on changes; distinguish external-site outages from broken
links before editing a valid URL.
The public link checker excludes local server URLs and this private repository's
GitHub URLs; verify repository and Issues access while signed in.

CI runs clean frozen-lockfile installs, tests, builds, and smoke checks on Linux,
macOS, and Windows with Node 22. Live Codex authentication and account queries
still require manual testing. When reporting such a check, record OS, Node/pnpm
versions and `codex --version`, without including account details.

## Maintaining documentation and dependencies

Update user-facing commands, configuration, privacy details, and setup instructions
in the same pull request as their behavior changes. Keep detailed development
instructions here; agent guidance links here to avoid duplicating those commands.

Use `pnpm add` or `pnpm add -D` from the root and commit `pnpm-lock.yaml` with the
manifest. Keep `packageManager`, the README's pnpm install command, and the tested
baseline aligned. `.nvmrc` selects Node 22 and `engines.node` enforces that major.
Rebuild `better-sqlite3` after changing Node versions.

For a clean local check, use a fresh checkout and the documented
`pnpm install --frozen-lockfile` command. Existing `node_modules` can conceal
missing dependencies, which is why CI always installs from a clean checkout.

## Proposing changes

Use [issues](https://github.com/ShahalKP/codex-usage-limit-dashboard/issues)
(repository access required) for bug
reports and feature discussions. In a pull request, describe the problem, resulting
behavior, relevant checks, and any migration or documentation changes. Use
synthetic account data in screenshots, fixtures, and logs. Contributions are
provided under the project's [MIT license](LICENSE).
