import type { HistoryPersistenceAction, UsageSnapshotData } from "../types.js";

export const HISTORY_RANGE_VALUES = ["24h", "7d", "30d", "all"] as const;

export type HistoryRange = (typeof HISTORY_RANGE_VALUES)[number];

export type HistoryStoreOptions = {
  databasePath?: string;
  now?: Date;
};

export type HistoryQueryOptions = HistoryStoreOptions & {
  limit?: number;
  range?: HistoryRange;
};

export type HistoryDeleteOptions = HistoryStoreOptions & {
  range?: HistoryRange;
};

export type PersistHistoryResult = {
  action: HistoryPersistenceAction;
  eventId: number;
};

export type HistoryEvent = UsageSnapshotData & {
  fingerprint: string;
  firstSeenAt: string;
  id: number;
  lastSeenAt: string;
  occurrenceCount: number;
};

export type HistoryListResult = {
  events: HistoryEvent[];
  range: HistoryRange;
  totalEventCount: number;
};

export function isHistoryRange(value: string): value is HistoryRange {
  return HISTORY_RANGE_VALUES.includes(value as HistoryRange);
}

export function parseHistoryRange(value: string | undefined): HistoryRange {
  if (!value) return "24h";
  if (isHistoryRange(value)) return value;

  throw new Error(
    `Invalid history range \"${value}\". Expected one of: ${HISTORY_RANGE_VALUES.join(", ")}.`,
  );
}

export function normalizeHistoryLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(200, Math.trunc(limit)));
}

export function resolveRangeStart(
  range: HistoryRange,
  now = new Date(),
): string | null {
  if (range === "all") return null;

  const millisByRange: Record<Exclude<HistoryRange, "all">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(now.getTime() - millisByRange[range]).toISOString();
}
