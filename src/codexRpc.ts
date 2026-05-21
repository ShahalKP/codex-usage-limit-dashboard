import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";

type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class CodexRpcClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderrBuffer = "";

  constructor(
    private readonly command = process.env.CODEX_BIN || "codex",
    private readonly args = ["app-server"],
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.proc) return;

    this.proc = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.proc.stderr.on("data", (chunk) => {
      this.stderrBuffer += chunk.toString();
    });

    this.proc.on("exit", (code, signal) => {
      const message = `codex app-server exited with code=${code ?? "null"} signal=${signal ?? "null"}`;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(message + this.stderrSuffix()));
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "local_codex_usage_dashboard",
        title: "Local Codex Usage Dashboard",
        version: "0.1.0",
      },
    });

    this.notify("initialized", {});
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (!this.proc) {
      throw new Error("CodexRpcClient.start() must be called before request().");
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = params === undefined ? { id, method } : { id, method, params };

    const promise = new Promise<JsonRpcResponse<T>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} response after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: JsonRpcResponse) => void,
        reject,
        timeout,
      });
    });

    this.write(payload);
    const response = await promise;

    if (response.error) {
      throw new Error(`${method} failed: ${response.error.message}`);
    }

    return response.result as T;
  }

  notify(method: string, params?: unknown): void {
    const payload: JsonRpcRequest = params === undefined ? { method } : { method, params };
    this.write(payload);
  }

  async stop(): Promise<void> {
    if (!this.proc) return;

    const proc = this.proc;
    this.rl?.close();
    this.rl = null;
    this.proc = null;

    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  }

  private write(payload: JsonRpcRequest): void {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error("codex app-server stdin is not writable." + this.stderrSuffix());
    }

    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;

    try {
      message = JSON.parse(line);
    } catch {
      this.emit("parse-error", line);
      return;
    }

    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      pending.resolve(message);
      return;
    }

    if (message.method) {
      this.emit("notification", message);
      this.emit(message.method, message.params);
    }
  }

  private stderrSuffix(): string {
    const trimmed = this.stderrBuffer.trim();
    return trimmed ? `\n\nCodex stderr:\n${trimmed}` : "";
  }
}
