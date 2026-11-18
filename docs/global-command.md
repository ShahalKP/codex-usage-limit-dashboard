# Optional global command

This project runs from a source checkout. These wrappers provide a personal
`codex-usage` command; they are not an npm package installation. Complete the
[quick start](../README.md#quick-start) first. The checkout must remain in place,
and Node 22 and pnpm must be available on `PATH` whenever the wrapper runs.

## macOS and Linux: POSIX shells

Save the following as `codex-usage` in a user-owned directory on your `PATH`, such
as `~/.local/bin` (create that directory if necessary):

```sh
#!/bin/sh
: "${CODEX_USAGE_REPO:?Set CODEX_USAGE_REPO to the absolute checkout directory}"
exec pnpm --dir "$CODEX_USAGE_REPO" exec tsx src/cli.ts "$@"
```

Set the checkout location and wrapper directory in your shell startup file
(`~/.zshrc` for zsh, or `~/.bashrc` for interactive bash), replacing the example
path with your own:

```sh
export CODEX_USAGE_REPO="/absolute/path/to/codex-usage-limit-dashboard"
export PATH="$HOME/.local/bin:$PATH"
```

Make the wrapper executable, then open a new terminal:

```sh
chmod +x ~/.local/bin/codex-usage
```

The quoted path supports spaces. No zsh-specific runtime is required.

## Windows: PowerShell

Add this function and your actual absolute checkout path to your PowerShell
profile (`$PROFILE`; create the file and its parent directory if needed):

```powershell
$env:CODEX_USAGE_REPO = 'C:\path\to\codex-usage-limit-dashboard'
function codex-usage {
    & pnpm --dir $env:CODEX_USAGE_REPO exec tsx src/cli.ts @args
}
```

Open a new PowerShell session. This function is available in PowerShell, not in
Command Prompt.

## Verify and use

From a directory outside the checkout:

```sh
codex-usage --help
codex-usage usage --watch
codex-usage usage --json
codex-usage history --range 7d
codex-usage login
```

Both wrappers forward all arguments to the CLI entry point. Running without a
subcommand defaults to `usage`. Update `CODEX_USAGE_REPO` after moving the checkout.
To uninstall, remove the wrapper or profile function and its configuration; history
remains in the [database location](../README.md#history-and-privacy) until removed.
