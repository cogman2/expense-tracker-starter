import "dotenv/config";
import { ROLES, Role, type UserRole } from "core";
import { prisma } from "../src/db";
import { createCredentialUser } from "../src/users";

// Seeds a single user (admin or agent). The public sign-up endpoint is
// disabled (see src/auth.ts), so the user is created the same way
// POST /api/users creates one: createCredentialUser (src/users.ts).
//
// Credentials and role come from the environment (see .env.example):
//   SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME, SEED_USER_ROLE
function isRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
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

  const user = await createCredentialUser({ name, email, password: effectivePassword, role });
  if (!user) {
    console.log(`[seed] user already exists: ${email} — nothing to do`);
    return;
  }

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
