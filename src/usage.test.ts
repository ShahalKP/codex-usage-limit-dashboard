import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.fn(async () => {});
const stopMock = vi.fn(async () => {});
const requestMock = vi.fn();
const persistUsageSnapshotMock = vi.fn();

vi.mock("./codexRpc.js", () => ({
  CodexRpcClient: vi.fn(function MockCodexRpcClient() {
    return {
      request: requestMock,
      start: startMock,
      stop: stopMock,
    };
  }),
}));

vi.mock("./history/store.js", () => ({
  persistUsageSnapshot: persistUsageSnapshotMock,
}));

describe("fetchCodexUsage", () => {
  beforeEach(() => {
    vi.resetModules();
    startMock.mockClear();
    stopMock.mockClear();
    requestMock.mockReset();
    persistUsageSnapshotMock.mockReset();

    requestMock.mockImplementation(async (method: string) => {
      if (method === "account/read") {
        return {
          account: {
            email: "dev@example.com",
            planType: "pro",
            type: "chatgpt",
          },
        };
      }

      return {
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: "Codex",
            planType: "pro",
            primary: {
              resetsAt: 1_710_000_000,
              usedPercent: 35,
              windowDurationMins: 300,
            },
            rateLimitReachedType: null,
            secondary: {
              resetsAt: 1_710_604_800,
              usedPercent: 20,
              windowDurationMins: 10_080,
            },
          },
        },
      };
    });
  });

  it("persists validated successful snapshots", async () => {
    persistUsageSnapshotMock.mockReturnValue({
      action: "inserted",
      eventId: 1,
    });

    const { fetchCodexUsage } = await import("./usage.js");
    const snapshot = await fetchCodexUsage();

    expect(persistUsageSnapshotMock).toHaveBeenCalledTimes(1);
    expect(snapshot.history).toEqual({
      action: "inserted",
      persisted: true,
      warning: null,
    });
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the live snapshot when persistence fails", async () => {
    persistUsageSnapshotMock.mockImplementation(() => {
      throw new Error("database is locked");
    });

    const { fetchCodexUsage } = await import("./usage.js");
    const snapshot = await fetchCodexUsage();

    expect(snapshot.selectedLimit?.limitId).toBe("codex");
    expect(snapshot.history).toEqual({
      action: null,
      persisted: false,
      warning: "History was not updated: database is locked",
    });
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("accepts prolite plan types from successful Codex app-server responses", async () => {
    persistUsageSnapshotMock.mockReturnValue({
      action: "inserted",
      eventId: 1,
    });

    requestMock.mockImplementation(async (method: string) => {
      if (method === "account/read") {
        return {
          account: {
            email: "dev@example.com",
            planType: "plus",
            type: "chatgpt",
          },
        };
      }

      return {
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: null,
            planType: "prolite",
            primary: {
              resetsAt: 1_710_000_000,
              usedPercent: 35,
              windowDurationMins: 300,
            },
            rateLimitReachedType: null,
            secondary: {
              resetsAt: 1_710_604_800,
              usedPercent: 20,
              windowDurationMins: 10_080,
            },
          },
        },
      };
    });

    const { fetchCodexUsage } = await import("./usage.js");
    const snapshot = await fetchCodexUsage();

    expect(snapshot.account?.planType).toBe("plus");
    expect(snapshot.selectedLimit?.planType).toBe("prolite");
    expect(snapshot.history?.persisted).toBe(true);
  });

  it("explains stale Codex CLI prolite decode errors without leaking the response body", async () => {
    requestMock.mockImplementation(async (method: string) => {
      if (method === "account/read") {
        return {
          account: {
            email: "dev@example.com",
            planType: "plus",
            type: "chatgpt",
          },
        };
      }

      throw new Error(
        "account/rateLimits/read failed: failed to fetch codex rate limits: Decode error for https://chatgpt.com/backend-api/wham/usage: unknown variant `prolite`, expected one of `guest`, `free`; content-type=application/json; body={\"email\":\"dev@example.com\",\"plan_type\":\"prolite\"}",
      );
    });

    const { fetchCodexUsage } = await import("./usage.js");
    let caught: unknown;

    try {
      await fetchCodexUsage();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(
      "Codex CLI could not read rate limits because its app-server does not recognize ChatGPT plan type \"prolite\".",
    );
    expect(message).toContain("npm install -g @openai/codex@latest");
    expect(message).not.toContain("dev@example.com");
    expect(message).not.toContain("body=");
    expect(persistUsageSnapshotMock).not.toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
