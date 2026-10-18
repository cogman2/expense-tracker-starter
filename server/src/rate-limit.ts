import rateLimit from "express-rate-limit";

// Rate limiters for the auth surface. Applied only in production (see index.ts).
// Both key by client IP (which requires `trust proxy` behind a reverse proxy),
// use the in-memory store, and respond with a JSON 429 plus RateLimit-* headers.
//
// Limits are env-overridable so they can be tuned per deployment without a code
// change. Windows are in minutes; a value of 0 falls back to the default.

function minutes(envVar: string, fallbackMinutes: number): number {
  const raw = Number(process.env[envVar]);
  return (Number.isFinite(raw) && raw > 0 ? raw : fallbackMinutes) * 60 * 1000;
}

function count(envVar: string, fallback: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Strict limiter for the login path — the brute-force target. Only failed
// attempts count (skipSuccessfulRequests), so legitimate users signing in
// normally are never locked out.
export const signInRateLimiter = rateLimit({
  windowMs: minutes("AUTH_RATE_LIMIT_SIGNIN_WINDOW_MIN", 15),
  limit: count("AUTH_RATE_LIMIT_SIGNIN_MAX", 10),
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});

// General limiter for the rest of /api/auth/*. Kept generous because the client
// polls /api/auth/get-session, so a tight cap here would throttle real sessions.
export const authRateLimiter = rateLimit({
  windowMs: minutes("AUTH_RATE_LIMIT_WINDOW_MIN", 1),
  limit: count("AUTH_RATE_LIMIT_MAX", 100),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});
