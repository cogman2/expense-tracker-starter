import { expect, test } from "@playwright/test";
import { Role, SortOrder, TICKETS_PAGE_SIZE, TicketSortField } from "core";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";
import { db } from "./db";
import { createTicket, uid } from "./inbound-helpers";

// The select's UI states and the list column are unit-tested in
// client/src/TicketDetailPage.test.tsx and TicketsPage.test.tsx; this spec keeps
// what needs the real stack: PATCH /api/tickets/:id, GET /api/tickets/assignees,
// persistence, and the soft-delete cascade (server/src/routes/{tickets,users}.ts).
// Server checks use native fetch() (Playwright's request fixture is unreliable on Bun).
const SERVER_URL = "http://localhost:3000";

type Assignee = { id: string; name: string };
type ApiUser = { id: string; name: string; email: string };

async function signInCookie(email: string, password: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

const adminCookie = () => signInCookie(ADMIN.email, ADMIN.password);
const agentCookie = () => signInCookie(AGENT.email, AGENT.password);

function patchTicket(id: string | number, body: unknown, cookie?: string) {
  return fetch(`${SERVER_URL}/api/tickets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function getTicketAssignee(id: number, cookie: string): Promise<Assignee | null> {
  const res = await fetch(`${SERVER_URL}/api/tickets/${id}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { ticket: { assignee: Assignee | null } }).ticket.assignee;
}

async function getAssignees(cookie: string): Promise<Assignee[]> {
  const res = await fetch(`${SERVER_URL}/api/tickets/assignees`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { assignees: Assignee[] }).assignees;
}

async function seededId(email: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return user.id;
}

async function createThrowawayUser(cookie: string): Promise<ApiUser> {
  const tag = uid();
  const res = await fetch(`${SERVER_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: `Assignee ${tag}`,
      email: `assignee-${tag}@example.com`,
      password: "password123",
      role: Role.agent,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { user: ApiUser }).user;
}

function deleteUser(id: string, cookie: string) {
  return fetch(`${SERVER_URL}/api/users/${id}`, { method: "DELETE", headers: { Cookie: cookie } });
}

test.describe("PATCH /api/tickets/:id validation", () => {
  test("is 401 when signed out", async () => {
    const res = await patchTicket(1, { assigneeId: null });
    expect(res.status).toBe(401);
  });

  // One invalid case each is enough to show the route answers with the schema's
  // message; the rules themselves are unit-tested in core/src/schemas/tickets.test.ts.
  test("rejects a malformed ticket id with 400", async () => {
    const res = await patchTicket("abc", { assigneeId: null }, await agentCookie());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ticket id must be a whole number of 1 or more" });
  });

  test("rejects a missing assigneeId with 400", async () => {
    const { ticketId } = await createTicket();
    const res = await patchTicket(ticketId, {}, await agentCookie());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "assigneeId must be a user id or null" });
  });

  test("rejects an unknown assignee id with 400 and leaves the ticket unassigned", async () => {
    const cookie = await agentCookie();
    const { ticketId } = await createTicket();
    const res = await patchTicket(ticketId, { assigneeId: "no-such-user" }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "assignee must be an active user" });
    expect(await getTicketAssignee(ticketId, cookie)).toBeNull();
  });

  test("is 404 for a missing ticket, before the assignee is checked", async () => {
    const cookie = await agentCookie();
    const res = await patchTicket(2147483647, { assigneeId: "no-such-user" }, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ticket not found" });
  });
});

test.describe("assigning and unassigning", () => {
  test("an agent assigns a ticket to the admin; response, detail and list agree; null unassigns", async ({
    page,
  }) => {
    const cookie = await agentCookie();
    const adminId = await seededId(ADMIN.email);
    const subject = `Assign ${uid()}`;
    const { ticketId } = await createTicket({ subject });
    expect(await getTicketAssignee(ticketId, cookie)).toBeNull();

    const res = await patchTicket(ticketId, { assigneeId: adminId }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ticket: { id: ticketId, assignee: { id: adminId, name: ADMIN.name } },
    });
    expect(await getTicketAssignee(ticketId, cookie)).toEqual({ id: adminId, name: ADMIN.name });

    // The ticket's list page is fixed when sorting by id ascending (ids never change).
    const before = await db.ticket.count({ where: { id: { lt: ticketId } } });
    const listPage = Math.floor(before / TICKETS_PAGE_SIZE) + 1;
    const listUrl = `/tickets?sort=${TicketSortField.id}&order=${SortOrder.asc}&page=${listPage}`;

    await loginAndWaitForHome(page, AGENT.email, AGENT.password);
    await page.goto(listUrl);
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row.getByRole("cell", { name: ADMIN.name, exact: true })).toBeVisible();

    const clear = await patchTicket(ticketId, { assigneeId: null }, cookie);
    expect(clear.status).toBe(200);
    expect(await clear.json()).toEqual({ ticket: { id: ticketId, assignee: null } });
    expect(await getTicketAssignee(ticketId, cookie)).toBeNull();

    await page.goto(listUrl);
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name: ADMIN.name, exact: true })).toHaveCount(0);
    // Category is also "—" for a fresh ticket, so pick the Assignee column by header.
    const assigneeColumn = await page.getByRole("columnheader").evaluateAll(
      (headers) => headers.findIndex((h) => h.textContent?.includes("Assignee")),
    );
    expect(assigneeColumn).toBeGreaterThan(-1);
    await expect(row.getByRole("cell").nth(assigneeColumn)).toHaveText("—");
  });
});

test.describe("GET /api/tickets/assignees and soft-deleted users", () => {
  test("is 401 when signed out", async () => {
    const res = await fetch(`${SERVER_URL}/api/tickets/assignees`);
    expect(res.status).toBe(401);
  });

  test("lists the seeded admin and agent; a soft-deleted user drops out and cannot be assigned", async () => {
    const admin = await adminCookie();
    const agent = await agentCookie();
    const adminId = await seededId(ADMIN.email);
    const agentId = await seededId(AGENT.email);

    const listed = await getAssignees(agent);
    expect(listed).toEqual(
      expect.arrayContaining([
        { id: adminId, name: ADMIN.name },
        { id: agentId, name: AGENT.name },
      ]),
    );

    const doomed = await createThrowawayUser(admin);
    expect((await getAssignees(agent)).map((a) => a.id)).toContain(doomed.id);

    expect((await deleteUser(doomed.id, admin)).status).toBe(204);
    expect((await getAssignees(agent)).map((a) => a.id)).not.toContain(doomed.id);

    const { ticketId } = await createTicket();
    const res = await patchTicket(ticketId, { assigneeId: doomed.id }, agent);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "assignee must be an active user" });
    expect(await getTicketAssignee(ticketId, agent)).toBeNull();
  });

  test("deleting a user unassigns their tickets", async () => {
    const admin = await adminCookie();
    const agent = await agentCookie();
    const doomed = await createThrowawayUser(admin);
    const { ticketId } = await createTicket();
    const { ticketId: otherTicketId } = await createTicket();
    const agentId = await seededId(AGENT.email);

    const assigned = await patchTicket(ticketId, { assigneeId: doomed.id }, agent);
    expect(assigned.status).toBe(200);
    expect((await patchTicket(otherTicketId, { assigneeId: agentId }, agent)).status).toBe(200);
    expect(await getTicketAssignee(ticketId, agent)).toEqual({
      id: doomed.id,
      name: doomed.name,
    });

    expect((await deleteUser(doomed.id, admin)).status).toBe(204);
    expect(await getTicketAssignee(ticketId, agent)).toBeNull();
    // The cascade is scoped to the deleted user: another assignee is untouched.
    expect(await getTicketAssignee(otherTicketId, agent)).toEqual({ id: agentId, name: AGENT.name });
  });
});

test.describe("Assignee select (browser)", () => {
  test("an agent assigns the admin and the choice survives a reload", async ({ page }) => {
    const { ticketId } = await createTicket({ subject: `Pick ${uid()}` });

    await loginAndWaitForHome(page, AGENT.email, AGENT.password);
    await page.goto(`/tickets/${ticketId}`);

    const select = page.getByLabel("Assignee");
    await expect(select).toHaveValue("");
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/tickets/${ticketId}`) && r.request().method() === "PATCH",
    );
    await select.selectOption({ label: ADMIN.name });
    expect((await saved).status()).toBe(200);
    await expect(select).toHaveValue(await seededId(ADMIN.email));

    await page.reload();
    const reloaded = page.getByLabel("Assignee");
    await expect(reloaded).toHaveValue(await seededId(ADMIN.email));
    await expect(reloaded.locator("option:checked")).toHaveText(ADMIN.name);
  });
});
