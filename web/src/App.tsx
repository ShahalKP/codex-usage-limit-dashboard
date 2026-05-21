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
  return new Date(timestampSeconds * 1000).toLocaleString();
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
  const used = selected?.primary?.usedPercent ?? null;
  const remaining = used === null ? null : clampPercent(100 - used);

  const accountLabel = useMemo(() => {
    if (!data?.account) return "Not logged in";
    const plan = data.account.planType ? ` · ${data.account.planType}` : "";
    return `${data.account.email ?? data.account.type}${plan}`;
  }, [data]);

  return (
    <main className="page">
      <section className="card">
        <div className="header">
          <div>
            <p className="eyebrow">Local Codex Monitor</p>
            <h1>Codex usage limit</h1>
          </div>
          <button onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="meta">
          <div>
            <span>Account</span>
            <strong>{accountLabel}</strong>
          </div>
          <div>
            <span>Bucket</span>
            <strong>{selected?.limitName ?? selected?.limitId ?? "Unknown"}</strong>
          </div>
          <div>
            <span>Fetched</span>
            <strong>{data ? new Date(data.fetchedAt).toLocaleString() : "—"}</strong>
          </div>
        </div>

        <div className="meterBlock">
          <div className="meterHeader">
            <span>Used</span>
            <strong>{used === null ? "—" : `${used}%`}</strong>
          </div>
          <div className="meter">
            <div style={{ width: `${used ?? 0}%` }} />
          </div>
        </div>

        <div className="meterBlock">
          <div className="meterHeader">
            <span>Remaining</span>
            <strong>{remaining === null ? "—" : `${remaining}%`}</strong>
          </div>
          <div className="meter remaining">
            <div style={{ width: `${remaining ?? 0}%` }} />
          </div>
        </div>

        <div className="details">
          <div>
            <span>Window</span>
            <strong>{selected?.primary?.windowDurationMins ?? "—"} minutes</strong>
          </div>
          <div>
            <span>Resets at</span>
            <strong>{formatReset(selected?.primary?.resetsAt)}</strong>
          </div>
          <div>
            <span>Limit state</span>
            <strong>{selected?.rateLimitReachedType ?? "OK"}</strong>
          </div>
        </div>

        {data?.allLimits?.length ? (
          <section className="allBuckets">
            <h2>All returned buckets</h2>
            <table>
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Used</th>
                  <th>Window</th>
                  <th>Reset</th>
                </tr>
              </thead>
              <tbody>
                {data.allLimits.map((limit) => (
                  <tr key={limit.limitId}>
                    <td>{limit.limitName ?? limit.limitId}</td>
                    <td>{limit.primary?.usedPercent ?? "—"}%</td>
                    <td>{limit.primary?.windowDurationMins ?? "—"} min</td>
                    <td>{formatReset(limit.primary?.resetsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
