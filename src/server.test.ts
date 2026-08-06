import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistUsageSnapshot } from "./history/store.js";
import { HISTORY_DB_FILE_NAME } from "./history/db.js";

const fetchCodexUsageMock = vi.fn();
const fetchClaudeUsageMock = vi.fn();

vi.mock("./usage.js", () => ({
  fetchCodexUsage: fetchCodexUsageMock,
}));

vi.mock("./claudeUsage.js", () => ({
  fetchClaudeUsage: fetchClaudeUsageMock,
}));

function makeDatabasePath(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "codex-server-history-")),
    HISTORY_DB_FILE_NAME,
  );
}

describe("createServerApp", () => {
  let baseUrl = "";
  let databasePath = "";
  let server: import("node:http").Server;

  beforeEach(async () => {
    vi.resetModules();
    fetchCodexUsageMock.mockReset();
    fetchClaudeUsageMock.mockReset();
    databasePath = makeDatabasePath();
    process.env.CODEX_USAGE_DB_PATH = databasePath;

    const { createServerApp } = await import("./server.js");
    const app = createServerApp();

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not expose an IPv4 address.");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    delete process.env.CODEX_USAGE_DB_PATH;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("returns history query results from the local sqlite store", async () => {
    persistUsageSnapshot(
      {
        fetchedAt: "2026-05-30T10:00:00.000Z",
        account: {
          email: "dev@example.com",
          planType: "pro",
          type: "chatgpt",
        },
        allLimits: [
          {
            limitId: "codex",
            limitName: "Codex",
            planType: "pro",
            primary: {
              resetsAt: 1_710_000_000,
              usedPercent: 35,
              windowDurationMins: 300,
            },
            rateLimitReachedType: null,
            secondary: null,
          },
        ],
        selectedLimit: {
          limitId: "codex",
          limitName: "Codex",
          planType: "pro",
          primary: {
            resetsAt: 1_710_000_000,
            usedPercent: 35,
            windowDurationMins: 300,
          },
          rateLimitReachedType: null,
          secondary: null,
        },
      },
      { databasePath },
    );

    const response = await fetch(
      `${baseUrl}/api/codex/history?range=all&limit=5`,
    );
    const body = (await response.json()) as {
      events: Array<{ selectedLimit: { limitId: string } }>;
      totalEventCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.totalEventCount).toBe(1);
    expect(body.events[0]?.selectedLimit.limitId).toBe("codex");
  });

  it("deletes history through the cleanup endpoint", async () => {
    persistUsageSnapshot(
      {
        fetchedAt: "2026-05-30T10:00:00.000Z",
        account: null,
        allLimits: [],
        selectedLimit: null,
      },
      { databasePath },
    );

    const response = await fetch(`${baseUrl}/api/codex/history`, {
      body: JSON.stringify({ range: "all" }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const body = (await response.json()) as { deletedCount: number };

    expect(response.status).toBe(200);
    expect(body.deletedCount).toBe(1);
  });

  it("returns the current snapshot payload with any save warning intact", async () => {
    fetchCodexUsageMock.mockResolvedValue({
      account: null,
      allLimits: [],
      fetchedAt: "2026-05-30T10:00:00.000Z",
      history: {
        action: null,
        persisted: false,
        warning: "History was not updated: database is locked",
      },
      selectedLimit: null,
    });

    const response = await fetch(`${baseUrl}/api/codex/rate-limits`);
    const body = (await response.json()) as {
      history: { warning: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.history.warning).toBe(
      "History was not updated: database is locked",
    );
  });

  it("returns the claude usage snapshot payload as JSON", async () => {
    fetchClaudeUsageMock.mockResolvedValue({
      fetchedAt: "2026-08-06T10:00:00.000Z",
      account: {
        type: "claude",
        email: "dev@example.com",
        orgName: "Acme",
        subscriptionType: "team",
        userRateLimitTier: "default_claude_max_5x",
        organizationRateLimitTier: "default_raven",
      },
      windows: [
        {
          label: "Last 5 hours",
          lookbackMins: 300,
          since: "2026-08-06T05:00:00.000Z",
          responses: 3,
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 5,
          byModel: [],
        },
      ],
      scan: {
        filesScanned: 10,
        responsesCounted: 3,
        malformedLines: 0,
        elapsedMs: 50,
      },
    });

    const response = await fetch(`${baseUrl}/api/claude/usage`);
    const body = (await response.json()) as {
      account: { email: string } | null;
      windows: Array<{ label: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.account?.email).toBe("dev@example.com");
    expect(body.windows[0]?.label).toBe("Last 5 hours");
  });

  it("returns 500 with the error message when fetchClaudeUsage rejects", async () => {
    fetchClaudeUsageMock.mockRejectedValue(new Error("claude auth status failed"));

    const response = await fetch(`${baseUrl}/api/claude/usage`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe("claude auth status failed");
  });
});
