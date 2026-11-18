import { format } from "date-fns";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { RateLimitWindow } from "../types.js";
import type { HistoryEvent, HistoryListResult } from "./types.js";

export type HistoryWindowSelection = "primary" | "secondary" | "all";

export type HistoryLayout = {
  barWidth: number;
  compact: boolean;
  showAccount: boolean;
  showBucket: boolean;
  showOccurrenceCount: boolean;
  showSummary: boolean;
};

export function parseHistoryWindowSelection(
  value: string | undefined,
): HistoryWindowSelection {
  if (!value) return "all";
  if (value === "primary" || value === "secondary" || value === "all") {
    return value;
  }

  throw new Error(
    `Invalid history window "${value}". Expected one of: primary, secondary, all.`,
  );
}

export function resolveHistoryLayout(width: number): HistoryLayout {
  if (width < 76) {
    return {
      barWidth: 10,
      compact: true,
      showAccount: false,
      showBucket: false,
      showOccurrenceCount: false,
      showSummary: false,
    };
  }

  if (width < 96) {
    return {
      barWidth: 14,
      compact: true,
      showAccount: false,
      showBucket: false,
      showOccurrenceCount: true,
      showSummary: true,
    };
  }

  if (width < 120) {
    return {
      barWidth: 18,
      compact: false,
      showAccount: false,
      showBucket: true,
      showOccurrenceCount: true,
      showSummary: true,
    };
  }

  return {
    barWidth: 24,
    compact: false,
    showAccount: true,
    showBucket: true,
    showOccurrenceCount: true,
    showSummary: true,
  };
}

export async function confirmHistoryCleanup(
  range: string,
  force: boolean,
): Promise<boolean> {
  if (force) return true;

  if (!input.isTTY) {
    throw new Error(
      "History cleanup requires confirmation. Re-run with --yes to confirm in non-interactive mode.",
    );
  }

  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(
      `Delete ${range === "all" ? "all saved history" : `history observed in the last ${range}`}? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export function formatHistoryHeading(
  result: HistoryListResult,
  window: HistoryWindowSelection,
  layout: HistoryLayout,
): string {
  if (!layout.showSummary) {
    return `${result.range} · ${result.events.length}/${result.totalEventCount}`;
  }

  return `range ${result.range} · showing ${result.events.length}/${result.totalEventCount} · window ${window}`;
}

export function formatHistoryInterval(event: HistoryEvent): string {
  return `${formatStamp(event.firstSeenAt)} → ${formatStamp(event.lastSeenAt)}`;
}

export function formatHistoryMetadata(
  event: HistoryEvent,
  layout: HistoryLayout,
): string | null {
  const parts: string[] = [];

  if (layout.showOccurrenceCount) {
    parts.push(
      event.occurrenceCount > 1
        ? `${event.occurrenceCount} observations`
        : "1 observation",
    );
  }

  if (layout.showBucket) {
    parts.push(
      event.selectedLimit?.limitName ??
        event.selectedLimit?.limitId ??
        "bucket unavailable",
    );
  }

  if (layout.showAccount) {
    parts.push(
      event.account?.email ?? event.account?.type ?? "unknown account",
    );
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function selectHistoryWindows(
  event: HistoryEvent,
  window: HistoryWindowSelection,
): Array<{ label: string; window: RateLimitWindow | null }> {
  const primary = event.selectedLimit?.primary ?? null;
  const secondary = event.selectedLimit?.secondary ?? null;

  if (window === "primary") {
    return [
      { label: describeWindowLabel(primary, "primary"), window: primary },
    ];
  }

  if (window === "secondary") {
    return [
      {
        label: describeWindowLabel(secondary, "secondary"),
        window: secondary,
      },
    ];
  }

  return [
    { label: describeWindowLabel(primary, "primary"), window: primary },
    { label: describeWindowLabel(secondary, "secondary"), window: secondary },
  ];
}

export function describeHistoryWindow(window: RateLimitWindow | null): {
  remaining: number | null;
  resetText: string;
} {
  if (!window) {
    return {
      remaining: null,
      resetText: "unavailable",
    };
  }

  return {
    remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)),
    resetText: formatReset(window.resetsAt),
  };
}

function describeWindowLabel(
  window: RateLimitWindow | null,
  fallbackLabel: string,
): string {
  if (!window) {
    return fallbackLabel;
  }

  return formatWindowLabel(window.windowDurationMins);
}

export function formatWindowLabel(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function formatStamp(iso: string): string {
  return format(new Date(iso), "MMM d h:mm a");
}

function formatReset(timestampSeconds: number): string {
  return format(new Date(timestampSeconds * 1000), "MMM d h:mm a");
}
