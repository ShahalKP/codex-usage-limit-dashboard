import { Command } from "commander";
import { renderLogin } from "./tui/LoginApp.js";
import { renderUsage } from "./tui/UsageApp.js";
import { fetchCodexUsage } from "./usage.js";

const program = new Command()
  .name("codex-usage")
  .description("Show your Codex rate-limit usage")
  .version("1.0.0")
  .addHelpText(
    "after",
    "\nExamples:\n  codex-usage usage\n  codex-usage usage --watch\n  codex-usage usage --json\n  codex-usage login",
  );

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

program
  .command("login")
  .description("Authenticate with ChatGPT via device code flow")
  .action(async () => {
    const { waitUntilExit } = renderLogin();
    await waitUntilExit();
  });

// Default to `usage` if no command is given
if (process.argv.length === 2) {
  process.argv.push("usage");
}

// Strip the bare `--` that pnpm injects when forwarding extra arguments
// (e.g. `pnpm run usage -- --json` becomes `tsx src/cli.ts usage -- --json`).
// Commander treats `--` as the options terminator and then rejects `--json`
// as an unexpected positional argument.
const argv = process.argv.filter((a) => a !== "--");

program.parseAsync(argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
