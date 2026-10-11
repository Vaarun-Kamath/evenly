import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      reporter: ["text"],
      // packages/core is held to 100% (BUILD_PLAN M1; PLATFORM.md section 2).
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
