// Staff-user operations shared by the admin routes (./routes/users.ts) and the
// seed script (../prisma/seed.ts), so there is one way to create an account and
// one way to find a live one.
import type { UpdateUserInput, UserRole } from "core";
import { auth } from "./auth";
import { prisma } from "./db";
import { Prisma } from "./generated/prisma/client";

/**
 * Whether a write lost the race for a unique column. On User the only unique
 * column a caller supplies is the email (ids are generated), so here it means
 * "that email was taken between our check and our write".
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// No user id contains a control character, and Postgres refuses a NUL byte in a
// text parameter with an error rather than a miss — a 500 for a mistyped URL.
const CONTROL_CHARACTER = /\p{Cc}/u;

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
export async function findActiveUser(id: string): Promise<{ id: string; role: UserRole } | null> {
  if (CONTROL_CHARACTER.test(id)) return null;
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
 * email stays reserved. The lookup answers the usual case; the unique index
 * answers a concurrent create of the same email, which would otherwise be a
 * 500. Public sign-up is disabled (./auth.ts), so this is the only way accounts
 * appear. It goes through Better Auth's internal adapter and hashes with Better
 * Auth's own hasher, so credential sign-in works and anything Better Auth keeps
 * alongside the row stays consistent.
 */
export async function createCredentialUser(input: NewCredentialUser): Promise<PublicUser | null> {
  const ctx = await auth.$context;

  if (await ctx.internalAdapter.findUserByEmail(input.email)) return null;

  let user;
  try {
    user = await ctx.internalAdapter.createUser({
      email: input.email,
      name: input.name,
      role: input.role,
      emailVerified: true,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });

  return toPublicUser({ ...user, role: input.role });
}

/**
 * Saves a staff user's name, email and role, or returns null when the email
 * belongs to someone else — checked first, and caught from the unique index when
 * another write takes it in between. Keeping your own email is not a clash.
 * Through Better Auth's adapter, like creation, so what it keeps alongside the
 * row stays consistent.
 */
export async function updateStaffUser(
  id: string,
  input: UpdateUserInput,
): Promise<PublicUser | null> {
  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(input.email);
  if (existing && existing.user.id !== id) return null;

  let user;
  try {
    user = await ctx.internalAdapter.updateUser(id, {
      name: input.name,
      email: input.email,
      role: input.role,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  // The adapter doesn't type the role field it returns; it is the one just written.
  return toPublicUser({ ...user, role: input.role });
}
