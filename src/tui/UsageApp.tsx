import { format, intervalToDuration } from "date-fns";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RateLimitWindow, UsageSnapshot } from "../types.js";
import { fetchCodexUsage } from "../usage.js";

// ── Spinner ──────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
}

// ── Bar ──────────────────────────────────────────────────────────────────────

function Bar({
  percent,
  color,
  suffix,
  width = 28,
}: {
  percent: number;
  color: string;
  suffix?: string;
  width?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return (
    <Box>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(empty)}</Text>
      {suffix && (
        <Text>
          {"  "}
          <Text dimColor>{suffix}</Text>
        </Text>
      )}
    </Box>
  );
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function formatResetTime(resetsAt: number): string {
  const date = new Date(resetsAt * 1000);
  const now = new Date();
  const msUntil = date.getTime() - now.getTime();

  if (msUntil <= 0) return "now";

  const dur = intervalToDuration({ start: now, end: date });
  const parts: string[] = [];
  if (dur.days && dur.days > 0) parts.push(`${dur.days}d`);
  if (dur.hours && dur.hours > 0) parts.push(`${dur.hours}h`);
  if (!dur.days && dur.minutes && dur.minutes > 0)
    parts.push(`${dur.minutes}m`);

  const relative = `in ${parts.join(" ")}`;
  const absolute = format(date, "MMM d 'at' h:mm a");
  return `${relative}  (${absolute})`;
}

function formatFetchTime(iso: string): string {
  return format(new Date(iso), "MMM d, h:mm a");
}

// ── Window card ───────────────────────────────────────────────────────────────

function WindowCard({
  label,
  window: win,
}: {
  label: string;
  window: RateLimitWindow;
}) {
  const remaining = Math.max(0, 100 - win.usedPercent);
  const quotaColor =
    remaining <= 20 ? "red" : remaining <= 40 ? "yellow" : "green";

  // Time remaining
  const now = Math.floor(Date.now() / 1000);
  const windowDurationSecs = win.windowDurationMins * 60;
  const secsLeft = Math.max(0, win.resetsAt - now);
  const timeRemainingPct = Math.min(
    100,
    Math.round((secsLeft / windowDurationSecs) * 100),
  );
  const timeColor =
    timeRemainingPct <= 25 ? "red" : timeRemainingPct <= 50 ? "yellow" : "cyan";

  const resetStr = formatResetTime(win.resetsAt);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      <Text bold color="white">
        {label}
      </Text>

      {/* ── Quota section ── */}
      <Box marginTop={1} flexDirection="column" gap={0}>
        <Bar
          percent={remaining}
          color={quotaColor}
          suffix={`${remaining}% quota remaining`}
        />
      </Box>

      {/* ── Time section ── */}
      <Box marginTop={1} flexDirection="column" gap={0}>
        <Bar
          percent={timeRemainingPct}
          color={timeColor}
          suffix={`${timeRemainingPct}% of window left`}
        />
        <Text dimColor>Resets {resetStr}</Text>
      </Box>
    </Box>
  );
}

// ── Watch countdown ───────────────────────────────────────────────────────────

function Countdown({ seconds }: { seconds: number }) {
  return (
    <Text dimColor>
      Refreshing in {seconds}s · press{" "}
      <Text color="cyan" bold>
        r
      </Text>{" "}
      to refresh ·{" "}
      <Text color="cyan" bold>
        q
      </Text>{" "}
      to quit
    </Text>
  );
}

// ── App state ─────────────────────────────────────────────────────────────────

type AppState =
  | { phase: "loading" }
  | { phase: "done"; snapshot: UsageSnapshot }
  | { phase: "error"; message: string };

// ── Main component ────────────────────────────────────────────────────────────

export function UsageApp({ watch }: { watch: boolean }) {
  const { exit, waitUntilRenderFlush } = useApp();
  const [state, setState] = useState<AppState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setRefreshing(true);
    try {
      const snapshot = await fetchCodexUsage();
      if (mountedRef.current) {
        setState({ phase: "done", snapshot });
        setCountdown(60);
      }
    } catch (err) {
      if (mountedRef.current) {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Auto-refresh and countdown in watch mode
  useEffect(() => {
    if (!watch || state.phase !== "done") return;

    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void load();
          return 60;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [watch, state.phase, load]);

  // Exit after first render when not in watch mode
  useEffect(() => {
    if (!watch && state.phase === "done") {
      void waitUntilRenderFlush().then(() => exit());
    }
  }, [watch, state.phase, exit, waitUntilRenderFlush]);

  // Keyboard handling
  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === "r" && watch && !refreshing) void load();
  });

  const snapshot = state.phase === "done" ? state.snapshot : null;
  const limit = snapshot?.selectedLimit ?? null;
  const account = snapshot?.account ?? null;
  const planType = limit?.planType ?? (account ? account.planType : null);
  const email =
    account && account !== null ? (account.email ?? account.type) : null;

  return (
    <Box flexDirection="column" marginX={1} marginY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ⚡ Codex Usage Limits
        </Text>
      </Box>

      {/* Loading state */}
      {state.phase === "loading" && (
        <Box>
          <Spinner />
          <Text dimColor> Loading usage data…</Text>
        </Box>
      )}

      {/* Error state */}
      {state.phase === "error" && (
        <Box flexDirection="column">
          <Text color="red" bold>
            ✖ Error
          </Text>
          <Text color="red">{state.message}</Text>
          {watch && (
            <Text dimColor>
              press{" "}
              <Text color="cyan" bold>
                r
              </Text>{" "}
              to retry ·{" "}
              <Text color="cyan" bold>
                q
              </Text>{" "}
              to quit
            </Text>
          )}
        </Box>
      )}

      {/* Success state */}
      {state.phase === "done" && snapshot && (
        <Box flexDirection="column">
          {snapshot.history?.warning && (
            <Box marginBottom={1} flexDirection="column">
              <Text color="yellow" bold>
                ⚠ History not updated
              </Text>
              <Text color="yellow">{snapshot.history.warning}</Text>
            </Box>
          )}

          {/* Account row */}
          <Box marginBottom={1} gap={1}>
            <Text dimColor>Account</Text>
            <Text>{email ?? "Unknown"}</Text>
            {planType && (
              <Text dimColor>
                · <Text color="yellow">{planType}</Text>
              </Text>
            )}
            {limit && (
              <Text dimColor>
                · bucket{" "}
                <Text color="blue">{limit.limitName ?? limit.limitId}</Text>
              </Text>
            )}
          </Box>

          {/* No limit returned */}
          {!limit?.primary && (
            <Box>
              <Text color="yellow">⚠ No rate-limit bucket returned.</Text>
            </Box>
          )}

          {/* 5h window */}
          {limit?.primary && (
            <WindowCard label="5h Window" window={limit.primary} />
          )}

          {/* 7d window */}
          {limit?.secondary && (
            <WindowCard label="7d Window" window={limit.secondary} />
          )}

          {/* Limit state warning */}
          {limit?.rateLimitReachedType && (
            <Box marginBottom={1}>
              <Text color="red">
                ⚠ Limit state: {limit.rateLimitReachedType}
              </Text>
            </Box>
          )}

          {/* Footer */}
          <Box marginTop={0}>
            {refreshing ? (
              <Box gap={1}>
                <Spinner />
                <Text dimColor>Refreshing…</Text>
              </Box>
            ) : watch ? (
              <Box flexDirection="column" gap={0}>
                <Text dimColor>
                  Fetched {formatFetchTime(snapshot.fetchedAt)}
                </Text>
                <Countdown seconds={countdown} />
              </Box>
            ) : (
              <Text dimColor>
                Fetched {formatFetchTime(snapshot.fetchedAt)}
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Render helper (called from cli.ts without JSX) ────────────────────────────

import { render } from "ink";

export function renderUsage(opts: {
  watch: boolean;
}): ReturnType<typeof render> {
  return render(<UsageApp watch={opts.watch} />);
}
