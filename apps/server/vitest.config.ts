import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/unit/**/*.test.ts"] },
      },
      {
        // Needs a real Postgres: TEST_DATABASE_URL, default postgres://lib001:lib001@localhost:5432/postgres.
        // Start one with: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["test/integration/globalSetup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
