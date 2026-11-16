import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
const scratch = await mkdtemp(path.join(tmpdir(), "codex-usage-smoke-"));

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function checkServers(built) {
  const apiPort = await unusedPort();
  let webPort = await unusedPort();
  while (webPort === apiPort) webPort = await unusedPort();
  const children = [];
  let output = "";
  const env = {
    ...process.env,
    PORT: String(apiPort),
    CODEX_USAGE_DB_PATH: path.join(scratch, "history.sqlite"),
    // Health checks must never depend on Codex or a real account.
    CODEX_BIN: path.join(scratch, "no-codex"),
  };

  function start(args) {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => { output += error.message; });
    children.push(child);
  }

  try {
    start(built ? ["dist/src/server.js"] : ["--import", "tsx", "src/server.ts"]);
    start([vite, ...(built ? ["preview"] : []), "--config", "web/vite.config.ts", "--port", String(webPort)]);
    const origin = `http://127.0.0.1:${webPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (children.some((child) => child.exitCode !== null)) break;
      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
        ready = true;
        break;
      } catch {
        await delay(250);
      }
    }
    assert.ok(ready, `Servers did not become ready:\n${output}`);
    const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root"><\/div>/);
    const history = await fetch(`${origin}/api/codex/history?range=all`, { signal: AbortSignal.timeout(5000) });
    assert.equal(history.status, 200);
    assert.deepEqual((await history.json()).events, []);
    console.log(`${built ? "Built preview" : "Development"}: page, custom-port proxy, and temporary SQLite history passed.`);
  } finally {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await stopped; } finally { clearTimeout(timeout); }
    }));
  }
}

try {
  for (const args of [["--import", "tsx", "src/cli.ts", "--help"], ["dist/src/cli.js", "--help"]]) {
    const help = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" });
    assert.match(help, /history:clear/);
    assert.match(help, /usage/);
  }
  console.log("Source and compiled CLI help passed.");
  await checkServers(false);
  await checkServers(true);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
