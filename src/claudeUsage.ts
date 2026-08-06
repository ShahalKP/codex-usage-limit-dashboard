import { execFile } from "node:child_process";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { ClaudeAuthStatusSchema } from "./schemas.js";
import type { ClaudeModelUsage, ClaudeUsageSnapshot, ClaudeUsageWindow } from "./types.js";

const WINDOW_DEFS: { label: string; lookbackMins: number }[] = [
  { label: "Last 5 hours", lookbackMins: 300 },
  { label: "Last 7 days", lookbackMins: 10080 },
];

export async function readClaudeAuthStatus(command?: string): Promise<unknown> {
  const bin = command ?? process.env.CLAUDE_BIN ?? "claude";
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(bin, ["auth", "status"], { timeout: 15_000 }, (error, out) => {
      if (error) reject(error);
      else resolve(out);
    });
  });
  return JSON.parse(stdout);
}

export function readClaudeTiers(configPath?: string): {
  userRateLimitTier?: string;
  organizationRateLimitTier?: string;
} {
  try {
    const filePath = configPath ?? path.join(os.homedir(), ".claude.json");
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const oauthAccount = raw?.oauthAccount;
    if (!oauthAccount || typeof oauthAccount !== "object") return {};
    const result: { userRateLimitTier?: string; organizationRateLimitTier?: string } = {};
    if (typeof oauthAccount.userRateLimitTier === "string") {
      result.userRateLimitTier = oauthAccount.userRateLimitTier;
    }
    if (typeof oauthAccount.organizationRateLimitTier === "string") {
      result.organizationRateLimitTier = oauthAccount.organizationRateLimitTier;
    }
    return result;
  } catch {
    return {};
  }
}

function walkJsonlFiles(root: string, cutoffMs: number): string[] {
  const results: string[] = [];

  function recurse(dir: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const stat = statSync(full);
          if (stat.mtimeMs >= cutoffMs) {
            results.push(full);
          }
        } catch {
          // skip unreadable file
        }
      }
    }
  }

  recurse(root);
  return results;
}

function emptyWindow(def: { label: string; lookbackMins: number }, now: Date): ClaudeUsageWindow {
  return {
    label: def.label,
    lookbackMins: def.lookbackMins,
    since: new Date(now.getTime() - def.lookbackMins * 60_000).toISOString(),
    responses: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    byModel: [],
  };
}

function getOrCreateModelBucket(
  byModel: Map<string, ClaudeModelUsage>,
  model: string,
): ClaudeModelUsage {
  let bucket = byModel.get(model);
  if (!bucket) {
    bucket = {
      model,
      responses: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    byModel.set(model, bucket);
  }
  return bucket;
}

export async function scanClaudeUsage(options?: {
  root?: string;
  now?: Date;
}): Promise<{
  windows: ClaudeUsageWindow[];
  scan: {
    filesScanned: number;
    responsesCounted: number;
    malformedLines: number;
    elapsedMs: number;
  };
}> {
  const startedAt = Date.now();
  const now = options?.now ?? new Date();
  const root = options?.root ?? path.join(os.homedir(), ".claude", "projects");

  const maxLookbackMins = Math.max(...WINDOW_DEFS.map((w) => w.lookbackMins));
  const cutoffMs = now.getTime() - maxLookbackMins * 60_000;

  const files = walkJsonlFiles(root, cutoffMs);

  const windows = WINDOW_DEFS.map((def) => emptyWindow(def, now));
  const byModelMaps = WINDOW_DEFS.map(() => new Map<string, ClaudeModelUsage>());

  let malformedLines = 0;
  let responsesCounted = 0;
  const seen = new Set<string>();

  for (const file of files) {
    try {
      const lines = createInterface({
        input: createReadStream(file, { encoding: "utf8" }),
      });

      for await (const line of lines) {
        if (!line.includes('"usage"')) continue;

        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          malformedLines++;
          continue;
        }

        if (typeof record !== "object" || record === null) {
          malformedLines++;
          continue;
        }
        const rec = record as Record<string, unknown>;
        if (rec.type !== "assistant") continue;

        const message = rec.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, unknown> | undefined;
        if (!usage) continue;

        const key = (message?.id as string | undefined) ?? (rec.requestId as string | undefined);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const tsValue = rec.timestamp;
        const ts = typeof tsValue === "string" ? Date.parse(tsValue) : NaN;
        if (Number.isNaN(ts)) {
          malformedLines++;
          continue;
        }

        responsesCounted++;

        const model = (message?.model as string | undefined) ?? "unknown";
        const inputTokens = Number(usage.input_tokens) || 0;
        const outputTokens = Number(usage.output_tokens) || 0;
        const cacheCreationTokens = Number(usage.cache_creation_input_tokens) || 0;
        const cacheReadTokens = Number(usage.cache_read_input_tokens) || 0;

        for (let i = 0; i < WINDOW_DEFS.length; i++) {
          const def = WINDOW_DEFS[i];
          const ageMins = (now.getTime() - ts) / 60_000;
          if (ageMins < 0 || ageMins > def.lookbackMins) continue;

          const window = windows[i];
          window.responses++;
          window.inputTokens += inputTokens;
          window.outputTokens += outputTokens;
          window.cacheCreationTokens += cacheCreationTokens;
          window.cacheReadTokens += cacheReadTokens;

          const bucket = getOrCreateModelBucket(byModelMaps[i], model);
          bucket.responses++;
          bucket.inputTokens += inputTokens;
          bucket.outputTokens += outputTokens;
          bucket.cacheCreationTokens += cacheCreationTokens;
          bucket.cacheReadTokens += cacheReadTokens;
        }
      }
    } catch {
      // Unreadable or mid-scan-deleted file (e.g. EACCES, ENOENT surfaced
      // asynchronously during the read). Skip this file, keep whatever was
      // already accumulated from it, move on to the next file.
      continue;
    }
  }

  for (let i = 0; i < windows.length; i++) {
    windows[i].byModel = Array.from(byModelMaps[i].values()).sort(
      (a, b) => b.outputTokens - a.outputTokens,
    );
  }

  return {
    windows,
    scan: {
      filesScanned: files.length,
      responsesCounted,
      malformedLines,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

export async function fetchClaudeUsage(options?: {
  root?: string;
  now?: Date;
  configPath?: string;
}): Promise<ClaudeUsageSnapshot> {
  const fetchedAt = new Date().toISOString();
  const raw = await readClaudeAuthStatus();
  const parsed = ClaudeAuthStatusSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unexpected \`claude auth status\` response: ${parsed.error.message}`);
  }
  const auth = parsed.data;
  const scan = await scanClaudeUsage({ root: options?.root, now: options?.now });

  if (!auth.loggedIn) {
    return { fetchedAt, account: null, windows: scan.windows, scan: scan.scan };
  }

  const tiers = readClaudeTiers(options?.configPath);
  return {
    fetchedAt,
    account: {
      type: "claude",
      email: auth.email,
      orgName: auth.orgName ?? null,
      subscriptionType: auth.subscriptionType ?? null,
      userRateLimitTier: tiers.userRateLimitTier ?? null,
      organizationRateLimitTier: tiers.organizationRateLimitTier ?? null,
    },
    windows: scan.windows,
    scan: scan.scan,
  };
}
