import { describe, expect, it } from "vitest";
import {
  formatHistoryMetadata,
  parseHistoryWindowSelection,
  resolveHistoryLayout,
  selectHistoryWindows,
} from "./cli.js";
import type { HistoryEvent } from "./types.js";

const sampleEvent: HistoryEvent = {
  account: {
    email: "info4shahal@gmail.com",
    planType: "pro",
    type: "chatgpt",
  },
  allLimits: [
    {
      limitId: "codex",
      limitName: "codex",
      planType: "pro",
      primary: {
        resetsAt: 1748581920,
        usedPercent: 18,
        windowDurationMins: 300,
      },
      rateLimitReachedType: null,
      secondary: {
        resetsAt: 1749146400,
        usedPercent: 46,
        windowDurationMins: 10080,
      },
    },
  ],
  fetchedAt: "2026-05-30T10:00:00.000Z",
  fingerprint: "fingerprint",
  firstSeenAt: "2026-05-30T10:00:00.000Z",
  id: 1,
  lastSeenAt: "2026-05-30T10:00:00.000Z",
  occurrenceCount: 3,
  selectedLimit: {
    limitId: "codex",
    limitName: "codex",
    planType: "pro",
    primary: {
      resetsAt: 1748581920,
      usedPercent: 18,
      windowDurationMins: 300,
    },
    rateLimitReachedType: null,
    secondary: {
      resetsAt: 1749146400,
      usedPercent: 46,
      windowDurationMins: 10080,
    },
  },
};

describe("parseHistoryWindowSelection", () => {
  it("defaults to all windows", () => {
    expect(parseHistoryWindowSelection(undefined)).toBe("all");
  });
});

describe("selectHistoryWindows", () => {
  it("returns both 5h and 7d windows in the default all view", () => {
    expect(selectHistoryWindows(sampleEvent, "all")).toEqual([
      {
        label: "5h",
        window: sampleEvent.selectedLimit?.primary ?? null,
      },
      {
        label: "7d",
        window: sampleEvent.selectedLimit?.secondary ?? null,
      },
    ]);
  });
});

describe("resolveHistoryLayout", () => {
  it("drops non-vital metadata on narrow terminals", () => {
    expect(resolveHistoryLayout(72)).toEqual({
      barWidth: 10,
      compact: true,
      showAccount: false,
      showBucket: false,
      showOccurrenceCount: false,
      showSummary: false,
    });
  });

  it("retains full metadata on wide terminals", () => {
    expect(resolveHistoryLayout(128)).toEqual({
      barWidth: 24,
      compact: false,
      showAccount: true,
      showBucket: true,
      showOccurrenceCount: true,
      showSummary: true,
    });
  });
});

describe("formatHistoryMetadata", () => {
  it("omits bucket and account details when the layout is narrow", () => {
    const metadata = formatHistoryMetadata(
      sampleEvent,
      resolveHistoryLayout(90),
    );
    expect(metadata).toBe("3 observations");
  });
});
