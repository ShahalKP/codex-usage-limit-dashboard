import { format } from "date-fns";
import { Box, Text, useApp } from "ink";
import { useEffect, useRef, useState } from "react";
import { CodexRpcClient } from "../codexRpc.js";
import type { CodexAccount } from "../types.js";

// ── Spinner ───────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DeviceCodeInfo = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

type LoginPhase =
  | { kind: "starting" }
  | { kind: "waiting"; info: DeviceCodeInfo }
  | { kind: "success"; account: CodexAccount; at: Date }
  | { kind: "error"; message: string };

// ── Main component ────────────────────────────────────────────────────────────

export function LoginApp() {
  const { exit, waitUntilRenderFlush } = useApp();
  const [phase, setPhase] = useState<LoginPhase>({ kind: "starting" });
  const mountedRef = useRef(true);

  useEffect(() => {
    let client: CodexRpcClient | null = null;

    const run = async () => {
      client = new CodexRpcClient();
      try {
        await client.start();

        if (!mountedRef.current) return;
        const started = await client.request<{
          type: string;
          loginId: string;
          verificationUrl: string;
          userCode: string;
        }>("account/login/start", { type: "chatgptDeviceCode" });

        if (started.type !== "chatgptDeviceCode") {
          throw new Error(`Unexpected login type: ${started.type}`);
        }

        if (!mountedRef.current) return;
        setPhase({
          kind: "waiting",
          info: {
            loginId: started.loginId,
            verificationUrl: started.verificationUrl,
            userCode: started.userCode,
          },
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Login timed out after 5 minutes.")),
            5 * 60_000,
          );

          client!.on("account/login/completed", (params: unknown) => {
            const p = params as {
              loginId?: string;
              success?: boolean;
              error?: string | null;
            };
            if (p.loginId !== started.loginId) return;
            clearTimeout(timeout);
            if (p.success) resolve();
            else reject(new Error(p.error ?? "Login failed."));
          });
        });

        if (!mountedRef.current) return;
        const result = await client.request<{ account: CodexAccount }>(
          "account/read",
          { refreshToken: true },
        );

        if (mountedRef.current) {
          setPhase({
            kind: "success",
            account: result.account,
            at: new Date(),
          });
        }
      } catch (err) {
        if (mountedRef.current) {
          setPhase({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        await client?.stop();
      }
    };

    void run();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Exit cleanly after success
  useEffect(() => {
    if (phase.kind === "success") {
      void waitUntilRenderFlush().then(() => exit());
    }
  }, [phase.kind, exit, waitUntilRenderFlush]);

  const account = phase.kind === "success" ? phase.account : null;
  const email = account?.email ?? account?.type;

  return (
    <Box flexDirection="column" marginX={1} marginY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🔑 Codex Login
        </Text>
      </Box>

      {/* Starting */}
      {phase.kind === "starting" && (
        <Box gap={1}>
          <Spinner />
          <Text dimColor>Starting device code flow…</Text>
        </Box>
      )}

      {/* Waiting for user to visit URL */}
      {phase.kind === "waiting" && (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text dimColor> Waiting for authentication…</Text>
          </Box>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={2}
            paddingY={1}
          >
            <Text bold>1. Open this URL in your browser:</Text>
            <Text color="cyan" bold>
              {phase.info.verificationUrl}
            </Text>
            <Box marginTop={1}>
              <Text bold>2. Enter this code:</Text>
            </Box>
            <Box marginTop={0}>
              <Text bold color="yellow" backgroundColor="black">
                {" "}
                {phase.info.userCode}{" "}
              </Text>
            </Box>
          </Box>
          <Text dimColor>Times out in 5 minutes…</Text>
        </Box>
      )}

      {/* Success */}
      {phase.kind === "success" && (
        <Box flexDirection="column" gap={0}>
          <Box gap={1}>
            <Text color="green" bold>
              ✔ Logged in
            </Text>
          </Box>
          {email && (
            <Text dimColor>
              Account: <Text color="white">{email}</Text>
            </Text>
          )}
          {phase.at && (
            <Text dimColor>At {format(phase.at, "MMM d, h:mm a")}</Text>
          )}
        </Box>
      )}

      {/* Error */}
      {phase.kind === "error" && (
        <Box flexDirection="column">
          <Text color="red" bold>
            ✖ Login failed
          </Text>
          <Text color="red">{phase.message}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Render helper (called from cli.ts without JSX) ────────────────────────────

import { render } from "ink";

export function renderLogin(): ReturnType<typeof render> {
  return render(<LoginApp />);
}
