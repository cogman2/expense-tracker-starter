import { expect, test, type Page } from "@playwright/test";
import { Role, type UserRole } from "core";
import { ADMIN, AGENT, login, loginAndWaitForHome } from "./auth-helpers";

// Happy-path, UI-only coverage of the user CRUD operations on /users.
// Every test creates its own uniquely named user, so none depends on another.

const PASSWORD = "password123";

function uniqueUser(label: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    name: `${label} ${suffix}`,
    email: `${label.toLowerCase()}-${suffix}@example.com`,
  };
}

const rowFor = (page: Page, text: string) =>
  page.getByRole("row").filter({ hasText: text });

async function gotoUsersAsAdmin(page: Page) {
  await loginAndWaitForHome(page, ADMIN.email, ADMIN.password);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
}

async function createUserViaForm(
  page: Page,
  user: { name: string; email: string },
  role: UserRole,
) {
  await page.getByLabel("Name", { exact: true }).fill(user.name);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(
    page.getByText(`Created ${role} account for ${user.email}.`),
  ).toBeVisible();
  await expect(rowFor(page, user.email)).toBeVisible();
}

async function editUserViaRow(
  page: Page,
  current: { name: string },
  next: { name: string; email: string; role: UserRole },
) {
  await page.getByRole("button", { name: `Edit ${current.name}`, exact: true }).click();
  await page.getByLabel(`Name for ${current.name}`, { exact: true }).fill(next.name);
  await page.getByLabel(`Email for ${current.name}`, { exact: true }).fill(next.email);
  await page.getByLabel(`Role for ${current.name}`, { exact: true }).selectOption(next.role);
  await page.getByRole("button", { name: `Save ${current.name}`, exact: true }).click();
  await expect(page.getByText(`Saved changes to ${next.email}.`)).toBeVisible();
}

async function deleteUserViaDialog(
  page: Page,
  user: { name: string; email: string },
) {
  await page.getByRole("button", { name: `Delete ${user.name}`, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Delete user?")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(`Deleted ${user.email}.`)).toBeVisible();
  await expect(dialog).toBeHidden();
}

async function signOutAndLoginAs(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email, PASSWORD);
}

test.describe("User management (admin, /users)", () => {
  test("create: new user appears without reload and can sign in", async ({ page }) => {
    const user = uniqueUser("Created");
    await gotoUsersAsAdmin(page);

    await createUserViaForm(page, user, Role.agent);
    const row = rowFor(page, user.email);
    await expect(row).toContainText(user.name);
    await expect(row).toContainText(Role.agent);

    await signOutAndLoginAs(page, user.email);
    await expect(page).toHaveURL("/");
  });

  test("read: table lists seeded users and persists created users across reload", async ({ page }) => {
    const user = uniqueUser("Listed");
    await gotoUsersAsAdmin(page);

    const adminRow = rowFor(page, ADMIN.email);
    await expect(adminRow).toContainText(ADMIN.name);
    await expect(adminRow).toContainText(Role.admin);
    const agentRow = rowFor(page, AGENT.email);
    await expect(agentRow).toContainText(AGENT.name);
    await expect(agentRow).toContainText(Role.agent);

    await createUserViaForm(page, user, Role.agent);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    const row = rowFor(page, user.email);
    await expect(row).toContainText(user.name);
    await expect(row).toContainText(Role.agent);
  });

  test("update: edits name, email and role, persists, and new credentials work", async ({ page }) => {
    const original = uniqueUser("Before");
    const updated = { ...uniqueUser("After"), role: Role.admin };
    await gotoUsersAsAdmin(page);
    await createUserViaForm(page, original, Role.agent);

    await editUserViaRow(page, original, updated);

    const row = rowFor(page, updated.email);
    await expect(row).toContainText(updated.name);
    await expect(row).toContainText(Role.admin);
    await expect(rowFor(page, original.email)).toHaveCount(0);

    await page.reload();
    const reloaded = rowFor(page, updated.email);
    await expect(reloaded).toContainText(updated.name);
    await expect(reloaded).toContainText(Role.admin);
    await expect(rowFor(page, original.email)).toHaveCount(0);

    await signOutAndLoginAs(page, updated.email);
    await expect(page).toHaveURL("/");
    await page.goto("/users");
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("delete: confirmed delete removes the row and it stays gone after reload", async ({ page }) => {
    const user = uniqueUser("Doomed");
    await gotoUsersAsAdmin(page);
    await createUserViaForm(page, user, Role.agent);

    await deleteUserViaDialog(page, user);
    await expect(rowFor(page, user.email)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(rowFor(page, ADMIN.email)).toBeVisible();
    await expect(rowFor(page, user.email)).toHaveCount(0);
  });

  test("lifecycle: create, edit, then delete the same user", async ({ page }) => {
    const user = uniqueUser("Life");
    const edited = { ...uniqueUser("Renamed"), role: Role.admin };
    await gotoUsersAsAdmin(page);

    await createUserViaForm(page, user, Role.agent);
    await expect(rowFor(page, user.email)).toContainText(user.name);

    await editUserViaRow(page, user, edited);
    const row = rowFor(page, edited.email);
    await expect(row).toContainText(edited.name);
    await expect(row).toContainText(Role.admin);
    await expect(rowFor(page, user.email)).toHaveCount(0);

    // Edited users are admins now, which cannot be deleted; demote back first.
    await editUserViaRow(page, edited, { ...edited, role: Role.agent });
    await expect(rowFor(page, edited.email)).toContainText(Role.agent);

    await deleteUserViaDialog(page, edited);
    await expect(rowFor(page, edited.email)).toHaveCount(0);
    await page.reload();
    await expect(rowFor(page, ADMIN.email)).toBeVisible();
    await expect(rowFor(page, edited.email)).toHaveCount(0);
  });
});
