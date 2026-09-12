import { expect, type Page } from "@playwright/test";

// Seeded accounts (see e2e/global-setup.ts). Both use the same password.
export const ADMIN = { email: "admin@example.com", password: "password123", name: "Admin" };
export const AGENT = { email: "agent@example.com", password: "password123", name: "Agent" };

/**
 * Fills and submits the login form. Does not assert on the outcome — callers
 * assert the redirect/error behavior they care about.
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Logs in and waits for the redirect to the home page. */
export async function loginAndWaitForHome(
  page: Page,
  email: string,
  password: string,
) {
  await login(page, email, password);
  await expect(page).toHaveURL("/");
}
