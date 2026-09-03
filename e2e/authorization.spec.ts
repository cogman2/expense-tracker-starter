import { expect, test } from "@playwright/test";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";

// Covers client/src/RequireAdmin.tsx (the client-side authorization guard for
// the admin-only /users section). Server-side enforcement lives in
// server/src/require-auth.ts and is exercised separately in api-auth.spec.ts.
test.describe("Authorization (RequireAdmin)", () => {
  test("admin can load /users", async ({ page }) => {
    await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);

    await page.goto("/users");

    await expect(page).toHaveURL("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("agent visiting /users is redirected to /", async ({ page }) => {
    await loginAndWaitForHome(page, AGENT.email, AGENT.password);

    await page.goto("/users");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });

  test("unauthenticated visit to /users redirects to /login", async ({
    page,
  }) => {
    await page.goto("/users");

    await expect(page).toHaveURL("/login");
  });

  test("an agent who signs in after being redirected from /users still cannot reach it", async ({
    page,
  }) => {
    // Direct, deep-link style navigation straight to the admin route.
    await page.goto("/users");
    await expect(page).toHaveURL("/login");

    await page.getByLabel("Email").fill(AGENT.email);
    await page.getByLabel("Password").fill(AGENT.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // LoginPage always navigates to "/" on success (it doesn't preserve the
    // originally requested URL), and RequireAdmin then confirms the agent
    // still can't reach /users directly.
    await expect(page).toHaveURL("/");

    await page.goto("/users");
    await expect(page).toHaveURL("/");
  });

  test("role differences: both admin and agent reach /, only admin reaches /users", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const agentContext = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const agentPage = await agentContext.newPage();

      await loginAndWaitForHome(adminPage, ADMIN.email, ADMIN.password);
      await loginAndWaitForHome(agentPage, AGENT.email, AGENT.password);

      await adminPage.goto("/users");
      await expect(adminPage).toHaveURL("/users");
      await expect(
        adminPage.getByRole("heading", { name: "Users" }),
      ).toBeVisible();

      await agentPage.goto("/users");
      await expect(agentPage).toHaveURL("/");
      await expect(
        agentPage.getByRole("heading", { name: "Helpdesk" }),
      ).toBeVisible();
    } finally {
      await adminContext.close();
      await agentContext.close();
    }
  });
});
