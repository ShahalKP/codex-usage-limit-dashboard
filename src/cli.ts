import { Command } from "commander";
import { clearHistoryEvents, listHistoryEvents } from "./history/store.js";
import {
  confirmHistoryCleanup,
  parseHistoryWindowSelection,
} from "./history/cli.js";
import { parseHistoryRange } from "./history/types.js";
import { renderLogin } from "./tui/LoginApp.js";
import { renderHistory } from "./tui/HistoryApp.js";
import { renderUsage } from "./tui/UsageApp.js";
import { fetchCodexUsage } from "./usage.js";

const program = new Command()
  .name("codex-usage")
  .description("Show your Codex rate-limit usage")
  .version("1.0.0")
  .addHelpText(
    "after",
    "\nExamples:\n  codex-usage usage\n  codex-usage usage --watch\n  codex-usage usage --json\n  codex-usage history --range 24h\n  codex-usage history --json\n  codex-usage history:clear --range 7d\n  codex-usage login",
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

program
  .command("history")
  .description("Show saved history of meaningful Codex quota changes")
  .option("--json", "Output machine-readable JSON")
  .option("--range <range>", "Filter to 24h, 7d, 30d, or all", "24h")
  .option("--limit <count>", "Maximum number of events to show", "10")
  .option(
    "--window <window>",
    "Choose which window summary to render: primary, secondary, or all",
    "all",
  )
  .action(
    async (opts: {
      json?: boolean;
      limit: string;
      range: string;
      window: string;
    }) => {
      const result = listHistoryEvents({
        limit: Number(opts.limit),
        range: parseHistoryRange(opts.range),
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const { waitUntilExit } = renderHistory({
        result,
        window: parseHistoryWindowSelection(opts.window),
      });
      await waitUntilExit();
    },
  );

program
  .command("history:clear")
  .description("Delete saved history, either all of it or a recent range")
  .option("--range <range>", "Delete 24h, 7d, 30d, or all history", "all")
  .option("--yes", "Skip the interactive confirmation prompt")
  .option("--json", "Output machine-readable JSON")
  .action(async (opts: { json?: boolean; range: string; yes?: boolean }) => {
    const range = parseHistoryRange(opts.range);
    const confirmed = await confirmHistoryCleanup(range, opts.yes ?? false);

    if (!confirmed) {
      console.log("History cleanup cancelled.");
      return;
    }

    const result = clearHistoryEvents({ range });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(
      `Deleted ${result.deletedCount} coalesced ${result.deletedCount === 1 ? "event" : "events"} from ${result.range}.`,
    );
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
