# Plan 003: Pin the Node version (`.nvmrc` + `engines`) and correct the docs

> **Executor instructions**: Follow this plan exactly. Run every verification
> command. Touch only the files in Scope. If a STOP condition occurs, stop and
> report.

## Status

- **Priority**: P2 (small, but it blocks a clean first-run for anyone new)
- **Effort**: S
- **Risk**: LOW (config + docs only; no source logic)
- **Planned at**: commit `0458474`, 2026-08-06
- **Branch**: create `fix/node-22-pin` **off `main`**. Do NOT use or disturb
  `dev` — it holds 10 commits of unmerged feature work, and this fix should be
  mergeable independently of that review.

## Why this matters

A fresh clone that follows the docs gets a broken setup with a confusing error.
The docs say Node 20+; on Node 20 the whole test suite fails to load
`better-sqlite3`'s native module and **zero tests pass**, with a cryptic ABI
error rather than anything pointing at the Node version.

**Be precise about the cause — an earlier draft of this got it wrong.**
`better-sqlite3@12.10.0` declares
`engines: { node: "20.x || 22.x || 23.x || 24.x || 25.x || 26.x" }`, so Node 20
**is** supported upstream. The failure is *not* "better-sqlite3 requires Node
22". It is that the native module is compiled against **one** Node ABI at
install time, and this checkout's binary was built for Node 22 (ABI 127) while
the machine's default `node` is v20.19.5 (ABI 115). Switching Node majors
without rebuilding breaks it in either direction.

So do **not** write documentation claiming Node 22 is required by the
dependency. The fix is to pin a single Node version so the build artifact and
the runtime stay in sync, and to say what to do if you switch.

Verified on this machine: under `nvm use 22`, `pnpm --version` → 11.8.0,
`pnpm test` → 33/33 pass, `pnpm run build` → exit 0. Under default Node 20,
`pnpm` itself additionally fails with
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` (a corepack-shim problem, separate
from the ABI issue).

## Current state

Three tracked files assert the wrong minimum. Exact current text:

- `CLAUDE.md:16` — `| Runtime         | Node.js 20+, \`tsx\` (no compile step for dev)                          |`
- `CLAUDE.md:59` — `- **Node.js 20+** — \`node -v\` to verify.`
- `AGENTS.md:16` and `AGENTS.md:46` — identical two lines (this file mirrors
  CLAUDE.md; keep them consistent with each other).
- `README.md:16` — `- Node.js 20+`

`package.json` has **no** `engines` field and no `packageManager` field. There
is no `.nvmrc`. There is no CI config (`.github` does not exist), so nothing
else needs updating.

`better-sqlite3` is `^12.10.0` (resolved 12.10.0).

## Scope

**In scope:**
- `.nvmrc` (new)
- `package.json` (add `engines` only)
- `CLAUDE.md` (two lines)
- `AGENTS.md` (two lines)
- `README.md` (one line + a short note)

**Out of scope — do NOT touch:**
- `codebase-improvement-audit.md`. It mentions Node 20 at lines 29, 69 and 122,
  but it is a **historical audit record** of what was observed at a point in
  time. Rewriting it would falsify the record.
- `pnpm-lock.yaml`, `web/pnpm-lock.yaml`, any lockfile.
- Any file under `src/` or `web/src/`. No source logic changes.
- Do not add a `packageManager` field. It was considered and deliberately
  skipped — it changes how corepack resolves pnpm, which is exactly the
  machinery already misbehaving on this machine. Out of scope for this fix.
- Do not rebuild or reinstall `better-sqlite3`, and do not run `pnpm install`.

## Steps

### Step 1: `.nvmrc`

Create `.nvmrc` containing exactly `22` and a trailing newline. Nothing else —
no comments; `nvm` reads the whole file as a version string.

**Verify**: `cd` to the repo root in a shell with nvm loaded, run `nvm use`
(no argument) and confirm it selects a v22.x. Command:
`source ~/.nvm/nvm.sh && nvm use && node --version` → prints `v22.x.y`.

### Step 2: `engines` in `package.json`

Add a top-level `engines` field. Place it next to the existing top-level
metadata keys, matching the file's existing 2-space indentation:

```json
"engines": {
  "node": ">=22"
}
```

`>=22` is a deliberate project decision, not a restatement of the dependency's
range: it declares the single version this project is set up and tested
against, so a mismatch fails fast with a clear engine error instead of the
cryptic native-module ABI error. Note that pnpm enforces this and will refuse
to install on Node 20 — that is the intended outcome.

**Verify**: `python3 -c "import json;print(json.load(open('package.json'))['engines'])"`
→ `{'node': '>=22'}`, and the file is still valid JSON.

### Step 3: Correct the three docs

In `CLAUDE.md` and `AGENTS.md`, change both lines in each file:

- The runtime table row: `Node.js 20+` → `Node.js 22 (pinned via .nvmrc)`.
- The prerequisite bullet: replace
  `- **Node.js 20+** — \`node -v\` to verify.`
  with a bullet that states the pin, how to select it, and — briefly — why,
  without the false claim. It must convey all three of:
  1. Node 22 is pinned; run `nvm use` in the repo root (reads `.nvmrc`).
  2. `better-sqlite3` compiles a native module against the Node ABI it was
     installed under, so mixing Node majors breaks it.
  3. If you do switch Node majors, run `pnpm rebuild better-sqlite3`.

  Keep it to two or three lines and match the surrounding bullet style.

In `README.md`, change `- Node.js 20+` to `- Node.js 22 (see \`.nvmrc\`)` and
add one adjacent line telling the reader to run `nvm use` before the setup
commands. Match the existing terse README tone — do not paste the long
explanation there; CLAUDE.md is the place for the why.

Do **not** claim anywhere that `better-sqlite3` requires Node 22. Its declared
range includes 20.x.

**Verify**: `git grep -n "Node.js 20+"` returns **no** hits in `CLAUDE.md`,
`AGENTS.md`, or `README.md` (hits in `codebase-improvement-audit.md` are
expected and correct — that file is out of scope).

## Done criteria

All must hold. Run these from the repo root with nvm loaded:

- [ ] `cat .nvmrc` → `22`
- [ ] `source ~/.nvm/nvm.sh && nvm use && node --version` → `v22.x.y`
- [ ] `python3 -c "import json;print(json.load(open('package.json'))['engines'])"` → `{'node': '>=22'}`
- [ ] `git grep -n "Node.js 20+" -- CLAUDE.md AGENTS.md README.md` → no output
- [ ] `git grep -rn "20+" -- README.md` → no stale Node 20 claim remains
- [ ] `pnpm test` → 33/33 pass (proves `engines` did not break the toolchain)
- [ ] `pnpm run build` → exit 0
- [ ] `git status --short` → only the 5 in-scope files modified/added, plus
      untracked `plans/`
- [ ] `git diff --stat main..fix/node-22-pin -- src/ web/src/` → empty

## STOP conditions

- Adding `engines` causes `pnpm test` or `pnpm run build` to fail even under
  Node 22 — report the exact error rather than removing the field.
- `nvm use` does not pick up `.nvmrc` — report what it printed.
- Any in-scope doc's current text does not match the "Current state" excerpts.
- You find yourself editing a file under `src/`, `web/src/`, a lockfile, or
  `codebase-improvement-audit.md`.

## Maintenance notes

- If the project ever intentionally supports a range of Node majors again, the
  honest fix is CI matrix testing plus a rebuild step — not widening `engines`
  and hoping the prebuilt binary matches.
- `.nvmrc` pins the major only (`22`), so patch/minor upgrades need no change.
