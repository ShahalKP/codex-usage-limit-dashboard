import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const HISTORY_DB_ENV_VAR = "CODEX_USAGE_DB_PATH";
export const HISTORY_DB_FILE_NAME = "history.sqlite";
const APP_SUPPORT_DIR_NAME = "codex-usage-limit-dashboard";
const HISTORY_SCHEMA_VERSION = 1;

const CREATE_HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS usage_history_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
    account_type TEXT,
    account_email TEXT,
    account_plan_type TEXT,
    selected_limit_id TEXT,
    selected_limit_name TEXT,
    selected_limit_plan_type TEXT,
    selected_limit_reached_type TEXT,
    primary_used_percent REAL,
    primary_window_minutes INTEGER,
    primary_resets_at INTEGER,
    secondary_used_percent REAL,
    secondary_window_minutes INTEGER,
    secondary_resets_at INTEGER,
    raw_snapshot_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_history_events_last_seen
    ON usage_history_events(last_seen_at DESC, id DESC);

  CREATE INDEX IF NOT EXISTS idx_usage_history_events_first_seen
    ON usage_history_events(first_seen_at DESC);

  CREATE INDEX IF NOT EXISTS idx_usage_history_events_fingerprint
    ON usage_history_events(fingerprint, id DESC);
`;

export function resolveHistoryDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicitPath = env[HISTORY_DB_ENV_VAR]?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (process.platform === "darwin") {
    return path.join(
      homedir(),
      "Library",
      "Application Support",
      APP_SUPPORT_DIR_NAME,
      HISTORY_DB_FILE_NAME,
    );
  }

  if (process.platform === "win32") {
    const appData = env.APPDATA?.trim();
    return path.join(
      appData || path.join(homedir(), "AppData", "Roaming"),
      APP_SUPPORT_DIR_NAME,
      HISTORY_DB_FILE_NAME,
    );
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return path.join(
    xdgDataHome || path.join(homedir(), ".local", "share"),
    APP_SUPPORT_DIR_NAME,
    HISTORY_DB_FILE_NAME,
  );
}

export function openHistoryDatabase(
  filePath = resolveHistoryDatabasePath(),
): Database.Database {
  mkdirSync(path.dirname(filePath), { recursive: true });

  const database = new Database(filePath);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");

  initializeHistorySchema(database);

  return database;
}

function initializeHistorySchema(database: Database.Database): void {
  const currentVersion = Number(
    database.pragma("user_version", { simple: true }),
  );

  if (currentVersion < HISTORY_SCHEMA_VERSION) {
    database.exec(CREATE_HISTORY_TABLE_SQL);
    database.pragma(`user_version = ${HISTORY_SCHEMA_VERSION}`);
    return;
  }

  database.exec(CREATE_HISTORY_TABLE_SQL);
}
