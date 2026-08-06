import type { z } from "zod";
import { CodexRpcClient } from "./codexRpc.js";
import { persistUsageSnapshot } from "./history/store.js";
import {
  AccountReadResultSchema,
  RateLimitsReadResultSchema,
} from "./schemas.js";
import type {
  CodexRateLimit,
  UsageSnapshot,
  UsageSnapshotData,
} from "./types.js";

type ValidatedLimitsResult = z.infer<typeof RateLimitsReadResultSchema>;

function pickCodexLimit(result: ValidatedLimitsResult): CodexRateLimit | null {
  const byId = result.rateLimitsByLimitId;

  if (byId?.["codex"]) return byId["codex"] as CodexRateLimit;

  const all = byId ? Object.values(byId) : [];
  const codexLike = all.find((item) =>
    [item.limitId, item.limitName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes("codex")),
  );

  return (codexLike ??
    result.rateLimits ??
    all[0] ??
    null) as CodexRateLimit | null;
}

function allLimits(result: ValidatedLimitsResult): CodexRateLimit[] {
  if (result.rateLimitsByLimitId) {
    return Object.values(result.rateLimitsByLimitId).filter(
      (item) => item.limitId !== "codex_bengalfox",
    ) as CodexRateLimit[];
  }
  return result.rateLimits ? [result.rateLimits as CodexRateLimit] : [];
}

export async function fetchCodexUsage(): Promise<UsageSnapshot> {
  const client = new CodexRpcClient();

  try {
    await client.start();

    const rawAccount = await client.request<unknown>("account/read", {
      refreshToken: true,
    });
    const accountResult = AccountReadResultSchema.safeParse(rawAccount);
    if (!accountResult.success) {
      throw new Error(
        `Unexpected account/read response: ${accountResult.error.message}`,
      );
    }

    let rawLimits: unknown;
    try {
      rawLimits = await client.request<unknown>("account/rateLimits/read");
    } catch (error) {
      throw normalizeRateLimitsReadError(error);
    }
    const limitsResult = RateLimitsReadResultSchema.safeParse(rawLimits);
    if (!limitsResult.success) {
      throw new Error(
        `Unexpected rateLimits/read response: ${limitsResult.error.message}`,
      );
    }

    return withHistoryPersistence({
      fetchedAt: new Date().toISOString(),
      account: accountResult.data.account,
      selectedLimit: pickCodexLimit(limitsResult.data),
      allLimits: allLimits(limitsResult.data),
    });
  } finally {
    await client.stop();
  }
}

function normalizeRateLimitsReadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("account/rateLimits/read failed") &&
    message.includes("unknown variant `prolite`")
  ) {
    return new Error(
      "Codex CLI could not read rate limits because its app-server does not recognize ChatGPT plan type \"prolite\". This is a Codex CLI compatibility issue, not a dashboard schema error. Upgrade Codex CLI with `npm install -g @openai/codex@latest` or set CODEX_BIN to a newer codex binary, then retry.",
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function withHistoryPersistence(snapshot: UsageSnapshotData): UsageSnapshot {
  try {
    const result = persistUsageSnapshot(snapshot);
    return {
      ...snapshot,
      history: {
        action: result.action,
        persisted: true,
        warning: null,
      },
    };
  } catch (error) {
    return {
      ...snapshot,
      history: {
        action: null,
        persisted: false,
        warning: `History was not updated: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
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
