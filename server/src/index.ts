import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import { requireAuth } from "./require-auth";
import { prisma } from "./db";

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
  res.json(req.auth);
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
