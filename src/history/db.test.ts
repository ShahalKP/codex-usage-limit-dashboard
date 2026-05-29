import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HISTORY_DB_ENV_VAR,
  HISTORY_DB_FILE_NAME,
  openHistoryDatabase,
  resolveHistoryDatabasePath,
} from "./db.js";

const tempDirectories: string[] = [];

afterEach(() => {
  tempDirectories.length = 0;
});

describe("resolveHistoryDatabasePath", () => {
  it("uses the override path when provided", () => {
    const dbPath = path.join(tmpdir(), "codex-usage-override.sqlite");
    const resolved = resolveHistoryDatabasePath({
      ...process.env,
      [HISTORY_DB_ENV_VAR]: dbPath,
    });

    expect(resolved).toBe(dbPath);
  });

  it("uses the platform default filename when no override is set", () => {
    const resolved = resolveHistoryDatabasePath({});
    expect(path.basename(resolved)).toBe(HISTORY_DB_FILE_NAME);
  });
});

describe("openHistoryDatabase", () => {
  it("creates the database file and schema idempotently", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "codex-usage-db-"));
    tempDirectories.push(directory);
    const dbPath = path.join(directory, HISTORY_DB_FILE_NAME);

    const first = openHistoryDatabase(dbPath);
    expect(existsSync(dbPath)).toBe(true);

    const tableCount = first
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM sqlite_master
          WHERE type = 'table' AND name = 'usage_history_events'
        `,
      )
      .get() as { count: number };
    expect(tableCount.count).toBe(1);
    first.close();

    const second = openHistoryDatabase(dbPath);
    const userVersion = second.pragma("user_version", {
      simple: true,
    }) as number;
    expect(userVersion).toBe(1);
    second.close();
  });
});
