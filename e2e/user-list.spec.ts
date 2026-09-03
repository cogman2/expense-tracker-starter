import { expect, test } from "@playwright/test";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";

// Covers GET /api/users (server/src/index.ts) and the user list table on the
// admin-only /users page (client/src/UsersPage.tsx).
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

type CreateUserBody = {
  name: string;
  email: string;
  password: string;
  role: string;
};

function createUser(body: Partial<CreateUserBody>, cookie?: string) {
  return fetch(`${SERVER_URL}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Unique-per-test email so parallel tests never collide within a run. */
function uniqueEmail(label: string): string {
  return `${label}-${test.info().testId}-${Date.now()}@example.com`;
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
    expect(admin?.role).toBe("admin");
    expect(agent?.role).toBe("agent");

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

test.describe("GET /api/users reflects newly created users", () => {
  test("a user created via POST /api/users shows up in the list", async () => {
    const cookie = await signInAsAdmin();
    const email = uniqueEmail("list-reflects-create");

    const createRes = await createUser(
      { name: "List Reflects Create", email, password: "password123", role: "agent" },
      cookie,
    );
    expect(createRes.status).toBe(201);

    const res = await getUsers(cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: UserRow[] };

    const created = body.users.find((u) => u.email === email);
    expect(created).toBeTruthy();
    expect(created?.name).toBe("List Reflects Create");
    expect(created?.role).toBe("agent");
  });
});

test.describe("UI: Users list (/users)", () => {
  test("admin sees the users table with the seeded accounts", async ({ page }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");

    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Role" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Created" })).toBeVisible();

    const adminRow = page.getByRole("row").filter({ hasText: ADMIN.email });
    await expect(adminRow).toBeVisible();
    await expect(adminRow.getByRole("cell", { name: "admin", exact: true })).toBeVisible();

    const agentRow = page.getByRole("row").filter({ hasText: AGENT.email });
    await expect(agentRow).toBeVisible();
    await expect(agentRow.getByRole("cell", { name: "agent", exact: true })).toBeVisible();
  });

  test("creating a user through the form adds a row to the table without a reload", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");
    await expect(page.getByRole("row").filter({ hasText: ADMIN.email })).toBeVisible();

    const email = uniqueEmail("ui-list-created");

    await page.getByLabel("Name").fill("Newly Listed User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByLabel("Role").selectOption("agent");
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(
      page.getByText(`Created agent account for ${email}.`),
    ).toBeVisible();

    const newRow = page.getByRole("row").filter({ hasText: email });
    await expect(newRow).toBeVisible();
    await expect(newRow.getByRole("cell", { name: "Newly Listed User" })).toBeVisible();
    await expect(newRow.getByRole("cell", { name: "agent", exact: true })).toBeVisible();
  });
});
