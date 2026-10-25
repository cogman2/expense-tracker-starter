import path from "node:path";
import dotenv from "dotenv";

// Load server/.env (gitignored) so DATABASE_URL / TEST_DATABASE_URL are
// available when Playwright runs from the repo root. dotenv does not override
// variables already present in the environment (e.g. injected by CI), so an
// explicit override always wins.
dotenv.config({ path: path.resolve(process.cwd(), "server/.env") });

/**
 * Connection string for the isolated end-to-end test database.
 *
 * Prefers an explicit `TEST_DATABASE_URL`; otherwise derives one from
 * `DATABASE_URL` by appending a `_test` suffix to the database name — so the
 * e2e suite never touches the development/production database.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL?.trim();
  if (!base) {
    throw new Error(
      "Neither TEST_DATABASE_URL nor DATABASE_URL is set. Add them to server/.env " +
        "(see server/.env.example).",
    );
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  url.pathname = `/${name}_test`;
  return url.toString();
}

export const TEST_DATABASE_URL = resolveTestDatabaseUrl();

/**
 * Safety guard for destructive operations (migrate reset): the target database
 * name must contain "test", so we can never wipe the real database by mistake.
 */
export function assertIsTestDatabase(url: string): void {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to use "${dbName}" as the test database — its name must contain ` +
        `"test". Point TEST_DATABASE_URL at a dedicated database.`,
    );
  }
}

/** Redact the password when logging a connection string. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}
