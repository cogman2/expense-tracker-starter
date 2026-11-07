// Direct access to the isolated e2e database, for specs that assert what the
// server STORED (there is no read API for tickets). Built like server/src/db.ts
// but pinned to TEST_DATABASE_URL: server/src/db.ts reads DATABASE_URL, which in
// the Playwright process is the development database.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/src/generated/prisma/client";
import { assertIsTestDatabase, TEST_DATABASE_URL } from "./test-db";

assertIsTestDatabase(TEST_DATABASE_URL);

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});
