import { expect, test } from "@playwright/test";
import { ADMIN, loginAndWaitForHome } from "./auth-helpers";

// Covers the sign-out flow (client/src/HomePage.tsx's "Sign out" button) and
// what happens once the session is gone: protected routes must not be
// reachable again, whether via a fresh navigation or the browser's back
// button.
test.describe("Sign out", () => {
  test("sign out returns to /login", async ({ page }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/login");
  });

  test("after sign out, revisiting a protected route redirects to /login", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    await page.goto("/");

    await expect(page).toHaveURL("/login");
  });

  test("after sign out, navigating back does not restore protected content", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    // The router's history stack still has "/" in it, but the session cookie
    // is gone, so RequireAuth must bounce back to /login rather than showing
    // stale protected content.
    await page.goBack();

    await expect(page).toHaveURL("/login");
  });

  test("signing back in after sign out works and restores access", async ({
    page,
  }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });
});
