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
});
