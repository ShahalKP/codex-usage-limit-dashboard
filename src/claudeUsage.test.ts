import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

const { fetchClaudeUsage, readClaudeTiers, scanClaudeUsage } = await import("./claudeUsage.js");

function jsonlLine(record: unknown): string {
  return JSON.stringify(record);
}

function isoMinutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

describe("scanClaudeUsage", () => {
  let root: string;
  const now = new Date("2026-08-06T12:00:00.000Z");

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "claude-usage-fixture-"));

    const slugDir = path.join(root, "-Users-test-project");
    mkdirSync(slugDir, { recursive: true });

    // Flat session file: triplicate message.id (dedup case), a >5h/<7d record,
    // a >7d record, a malformed line, and a non-assistant record.
    const flatLines = [
      // Triplicate content blocks for one API response — must count once.
      jsonlLine({
        type: "assistant",
        timestamp: isoMinutesAgo(now, 10),
        isSidechain: false,
        message: {
          id: "msg-dup-1",
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      }),
      jsonlLine({
        type: "assistant",
        timestamp: isoMinutesAgo(now, 10),
        isSidechain: false,
        message: {
          id: "msg-dup-1",
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      }),
      jsonlLine({
        type: "assistant",
        timestamp: isoMinutesAgo(now, 10),
        isSidechain: false,
        message: {
          id: "msg-dup-1",
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      }),
      // Older than 5h but inside 7d.
      jsonlLine({
        type: "assistant",
        timestamp: isoMinutesAgo(now, 400),
        isSidechain: false,
        message: {
          id: "msg-mid-window",
          model: "claude-opus-5",
          usage: {
            input_tokens: 200,
            output_tokens: 80,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
      // Older than 7 days — must be excluded from both windows.
      jsonlLine({
        type: "assistant",
        timestamp: isoMinutesAgo(now, 10080 + 60),
        isSidechain: false,
        message: {
          id: "msg-too-old",
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 999,
            output_tokens: 999,
            cache_creation_input_tokens: 999,
            cache_read_input_tokens: 999,
          },
        },
      }),
      // Malformed line (not JSON, but passes the '"usage"' substring pre-filter).
      '{not valid json but contains "usage" as a substring',
      // Non-assistant record (should be skipped, not counted as malformed).
      jsonlLine({
        type: "user",
        timestamp: isoMinutesAgo(now, 5),
        message: { id: "msg-user", usage: { input_tokens: 1 } },
      }),
    ];
    writeFileSync(path.join(slugDir, "session-1.jsonl"), flatLines.join("\n") + "\n");

    // Nested subagent transcript — the recursive-walk regression fixture.
    const subagentDir = path.join(slugDir, "session-1", "subagents");
    mkdirSync(subagentDir, { recursive: true });
    const subagentLines = [
      jsonlLine({
        type: "assistant",
        timestamp: isoMinutesAgo(now, 15),
        isSidechain: true,
        message: {
          id: "msg-subagent-1",
          model: "claude-haiku-5",
          usage: {
            input_tokens: 300,
            output_tokens: 150,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 40,
          },
        },
      }),
    ];
    writeFileSync(
      path.join(subagentDir, "agent-x.jsonl"),
      subagentLines.join("\n") + "\n",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("includes tokens from nested subagent transcripts (recursive walk)", async () => {
    const result = await scanClaudeUsage({ root, now });
    const sevenDay = result.windows.find((w) => w.label === "Last 7 days")!;
    const subagentModel = sevenDay.byModel.find((m) => m.model === "claude-haiku-5");
    expect(subagentModel).toBeDefined();
    expect(subagentModel!.outputTokens).toBe(150);
    expect(subagentModel!.inputTokens).toBe(300);
  });

  it("dedups the triplicate message.id and counts it once", async () => {
    const result = await scanClaudeUsage({ root, now });
    const sevenDay = result.windows.find((w) => w.label === "Last 7 days")!;
    const sonnetBucket = sevenDay.byModel.find((m) => m.model === "claude-sonnet-5")!;
    // Only the dedup response (10 min ago) should count for claude-sonnet-5
    // within 7 days, not the >7d record and not 3x the dedup response.
    expect(sonnetBucket.responses).toBe(1);
    expect(sonnetBucket.outputTokens).toBe(50);
    expect(sonnetBucket.inputTokens).toBe(100);
  });

  it("applies the 5h and 7d window boundaries per-record", async () => {
    const result = await scanClaudeUsage({ root, now });
    const fiveHour = result.windows.find((w) => w.label === "Last 5 hours")!;
    const sevenDay = result.windows.find((w) => w.label === "Last 7 days")!;

    // msg-mid-window (400 min ago, claude-opus-5) excluded from 5h, included in 7d.
    expect(fiveHour.byModel.find((m) => m.model === "claude-opus-5")).toBeUndefined();
    const opusIn7d = sevenDay.byModel.find((m) => m.model === "claude-opus-5");
    expect(opusIn7d).toBeDefined();
    expect(opusIn7d!.outputTokens).toBe(80);

    // msg-too-old (>7d, distinctive 999-token claude-sonnet-5 record) is excluded
    // from both windows: the sonnet bucket must reflect only the dedup response
    // (50 output tokens), never 50 + 999.
    const sonnetIn7d = sevenDay.byModel.find((m) => m.model === "claude-sonnet-5");
    expect(sonnetIn7d!.outputTokens).toBe(50);
    expect(sonnetIn7d!.inputTokens).toBe(100);
  });

  it("sorts byModel by outputTokens desc and per-model sums equal window totals", async () => {
    const result = await scanClaudeUsage({ root, now });
    const sevenDay = result.windows.find((w) => w.label === "Last 7 days")!;

    expect(sevenDay.byModel.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < sevenDay.byModel.length; i++) {
      expect(sevenDay.byModel[i - 1].outputTokens).toBeGreaterThanOrEqual(
        sevenDay.byModel[i].outputTokens,
      );
    }

    const sumInput = sevenDay.byModel.reduce((acc, m) => acc + m.inputTokens, 0);
    const sumOutput = sevenDay.byModel.reduce((acc, m) => acc + m.outputTokens, 0);
    expect(sumInput).toBe(sevenDay.inputTokens);
    expect(sumOutput).toBe(sevenDay.outputTokens);
  });

  it("counts the malformed line and still succeeds", async () => {
    const result = await scanClaudeUsage({ root, now });
    expect(result.scan.malformedLines).toBeGreaterThanOrEqual(1);
    expect(result.scan.filesScanned).toBeGreaterThan(0);
  });
});

describe("readClaudeTiers", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "claude-tiers-fixture-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads nested oauthAccount tiers", () => {
    const configPath = path.join(dir, ".claude.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        oauthAccount: {
          userRateLimitTier: "default_claude_max_5x",
          organizationRateLimitTier: "default_raven",
        },
      }),
    );
    expect(readClaudeTiers(configPath)).toEqual({
      userRateLimitTier: "default_claude_max_5x",
      organizationRateLimitTier: "default_raven",
    });
  });

  it("returns {} when oauthAccount is missing, without throwing", () => {
    const configPath = path.join(dir, ".claude.json");
    writeFileSync(configPath, JSON.stringify({ someOtherKey: true }));
    expect(readClaudeTiers(configPath)).toEqual({});
  });

  it("returns {} when the file does not exist, without throwing", () => {
    expect(() => readClaudeTiers(path.join(dir, "missing.json"))).not.toThrow();
    expect(readClaudeTiers(path.join(dir, "missing.json"))).toEqual({});
  });
});

describe("fetchClaudeUsage", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("returns account: null when loggedIn is false, with window data still populated", async () => {
    execFileMock.mockImplementation((_bin, _args, _opts, callback) => {
      callback(null, JSON.stringify({ loggedIn: false }), "");
    });

    const snapshot = await fetchClaudeUsage();
    expect(snapshot.account).toBeNull();
    expect(snapshot.windows).toHaveLength(2);
    expect(snapshot.windows[0].label).toBe("Last 5 hours");
    expect(snapshot.windows[1].label).toBe("Last 7 days");
  });

  it("throws without leaking the raw response body on malformed auth status", async () => {
    const distinctiveSecret = "SECRET_TOKEN_abc123_should_not_leak";
    execFileMock.mockImplementation((_bin, _args, _opts, callback) => {
      // Missing the required `loggedIn` boolean -> schema failure.
      callback(
        null,
        JSON.stringify({ notLoggedIn: true, apiKey: distinctiveSecret }),
        "",
      );
    });

    await expect(fetchClaudeUsage()).rejects.toThrow();
    try {
      await fetchClaudeUsage();
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(distinctiveSecret);
    }
  });
});
