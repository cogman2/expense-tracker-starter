import { expect, test } from "@playwright/test";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";

// Covers POST /api/users (server/src/index.ts) and the "Create user" form on
// the admin-only /users page (client/src/UsersPage.tsx).
//
// NOTE on tooling: like e2e/api-auth.spec.ts, the server-side checks here use
// the runtime's native `fetch()` instead of Playwright's `request` fixture /
// APIRequestContext. Under this repo's `bun run test:e2e` (Playwright's CLI
// executed by the Bun runtime), Playwright's built-in API request context
// throws on any response that sets a cookie (a Bun/playwright-core
// incompatibility, not a bug in this app) — see api-auth.spec.ts for the full
// writeup. Native `fetch()` is unaffected; cookies are threaded manually.
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

test.describe("POST /api/users enforcement", () => {
  test("unauthenticated request is rejected with 401", async () => {
    const res = await createUser({
      name: "Nobody",
      email: uniqueEmail("unauth"),
      password: "password123",
      role: "agent",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("agent (non-admin) request is rejected with 403", async () => {
    const cookie = await signInAsAgent();

    const res = await createUser(
      {
        name: "Should Not Exist",
        email: uniqueEmail("agent-forbidden"),
        password: "password123",
        role: "agent",
      },
      cookie,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("admin request with valid data creates a user and leaks no secrets", async () => {
    const cookie = await signInAsAdmin();
    const email = uniqueEmail("valid-admin");

    const res = await createUser(
      { name: "New Agent", email, password: "password123", role: "agent" },
      cookie,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      user: {
        id: expect.any(String),
        name: "New Agent",
        email,
        role: "agent",
      },
    });
    // Never leak the password hash or any session data alongside the user.
    expect(body.user).not.toHaveProperty("password");
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.user).not.toHaveProperty("hash");
    expect(body).not.toHaveProperty("session");
    expect(JSON.stringify(body)).not.toContain("password123");
  });

  test("duplicate email is rejected with 409", async () => {
    const cookie = await signInAsAdmin();
    const email = uniqueEmail("duplicate");

    const first = await createUser(
      { name: "First", email, password: "password123", role: "agent" },
      cookie,
    );
    expect(first.status).toBe(201);

    const second = await createUser(
      { name: "Second", email, password: "password123", role: "agent" },
      cookie,
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: "a user with that email already exists",
    });
  });

  test("password shorter than 8 characters is rejected with 400", async () => {
    const cookie = await signInAsAdmin();

    const res = await createUser(
      {
        name: "Short Password",
        email: uniqueEmail("short-password"),
        password: "short",
        role: "agent",
      },
      cookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password must be at least 8 characters/);
  });

  test("invalid email is rejected with 400", async () => {
    const cookie = await signInAsAdmin();

    const res = await createUser(
      {
        name: "Bad Email",
        email: "not-an-email",
        password: "password123",
        role: "agent",
      },
      cookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid email/);
  });

  test("invalid role is rejected with 400", async () => {
    const cookie = await signInAsAdmin();

    const res = await createUser(
      {
        name: "Bad Role",
        email: uniqueEmail("bad-role"),
        password: "password123",
        role: "superuser",
      },
      cookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/role must be one of/);
  });

  test("missing name is rejected with 400", async () => {
    const cookie = await signInAsAdmin();

    const res = await createUser(
      {
        email: uniqueEmail("missing-name"),
        password: "password123",
        role: "agent",
      },
      cookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name is required/);
  });
});

test.describe("Admin creates a user who can then sign in", () => {
  test("a newly created account can sign in with the given credentials", async () => {
    const cookie = await signInAsAdmin();
    const email = uniqueEmail("new-signin");
    const password = "brand-new-password";

    const createRes = await createUser(
      { name: "Fresh Hire", email, password, role: "agent" },
      cookie,
    );
    expect(createRes.status).toBe(201);

    const signInRes = await signIn(email, password);
    expect(signInRes.status).toBe(200);
    const signInCookie = sessionCookieFrom(signInRes);
    expect(signInCookie).toBeTruthy();
  });
});

test.describe("UI: Create user form (/users)", () => {
  test("admin creates a user through the form and sees the success message", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    const email = uniqueEmail("ui-created");

    await page.getByLabel("Name").fill("UI Created User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByLabel("Role").selectOption("admin");

    await page.getByRole("button", { name: "Create user" }).click();

    await expect(
      page.getByText(`Created admin account for ${email}.`),
    ).toBeVisible();

    // The form resets on success.
    await expect(page.getByLabel("Name")).toHaveValue("");
    await expect(page.getByLabel("Email")).toHaveValue("");
  });

  test("submitting a duplicate email surfaces the server error in the UI", async ({
    page,
  }) => {
    const cookie = await signInAsAdmin();
    const email = uniqueEmail("ui-duplicate");
    const seedRes = await createUser(
      { name: "Already Exists", email, password: "password123", role: "agent" },
      cookie,
    );
    expect(seedRes.status).toBe(201);

    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");

    await page.getByLabel("Name").fill("Duplicate Attempt");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByLabel("Role").selectOption("agent");

    await page.getByRole("button", { name: "Create user" }).click();

    await expect(
      page.getByText("a user with that email already exists"),
    ).toBeVisible();
  });
});
