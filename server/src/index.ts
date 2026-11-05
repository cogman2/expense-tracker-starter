import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import { authRateLimiter, signInRateLimiter } from "./rate-limit";
import { prisma } from "./db";
import { ticketsRouter } from "./routes/tickets";
import { usersRouter } from "./routes/users";
import { webhooksRouter } from "./routes/webhooks";
import { jsonErrorHandler } from "./middleware/error-handler";

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

// Above the global JSON parser on purpose: inbound emails can be megabytes, and
// once express.json() has read a body (100 KB default) the webhook's own larger
// limit could no longer apply. See routes/webhooks.ts.
app.use(webhooksRouter);

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

// The user routes (profile + admin user administration) live in their own
// module. Mounted after express.json(), which its POST handler depends on.
app.use(usersRouter);

// The ticket list (any signed-in user).
app.use(ticketsRouter);

// Last, so it catches errors from every route above — including body-parser's
// for malformed or oversized JSON, which Express would otherwise answer with an
// HTML page (with a stack trace outside production).
app.use(jsonErrorHandler);

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
