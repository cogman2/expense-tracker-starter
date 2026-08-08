import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "./e2e/test-db";

// End-to-end test configuration. Playwright boots its own server + client
// against an isolated test database (see e2e/global-setup.ts) so runs never
// touch development data. Run from the repo root: `bun run test:e2e`.
const SERVER_URL = "http://localhost:3000";
const CLIENT_URL = "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  // Only *.spec.ts files are tests; e2e/*.ts helpers and global-setup are ignored.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: CLIENT_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  // Playwright starts both servers itself and waits for them to be ready.
  // reuseExistingServer is false so a stray dev server (pointed at the real
  // database) can never be silently reused for tests — stop `bun run dev`
  // first. The server gets DATABASE_URL overridden to the test database;
  // Bun still loads the rest (BETTER_AUTH_SECRET, etc.) from server/.env,
  // and an already-set env var wins over the .env file.
  webServer: [
    {
      command: "bun run --filter server start",
      url: `${SERVER_URL}/health`,
      env: {
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: "test",
        PORT: "3000",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "bun run --filter client dev",
      url: CLIENT_URL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
