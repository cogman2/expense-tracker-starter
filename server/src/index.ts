import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import { requireAuth, requireAdmin } from "./require-auth";
import { authRateLimiter, signInRateLimiter } from "./rate-limit";
import { prisma } from "./db";
import { Role } from "./generated/prisma/enums";

export interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

export interface ApiReadiness {
  status: "ready" | "unavailable";
  database: "up" | "down";
  timestamp: string;
}

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// Rate limiting for the auth surface, production only. Off in dev/test so local
// work and the Playwright e2e suite are unaffected. Registered before the auth
// mount so it runs ahead of the handler.
if (process.env.NODE_ENV === "production") {
  // Trust the reverse proxy so client IPs (not the proxy's) are the rate-limit
  // keys; required for correct keying and to satisfy express-rate-limit's proxy
  // validation. TRUST_PROXY is the number of proxy hops in front of the app.
  app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
  app.use("/api/auth/sign-in", signInRateLimiter);
  app.use("/api/auth", authRateLimiter);
}

// Better Auth mounts the entire /api/auth/* surface. It must be registered
// before express.json(): the handler consumes the raw request body itself.
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: ApiHealth = {
    status: "ok",
    service: "helpdesk-server",
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const body: ApiReadiness = {
      status: "ready",
      database: "up",
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  } catch (err) {
    console.error("[server] database readiness check failed", err);
    const body: ApiReadiness = {
      status: "unavailable",
      database: "down",
      timestamp: new Date().toISOString(),
    };
    res.status(503).json(body);
  }
});

// Example protected route: requireAuth gates it, and req.auth holds the
// authenticated session/user.
app.get("/api/me", requireAuth, (req, res) => {
  // Return only the user profile — never the session object, which contains
  // the raw session token (the same secret as the httpOnly cookie).
  res.json({ user: req.auth!.user });
});

// Admin-only user creation. Public sign-up is disabled (see src/auth.ts), so
// admins provision accounts here. Mirrors prisma/seed.ts: the user is created
// through Better Auth's internal adapter and the password hashed with Better
// Auth's own hasher, so credential sign-in works. requireAdmin enforces the
// authorization server-side — the client route guard is UX only.
const VALID_ROLES = Object.values(Role) as string[];
const MIN_PASSWORD_LENGTH = 8;
// Basic shape check; Better Auth / the DB remain the source of truth.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const email = emailRaw.toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : "";

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "a valid email is required" });
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      error: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
    return;
  }
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(", ")}` });
    return;
  }

  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "a user with that email already exists" });
    return;
  }

  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    role: role as Role,
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

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
