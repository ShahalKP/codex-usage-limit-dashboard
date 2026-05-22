import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./web/src"),
    },
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
});
