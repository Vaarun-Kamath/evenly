import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs: the same build works at "/" and at any sub-path. The server injects a
  // <base href> into index.html at request time (ADR-0002).
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.EVENLY_API_URL ?? "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
  },
});
