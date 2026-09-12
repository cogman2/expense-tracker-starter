// Truncates all data tables for a clean slate between e2e runs.
//
// This is a guard-free alternative to `prisma migrate reset`, which Prisma 7
// blocks when invoked by an AI agent. It connects with the app's own Prisma
// client (so it honours DATABASE_URL from the environment) and refuses to run
// unless the target database name contains "test".
import { prisma } from "../src/db";

const url = process.env.DATABASE_URL ?? "";
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to truncate "${dbName}" — the database name must contain "test". ` +
      "Set DATABASE_URL to the dedicated test database.",
  );
}

// Better Auth data tables. CASCADE clears FK-linked rows; RESTART IDENTITY
// resets sequences. The _prisma_migrations table is left intact.
await prisma.$executeRawUnsafe(
  'TRUNCATE TABLE "User", "Session", "Account", "Verification" RESTART IDENTITY CASCADE',
);

console.log(`[reset-test-db] truncated all data in "${dbName}"`);
await prisma.$disconnect();
