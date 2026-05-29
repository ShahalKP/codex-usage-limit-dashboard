import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "dist-web/**", "node_modules/**"],
    include: ["src/**/*.test.ts"],
  },
});
