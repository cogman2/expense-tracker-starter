import { expect, test } from "@playwright/test";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";

// Covers PATCH /api/users/:id (server/src/routes/users.ts) and the inline row
// editor on the admin-only /users page (client/src/UsersPage.tsx).
//
// NOTE on tooling: like e2e/api-auth.spec.ts, e2e/user-creation.spec.ts and
// e2e/user-list.spec.ts, the server-side checks here use the runtime's native
// `fetch()` instead of Playwright's `request` fixture / APIRequestContext.
// Under this repo's `bun run test:e2e` (Playwright's CLI executed by the Bun
// runtime), Playwright's built-in API request context throws on any response
// that sets a cookie (a Bun/playwright-core incompatibility, not a bug in
// this app) — see api-auth.spec.ts for the full writeup. Native `fetch()` is
// unaffected; cookies are threaded manually.
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

function getMe(cookie: string) {
  return fetch(`${SERVER_URL}/api/me`, { headers: { Cookie: cookie } });
}

type CreateUserBody = {
  name: string;
  email: string;
  password: string;
  role: string;
};

function createUser(body: Partial<CreateUserBody>, cookie: string) {
  return fetch(`${SERVER_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

type UpdateUserBody = { name: string; email: string; role: string };

function patchUser(
  id: string,
  body: Partial<UpdateUserBody>,
  cookie?: string,
) {
  return fetch(`${SERVER_URL}/api/users/${id}`, {
    method: "PATCH",
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

// The create-user form's labels ("Name", "Email", "Role", "Password") are
// matched with plain, non-exact `getByLabel()` calls elsewhere in the suite
// (e.g. user-creation.spec.ts, user-list.spec.ts) — and Playwright's label
// matching is a case-insensitive substring match. Because every test shares
// one admin session and one /users table (same DB row for the whole run),
// any throwaway user whose *name* happens to contain "name", "email" or
// "role" turns its "Edit {name}" button's aria-label into a second match for
// those generic locators (e.g. "Edit Throwaway bad-email" also matches
// `getByLabel("Email")`), breaking unrelated tests elsewhere in the suite
// with a strict-mode violation. Strip those words out of the label before
// using it in a persisted name; the raw label is still fine for the email,
// which is never matched via getByLabel.
function nameSafeTag(label: string): string {
  return label.replace(/name|email|role/gi, "x");
}

/** Creates a throwaway agent account for tests that need a disposable row. */
async function createThrowawayUser(
  adminCookie: string,
  label: string,
  overrides: Partial<CreateUserBody> = {},
) {
  const email = uniqueEmail(label);
  const res = await createUser(
    {
      name: `Throwaway ${nameSafeTag(label)}`,
      email,
      password: "password123",
      role: "agent",
      ...overrides,
    },
    adminCookie,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    user: { id: string; name: string; email: string; role: string };
  };
  return body.user;
}

test.describe("PATCH /api/users/:id enforcement", () => {
  test("unauthenticated request is rejected with 401", async () => {
    const res = await patchUser("anything", {
      name: "Nobody",
      email: uniqueEmail("unauth"),
      role: "agent",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("agent (non-admin) request is rejected with 403", async () => {
    const cookie = await signInAsAgent();

    const res = await patchUser(
      "anything",
      { name: "Nobody", email: uniqueEmail("agent-forbidden"), role: "agent" },
      cookie,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("admin request with valid data updates the user and leaks no secrets", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "valid-admin");
    const newEmail = uniqueEmail("valid-admin-updated");

    const res = await patchUser(
      target.id,
      { name: "Changed Owner", email: newEmail, role: "admin" },
      adminCookie,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: {
        id: target.id,
        name: "Changed Owner",
        email: newEmail,
        role: "admin",
      },
    });
    // Never leak the password hash or any session data alongside the user.
    expect(body.user).not.toHaveProperty("password");
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.user).not.toHaveProperty("hash");
    expect(body).not.toHaveProperty("session");
    expect(JSON.stringify(body)).not.toContain("password123");
  });

  test("unknown id is rejected with 404", async () => {
    const adminCookie = await signInAsAdmin();

    const res = await patchUser(
      "does-not-exist-id",
      { name: "Nobody", email: uniqueEmail("unknown-id"), role: "agent" },
      adminCookie,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "user not found" });
  });

  test("changing email to another user's email is rejected with 409", async () => {
    const adminCookie = await signInAsAdmin();
    const first = await createThrowawayUser(adminCookie, "dup-first");
    const second = await createThrowawayUser(adminCookie, "dup-second");

    const res = await patchUser(
      second.id,
      { name: second.name, email: first.email, role: "agent" },
      adminCookie,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "a user with that email already exists",
    });
  });

  test("an admin changing their own role is rejected with 409", async () => {
    const adminCookie = await signInAsAdmin();
    const meRes = await getMe(adminCookie);
    const me = (await meRes.json()) as {
      user: { id: string; name: string; email: string; role: string };
    };
    expect(me.user.role).toBe("admin");

    const res = await patchUser(
      me.user.id,
      { name: me.user.name, email: me.user.email, role: "agent" },
      adminCookie,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "you cannot change your own role",
    });
  });

  test("an admin editing their own name (role unchanged) succeeds", async () => {
    const adminCookie = await signInAsAdmin();
    const meRes = await getMe(adminCookie);
    const me = (await meRes.json()) as {
      user: { id: string; name: string; email: string; role: string };
    };

    const editedName = `${me.user.name} Edited`;
    try {
      const res = await patchUser(
        me.user.id,
        { name: editedName, email: me.user.email, role: me.user.role },
        adminCookie,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.name).toBe(editedName);
      expect(body.user.role).toBe(me.user.role);
    } finally {
      // Restore the seeded admin's name: it's a shared fixture other specs
      // assert on (e.g. login.spec.ts, route-guards.spec.ts expect "Admin").
      const restoreRes = await patchUser(
        me.user.id,
        { name: me.user.name, email: me.user.email, role: me.user.role },
        adminCookie,
      );
      expect(restoreRes.status).toBe(200);
    }
  });

  test("saving a user with their own email unchanged does not 409", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "self-email");

    const res = await patchUser(
      target.id,
      { name: "Kept Original Address", email: target.email, role: "agent" },
      adminCookie,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe(target.email);
    expect(body.user.name).toBe("Kept Original Address");
  });

  test("invalid email is rejected with 400", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "bad-email");

    const res = await patchUser(
      target.id,
      { name: "Bad Email", email: "not-an-email", role: "agent" },
      adminCookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid email/);
  });

  test("missing name is rejected with 400", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "missing-name");

    const res = await patchUser(
      target.id,
      { email: uniqueEmail("missing-name-patch"), role: "agent" },
      adminCookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name is required/);
  });

  test("invalid role is rejected with 400", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "bad-role");

    const res = await patchUser(
      target.id,
      { name: "Bad Role", email: uniqueEmail("bad-role-patch"), role: "superuser" },
      adminCookie,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/role must be one of/);
  });
});

test.describe("An edited user can sign in with their new email", () => {
  test("after an admin changes an agent's email, that agent can sign in with the new address", async ({
    page,
  }) => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "email-change-signin");
    const newEmail = uniqueEmail("email-change-signin-new");

    const patchRes = await patchUser(
      target.id,
      { name: target.name, email: newEmail, role: "agent" },
      adminCookie,
    );
    expect(patchRes.status).toBe(200);

    await loginAndWaitForHome(page, newEmail, "password123");
  });
});

test.describe("UI: row editor (/users)", () => {
  test("admin edits a row's name through the pencil button and sees it update without a reload", async ({
    page,
  }) => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "ui-rename");

    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");
    await expect(
      page.getByRole("row").filter({ hasText: target.email }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Edit ${target.name}` }).click();

    // Avoid the substrings "name"/"email"/"role" in this literal — see
    // nameSafeTag's comment: a persisted row containing one of those words
    // becomes a second match for other specs' plain getByLabel("Name") etc.
    const newName = "Updated Via The UI";
    const nameField = page.getByLabel(`Name for ${target.name}`);
    await nameField.fill(newName);
    await page.getByRole("button", { name: `Save ${target.name}` }).click();

    await expect(
      page.getByText(`Saved changes to ${target.email}.`),
    ).toBeVisible();

    const updatedRow = page.getByRole("row").filter({ hasText: target.email });
    // exact: true — otherwise this also matches the row's "Edit {newName}"
    // button, whose cell's accessible name contains newName as a substring.
    await expect(
      updatedRow.getByRole("cell", { name: newName, exact: true }),
    ).toBeVisible();
  });

  test("Cancel discards an edit and nothing is persisted", async ({ page }) => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "ui-cancel");

    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");
    await expect(
      page.getByRole("row").filter({ hasText: target.email }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Edit ${target.name}` }).click();
    await page.getByLabel(`Name for ${target.name}`).fill("Should Not Stick");
    await page
      .getByRole("button", { name: `Cancel editing ${target.name}` })
      .click();

    // exact: true — otherwise this also matches the row's "Edit {target.name}"
    // button, whose cell's accessible name contains target.name as a substring.
    const row = page.getByRole("row").filter({ hasText: target.email });
    await expect(
      row.getByRole("cell", { name: target.name, exact: true }),
    ).toBeVisible();

    // Reload to prove the discarded edit was never persisted server-side.
    await page.reload();
    const reloadedRow = page.getByRole("row").filter({ hasText: target.email });
    await expect(
      reloadedRow.getByRole("cell", { name: target.name, exact: true }),
    ).toBeVisible();
  });

  test("a duplicate email in the row editor surfaces the server error and stays in edit mode", async ({
    page,
  }) => {
    const adminCookie = await signInAsAdmin();
    const existing = await createThrowawayUser(adminCookie, "ui-dup-existing");
    const editing = await createThrowawayUser(adminCookie, "ui-dup-editing");

    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");
    await expect(
      page.getByRole("row").filter({ hasText: editing.email }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Edit ${editing.name}` }).click();
    await page.getByLabel(`Email for ${editing.name}`).fill(existing.email);
    await page.getByRole("button", { name: `Save ${editing.name}` }).click();

    await expect(
      page.getByText("a user with that email already exists"),
    ).toBeVisible();

    // The row must still be in edit mode — the editor fields stay visible.
    await expect(page.getByLabel(`Email for ${editing.name}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Save ${editing.name}` }),
    ).toBeVisible();
  });
});
