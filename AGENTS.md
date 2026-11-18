# Agent guidance

## Project and source of truth

Codex Usage Limit Dashboard is a local TypeScript CLI (Ink/Commander) and Express
API with a React 19/Vite 7 dashboard. Usage comes from Codex app-server JSON-RPC;
history is stored in SQLite through `better-sqlite3`.

Read [README.md](README.md) for user behavior and [CONTRIBUTING.md](CONTRIBUTING.md)
for setup, commands, architecture, build paths, and verification. Keep these guides
current when changing behavior. `PRODUCT.md` and `prd.md` provide product context;
audit and issue-draft documents are historical planning material.

## Implementation rules

- Use Node 22 and the pnpm version pinned in `package.json`. Use pnpm for all
  dependency installs. One root manifest and lockfile own all dependencies.
- Use strict TypeScript, ESM, type imports, and `.js` suffixes for backend imports.
  Import directly from source modules rather than introducing barrel files.
- Validate raw external responses with Zod `safeParse`; report descriptive errors.
- Keep the API and frontend servers bound to `127.0.0.1`. Each usage fetch owns a
  fresh Codex app-server subprocess and closes it afterwards.
- Preserve the frontend's self-contained types; do not import backend source into
  `web/`. Keep the `@/*` aliases in TypeScript and Vite aligned.
- Use Tailwind CSS 4, the existing shadcn/Radix components, and the `cn()` utility
  for frontend styling. Extract substantial new views into components.
- Ink components live in `.tsx` files and expose render helpers to the CLI.
  Use `date-fns` for date formatting and flush the last render before exit.
- Preserve progress colors by percentage used: green below 60%, yellow from 60%
  to below 80%, red at 80% or more.
- Keep history coalescing, explicit cleanup, and persistence-warning behavior
  consistent across CLI and API. Never use a user's real history in tests.

## Verification

Run the relevant checks listed in [CONTRIBUTING.md](CONTRIBUTING.md#checks-before-a-pull-request).
Vitest tests live beside source files and cover usage, API routes, and history.
Mock Codex access; no live account should be needed for automated checks.
Use the smoke check after setup, server, proxy, or build changes. Keep documentation
and its checks aligned with the supported commands and distribution model.
