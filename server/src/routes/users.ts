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
import { createUserSchema, updateUserSchema } from "core";
import { auth } from "../auth";
import { prisma } from "../db";
import { requireAuth, requireAdmin } from "../require-auth";
import { firstIssueMessage } from "../schemas";

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
// session data can leak.
usersRouter.get("/api/users", requireAuth, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

// Admin-only user creation. Public sign-up is disabled (see ../auth.ts), so
// admins provision accounts here. Mirrors prisma/seed.ts: the user is created
// through Better Auth's internal adapter and the password hashed with Better
// Auth's own hasher, so credential sign-in works. requireAdmin enforces the
// authorization server-side — the client route guard is UX only.
usersRouter.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  // One schema shared with the client's form (core/src/users.ts). It trims the
  // name, lowercases the email and narrows the role, so everything below works
  // with clean values.
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssueMessage(parsed.error) });
    return;
  }
  const { name, email, password, role } = parsed.data;

  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "a user with that email already exists" });
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

  // Return only safe fields — never the password hash or session data.
  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// Admin-only user edit: name, email and role. Passwords are not editable here —
// changing someone's credentials is a separate operation. Like the create route,
// the work goes through Better Auth's internal adapter rather than Prisma
// directly, so anything Better Auth maintains alongside the row stays consistent.
usersRouter.patch("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
  // Same schema the client's row editor validates against (core/src/users.ts).
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssueMessage(parsed.error) });
    return;
  }
  const { name, email, role } = parsed.data;

  const ctx = await auth.$context;

  const target = await ctx.internalAdapter.findUserById(req.params.id);
  if (!target) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  // An admin demoting themselves would lose access to this very page (and could
  // strip the last admin), so it is refused rather than silently honored. Editing
  // your own name or email is fine. The current role is read off the session
  // rather than `target`: inside this branch they are the same row, and the
  // session's user carries the role additionalField as a typed property.
  const isSelf = target.id === req.auth!.user.id;
  if (isSelf && role !== req.auth!.user.role) {
    res.status(409).json({ error: "you cannot change your own role" });
    return;
  }

  // Scoped to *other* rows: an email left untouched must not collide with itself.
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing && existing.user.id !== target.id) {
    res.status(409).json({ error: "a user with that email already exists" });
    return;
  }

  const user = await ctx.internalAdapter.updateUser(target.id, {
    name,
    email,
    role,
  });

  // Only safe fields, and no createdAt — the list endpoint remains the one place
  // that reports it, exactly as with creation.
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
