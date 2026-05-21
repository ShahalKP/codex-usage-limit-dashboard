import { CodexRpcClient } from "./codexRpc.js";
import type {
  AccountReadResult,
  CodexRateLimit,
  RateLimitsReadResult,
  UsageSnapshot,
} from "./types.js";

function pickCodexLimit(result: RateLimitsReadResult): CodexRateLimit | null {
  const byId = result.rateLimitsByLimitId;

  if (byId?.codex) return byId.codex;

  const all = byId ? Object.values(byId) : [];
  const codexLike = all.find((item) =>
    [item.limitId, item.limitName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes("codex")),
  );

  return codexLike ?? result.rateLimits ?? all[0] ?? null;
}

function allLimits(result: RateLimitsReadResult): CodexRateLimit[] {
  if (result.rateLimitsByLimitId) {
    return Object.values(result.rateLimitsByLimitId).filter(
      (item) => item.limitId !== "codex_bengalfox",
    );
  }
  return result.rateLimits ? [result.rateLimits] : [];
}

export async function fetchCodexUsage(): Promise<UsageSnapshot> {
  const client = new CodexRpcClient();

  try {
    await client.start();

    const account = await client.request<AccountReadResult>("account/read", {
      refreshToken: true,
    });

    const limits = await client.request<RateLimitsReadResult>(
      "account/rateLimits/read",
    );

    return {
      fetchedAt: new Date().toISOString(),
      account: account.account,
      selectedLimit: pickCodexLimit(limits),
      allLimits: allLimits(limits),
    };
  } finally {
    await client.stop();
  }
}

export function remainingPercent(limit: CodexRateLimit | null): number | null {
  const used = limit?.primary?.usedPercent;
  if (typeof used !== "number") return null;
  return Math.max(0, Math.min(100, 100 - used));
}

export function resetDate(limit: CodexRateLimit | null): Date | null {
  const resetsAt = limit?.primary?.resetsAt;
  if (typeof resetsAt !== "number") return null;
  return new Date(resetsAt * 1000);
}
