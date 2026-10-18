import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./auth-helpers";

test.describe("Login page", () => {
  test("successful sign-in redirects to the home page", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
    await expect(page.getByText("Admin")).toBeVisible();
  });

  test("invalid credentials show an error and stay on the login page", async ({
    page,
  }) => {
    await login(page, ADMIN.email, "wrong-password");

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("alert")).toHaveText(
      "Invalid email or password",
    );
  });

  test("invalid email shows a validation message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid email")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("empty password shows a required validation message", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Password is required")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("already authenticated user visiting /login is redirected home", async ({
    page,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL("/");

    await page.goto("/login");

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Helpdesk" }),
    ).toBeVisible();
  });
});
