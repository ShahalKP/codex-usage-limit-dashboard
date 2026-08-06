import { pathToFileURL } from "node:url";
import express from "express";
import { z } from "zod";
import { clearHistoryEvents, listHistoryEvents } from "./history/store.js";
import { HISTORY_RANGE_VALUES } from "./history/types.js";
import { fetchCodexUsage } from "./usage.js";
import { fetchClaudeUsage } from "./claudeUsage.js";

const port = Number(process.env.PORT || 8787);

const HistoryQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .refine(
      (value) =>
        value === undefined ||
        (Number.isInteger(value) && value >= 1 && value <= 200),
      "limit must be an integer between 1 and 200",
    ),
  range: z.enum(HISTORY_RANGE_VALUES).optional(),
});

const HistoryDeleteSchema = z.object({
  range: z.enum(HISTORY_RANGE_VALUES).optional(),
});

export function createServerApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/codex/rate-limits", async (_req, res) => {
    try {
      const usage = await fetchCodexUsage();
      res.json(usage);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/claude/usage", async (_req, res) => {
    try {
      const usage = await fetchClaudeUsage();
      res.json(usage);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/codex/history", (req, res) => {
    const parsed = HistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: parsed.error.issues[0]?.message ?? "Invalid history query.",
        });
      return;
    }

    try {
      const history = listHistoryEvents(parsed.data);
      res.json(history);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.delete("/api/codex/history", (req, res) => {
    const parsed = HistoryDeleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error:
            parsed.error.issues[0]?.message ??
            "Invalid history delete request.",
        });
      return;
    }

    try {
      const result = clearHistoryEvents(parsed.data);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return app;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const app = createServerApp();

  app.listen(port, "127.0.0.1", () => {
    console.log(`Codex usage API listening on http://127.0.0.1:${port}`);
  });
}
