import { expect, test } from "@playwright/test";
import { ADMIN, loginAndWaitForHome } from "./auth-helpers";

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

  test("session persists across a page reload", async ({ page }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    await page.reload();

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });
});
