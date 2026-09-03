import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see server/.env.example");
}

// Prisma 7 connects through a driver adapter (the query compiler runs as WASM
// on the JS thread; there is no native query-engine binary).
const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
