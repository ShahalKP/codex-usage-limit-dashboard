import { format, intervalToDuration } from "date-fns";
import {
  AlertTriangleIcon,
  CircleAlertIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card.js";
import { Progress } from "./components/ui/progress.js";
import { cn } from "./lib/utils.js";
import "./styles.css";

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

type UsageSnapshot = {
  fetchedAt: string;
  account: null | {
    type: string;
    email?: string;
    planType?: string | null;
  };
  selectedLimit: CodexRateLimit | null;
  allLimits: CodexRateLimit[];
};

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

function quotaTone(remaining: number): "good" | "warn" | "danger" {
  if (remaining <= 20) return "danger";
  if (remaining <= 40) return "warn";
  return "good";
}

function timeTone(percentLeft: number): "info" | "warn" | "danger" {
  if (percentLeft <= 25) return "danger";
  if (percentLeft <= 50) return "warn";
  return "info";
}

function windowTimeLeft(win: RateLimitWindow): number {
  const now = Math.floor(Date.now() / 1000);
  const windowDurationSecs = win.windowDurationMins * 60;
  const secsLeft = Math.max(0, win.resetsAt - now);

  if (windowDurationSecs <= 0) return 0;

  return Math.min(100, Math.round((secsLeft / windowDurationSecs) * 100));
}

function quotaProgressClass(remaining: number): string {
  if (remaining <= 20) {
    return "[&>[data-slot=progress-indicator]]:bg-destructive";
  }

  if (remaining <= 40) {
    return "[&>[data-slot=progress-indicator]]:bg-warning";
  }

  return "[&>[data-slot=progress-indicator]]:bg-success";
}

function timeProgressClass(percentLeft: number): string {
  if (percentLeft <= 25) {
    return "[&>[data-slot=progress-indicator]]:bg-destructive";
  }

  if (percentLeft <= 50) {
    return "[&>[data-slot=progress-indicator]]:bg-warning";
  }

  return "[&>[data-slot=progress-indicator]]:bg-info";
}

function WindowCard({ label, win }: { label: string; win: RateLimitWindow }) {
  const remaining = clampPercent(100 - win.usedPercent);
  const timeLeft = windowTimeLeft(win);

  return (
    <Card size="sm" className="border-border/60 bg-background/55 shadow-none">
      <CardHeader className="border-b border-border/45">
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          {win.windowDurationMins} minute quota window
        </CardDescription>
        <CardAction className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          {remaining}% left
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            <span className="mb-0">Quota</span>
            <span className="mb-0">{remaining}% quota remaining</span>
          </div>
          <Progress
            value={remaining}
            aria-label={`${label} quota remaining`}
            className={cn("h-2 bg-muted/80", quotaProgressClass(remaining))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            <span className="mb-0">Window</span>
            <span className="mb-0">{timeLeft}% of window left</span>
          </div>
          <Progress
            value={timeLeft}
            aria-label={`${label} time remaining`}
            className={cn("h-2 bg-muted/80", timeProgressClass(timeLeft))}
          />
          <p className="text-xs text-muted-foreground">
            Resets {formatReset(win.resetsAt)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function App() {
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/codex/rate-limits");
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Failed to fetch Codex rate limits.");
      }

      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const selected = data?.selectedLimit ?? null;
  const planType = selected?.planType ?? data?.account?.planType ?? null;
  const windows = [
    selected?.primary ? { label: "5h Window", win: selected.primary } : null,
    selected?.secondary
      ? { label: "7d Window", win: selected.secondary }
      : null,
  ].filter(
    (item): item is { label: string; win: RateLimitWindow } => item !== null,
  );

  const accountLabel = useMemo(() => {
    if (!data?.account) return "Not logged in";
    return data.account.email ?? data.account.type;
  }, [data]);

  return (
    <main className="min-h-svh px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Card className="border-border/60 bg-card/95 shadow-2xl shadow-black/30 backdrop-blur-sm">
          <CardHeader className="gap-4 border-b border-border/50">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-[0.22em] text-primary uppercase">
                  Local Codex Monitor
                </p>
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-3xl sm:text-4xl">
                    Codex Usage Limits
                  </CardTitle>
                  <CardDescription>
                    Dashboard view aligned to the CLI windows, quota remaining,
                    and relative reset timing.
                  </CardDescription>
                </div>
              </div>

              <Button
                onClick={refresh}
                disabled={loading}
                variant="outline"
                className="sm:self-start"
              >
                <RefreshCwIcon
                  data-icon="inline-start"
                  className={loading ? "animate-spin" : undefined}
                />
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-6 pt-6">
            <section className="grid gap-3 rounded-xl border border-border/50 bg-background/55 p-4 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Account
                </p>
                <p className="font-medium text-foreground">{accountLabel}</p>
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Plan / Bucket
                </p>
                <p className="font-medium text-foreground">
                  {planType ?? "Unknown"}
                  {selected
                    ? ` · ${selected.limitName ?? selected.limitId}`
                    : ""}
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Fetched
                </p>
                <p className="font-medium text-foreground">
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

            {!selected?.primary ? (
              <Alert>
                <CircleAlertIcon />
                <AlertTitle>No rate-limit bucket returned</AlertTitle>
                <AlertDescription>
                  The Codex API responded without a primary usage window.
                </AlertDescription>
              </Alert>
            ) : (
              <section className="grid gap-4 lg:grid-cols-2">
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
                  {selected.rateLimitReachedType}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>

          <CardFooter className="flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <p>Fetched {formatFetchTime(data?.fetchedAt)}</p>
            <p>{loading ? "Refreshing…" : "Auto-refreshes every 60s"}</p>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
