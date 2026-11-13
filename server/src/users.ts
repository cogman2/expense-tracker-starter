// Staff-user operations shared by the admin routes (./routes/users.ts) and the
// seed script (../prisma/seed.ts), so there is one way to create an account and
// one way to find a live one.
import type { UserRole } from "core";
import { auth } from "./auth";
import { prisma } from "./db";

/**
 * A user as the API shows them: never the password hash (which lives on
 * Account) or session data. The list adds createdAt to this.
 */
export const PUBLIC_USER_SELECT = { id: true, name: true, email: true, role: true } as const;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/** Just the public fields of a user row, whatever else it carries. */
export function toPublicUser(user: PublicUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * The user with this id, unless they don't exist or were soft-deleted — a
 * deleted user is gone as far as the API is concerned. Carries the role, which
 * is what the rules about who may be changed (canDeleteUser) look at.
 */
export function findActiveUser(id: string): Promise<{ id: string; role: UserRole } | null> {
  return prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, role: true } });
}

export interface NewCredentialUser {
  name: string;
  /** Already normalized (trimmed, lowercased) by the caller's schema. */
  email: string;
  password: string;
  role: UserRole;
}

/**
 * Creates a staff account that can sign in with email and password, or returns
 * null when the email is taken — by an active or a soft-deleted user, whose
 * email stays reserved. Public sign-up is disabled (./auth.ts), so this is the
 * only way accounts appear. It goes through Better Auth's internal adapter and
 * hashes with Better Auth's own hasher, so credential sign-in works and anything
 * Better Auth keeps alongside the row stays consistent.
 */
export async function createCredentialUser(input: NewCredentialUser): Promise<PublicUser | null> {
  const ctx = await auth.$context;

  if (await ctx.internalAdapter.findUserByEmail(input.email)) return null;

  const user = await ctx.internalAdapter.createUser({
    email: input.email,
    name: input.name,
    role: input.role,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });

  return toPublicUser({ ...user, role: input.role });
}
