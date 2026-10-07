import { expect, test } from "@playwright/test";
import { ADMIN, login, loginAndWaitForHome } from "./auth-helpers";

// Covers client/src/RequireAuth.tsx and the catch-all route in App.tsx.
// Login-form behavior itself (validation, error text, already-authenticated
// redirect from /login) is covered by login.spec.ts.
test.describe("Route guards (RequireAuth)", () => {
  test("unauthenticated visit to / redirects to /login", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL("/login");
  });

  test("unauthenticated visit to an unknown route redirects to /login", async ({
    page,
  }) => {
    // App.tsx's catch-all sends unknown paths to "/", which RequireAuth then
    // bounces to /login since there is no session.
    await page.goto("/this-route-does-not-exist");

    await expect(page).toHaveURL("/login");
  });

  test("authenticated visit to an unknown route redirects to /", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    await page.goto("/this-route-does-not-exist");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });

  test("after login, the originally-protected content renders", async ({
    page,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
    await expect(page.getByText(ADMIN.name)).toBeVisible();
  });

  test("session persists across a page reload", async ({ page }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    await page.reload();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });

  test("session persists across a fresh navigation (full page load)", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    // A full document navigation (e.g. typing the URL, following a bookmark)
    // rather than client-side routing — exercises the session cookie, not
    // just in-memory router state.
    await page.goto("/");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });
});
