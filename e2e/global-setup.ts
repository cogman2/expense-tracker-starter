import { execSync } from "node:child_process";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { TEST_DATABASE_URL, assertIsTestDatabase, maskUrl } from "./test-db";

const serverDir = path.resolve(process.cwd(), "server");

// Playwright global setup: provisions a clean, isolated test database before
// the run. Resets it to the committed migrations, then seeds baseline
// admin/agent accounts so tests have known credentials. Destructive by design
// but safe — assertIsTestDatabase refuses any DB whose name lacks "test".
export default async function globalSetup(_config: FullConfig) {
  assertIsTestDatabase(TEST_DATABASE_URL);

  const baseEnv = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
  const run = (cmd: string, extraEnv: Record<string, string> = {}) =>
    execSync(cmd, {
      cwd: serverDir,
      env: { ...baseEnv, ...extraEnv },
      stdio: "inherit",
    });

  console.log(`[e2e] preparing test database: ${maskUrl(TEST_DATABASE_URL)}`);
  // Ensure the schema is current (safe/idempotent; not the AI-guarded `reset`),
  // then truncate all data for a clean slate every run.
  run("bunx prisma migrate deploy");
  run("bun run prisma/reset-test-db.ts");

  // Seed baseline accounts (the seed script is idempotent). Passwords are
  // test-only fixtures.
  console.log("[e2e] seeding baseline admin + agent accounts");
  run("bun run prisma/seed.ts", {
    SEED_USER_EMAIL: "admin@example.com",
    SEED_USER_PASSWORD: "password123",
    SEED_USER_NAME: "Admin",
    SEED_USER_ROLE: "admin",
  });
  run("bun run prisma/seed.ts", {
    SEED_USER_EMAIL: "agent@example.com",
    SEED_USER_PASSWORD: "password123",
    SEED_USER_NAME: "Agent",
    SEED_USER_ROLE: "agent",
  });
}
