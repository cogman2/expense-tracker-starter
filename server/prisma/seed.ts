import "dotenv/config";
import { auth } from "../src/auth";
import { prisma } from "../src/db";

// Seeds a single user (admin or agent). Because the public sign-up endpoint is
// disabled (see src/auth.ts), we create the user through Better Auth's
// internal adapter instead of the HTTP API. The password is hashed with
// Better Auth's own hasher (scrypt) so credential sign-in works, and the
// credential lands in the `Account` table as providerId "credential".
//
// Credentials and role come from the environment (see .env.example):
//   SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME, SEED_USER_ROLE
const ROLES = ["admin", "agent"] as const;
type Role = (typeof ROLES)[number];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

async function main() {
  const email = (process.env.SEED_USER_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.SEED_USER_PASSWORD ?? "password123";
  const name = process.env.SEED_USER_NAME ?? "Admin";
  const role = process.env.SEED_USER_ROLE ?? "admin";

  if (!isRole(role)) {
    throw new Error(`SEED_USER_ROLE must be one of ${ROLES.join(" | ")}, got "${role}"`);
  }

  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) {
    console.log(`[seed] user already exists: ${email} — nothing to do`);
    return;
  }

  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    role,
    emailVerified: true,
  });

  const hash = await ctx.password.hash(password);
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });

  console.log(`[seed] created ${role}: ${email} (id ${user.id})`);
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
