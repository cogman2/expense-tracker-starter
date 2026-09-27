import { expect, test } from "@playwright/test";
import { ADMIN, AGENT } from "./auth-helpers";

// Server-side enforcement checks, hitting the Express/Better Auth server
// directly on :3000 rather than going through the SPA. This confirms the API
// itself is protected — not just that the client-side router guard hides the
// UI — per server/src/require-auth.ts and server/src/index.ts's /api/me route.
//
// NOTE on tooling: this suite intentionally uses the runtime's native
// `fetch()` instead of Playwright's `request` fixture / APIRequestContext.
// Under this repo's `bun run test:e2e` (Playwright's CLI executed by the Bun
// runtime, not Node), Playwright's built-in API request context throws
// `TypeError: "<path>" cannot be parsed as a URL` from its own cookie-jar code
// (coreBundle.js `_parseSetCookieHeader`) on *any* response that sets a
// cookie — e.g. the Better Auth sign-in response — even against a bare
// `http://localhost:3000` context with no baseURL. Reproduced with a minimal
// Bun HTTP server unrelated to this app, and confirmed absent when the same
// script runs under Node instead of Bun, so it's a Bun/playwright-core
// incompatibility, not a bug in this app. Native `fetch()` (unaffected) is
// used here as the workaround; cookies are threaded through manually.
const SERVER_URL = "http://localhost:3000";

/** Pulls the `name=value` pair out of a `Set-Cookie` response header. */
function sessionCookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected a Set-Cookie header on the response");
  }
  return setCookie.split(";")[0]!;
}

async function signIn(email: string, password: string) {
  return fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

function getMe(cookie?: string) {
  return fetch(`${SERVER_URL}/api/me`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

test.describe("Server-side auth enforcement", () => {
  test("GET /api/me is 401 when unauthenticated", async () => {
    const res = await getMe();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("sign-in with valid credentials sets a session cookie that authorizes /api/me", async () => {
    const signInRes = await signIn(ADMIN.email, ADMIN.password);
    expect(signInRes.ok).toBe(true);
    const cookie = sessionCookieFrom(signInRes);

    const meRes = await getMe(cookie);
    expect(meRes.status).toBe(200);

    const body = await meRes.json();
    expect(body.user.email).toBe(ADMIN.email);
    expect(body.user.role).toBe("admin");
    // The endpoint must never leak the raw session token/object, only the
    // user profile (see server/src/index.ts's comment on /api/me).
    expect(body).not.toHaveProperty("session");
    expect(body.user).not.toHaveProperty("token");
  });

  test("sign-in reflects the agent role on /api/me", async () => {
    const signInRes = await signIn(AGENT.email, AGENT.password);
    const cookie = sessionCookieFrom(signInRes);

    const meRes = await getMe(cookie);
    const body = await meRes.json();

    expect(body.user.email).toBe(AGENT.email);
    expect(body.user.role).toBe("agent");
  });

  test("sign-in with a wrong password is rejected and grants no access", async () => {
    const signInRes = await signIn(ADMIN.email, "wrong-password");
    expect(signInRes.ok).toBe(false);
    expect(signInRes.headers.get("set-cookie")).toBeNull();

    const meRes = await getMe();
    expect(meRes.status).toBe(401);
  });

  test("sign-in with an unknown email is rejected and grants no access", async () => {
    const signInRes = await signIn("nobody@example.com", "password123");
    expect(signInRes.ok).toBe(false);
    expect(signInRes.headers.get("set-cookie")).toBeNull();
  });

  test("sign-in email lookup is case-insensitive", async () => {
    const signInRes = await signIn(ADMIN.email.toUpperCase(), ADMIN.password);
    expect(signInRes.ok).toBe(true);
    const cookie = sessionCookieFrom(signInRes);

    const meRes = await getMe(cookie);
    expect(meRes.status).toBe(200);
    const body = await meRes.json();
    // Stored/returned email stays lowercase (see prisma/seed.ts), even
    // though the sign-in request used an uppercase variant.
    expect(body.user.email).toBe(ADMIN.email);
  });

  test("sign-in rejects an empty password", async () => {
    const signInRes = await signIn(ADMIN.email, "");
    expect(signInRes.ok).toBe(false);
    expect(signInRes.headers.get("set-cookie")).toBeNull();
  });

  test("sign-in rejects a whitespace-only email", async () => {
    const signInRes = await signIn("   ", ADMIN.password);
    expect(signInRes.ok).toBe(false);
    expect(signInRes.headers.get("set-cookie")).toBeNull();
  });

  test("signing out invalidates the session cookie server-side", async () => {
    const signInRes = await signIn(ADMIN.email, ADMIN.password);
    const cookie = sessionCookieFrom(signInRes);
    expect((await getMe(cookie)).status).toBe(200);

    const signOutRes = await fetch(`${SERVER_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(signOutRes.ok).toBe(true);

    const meRes = await getMe(cookie);
    expect(meRes.status).toBe(401);
  });
});
