import { PassThrough } from "node:stream";
import { render } from "ink";
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import type { RateLimitWindow } from "../types.js";
import { fetchCodexUsage } from "../usage.js";
import { UsageApp } from "./UsageApp.js";

vi.mock("../usage.js", () => ({ fetchCodexUsage: vi.fn() }));

function quotaWindow(minutes: number): RateLimitWindow {
  return { windowDurationMins: minutes, usedPercent: 23, resetsAt: 1_800_000_000 };
}

it.each([
  { primary: quotaWindow(10_080), secondary: null, labels: ["7d Window"] },
  {
    primary: quotaWindow(300),
    secondary: quotaWindow(10_080),
    labels: ["5h Window", "7d Window"],
  },
  { primary: null, secondary: quotaWindow(90), labels: ["90m Window"] },
  { primary: null, secondary: null, labels: [] },
])("renders only the reported quota windows ($labels)", async ({ primary, secondary, labels }) => {
  vi.mocked(fetchCodexUsage).mockResolvedValue({
    account: null,
    fetchedAt: "2026-11-18T21:25:00.000Z",
    selectedLimit: { limitId: "codex", primary, secondary },
    allLimits: [],
  });

  const stdin = Object.assign(new PassThrough(), {
    isTTY: true as const,
    setRawMode: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
  });
  const stdout = new PassThrough().setEncoding("utf8");
  let output = "";
  stdout.on("data", (chunk: string) => {
    output += chunk;
  });

  const app = render(createElement(UsageApp, { watch: false }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    interactive: false,
    patchConsole: false,
  });
  try {
    await app.waitUntilExit();
    expect(output.match(/\b\d+[dhm] Window\b/g) ?? []).toEqual(labels);
    expect(output.includes("No rate-limit windows returned.")).toBe(labels.length === 0);
  } finally {
    app.unmount();
  }
});
