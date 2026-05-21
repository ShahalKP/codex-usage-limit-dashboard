import { CodexRpcClient } from "./codexRpc.js";

type DeviceCodeLoginStart = {
  type: "chatgptDeviceCode";
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

export async function loginWithDeviceCode(): Promise<void> {
  const client = new CodexRpcClient();

  try {
    await client.start();

    const started = await client.request<DeviceCodeLoginStart>("account/login/start", {
      type: "chatgptDeviceCode",
    });

    if (started.type !== "chatgptDeviceCode") {
      throw new Error(`Unexpected login response type: ${JSON.stringify(started)}`);
    }

    console.log("\nOpen this URL:");
    console.log(started.verificationUrl);
    console.log("\nEnter this code:");
    console.log(started.userCode);
    console.log("\nWaiting for login completion...\n");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Login timed out after 5 minutes."));
      }, 5 * 60_000);

      client.on("account/login/completed", (params: unknown) => {
        const payload = params as { loginId?: string; success?: boolean; error?: string | null };
        if (payload.loginId !== started.loginId) return;

        clearTimeout(timeout);

        if (payload.success) {
          resolve();
        } else {
          reject(new Error(payload.error || "Login failed."));
        }
      });
    });

    const account = await client.request("account/read", { refreshToken: true });
    console.log("Login completed.");
    console.log(JSON.stringify(account, null, 2));
  } finally {
    await client.stop();
  }
}
