import { defineConfig, devices } from "@playwright/test";
import { baseURL } from "./tests/env";

// The scenarios share one group and run in order, so there is one worker and no retries: a retry
// would sign the same people up again (the sign-up limit is 5 per minute per address).
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
