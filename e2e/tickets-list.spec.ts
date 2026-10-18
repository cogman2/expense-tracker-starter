import { expect, test } from "@playwright/test";
import { TicketStatus } from "core";
import { AGENT, loginAndWaitForHome } from "./auth-helpers";
import { buildEmail, createTicket, uid } from "./inbound-helpers";

// The DB is shared with specs running in parallel (inbound-*), so nothing here
// asserts absolute totals or exact page contents: tickets carry unique subjects
// and are found by them, and ordering is checked relatively.
const SERVER_URL = "http://localhost:3000";
const PAGE_SIZE = 25;

// Paging through the UI and the home page's Tickets link are unit-tested
// (client/src/TicketsPage.test.tsx, client/src/HomePage.test.tsx), and the page
// offset math in server/src/pagination.test.ts. This spec keeps what needs the
// real server and database.

type ApiTicket = {
  id: number;
  subject: string;
  status: string;
  createdAt: string;
  customer: { name: string | null; email: string };
};
type TicketList = { tickets: ApiTicket[]; total: number; page: number; pageSize: number };

async function agentCookie(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: AGENT.email, password: AGENT.password }),
  });
  expect(res.ok).toBe(true);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function listTickets(cookie: string, query = "") {
  return fetch(`${SERVER_URL}/api/tickets${query}`, { headers: { Cookie: cookie } });
}

/** Creates a ticket with a unique subject and customer name. */
async function newTicket(tag = uid()) {
  const subject = `List ${tag}`;
  const name = `Customer ${tag}`;
  const base = buildEmail();
  const { ticketId } = await createTicket({
    subject,
    from: { ...(base.from as object), name },
  });
  return { id: ticketId, subject, name, email: (base.from as { email: string }).email };
}

test.describe("GET /api/tickets", () => {
  test("is 401 when unauthenticated", async () => {
    const res = await fetch(`${SERVER_URL}/api/tickets`);
    expect(res.status).toBe(401);
  });

  test("an agent gets page 1, 25 per page, with a new ticket's fields", async () => {
    const created = await newTicket();
    const res = await listTickets(await agentCookie());
    expect(res.status).toBe(200);
    const body = (await res.json()) as TicketList;
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(PAGE_SIZE);
    expect(body.tickets.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(body.total).toBeGreaterThanOrEqual(body.tickets.length);

    const row = body.tickets.find((t) => t.id === created.id);
    expect(row).toMatchObject({
      subject: created.subject,
      status: TicketStatus.open,
      customer: { name: created.name, email: created.email },
    });
  });

  // One invalid page is enough to show the route answers with the schema's
  // message; the rules themselves are unit-tested in core/src/schemas/tickets.test.ts.
  test("rejects ?page=0 with 400 and the schema message", async () => {
    const res = await listTickets(await agentCookie(), "?page=0");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "page must be a whole number of 1 or more",
    });
  });

  test("returns an empty page far past the end", async () => {
    const res = await listTickets(await agentCookie(), "?page=99999");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TicketList;
    expect(body.tickets).toEqual([]);
    expect(body.page).toBe(99999);
  });
});

test.describe("Tickets page (agent)", () => {
  // A ticket's row as the real server returns it, and the newer of two tickets
  // above the older (newest first).
  test("the list shows a new ticket's row, newest ticket first", async ({ page }) => {
    const older = await newTicket();
    const newer = await newTicket();
    await loginAndWaitForHome(page, AGENT.email, AGENT.password);
    await page.goto("/tickets");

    const olderRow = page.getByRole("row").filter({ hasText: older.subject });
    await expect(olderRow.getByRole("cell", { name: `#${older.id}`, exact: true })).toBeVisible();
    await expect(olderRow.getByRole("cell", { name: older.name })).toBeVisible();
    await expect(olderRow.getByRole("cell", { name: TicketStatus.open, exact: true })).toBeVisible();

    await expect(page.getByRole("row").filter({ hasText: newer.subject })).toBeVisible();
    const rows = await page.getByRole("row").allTextContents();
    const at = (s: string) => rows.findIndex((t) => t.includes(s));
    expect(at(newer.subject)).toBeLessThan(at(older.subject));
  });
});
