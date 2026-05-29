import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UsageSnapshotData } from "../types.js";
import { HISTORY_DB_FILE_NAME } from "./db.js";
import {
  clearHistoryEvents,
  listHistoryEvents,
  persistUsageSnapshot,
} from "./store.js";

function makeSnapshot(
  fetchedAt: string,
  overrides: Partial<UsageSnapshotData> = {},
): UsageSnapshotData {
  return {
    account: {
      email: "dev@example.com",
      planType: "pro",
      type: "chatgpt",
    },
    allLimits: overrides.allLimits ?? [
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
        secondary: {
          resetsAt: 1_710_604_800,
          usedPercent: 20,
          windowDurationMins: 10_080,
        },
      },
    ],
    fetchedAt,
    selectedLimit: overrides.selectedLimit ?? {
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
    ...overrides,
  };
}

function makeDatabasePath(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "codex-history-store-")),
    HISTORY_DB_FILE_NAME,
  );
}

describe("persistUsageSnapshot", () => {
  it("inserts the first history event", () => {
    const databasePath = makeDatabasePath();
    const snapshot = makeSnapshot("2026-05-30T10:00:00.000Z");

    const result = persistUsageSnapshot(snapshot, { databasePath });
    const history = listHistoryEvents({ databasePath, range: "all" });

    expect(result.action).toBe("inserted");
    expect(history.totalEventCount).toBe(1);
    expect(history.events[0]).toMatchObject({
      account: snapshot.account,
      fetchedAt: snapshot.fetchedAt,
      firstSeenAt: snapshot.fetchedAt,
      lastSeenAt: snapshot.fetchedAt,
      occurrenceCount: 1,
      selectedLimit: snapshot.selectedLimit,
    });
  });

  it("coalesces identical consecutive snapshots", () => {
    const databasePath = makeDatabasePath();
    persistUsageSnapshot(makeSnapshot("2026-05-30T10:00:00.000Z"), {
      databasePath,
    });

    const result = persistUsageSnapshot(
      makeSnapshot("2026-05-30T10:05:00.000Z"),
      {
        databasePath,
      },
    );
    const history = listHistoryEvents({ databasePath, range: "all" });

    expect(result.action).toBe("coalesced");
    expect(history.totalEventCount).toBe(1);
    expect(history.events[0]).toMatchObject({
      firstSeenAt: "2026-05-30T10:00:00.000Z",
      lastSeenAt: "2026-05-30T10:05:00.000Z",
      occurrenceCount: 2,
    });
  });

  it("stores the same state again after an intervening change", () => {
    const databasePath = makeDatabasePath();
    const initial = makeSnapshot("2026-05-30T10:00:00.000Z");
    const changed = makeSnapshot("2026-05-30T11:00:00.000Z", {
      allLimits: [
        {
          limitId: "codex",
          limitName: "Codex",
          planType: "pro",
          primary: {
            resetsAt: 1_710_000_000,
            usedPercent: 50,
            windowDurationMins: 300,
          },
          rateLimitReachedType: null,
          secondary: {
            resetsAt: 1_710_604_800,
            usedPercent: 32,
            windowDurationMins: 10_080,
          },
        },
      ],
      selectedLimit: {
        limitId: "codex",
        limitName: "Codex",
        planType: "pro",
        primary: {
          resetsAt: 1_710_000_000,
          usedPercent: 50,
          windowDurationMins: 300,
        },
        rateLimitReachedType: null,
        secondary: {
          resetsAt: 1_710_604_800,
          usedPercent: 32,
          windowDurationMins: 10_080,
        },
      },
    });
    const returned = makeSnapshot("2026-05-30T12:00:00.000Z");

    persistUsageSnapshot(initial, { databasePath });
    persistUsageSnapshot(changed, { databasePath });
    const result = persistUsageSnapshot(returned, { databasePath });
    const history = listHistoryEvents({
      databasePath,
      range: "all",
      limit: 10,
    });

    expect(result.action).toBe("inserted");
    expect(history.totalEventCount).toBe(3);
    expect(history.events.map((event) => event.fetchedAt)).toEqual([
      "2026-05-30T12:00:00.000Z",
      "2026-05-30T11:00:00.000Z",
      "2026-05-30T10:00:00.000Z",
    ]);
  });
});

describe("history queries and cleanup", () => {
  it("filters by range and clears the selected range", () => {
    const databasePath = makeDatabasePath();
    persistUsageSnapshot(
      makeSnapshot("2026-05-28T10:00:00.000Z", {
        allLimits: [
          {
            limitId: "codex",
            limitName: "Codex",
            planType: "pro",
            primary: {
              resetsAt: 1_710_000_000,
              usedPercent: 15,
              windowDurationMins: 300,
            },
            rateLimitReachedType: null,
            secondary: {
              resetsAt: 1_710_604_800,
              usedPercent: 10,
              windowDurationMins: 10_080,
            },
          },
        ],
        selectedLimit: {
          limitId: "codex",
          limitName: "Codex",
          planType: "pro",
          primary: {
            resetsAt: 1_710_000_000,
            usedPercent: 15,
            windowDurationMins: 300,
          },
          rateLimitReachedType: null,
          secondary: {
            resetsAt: 1_710_604_800,
            usedPercent: 10,
            windowDurationMins: 10_080,
          },
        },
      }),
      {
        databasePath,
      },
    );
    persistUsageSnapshot(makeSnapshot("2026-05-30T09:30:00.000Z"), {
      databasePath,
    });

    const history = listHistoryEvents({
      databasePath,
      now: new Date("2026-05-30T10:00:00.000Z"),
      range: "24h",
    });

    expect(history.totalEventCount).toBe(1);
    expect(history.events).toHaveLength(1);
    expect(history.events[0].fetchedAt).toBe("2026-05-30T09:30:00.000Z");

    const deleted = clearHistoryEvents({
      databasePath,
      now: new Date("2026-05-30T10:00:00.000Z"),
      range: "24h",
    });

    expect(deleted.deletedCount).toBe(1);
    expect(
      listHistoryEvents({ databasePath, range: "all" }).totalEventCount,
    ).toBe(1);
  });

  it("persists valid partial snapshots with missing windows", () => {
    const databasePath = makeDatabasePath();
    persistUsageSnapshot(
      makeSnapshot("2026-05-30T10:00:00.000Z", {
        allLimits: [
          {
            limitId: "codex",
            limitName: "Codex",
            planType: "pro",
            primary: null,
            rateLimitReachedType: null,
            secondary: null,
          },
        ],
        selectedLimit: {
          limitId: "codex",
          limitName: "Codex",
          planType: "pro",
          primary: null,
          rateLimitReachedType: null,
          secondary: null,
        },
      }),
      { databasePath },
    );

    const history = listHistoryEvents({ databasePath, range: "all" });
    expect(history.events[0].selectedLimit?.primary).toBeNull();
    expect(history.events[0].selectedLimit?.secondary).toBeNull();
  });
});
