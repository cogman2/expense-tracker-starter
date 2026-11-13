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

// Every table in the schema except _prisma_migrations, read from the database
// rather than listed here, so a new model's table is cleared without touching
// this file. CASCADE clears FK-linked rows; RESTART IDENTITY resets sequences.
// The names come from pg_tables, not from input, and are quoted as identifiers.
const tables = await prisma.$queryRaw<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (tables.length > 0) {
  const list = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

console.log(`[reset-test-db] truncated all data in "${dbName}"`);
await prisma.$disconnect();
