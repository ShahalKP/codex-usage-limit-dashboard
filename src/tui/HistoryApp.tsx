import { Box, Text, render, useApp } from "ink";
import { useEffect } from "react";
import {
  describeHistoryWindow,
  formatHistoryHeading,
  formatHistoryInterval,
  formatHistoryMetadata,
  parseHistoryWindowSelection,
  resolveHistoryLayout,
  selectHistoryWindows,
  type HistoryWindowSelection,
} from "../history/cli.js";
import type { HistoryListResult } from "../history/types.js";

function Bar({
  color,
  percent,
  width,
}: {
  color: string;
  percent: number;
  width: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);

  return (
    <Box>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(empty)}</Text>
    </Box>
  );
}

function HistoryWindowRow({
  compact,
  label,
  width,
  window,
}: {
  compact: boolean;
  label: string;
  width: number;
  window: {
    resetsAt: number;
    usedPercent: number;
    windowDurationMins: number;
  } | null;
}) {
  const summary = describeHistoryWindow(window);

  if (summary.remaining === null) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text bold color="yellow">
          {label}
        </Text>
        <Text dimColor>Unavailable in this snapshot</Text>
      </Box>
    );
  }

  const color =
    summary.remaining <= 20
      ? "red"
      : summary.remaining <= 40
        ? "yellow"
        : "green";

  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text bold color="cyan">
          {label}
        </Text>
        <Text dimColor>
          {"  "}
          {summary.remaining}% remaining
        </Text>
      </Text>
      <Bar color={color} percent={summary.remaining} width={width} />
      {!compact && <Text dimColor>Resets {summary.resetText}</Text>}
      {compact && <Text dimColor>{summary.resetText}</Text>}
    </Box>
  );
}

export function HistoryApp({
  result,
  window,
}: {
  result: HistoryListResult;
  window: HistoryWindowSelection;
}) {
  const { exit, waitUntilRenderFlush } = useApp();
  const terminalWidth = process.stdout.columns ?? 100;
  const layout = resolveHistoryLayout(terminalWidth);

  useEffect(() => {
    void waitUntilRenderFlush().then(() => exit());
  }, [exit, waitUntilRenderFlush]);

  if (result.totalEventCount === 0) {
    return (
      <Box flexDirection="column" marginX={1} marginY={1}>
        <Text bold color="cyan">
          🕘 Codex Usage History
        </Text>
        <Text dimColor>
          No saved history yet. Run codex-usage usage after a successful fetch.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginX={1} marginY={1}>
      <Text bold color="cyan">
        🕘 Codex Usage History
      </Text>
      <Text dimColor>{formatHistoryHeading(result, window, layout)}</Text>

      {result.events.map((event) => {
        const metadata = formatHistoryMetadata(event, layout);
        const windows = selectHistoryWindows(event, window);

        return (
          <Box
            key={event.id}
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            paddingY={0}
            marginTop={1}
          >
            <Text bold>{formatHistoryInterval(event)}</Text>
            {metadata && <Text dimColor>{metadata}</Text>}

            {windows.map((entry) => (
              <HistoryWindowRow
                key={`${event.id}-${entry.label}`}
                compact={layout.compact}
                label={entry.label}
                width={layout.barWidth}
                window={entry.window}
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

export function renderHistory(opts: {
  result: HistoryListResult;
  window: HistoryWindowSelection;
}): ReturnType<typeof render> {
  return render(<HistoryApp result={opts.result} window={opts.window} />);
}

export { parseHistoryWindowSelection };
