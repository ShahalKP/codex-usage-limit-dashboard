import { format, intervalToDuration } from "date-fns";
import {
  AlertTriangleIcon,
  CircleAlertIcon,
  RefreshCwIcon,
  Trash2Icon,
  TrendingUpIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Loader from "./components/kokonutui/loader.js";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import "./styles.css";

type HistoryRange = "24h" | "7d" | "30d" | "all";
type HistoryWindowSelection = "primary" | "secondary";

type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

type CodexRateLimit = {
  limitId: string;
  limitName?: string | null;
  planType?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: unknown;
  rateLimitReachedType?: string | null;
};

type UsageHistoryStatus = {
  persisted: boolean;
  action: "inserted" | "coalesced" | null;
  warning: string | null;
};

type UsageSnapshot = {
  fetchedAt: string;
  account: null | {
    type: string;
    email?: string;
    planType?: string | null;
  };
  selectedLimit: CodexRateLimit | null;
  allLimits: CodexRateLimit[];
  history?: UsageHistoryStatus;
};

type HistoryEvent = UsageSnapshot & {
  fingerprint: string;
  firstSeenAt: string;
  id: number;
  lastSeenAt: string;
  occurrenceCount: number;
};

type HistoryResponse = {
  events: HistoryEvent[];
  range: HistoryRange;
  totalEventCount: number;
};

type TrendPoint = {
  label: string;
  timestamp: string;
  value: number;
};

const HISTORY_RANGES: Array<{ label: string; value: HistoryRange }> = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatReset(timestampSeconds?: number): string {
  if (!timestampSeconds) return "Unknown";

  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const msUntil = date.getTime() - now.getTime();

  if (msUntil <= 0) return "now";

  const duration = intervalToDuration({ start: now, end: date });
  const parts: string[] = [];

  if (duration.days && duration.days > 0) parts.push(`${duration.days}d`);
  if (duration.hours && duration.hours > 0) parts.push(`${duration.hours}h`);
  if (!duration.days && duration.minutes && duration.minutes > 0) {
    parts.push(`${duration.minutes}m`);
  }

  const relative = parts.length > 0 ? `in ${parts.join(" ")}` : "now";
  const absolute = format(date, "MMM d 'at' h:mm a");
  return `${relative} (${absolute})`;
}

function formatFetchTime(iso?: string): string {
  if (!iso) return "-";
  return format(new Date(iso), "MMM d, h:mm a");
}

function windowTimeLeft(win: RateLimitWindow): number {
  const now = Math.floor(Date.now() / 1000);
  const windowDurationSecs = win.windowDurationMins * 60;
  const secsLeft = Math.max(0, win.resetsAt - now);

  if (windowDurationSecs <= 0) return 0;

  return Math.min(100, Math.round((secsLeft / windowDurationSecs) * 100));
}

function formatWindowLabel(mins: number): string {
  if (mins >= 1440) return `${Math.round(mins / 1440)}d Window`;
  if (mins >= 60) return `${Math.round(mins / 60)}h Window`;
  return `${mins}m Window`;
}

function humanizeRateLimitType(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatObservedInterval(
  firstSeenAt: string,
  lastSeenAt: string,
): string {
  return `${format(new Date(firstSeenAt), "MMM d, h:mm a")} to ${format(new Date(lastSeenAt), "MMM d, h:mm a")}`;
}

function historyRangeLabel(range: HistoryRange): string {
  if (range === "all") return "all recorded history";
  return `the last ${range}`;
}

function remainingForWindow(
  event: HistoryEvent,
  selection: HistoryWindowSelection,
): number | null {
  const window =
    selection === "primary"
      ? (event.selectedLimit?.primary ?? null)
      : (event.selectedLimit?.secondary ?? null);

  if (!window) return null;
  return clampPercent(100 - window.usedPercent);
}

function resolveHistoryWindowLabel(
  events: HistoryEvent[],
  selection: HistoryWindowSelection,
): string {
  for (const event of events) {
    const window =
      selection === "primary"
        ? (event.selectedLimit?.primary ?? null)
        : (event.selectedLimit?.secondary ?? null);
    if (window) {
      return formatWindowLabel(window.windowDurationMins).replace(
        " Window",
        "",
      );
    }
  }

  return selection === "primary" ? "Primary" : "Secondary";
}

function buildTrendPoints(
  events: HistoryEvent[],
  selection: HistoryWindowSelection,
): TrendPoint[] {
  return [...events]
    .reverse()
    .map((event) => {
      const value = remainingForWindow(event, selection);

      if (value === null) {
        return null;
      }

      return {
        label: format(new Date(event.lastSeenAt), "MMM d"),
        timestamp: event.lastSeenAt,
        value,
      };
    })
    .filter((point): point is TrendPoint => point !== null);
}

function WindowCard({ label, win }: { label: string; win: RateLimitWindow }) {
  const remaining = clampPercent(100 - win.usedPercent);
  const timeLeft = windowTimeLeft(win);

  return (
    <div
      className="wc2"
      style={
        {
          "--quota-col":
            remaining <= 20
              ? "oklch(70% 0.19 22)"
              : remaining <= 40
                ? "oklch(84% 0.18 88)"
                : "oklch(74% 0.18 142)",
          "--time-col":
            timeLeft <= 25
              ? "oklch(70% 0.19 22)"
              : timeLeft <= 50
                ? "oklch(84% 0.18 88)"
                : "oklch(72% 0.14 222)",
        } as React.CSSProperties
      }
    >
      <div className="wc2-header">{label}</div>
      <div className="wc2-cols">
        <div className="wc2-left">
          <span className="wc2-col-lbl">Quota</span>
          <div className="wc2-num wc2-num-q">{remaining}</div>
          <div className="wc2-sub-lbl">% remaining</div>
          <div className="wc2-track">
            <div
              className="wc2-fill wc2-fill-q"
              style={{ width: `${remaining}%` }}
            />
          </div>
        </div>
        <div className="wc2-sep" />
        <div className="wc2-right">
          <span className="wc2-col-lbl">Window</span>
          <div className="wc2-num wc2-num-t">{timeLeft}</div>
          <div className="wc2-sub-lbl">% left</div>
          <div className="wc2-track">
            <div
              className="wc2-fill wc2-fill-t"
              style={{ width: `${timeLeft}%` }}
            />
          </div>
          <div className="wc2-reset">Resets {formatReset(win.resetsAt)}</div>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-background/35 px-4 text-center text-sm text-muted-foreground">
        No window observations are available for this range yet.
      </div>
    );
  }

  const width = 600;
  const height = 220;
  const padding = 18;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(1, maxValue - minValue);
  const denominator = Math.max(1, points.length - 1);

  const coordinates = points.map((point, index) => {
    const x = padding + (index / denominator) * (width - padding * 2);
    const y =
      height -
      padding -
      ((point.value - minValue) / span) * (height - padding * 2);

    return { ...point, x, y };
  });

  const polyline = coordinates
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const area = `${polyline} ${coordinates[coordinates.length - 1].x},${height - padding} ${coordinates[0].x},${height - padding}`;

  return (
    <div className="rounded-2xl border border-border/50 bg-background/35 p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full overflow-visible"
      >
        <defs>
          <linearGradient id="history-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(82% 0.12 222 / 0.42)" />
            <stop offset="100%" stopColor="oklch(82% 0.12 222 / 0.05)" />
          </linearGradient>
        </defs>

        {[0, 25, 50, 75, 100].map((tick) => {
          const y = height - padding - (tick / 100) * (height - padding * 2);
          return (
            <g key={tick}>
              <line
                x1={padding}
                x2={width - padding}
                y1={y}
                y2={y}
                stroke="oklch(62% 0.022 222 / 0.16)"
                strokeDasharray="4 8"
              />
              <text
                fill="oklch(62% 0.022 222)"
                fontSize="11"
                textAnchor="end"
                x={padding - 6}
                y={y + 4}
              >
                {tick}%
              </text>
            </g>
          );
        })}

        <polygon fill="url(#history-trend-fill)" points={area} />
        <polyline
          fill="none"
          points={polyline}
          stroke="oklch(82% 0.12 222)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />

        {coordinates.map((point, index) => (
          <g key={`${point.timestamp}-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              fill="oklch(10% 0.022 222)"
              r="5"
              stroke="oklch(82% 0.12 222)"
              strokeWidth="2"
            />
          </g>
        ))}
      </svg>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatFetchTime(points[0]?.timestamp)}</span>
        <span>{formatFetchTime(points[points.length - 1]?.timestamp)}</span>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("24h");
  const [historyWindow, setHistoryWindow] =
    useState<HistoryWindowSelection>("primary");
  const [cleanupNotice, setCleanupNotice] = useState<string | null>(null);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const usageAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);

  const refreshUsage = useCallback(async () => {
    usageAbortRef.current?.abort();
    const controller = new AbortController();
    usageAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/codex/rate-limits", {
        signal: controller.signal,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Failed to fetch Codex rate limits.");
      }

      setData(body);
      const primary = body.selectedLimit?.primary;
      const secondary = body.selectedLimit?.secondary;
      const parts: string[] = [];
      if (primary) {
        parts.push(
          `${formatWindowLabel(primary.windowDurationMins)}: ${clampPercent(100 - primary.usedPercent)}% quota remaining`,
        );
      }
      if (secondary) {
        parts.push(
          `${formatWindowLabel(secondary.windowDurationMins)}: ${clampPercent(100 - secondary.usedPercent)}% quota remaining`,
        );
      }
      setLiveAnnouncement(
        parts.length > 0
          ? `Data updated. ${parts.join(". ")}.`
          : "Data updated.",
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(async (range: HistoryRange) => {
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;

    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const response = await fetch(
        `/api/codex/history?range=${encodeURIComponent(range)}&limit=12`,
        {
          signal: controller.signal,
        },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Failed to fetch history.");
      }

      setHistoryData(body);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshUsage();
    await refreshHistory(historyRange);
  }, [historyRange, refreshHistory, refreshUsage]);

  const handleCleanup = useCallback(
    async (range: HistoryRange) => {
      const message =
        range === "all"
          ? "Delete all saved local history? This removes every coalesced interval from the SQLite store."
          : `Delete coalesced history observed in ${historyRangeLabel(range)}? This cannot be undone.`;

      if (!window.confirm(message)) {
        return;
      }

      setCleanupPending(true);
      setCleanupNotice(null);

      try {
        const response = await fetch("/api/codex/history", {
          body: JSON.stringify({ range }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Failed to clear history.");
        }

        setCleanupNotice(
          `Deleted ${body.deletedCount} coalesced ${body.deletedCount === 1 ? "event" : "events"} from ${range === "all" ? "all history" : historyRangeLabel(range)}.`,
        );
        await refreshHistory(historyRange);
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : String(err));
      } finally {
        setCleanupPending(false);
      }
    },
    [historyRange, refreshHistory],
  );

  useEffect(() => {
    void refreshUsage();

    return () => {
      usageAbortRef.current?.abort();
    };
  }, [refreshUsage]);

  useEffect(() => {
    void refreshHistory(historyRange);

    return () => {
      historyAbortRef.current?.abort();
    };
  }, [historyRange, refreshHistory]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshAll();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshAll]);

  const selected = data?.selectedLimit ?? null;
  const planType = selected?.planType ?? data?.account?.planType ?? null;
  const windows = useMemo(
    () =>
      [
        selected?.primary
          ? {
              label: formatWindowLabel(selected.primary.windowDurationMins),
              win: selected.primary,
            }
          : null,
        selected?.secondary
          ? {
              label: formatWindowLabel(selected.secondary.windowDurationMins),
              win: selected.secondary,
            }
          : null,
      ].filter(
        (item): item is { label: string; win: RateLimitWindow } =>
          item !== null,
      ),
    [selected],
  );

  const accountLabel = useMemo(() => {
    if (!data?.account) return "Not logged in";
    return data.account.email ?? data.account.type;
  }, [data]);

  const trendPoints = useMemo(
    () => buildTrendPoints(historyData?.events ?? [], historyWindow),
    [historyData, historyWindow],
  );

  const historyWindowLabel = useMemo(
    () => resolveHistoryWindowLabel(historyData?.events ?? [], historyWindow),
    [historyData, historyWindow],
  );

  const latestTrendValue = trendPoints.length
    ? (trendPoints[trendPoints.length - 1]?.value ?? null)
    : null;
  const lowestTrendValue = trendPoints.length
    ? Math.min(...trendPoints.map((point) => point.value))
    : null;
  const averageTrendValue = trendPoints.length
    ? Math.round(
        trendPoints.reduce((sum, point) => sum + point.value, 0) /
          trendPoints.length,
      )
    : null;

  const showInitialLoader = loading && !data && !error;

  if (showInitialLoader) {
    return (
      <main className="min-h-svh px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70svh] w-full max-w-6xl items-center justify-center">
          <Loader
            size="lg"
            title="Fetching Codex usage..."
            subtitle="Reading your current rate-limit windows and account status"
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </span>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-border/50 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold tracking-[0.22em] text-primary uppercase">
              Local Codex Monitor
            </p>
            <h1 className="font-mono text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Codex Usage Limits
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Current quota remains the primary view. History below shows
              coalesced intervals, so repeated identical refreshes read as one
              observed state instead of poll noise.
            </p>
          </div>

          <Button
            onClick={refreshAll}
            disabled={loading || cleanupPending}
            variant="outline"
            className="sm:self-start"
          >
            <RefreshCwIcon
              data-icon="inline-start"
              className={loading ? "animate-spin" : undefined}
            />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </header>

        <section
          aria-label="Account information"
          className="grid gap-3 rounded-xl border border-border/50 bg-card/65 p-4 md:grid-cols-3"
        >
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Account
            </p>
            <p className="font-mono font-medium text-foreground">
              {accountLabel}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Plan / Bucket
            </p>
            <p className="font-mono font-medium text-foreground">
              {planType ?? "Unknown"}
              {selected ? ` · ${selected.limitName ?? selected.limitId}` : ""}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Fetched
            </p>
            <p className="font-mono font-medium text-foreground">
              {formatFetchTime(data?.fetchedAt)}
            </p>
          </div>
        </section>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {data?.history?.warning ? (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>History not updated</AlertTitle>
            <AlertDescription>{data.history.warning}</AlertDescription>
          </Alert>
        ) : null}

        {!selected?.primary ? (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>No rate-limit bucket returned</AlertTitle>
            <AlertDescription>
              The Codex API responded without a primary usage window.
            </AlertDescription>
          </Alert>
        ) : (
          <section
            aria-label="Quota windows"
            className="grid gap-4 lg:grid-cols-2"
          >
            {windows.map(({ label, win }) => (
              <WindowCard key={label} label={label} win={win} />
            ))}
          </section>
        )}

        {selected?.rateLimitReachedType ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Limit state reported</AlertTitle>
            <AlertDescription>
              {humanizeRateLimitType(selected.rateLimitReachedType)}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="rounded-[28px] border border-border/50 bg-card/72 p-5 shadow-[0_24px_64px_oklch(5%_0.02_222_/_0.28)]">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex max-w-2xl flex-col gap-2">
                <p className="text-xs font-semibold tracking-[0.22em] text-primary uppercase">
                  Observed History
                </p>
                <h2 className="font-mono text-3xl font-semibold tracking-tight text-foreground">
                  Recent quota change intervals
                </h2>
                <p className="text-sm text-muted-foreground">
                  Each row describes when a state was seen from its first
                  successful fetch to its last identical refresh. Cleanup is
                  explicit and local-only.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {HISTORY_RANGES.map((range) => (
                  <Button
                    key={range.value}
                    type="button"
                    size="sm"
                    variant={
                      historyRange === range.value ? "secondary" : "ghost"
                    }
                    onClick={() => setHistoryRange(range.value)}
                  >
                    {range.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-background/45 px-3 py-1 font-medium text-foreground">
                  {historyLoading
                    ? "Refreshing history…"
                    : `${historyData?.totalEventCount ?? 0} coalesced ${historyData?.totalEventCount === 1 ? "event" : "events"}`}
                </span>
                {historyData?.events[0] ? (
                  <span className="rounded-full border border-border/40 bg-background/35 px-3 py-1">
                    Latest interval ended{" "}
                    {formatFetchTime(historyData.events[0].lastSeenAt)}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={
                    historyWindow === "primary" ? "secondary" : "outline"
                  }
                  onClick={() => setHistoryWindow("primary")}
                >
                  Primary trend
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    historyWindow === "secondary" ? "secondary" : "outline"
                  }
                  onClick={() => setHistoryWindow("secondary")}
                >
                  Secondary trend
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    cleanupPending || (historyData?.totalEventCount ?? 0) === 0
                  }
                  onClick={() => void handleCleanup(historyRange)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Clear {historyRangeLabel(historyRange)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={
                    cleanupPending || (historyData?.totalEventCount ?? 0) === 0
                  }
                  onClick={() => void handleCleanup("all")}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Clear all history
                </Button>
              </div>
            </div>

            {cleanupNotice ? (
              <Alert>
                <CircleAlertIcon />
                <AlertTitle>Cleanup complete</AlertTitle>
                <AlertDescription>{cleanupNotice}</AlertDescription>
              </Alert>
            ) : null}

            {historyError ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>History unavailable</AlertTitle>
                <AlertDescription>{historyError}</AlertDescription>
              </Alert>
            ) : null}

            {historyLoading && !historyData ? (
              <div className="rounded-2xl border border-border/50 bg-background/35 p-6">
                <Loader
                  size="md"
                  title="Loading history..."
                  subtitle="Querying recent coalesced intervals from local storage"
                />
              </div>
            ) : null}

            {!historyLoading &&
            !historyError &&
            (historyData?.totalEventCount ?? 0) === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/35 p-6">
                <p className="text-sm font-medium text-foreground">
                  No saved history for {historyRangeLabel(historyRange)}.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Successful refreshes are stored automatically. Once a snapshot
                  is saved, this section will chart quota remaining and list the
                  observed intervals.
                </p>
              </div>
            ) : null}

            {!historyError && historyData && historyData.totalEventCount > 0 ? (
              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <section className="rounded-2xl border border-border/50 bg-background/35 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                        Remaining quota trend
                      </p>
                      <h3 className="font-mono text-2xl font-semibold text-foreground">
                        {historyWindowLabel}
                      </h3>
                    </div>
                    <TrendingUpIcon className="size-5 text-primary" />
                  </div>

                  <div className="mt-4">
                    <TrendChart points={trendPoints} />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-border/50 bg-background/40 p-3">
                      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                        Latest
                      </p>
                      <p className="mt-2 font-mono text-2xl text-foreground">
                        {latestTrendValue === null
                          ? "--"
                          : `${latestTrendValue}%`}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-background/40 p-3">
                      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                        Lowest
                      </p>
                      <p className="mt-2 font-mono text-2xl text-foreground">
                        {lowestTrendValue === null
                          ? "--"
                          : `${lowestTrendValue}%`}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-background/40 p-3">
                      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                        Average
                      </p>
                      <p className="mt-2 font-mono text-2xl text-foreground">
                        {averageTrendValue === null
                          ? "--"
                          : `${averageTrendValue}%`}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/50 bg-background/35 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                      Recent intervals
                    </p>
                    <h3 className="font-mono text-2xl font-semibold text-foreground">
                      Meaningful changes only
                    </h3>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {historyData.events.map((event) => {
                      const primaryRemaining = remainingForWindow(
                        event,
                        "primary",
                      );
                      const secondaryRemaining = remainingForWindow(
                        event,
                        "secondary",
                      );

                      return (
                        <article
                          key={event.id}
                          className="rounded-2xl border border-border/50 bg-background/40 p-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex flex-col gap-1">
                              <p className="font-mono text-sm text-foreground">
                                {formatObservedInterval(
                                  event.firstSeenAt,
                                  event.lastSeenAt,
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Seen {event.occurrenceCount}{" "}
                                {event.occurrenceCount === 1 ? "time" : "times"}{" "}
                                ·{" "}
                                {event.account?.email ??
                                  event.account?.type ??
                                  "Unknown account"}{" "}
                                ·{" "}
                                {event.selectedLimit?.limitName ??
                                  event.selectedLimit?.limitId ??
                                  "No selected bucket"}
                              </p>
                            </div>

                            <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                              {event.occurrenceCount} observations
                            </span>
                          </div>

                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <div className="rounded-xl border border-border/40 bg-background/35 p-3">
                              <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                                Primary window
                              </p>
                              <p className="mt-2 font-mono text-lg text-foreground">
                                {primaryRemaining === null
                                  ? "Unavailable"
                                  : `${primaryRemaining}% remaining`}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {event.selectedLimit?.primary
                                  ? `Resets ${formatReset(event.selectedLimit.primary.resetsAt)}`
                                  : "No primary usage window in this snapshot."}
                              </p>
                            </div>

                            <div className="rounded-xl border border-border/40 bg-background/35 p-3">
                              <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                                Secondary window
                              </p>
                              <p className="mt-2 font-mono text-lg text-foreground">
                                {secondaryRemaining === null
                                  ? "Unavailable"
                                  : `${secondaryRemaining}% remaining`}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {event.selectedLimit?.secondary
                                  ? `Resets ${formatReset(event.selectedLimit.secondary.resetsAt)}`
                                  : "No secondary usage window in this snapshot."}
                              </p>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </section>

        <footer className="flex items-center justify-between border-t border-border/30 pt-4 font-sans text-[11px] text-muted-foreground">
          <span>Auto-refreshes every 60s</span>
          <span>Last fetch: {formatFetchTime(data?.fetchedAt)}</span>
        </footer>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
