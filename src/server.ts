import express from "express";
import { fetchCodexUsage } from "./usage.js";

const app = express();
const port = Number(process.env.PORT || 8787);

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

app.listen(port, "127.0.0.1", () => {
  console.log(`Codex usage API listening on http://127.0.0.1:${port}`);
});
