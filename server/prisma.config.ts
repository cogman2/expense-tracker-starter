import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 reads the migration/introspection connection URL from here rather
// than from the schema's datasource block. The runtime PrismaClient connects
// via the @prisma/adapter-pg driver adapter instead (see src/db.ts).
// dotenv loads server/.env so DATABASE_URL is available on process.env when
// the Prisma CLI evaluates this config.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
