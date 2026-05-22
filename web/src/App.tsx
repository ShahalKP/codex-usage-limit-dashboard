import { format, intervalToDuration } from "date-fns";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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

function WindowCard({
  label,
  win,
}: {
  label: string;
  win: RateLimitWindow;
}) {
  const remaining = clampPercent(100 - win.usedPercent);
  const timeLeft = windowTimeLeft(win);

  return (
    <section className="windowCard">
      <h2>{label}</h2>

      <div className="metricBlock">
        <div className="metricHeader">
          <span>Quota</span>
          <strong>{remaining}% quota remaining</strong>
        </div>
        <div className="meter" aria-label={`${label} quota remaining`}>
          <div
            className={`bar bar-${quotaTone(remaining)}`}
            style={{ width: `${remaining}%` }}
          />
        </div>
      </div>

      <div className="metricBlock">
        <div className="metricHeader">
          <span>Window</span>
          <strong>{timeLeft}% of window left</strong>
        </div>
        <div className="meter" aria-label={`${label} time remaining`}>
          <div
            className={`bar bar-${timeTone(timeLeft)}`}
            style={{ width: `${timeLeft}%` }}
          />
        </div>
        <p className="resetText">Resets {formatReset(win.resetsAt)}</p>
      </div>
    </section>
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
  ].filter((item): item is { label: string; win: RateLimitWindow } => item !== null);

  const accountLabel = useMemo(() => {
    if (!data?.account) return "Not logged in";
    return data.account.email ?? data.account.type;
  }, [data]);

  return (
    <main className="page">
      <section className="card">
        <div className="header">
          <div>
            <p className="eyebrow">Local Codex Monitor</p>
            <h1>Codex Usage Limits</h1>
          </div>
          <button onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="accountRow">
          <span>Account</span>
          <strong>{accountLabel}</strong>
          {planType ? <em>· {planType}</em> : null}
          {selected ? (
            <em>· bucket {selected.limitName ?? selected.limitId}</em>
          ) : null}
        </div>

        {!selected?.primary ? (
          <div className="emptyState">No rate-limit bucket returned.</div>
        ) : (
          <div className="windowsGrid">
            {windows.map(({ label, win }) => (
              <WindowCard key={label} label={label} win={win} />
            ))}
          </div>
        )}

        {selected?.rateLimitReachedType ? (
          <div className="warning">Limit state: {selected.rateLimitReachedType}</div>
        ) : null}

        <div className="footer">
          <span>Fetched {formatFetchTime(data?.fetchedAt)}</span>
          {loading ? <span>Refreshing…</span> : <span>Auto-refreshes every 60s</span>}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
