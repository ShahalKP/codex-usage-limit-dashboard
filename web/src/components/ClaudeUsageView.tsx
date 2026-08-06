import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Loader from "./kokonutui/loader.js";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

// Self-contained types for the web layer — do not import from src/.
type ClaudeModelUsage = {
  model: string;
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

type ClaudeUsageWindow = {
  label: string;
  lookbackMins: number;
  since: string;
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  byModel: ClaudeModelUsage[];
};

type ClaudeAccount = null | {
  type: "claude";
  email?: string;
  orgName?: string | null;
  subscriptionType?: string | null;
  userRateLimitTier?: string | null;
  organizationRateLimitTier?: string | null;
};

type ClaudeUsageSnapshot = {
  fetchedAt: string;
  account: ClaudeAccount;
  windows: ClaudeUsageWindow[];
  scan: {
    filesScanned: number;
    responsesCounted: number;
    malformedLines: number;
    elapsedMs: number;
  };
};

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function ModelTable({ byModel }: { byModel: ClaudeModelUsage[] }) {
  if (byModel.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No activity in this window.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            <th className="py-1 pr-3">Model</th>
            <th className="py-1 pr-3">Responses</th>
            <th className="py-1 pr-3">Input</th>
            <th className="py-1 pr-3">Output</th>
            <th className="py-1 pr-3">Cache write</th>
            <th className="py-1">Cache read</th>
          </tr>
        </thead>
        <tbody>
          {byModel.map((m) => (
            <tr key={m.model} className="border-t border-border/40 font-mono">
              <td className="py-1 pr-3 text-foreground">{m.model}</td>
              <td className="py-1 pr-3">{formatNumber(m.responses)}</td>
              <td className="py-1 pr-3">{formatNumber(m.inputTokens)}</td>
              <td className="py-1 pr-3">{formatNumber(m.outputTokens)}</td>
              <td className="py-1 pr-3">{formatNumber(m.cacheCreationTokens)}</td>
              <td className="py-1">{formatNumber(m.cacheReadTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WindowCard({ win }: { win: ClaudeUsageWindow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{win.label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase">Responses</p>
            <p className="font-mono font-medium text-foreground">
              {formatNumber(win.responses)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Input tokens</p>
            <p className="font-mono font-medium text-foreground">
              {formatNumber(win.inputTokens)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Output tokens</p>
            <p className="font-mono font-medium text-foreground">
              {formatNumber(win.outputTokens)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">
              Cache write / read
            </p>
            <p className="font-mono font-medium text-foreground">
              {formatNumber(win.cacheCreationTokens)} /{" "}
              {formatNumber(win.cacheReadTokens)}
            </p>
          </div>
        </div>
        <ModelTable byModel={win.byModel} />
      </CardContent>
    </Card>
  );
}

export function ClaudeUsageView() {
  const [data, setData] = useState<ClaudeUsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/claude/usage");
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      setData(body as ClaudeUsageSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const account = data?.account ?? null;

  if (loading && !data && !error) {
    return (
      <main className="min-h-svh px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70svh] w-full max-w-6xl items-center justify-center">
          <Loader
            size="lg"
            title="Reading local Claude activity..."
            subtitle="Scanning session transcripts under ~/.claude/projects"
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-border/50 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold tracking-[0.22em] text-primary uppercase">
              Local Claude Code Monitor
            </p>
            <h1 className="font-mono text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Claude Usage
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Rolling lookback over local logs — not a quota percentage.
              <br />
              Local Claude Code activity on this machine only.
            </p>
          </div>

          <Button onClick={() => void load()} disabled={loading} variant="outline" className="sm:self-start">
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
              {account?.email ?? "Unknown"}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Subscription / Tier
            </p>
            <p className="font-mono font-medium text-foreground">
              {account?.subscriptionType ?? "Unknown"}
              {account?.userRateLimitTier ? ` · ${account.userRateLimitTier}` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Scanned
            </p>
            <p className="font-mono font-medium text-foreground">
              {data ? `${formatNumber(data.scan.filesScanned)} files · ${formatNumber(data.scan.elapsedMs)}ms` : "-"}
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

        {!account ? (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>Not logged in</AlertTitle>
            <AlertDescription>
              Run `claude auth login`, then refresh. Local activity below is
              still shown.
            </AlertDescription>
          </Alert>
        ) : null}

        {data ? (
          <section aria-label="Usage windows" className="grid gap-4 lg:grid-cols-2">
            {data.windows.map((win) => (
              <WindowCard key={win.label} win={win} />
            ))}
          </section>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          Rolling lookback over local logs — not a quota percentage. Local
          Claude Code activity on this machine only.
        </p>
      </div>
    </main>
  );
}
