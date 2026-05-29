import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CodexAccount,
  CodexRateLimit,
  UsageSnapshot,
  UsageSnapshotData,
} from "../types.js";
import { openHistoryDatabase } from "./db.js";
import {
  normalizeHistoryLimit,
  parseHistoryRange,
  resolveRangeStart,
  type HistoryDeleteOptions,
  type HistoryEvent,
  type HistoryListResult,
  type HistoryQueryOptions,
  type PersistHistoryResult,
} from "./types.js";

type HistoryRow = {
  fingerprint: string;
  first_seen_at: string;
  id: number;
  last_seen_at: string;
  occurrence_count: number;
  raw_snapshot_json: string;
};

type CountRow = {
  count: number;
};

type RowInsertPayload = {
  account_email: string | null;
  account_plan_type: string | null;
  account_type: string | null;
  fingerprint: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  primary_resets_at: number | null;
  primary_used_percent: number | null;
  primary_window_minutes: number | null;
  raw_snapshot_json: string;
  secondary_resets_at: number | null;
  secondary_used_percent: number | null;
  secondary_window_minutes: number | null;
  selected_limit_id: string | null;
  selected_limit_name: string | null;
  selected_limit_plan_type: string | null;
  selected_limit_reached_type: string | null;
};

export function persistUsageSnapshot(
  snapshot: UsageSnapshotData | UsageSnapshot,
  options: { databasePath?: string } = {},
): PersistHistoryResult {
  const database = openHistoryDatabase(options.databasePath);

  try {
    return withImmediateTransaction(database, () => {
      const record = toSnapshotRecord(snapshot);
      const fingerprint = fingerprintSnapshot(record);
      const latest = database
        .prepare<[], HistoryRow>(
          `
            SELECT id, fingerprint, first_seen_at, last_seen_at, occurrence_count, raw_snapshot_json
            FROM usage_history_events
            ORDER BY id DESC
            LIMIT 1
          `,
        )
        .get();

      if (latest && latest.fingerprint === fingerprint) {
        database
          .prepare(
            `
              UPDATE usage_history_events
              SET last_seen_at = ?,
                  occurrence_count = occurrence_count + 1,
                  raw_snapshot_json = ?
              WHERE id = ?
            `,
          )
          .run(record.fetchedAt, JSON.stringify(record), latest.id);

        return { action: "coalesced", eventId: latest.id };
      }

      const payload = buildInsertPayload(record, fingerprint);
      const result = database
        .prepare(
          `
            INSERT INTO usage_history_events (
              fingerprint,
              first_seen_at,
              last_seen_at,
              occurrence_count,
              account_type,
              account_email,
              account_plan_type,
              selected_limit_id,
              selected_limit_name,
              selected_limit_plan_type,
              selected_limit_reached_type,
              primary_used_percent,
              primary_window_minutes,
              primary_resets_at,
              secondary_used_percent,
              secondary_window_minutes,
              secondary_resets_at,
              raw_snapshot_json
            ) VALUES (
              @fingerprint,
              @first_seen_at,
              @last_seen_at,
              @occurrence_count,
              @account_type,
              @account_email,
              @account_plan_type,
              @selected_limit_id,
              @selected_limit_name,
              @selected_limit_plan_type,
              @selected_limit_reached_type,
              @primary_used_percent,
              @primary_window_minutes,
              @primary_resets_at,
              @secondary_used_percent,
              @secondary_window_minutes,
              @secondary_resets_at,
              @raw_snapshot_json
            )
          `,
        )
        .run(payload);

      return {
        action: "inserted",
        eventId: Number(result.lastInsertRowid),
      };
    });
  } finally {
    database.close();
  }
}

export function listHistoryEvents(
  options: HistoryQueryOptions = {},
): HistoryListResult {
  const range = parseHistoryRange(options.range);
  const limit = normalizeHistoryLimit(options.limit);
  const since = resolveRangeStart(range, options.now);
  const database = openHistoryDatabase(options.databasePath);

  try {
    const whereClause = since ? "WHERE last_seen_at >= ?" : "";
    const params = since ? [since] : [];

    const total = database
      .prepare<any[], CountRow>(
        `
          SELECT COUNT(*) AS count
          FROM usage_history_events
          ${whereClause}
        `,
      )
      .get(...params);

    const rows = database
      .prepare<any[], HistoryRow>(
        `
          SELECT id, fingerprint, first_seen_at, last_seen_at, occurrence_count, raw_snapshot_json
          FROM usage_history_events
          ${whereClause}
          ORDER BY last_seen_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(...params, limit);

    return {
      events: rows.map(toHistoryEvent),
      range,
      totalEventCount: total?.count ?? 0,
    };
  } finally {
    database.close();
  }
}

export function clearHistoryEvents(options: HistoryDeleteOptions = {}): {
  deletedCount: number;
  range: ReturnType<typeof parseHistoryRange>;
} {
  const range = parseHistoryRange(options.range);
  const since = resolveRangeStart(range, options.now);
  const database = openHistoryDatabase(options.databasePath);

  try {
    const result = since
      ? database
          .prepare(`DELETE FROM usage_history_events WHERE last_seen_at >= ?`)
          .run(since)
      : database.prepare(`DELETE FROM usage_history_events`).run();

    return {
      deletedCount: result.changes,
      range,
    };
  } finally {
    database.close();
  }
}

function withImmediateTransaction<T>(
  database: Database.Database,
  callback: () => T,
): T {
  database.exec("BEGIN IMMEDIATE");

  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

function buildInsertPayload(
  snapshot: UsageSnapshotData,
  fingerprint: string,
): RowInsertPayload {
  return {
    account_email: snapshot.account?.email ?? null,
    account_plan_type: snapshot.account?.planType ?? null,
    account_type: snapshot.account?.type ?? null,
    fingerprint,
    first_seen_at: snapshot.fetchedAt,
    last_seen_at: snapshot.fetchedAt,
    occurrence_count: 1,
    primary_resets_at: snapshot.selectedLimit?.primary?.resetsAt ?? null,
    primary_used_percent: snapshot.selectedLimit?.primary?.usedPercent ?? null,
    primary_window_minutes:
      snapshot.selectedLimit?.primary?.windowDurationMins ?? null,
    raw_snapshot_json: JSON.stringify(snapshot),
    secondary_resets_at: snapshot.selectedLimit?.secondary?.resetsAt ?? null,
    secondary_used_percent:
      snapshot.selectedLimit?.secondary?.usedPercent ?? null,
    secondary_window_minutes:
      snapshot.selectedLimit?.secondary?.windowDurationMins ?? null,
    selected_limit_id: snapshot.selectedLimit?.limitId ?? null,
    selected_limit_name: snapshot.selectedLimit?.limitName ?? null,
    selected_limit_plan_type: snapshot.selectedLimit?.planType ?? null,
    selected_limit_reached_type:
      snapshot.selectedLimit?.rateLimitReachedType ?? null,
  };
}

function toHistoryEvent(row: HistoryRow): HistoryEvent {
  const snapshot = parseSnapshotJson(row.raw_snapshot_json);

  return {
    ...snapshot,
    fingerprint: row.fingerprint,
    firstSeenAt: row.first_seen_at,
    id: row.id,
    lastSeenAt: row.last_seen_at,
    occurrenceCount: row.occurrence_count,
  };
}

function parseSnapshotJson(raw: string): UsageSnapshotData {
  const parsed = JSON.parse(raw) as UsageSnapshotData;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Stored history snapshot payload was not an object.");
  }

  if (typeof parsed.fetchedAt !== "string") {
    throw new Error("Stored history snapshot payload is missing fetchedAt.");
  }

  return parsed;
}

function toSnapshotRecord(
  snapshot: UsageSnapshotData | UsageSnapshot,
): UsageSnapshotData {
  return {
    account: snapshot.account,
    allLimits: snapshot.allLimits,
    fetchedAt: snapshot.fetchedAt,
    selectedLimit: snapshot.selectedLimit,
  };
}

function fingerprintSnapshot(snapshot: UsageSnapshotData): string {
  const normalized = {
    account: normalizeAccount(snapshot.account),
    allLimits: [...snapshot.allLimits]
      .map((limit) => normalizeRateLimit(limit))
      .filter((limit): limit is NormalizedRateLimit => limit !== null)
      .sort(compareRateLimits),
    selectedLimit: normalizeRateLimit(snapshot.selectedLimit),
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function compareRateLimits(
  a: NormalizedRateLimit,
  b: NormalizedRateLimit,
): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

function normalizeAccount(account: CodexAccount): CodexAccount {
  if (!account) return null;

  return {
    email: account.email,
    planType: account.planType ?? null,
    type: account.type,
  };
}

type NormalizedRateLimit = {
  credits: unknown;
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: ReturnType<typeof normalizeWindow>;
  rateLimitReachedType: string | null;
  secondary: ReturnType<typeof normalizeWindow>;
};

function normalizeRateLimit(
  limit: CodexRateLimit | null,
): NormalizedRateLimit | null {
  if (!limit) return null;

  return {
    credits: limit.credits ?? null,
    limitId: limit.limitId ?? null,
    limitName: limit.limitName ?? null,
    planType: limit.planType ?? null,
    primary: normalizeWindow(limit.primary),
    rateLimitReachedType: limit.rateLimitReachedType ?? null,
    secondary: normalizeWindow(limit.secondary),
  };
}

function normalizeWindow(
  window:
    | { resetsAt: number; usedPercent: number; windowDurationMins: number }
    | null
    | undefined,
) {
  if (!window) return null;

  return {
    resetsAt: window.resetsAt,
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins,
  };
}
