// Every route that reads or writes a user: the caller's own profile and the
// admin-only user administration pair. Paths are written out in full and the
// router is mounted at the root (see src/index.ts), because /api/me does not
// share the /api/users prefix and the Vite dev proxy forwards each by exact rule
// (client/vite.config.ts).
//
// The requireAuth/requireAdmin pair stays per-route rather than becoming
// router-level middleware: /api/me is auth-only, and keeping the guards at each
// route is what makes that difference visible.
import express from "express";
import { canDeleteUser, createUserSchema, updateUserSchema } from "core";
import { auth } from "../auth";
import { prisma } from "../db";
import { requireAuth, requireAdmin } from "../require-auth";
import { HttpError } from "../http-error";
import { parseBody } from "../schemas";
import {
  PUBLIC_USER_SELECT,
  createCredentialUser,
  findActiveUser,
  toPublicUser,
} from "../users";

export const usersRouter = express.Router();

// Example protected route: requireAuth gates it, and req.auth holds the
// authenticated session/user.
usersRouter.get("/api/me", requireAuth, (req, res) => {
  // Return only the user profile — never the session object, which contains
  // the raw session token (the same secret as the httpOnly cookie).
  res.json({ user: req.auth!.user });
});

// Admin-only user list. Explicit `select` (never raw rows) keeps the response
// to safe fields — no password hash (which lives on Account, not User) or
// session data can leak. Soft-deleted users are left out.
usersRouter.get("/api/users", requireAuth, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { ...PUBLIC_USER_SELECT, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

// Admin-only user creation. Public sign-up is disabled (see ../auth.ts), so
// admins provision accounts here, through the same createCredentialUser as
// prisma/seed.ts. requireAdmin enforces the authorization server-side — the
// client route guard is UX only.
usersRouter.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  // One schema shared with the client's form (core/src/users.ts). It trims the
  // name, lowercases the email and narrows the role, so everything below works
  // with clean values.
  const user = await createCredentialUser(parseBody(createUserSchema, req.body));
  if (!user) throw new HttpError(409, "a user with that email already exists");
  res.status(201).json({ user });
});

// Admin-only user edit: name, email and role. Passwords are not editable here —
// changing someone's credentials is a separate operation. Like the create route,
// the work goes through Better Auth's internal adapter rather than Prisma
// directly, so anything Better Auth maintains alongside the row stays consistent.
usersRouter.patch<{ id: string }>("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
  // Same schema the client's row editor validates against (core/src/users.ts).
  const { name, email, role } = parseBody(updateUserSchema, req.body);

  const ctx = await auth.$context;

  const target = await findActiveUser(req.params.id);
  if (!target) throw new HttpError(404, "user not found");

  // An admin demoting themselves would lose access to this very page (and could
  // strip the last admin), so it is refused rather than silently honored. Editing
  // your own name or email is fine. The current role is read off the session
  // rather than `target`: inside this branch they are the same row, and the
  // session's user carries the role additionalField as a typed property.
  const isSelf = target.id === req.auth!.user.id;
  if (isSelf && role !== req.auth!.user.role) {
    throw new HttpError(409, "you cannot change your own role");
  }

  // Scoped to *other* rows: an email left untouched must not collide with itself.
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing && existing.user.id !== target.id) {
    throw new HttpError(409, "a user with that email already exists");
  }

  const user = await ctx.internalAdapter.updateUser(target.id, {
    name,
    email,
    role,
  });

  // No createdAt — the list endpoint remains the one place that reports it,
  // exactly as with creation. The adapter doesn't type the role field it
  // returns; it is the one just written.
  res.json({ user: toPublicUser({ ...user, role }) });
});

// Admin-only soft delete. The row is kept with deletedAt set — its email stays
// taken, so the create route's duplicate check still refuses it — and every
// session it holds is revoked, so the user is signed out at once; the session
// hook in ../auth.ts keeps them from signing back in. Any tickets assigned to
// them become unassigned. Admin accounts cannot be deleted at all, which also
// rules out deleting yourself.
usersRouter.delete<{ id: string }>("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const target = await findActiveUser(req.params.id);
  if (!target) throw new HttpError(404, "user not found");
  if (!canDeleteUser(target)) throw new HttpError(409, "admin users cannot be deleted");

  // Their tickets go back to unassigned in the same transaction: a deleted user
  // is hidden from the API, so they could neither be shown nor reassigned from.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: { deletedAt: new Date() },
    }),
    prisma.ticket.updateMany({
      where: { assigneeId: target.id },
      data: { assigneeId: null },
    }),
  ]);
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(target.id);

  res.status(204).end();
});
