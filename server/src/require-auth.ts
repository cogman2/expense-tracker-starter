import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";

// The shape Better Auth returns from getSession (a { session, user } pair).
type AuthContext = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

// Make the resolved session/user available to downstream handlers in a
// type-safe way. After `requireAuth` runs, `req.auth` is guaranteed present.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Route guard: rejects unauthenticated requests with 401, otherwise attaches
// the session/user to `req.auth` and continues.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  req.auth = session;
  next();
}
