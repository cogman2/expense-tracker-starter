import { expect, test } from "@playwright/test";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";
import { Role } from "core";

// Covers DELETE /api/users/:id (soft delete, server/src/routes/users.ts), the
// sign-in block in server/src/auth.ts, and the delete dialog on /users.
//
// Server-side checks use native `fetch()` with manual cookie threading, for the
// same Bun/Playwright APIRequestContext reason documented in user-editing.spec.ts.
const SERVER_URL = "http://localhost:3000";

type ApiUser = { id: string; name: string; email: string; role: string };

function sessionCookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected a Set-Cookie header on the response");
  }
  return setCookie.split(";")[0]!;
}

function signIn(email: string, password: string) {
  return fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function signInCookie(email: string, password: string): Promise<string> {
  const res = await signIn(email, password);
  expect(res.status).toBe(200);
  return sessionCookieFrom(res);
}

const signInAsAdmin = () => signInCookie(ADMIN.email, ADMIN.password);
const signInAsAgent = () => signInCookie(AGENT.email, AGENT.password);

function getMe(cookie: string) {
  return fetch(`${SERVER_URL}/api/me`, { headers: { Cookie: cookie } });
}

function listUsers(cookie: string) {
  return fetch(`${SERVER_URL}/api/users`, { headers: { Cookie: cookie } });
}

function deleteUser(id: string, cookie?: string) {
  return fetch(`${SERVER_URL}/api/users/${id}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function patchUser(id: string, body: object, cookie: string) {
  return fetch(`${SERVER_URL}/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function createUser(body: object, cookie: string) {
  return fetch(`${SERVER_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function uniqueEmail(label: string): string {
  return `${label}-${test.info().testId}-${Date.now()}@example.com`;
}

// Keep "name"/"email"/"role" out of persisted display names: they would make
// "Delete {name}" buttons match other specs' generic getByLabel() locators.
function nameSafeTag(label: string): string {
  return label.replace(/name|email|role/gi, "x");
}

async function createThrowawayUser(
  adminCookie: string,
  label: string,
): Promise<ApiUser> {
  const res = await createUser(
    {
      name: `Doomed ${nameSafeTag(label)}`,
      email: uniqueEmail(label),
      password: "password123",
      role: Role.agent,
    },
    adminCookie,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { user: ApiUser }).user;
}

test.describe("DELETE /api/users/:id enforcement", () => {
  test("unauthenticated request is rejected with 401", async () => {
    const res = await deleteUser("anything");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("agent (non-admin) request is rejected with 403", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "agent-forbidden");
    const agentCookie = await signInAsAgent();

    const res = await deleteUser(target.id, agentCookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });

    // The target must be untouched.
    const list = (await (await listUsers(adminCookie)).json()) as {
      users: ApiUser[];
    };
    expect(list.users.map((u) => u.id)).toContain(target.id);
  });

  test("deleting an admin (including yourself) is rejected with 409", async () => {
    const adminCookie = await signInAsAdmin();
    const me = ((await (await getMe(adminCookie)).json()) as { user: ApiUser })
      .user;
    expect(me.role).toBe(Role.admin);

    const res = await deleteUser(me.id, adminCookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "admin users cannot be deleted" });

    // Still signed in and still listed.
    expect((await getMe(adminCookie)).status).toBe(200);
  });

  test("unknown id is rejected with 404", async () => {
    const adminCookie = await signInAsAdmin();
    const res = await deleteUser("does-not-exist-id", adminCookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "user not found" });
  });
});

test.describe("soft-delete lifecycle", () => {
  test("a deleted user disappears, is signed out, cannot sign in, and their email stays taken", async () => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "lifecycle");
    const targetCookie = await signInCookie(target.email, "password123");
    expect((await getMe(targetCookie)).status).toBe(200);

    const res = await deleteUser(target.id, adminCookie);
    expect(res.status).toBe(204);

    // No longer listed.
    const list = (await (await listUsers(adminCookie)).json()) as {
      users: ApiUser[];
    };
    expect(list.users.map((u) => u.id)).not.toContain(target.id);

    // Existing session was revoked.
    expect((await getMe(targetCookie)).status).toBe(401);

    // Signing in again is refused.
    const reSignIn = await signIn(target.email, "password123");
    expect(reSignIn.ok).toBe(false);

    // Second delete -> 404.
    const second = await deleteUser(target.id, adminCookie);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: "user not found" });

    // PATCH on a deleted user -> 404.
    const patch = await patchUser(
      target.id,
      { name: "Revived", email: uniqueEmail("revive"), role: Role.agent },
      adminCookie,
    );
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: "user not found" });

    // The email remains reserved.
    const recreate = await createUser(
      {
        name: "Second Coming",
        email: target.email,
        password: "password123",
        role: Role.agent,
      },
      adminCookie,
    );
    expect(recreate.status).toBe(409);
    expect(await recreate.json()).toEqual({
      error: "a user with that email already exists",
    });
  });
});

test.describe("UI: delete dialog (/users)", () => {
  test("the admin row has no Delete button", async ({ page }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");

    const adminRow = page.getByRole("row").filter({ hasText: ADMIN.email });
    await expect(adminRow).toBeVisible();
    await expect(
      adminRow.getByRole("button", { name: /^Delete / }),
    ).toHaveCount(0);
  });

  test("Cancel closes the dialog and leaves the row and the user intact", async ({
    page,
  }) => {
    const adminCookie = await signInAsAdmin();
    const target = await createThrowawayUser(adminCookie, "ui-cancel-del");

    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.goto("/users");
    const row = page.getByRole("row").filter({ hasText: target.email });
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: `Delete ${target.name}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Delete user?")).toBeVisible();
    await expect(dialog).toContainText(target.name);
    await expect(dialog).toContainText(target.email);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
    await expect(page.getByText(`Deleted ${target.email}.`)).toHaveCount(0);

    // Still present server-side.
    const list = (await (await listUsers(adminCookie)).json()) as {
      users: ApiUser[];
    };
    expect(list.users.map((u) => u.id)).toContain(target.id);
  });
});
