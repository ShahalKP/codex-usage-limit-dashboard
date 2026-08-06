import { Box, Text, useApp } from "ink";
import { useEffect, useState } from "react";
import type { ClaudeUsageSnapshot, ClaudeUsageWindow } from "../types.js";
import { fetchClaudeUsage } from "../claudeUsage.js";

type AppState =
  | { phase: "loading" }
  | { phase: "done"; snapshot: ClaudeUsageSnapshot }
  | { phase: "error"; message: string };

function WindowSection({ window: win }: { window: ClaudeUsageWindow }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        {win.label}
      </Text>
      <Text dimColor>
        {win.responses.toLocaleString()} responses · in{" "}
        {win.inputTokens.toLocaleString()} · out{" "}
        {win.outputTokens.toLocaleString()} · cache write{" "}
        {win.cacheCreationTokens.toLocaleString()} · cache read{" "}
        {win.cacheReadTokens.toLocaleString()}
      </Text>
      {win.byModel.map((m) => (
        <Box key={m.model} marginLeft={2}>
          <Text dimColor>
            {m.model}: {m.responses.toLocaleString()} resp · in{" "}
            {m.inputTokens.toLocaleString()} · out{" "}
            {m.outputTokens.toLocaleString()}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function ClaudeUsageApp() {
  const { exit, waitUntilRenderFlush } = useApp();
  const [state, setState] = useState<AppState>({ phase: "loading" });

  useEffect(() => {
    let mounted = true;
    void fetchClaudeUsage()
      .then((snapshot) => {
        if (mounted) setState({ phase: "done", snapshot });
      })
      .catch((err: unknown) => {
        if (mounted) {
          setState({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (state.phase === "done" || state.phase === "error") {
      void waitUntilRenderFlush().then(() => {
        exit();
        if (state.phase === "error") process.exitCode = 1;
      });
    }
  }, [state.phase, exit, waitUntilRenderFlush]);

  if (state.phase === "loading") {
    return (
      <Box marginX={1} marginY={1}>
        <Text dimColor>Reading local Claude activity…</Text>
      </Box>
    );
  }

  if (state.phase === "error") {
    return (
      <Box marginX={1} marginY={1} flexDirection="column">
        <Text color="red" bold>
          ✖ Error
        </Text>
        <Text color="red">{state.message}</Text>
      </Box>
    );
  }

  const { snapshot } = state;
  const account = snapshot.account;

  return (
    <Box flexDirection="column" marginX={1} marginY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ⚡ Claude Usage (local)
        </Text>
      </Box>

      {account ? (
        <Box marginBottom={1} gap={1}>
          <Text dimColor>Account</Text>
          <Text>{account.email ?? "Unknown"}</Text>
          {account.subscriptionType && (
            <Text dimColor>
              · <Text color="yellow">{account.subscriptionType}</Text>
            </Text>
          )}
          {account.userRateLimitTier && (
            <Text dimColor>
              · tier <Text color="blue">{account.userRateLimitTier}</Text>
            </Text>
          )}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color="yellow">
            Not logged in. Run `claude auth login`, then retry.
          </Text>
        </Box>
      )}

      {snapshot.windows.map((win) => (
        <WindowSection key={win.label} window={win} />
      ))}

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          Scanned {snapshot.scan.filesScanned.toLocaleString()} files in{" "}
          {snapshot.scan.elapsedMs.toLocaleString()}ms
          {snapshot.scan.malformedLines > 0
            ? ` (${snapshot.scan.malformedLines} malformed lines skipped)`
            : ""}
        </Text>
        <Text dimColor>
          Rolling lookback over local logs — not a quota percentage.
        </Text>
        <Text dimColor>
          Local Claude Code activity on this machine only.
        </Text>
      </Box>
    </Box>
  );
}

// ── Render helper (called from cli.ts without JSX) ────────────────────────────

import { render } from "ink";

export function renderClaudeUsage(): ReturnType<typeof render> {
  return render(<ClaudeUsageApp />);
}
