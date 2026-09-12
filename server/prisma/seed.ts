import "dotenv/config";
import { auth } from "../src/auth";
import { prisma } from "../src/db";
import { Role } from "../src/generated/prisma/enums";

// Seeds a single user (admin or agent). Because the public sign-up endpoint is
// disabled (see src/auth.ts), we create the user through Better Auth's
// internal adapter instead of the HTTP API. The password is hashed with
// Better Auth's own hasher (scrypt) so credential sign-in works, and the
// credential lands in the `Account` table as providerId "credential".
//
// Credentials and role come from the environment (see .env.example):
//   SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME, SEED_USER_ROLE
const ROLES = Object.values(Role);

function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

async function main() {
  const email = (process.env.SEED_USER_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.SEED_USER_PASSWORD;
  const name = process.env.SEED_USER_NAME ?? "Admin";
  const role = process.env.SEED_USER_ROLE ?? Role.admin;

  // Never provision a real account with the well-known default password in a
  // production-like environment; require an explicit, non-default value there.
  if (!password || password === "password123") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SEED_USER_PASSWORD must be set to a strong, non-default value in production.",
      );
    }
    console.warn(
      "[seed] using default dev password — do not use outside local development",
    );
  }
  const effectivePassword = password ?? "password123";

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

  const hash = await ctx.password.hash(effectivePassword);
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
