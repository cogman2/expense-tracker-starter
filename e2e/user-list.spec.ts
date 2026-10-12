import { expect, test } from "@playwright/test";
import { ADMIN, AGENT } from "./auth-helpers";
import { Role } from "core";

// Covers GET /api/users (server/src/routes/users.ts). The users table's happy
// path through the UI lives in e2e/user-management.spec.ts.
//
// NOTE on tooling: like e2e/api-auth.spec.ts and e2e/user-creation.spec.ts,
// the server-side checks here use the runtime's native `fetch()` instead of
// Playwright's `request` fixture / APIRequestContext. Under this repo's
// `bun run test:e2e` (Playwright's CLI executed by the Bun runtime),
// Playwright's built-in API request context throws on any response that sets
// a cookie (a Bun/playwright-core incompatibility, not a bug in this app) —
// see api-auth.spec.ts for the full writeup. Native `fetch()` is unaffected;
// cookies are threaded manually.
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

async function signInAsAdmin(): Promise<string> {
  const res = await signIn(ADMIN.email, ADMIN.password);
  return sessionCookieFrom(res);
}

async function signInAsAgent(): Promise<string> {
  const res = await signIn(AGENT.email, AGENT.password);
  return sessionCookieFrom(res);
}

function getUsers(cookie?: string) {
  return fetch(`${SERVER_URL}/api/users`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

test.describe("GET /api/users enforcement", () => {
  test("unauthenticated request is rejected with 401", async () => {
    const res = await getUsers();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("agent (non-admin) request is rejected with 403", async () => {
    const cookie = await signInAsAgent();

    const res = await getUsers(cookie);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("admin request returns the seeded users with only safe fields", async () => {
    const cookie = await signInAsAdmin();

    const res = await getUsers(cookie);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { users: UserRow[] };
    expect(Array.isArray(body.users)).toBe(true);

    const admin = body.users.find((u) => u.email === ADMIN.email);
    const agent = body.users.find((u) => u.email === AGENT.email);
    expect(admin).toBeTruthy();
    expect(agent).toBeTruthy();
    expect(admin?.role).toBe(Role.admin);
    expect(agent?.role).toBe(Role.agent);

    // Every row must expose exactly id/name/email/role/createdAt — nothing
    // more (no password hash, no session data).
    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual(
        ["createdAt", "email", "id", "name", "role"].sort(),
      );
    }

    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("hash");
    expect(raw).not.toContain("session");
  });

  test("users are ordered by createdAt ascending", async () => {
    const cookie = await signInAsAdmin();

    const res = await getUsers(cookie);
    const body = (await res.json()) as { users: UserRow[] };

    const timestamps = body.users.map((u) => new Date(u.createdAt).getTime());
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });
});
