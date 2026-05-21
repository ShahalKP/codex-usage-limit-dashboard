import { loginWithDeviceCode } from "./login.js";
import { fetchCodexUsage, remainingPercent, resetDate } from "./usage.js";

function formatDate(date: Date | null): string {
  if (!date) return "Unknown";
  return date.toLocaleString();
}

function printUsage(
  snapshot: Awaited<ReturnType<typeof fetchCodexUsage>>,
): void {
  const account = snapshot.account;
  const limit = snapshot.selectedLimit;
  const primary = limit?.primary ?? null;
  const remaining = remainingPercent(limit);
  const reset = resetDate(limit);

  console.log("");
  console.log(`Fetched: ${new Date(snapshot.fetchedAt).toLocaleString()}`);
  const planType = limit?.planType ?? account?.planType;
  console.log(
    `Account: ${
      account
        ? `${account.email ?? account.type}${planType ? ` (${planType})` : ""}`
        : "Not logged in"
    }`,
  );

  if (!limit || !primary) {
    console.log("No Codex rate-limit bucket was returned.");
    console.log("Try: npm run login");
    return;
  }

  console.log(`Bucket: ${limit.limitName ?? limit.limitId}`);
  console.log(
    `5h window:   ${primary.usedPercent}% used / ${remaining}% remaining (resets ${formatDate(reset)})`,
  );

  if (limit.secondary) {
    const secUsed = limit.secondary.usedPercent;
    const secRemaining = Math.max(0, Math.min(100, 100 - secUsed));
    const secReset = limit.secondary.resetsAt
      ? new Date(limit.secondary.resetsAt * 1000)
      : null;
    console.log(
      `7d window:   ${secUsed}% used / ${secRemaining}% remaining (resets ${formatDate(secReset)})`,
    );
  }

  if (limit.rateLimitReachedType) {
    console.log(`Limit state: ${limit.rateLimitReachedType}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "usage";
  const json = process.argv.includes("--json");

  if (command === "login") {
    await loginWithDeviceCode();
    return;
  }

  if (command === "usage") {
    const snapshot = await fetchCodexUsage();
    if (json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      printUsage(snapshot);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage:");
  console.error("  npm run login");
  console.error("  npm run usage");
  console.error("  npm run usage -- --json");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
