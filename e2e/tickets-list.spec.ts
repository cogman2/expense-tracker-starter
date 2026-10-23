import { expect, test } from "@playwright/test";
import {
  SortOrder,
  TicketCategory,
  TicketSortField,
  TicketStatus,
  type SortOrderValue,
  type TicketCategoryValue,
  type TicketSortFieldValue,
  type TicketStatusValue,
} from "core";
import { AGENT, loginAndWaitForHome } from "./auth-helpers";
import { db } from "./db";
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
  category: TicketCategoryValue | null;
  createdAt: string;
  customer: { name: string | null; email: string };
};
type TicketList = {
  tickets: ApiTicket[];
  total: number;
  page: number;
  pageSize: number;
  sort: TicketSortFieldValue;
  order: SortOrderValue;
  filters: { category?: TicketCategoryValue };
};

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

/** Walks every page of a sorted listing; returns the tickets matching `keep`, deduped by id, in server order. */
async function walkSorted(
  cookie: string,
  sort: TicketSortFieldValue,
  order: SortOrderValue,
  keep: (t: ApiTicket) => boolean,
) {
  const seen = new Map<number, ApiTicket>();
  for (let page = 1; ; page++) {
    const res = await listTickets(cookie, `?sort=${sort}&order=${order}&page=${page}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TicketList;
    expect(body).toMatchObject({ sort, order });
    if (body.tickets.length === 0) break;
    for (const t of body.tickets) if (keep(t) && !seen.has(t.id)) seen.set(t.id, t);
  }
  return [...seen.values()];
}

/** Walks every page of a category-filtered listing in one pass; returns every ticket, the reported total and filters. */
async function walkCategory(cookie: string, category: TicketCategoryValue) {
  const tickets: ApiTicket[] = [];
  let first: TicketList | undefined;
  for (let page = 1; ; page++) {
    const res = await listTickets(cookie, `?category=${category}&page=${page}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TicketList;
    first ??= body;
    if (body.tickets.length === 0) break;
    tickets.push(...body.tickets);
  }
  return { tickets, total: first.total, filters: first.filters };
}

test.afterAll(async () => {
  await db.$disconnect();
});

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

  // Sorting must happen in the database across ALL tickets, so our tickets may
  // land on any page. Rather than rely on a prefix that sorts first/last (collation
  // dependent), walk every page and keep only our run-unique tickets, in the order
  // the server returned them.
  test("sorts by subject in the database, ascending and descending", async () => {
    const run = uid();
    // Created out of alphabetical order so insertion order can't pass the test.
    const created = [await newTicket(`${run} b`), await newTicket(`${run} c`), await newTicket(`${run} a`)];
    const cookie = await agentCookie();
    const ourSubjects = (order: SortOrderValue) =>
      walkSorted(cookie, TicketSortField.subject, order, (t) => t.subject.includes(run)).then((ts) =>
        ts.map((t) => t.subject),
      );

    const asc = created.map((t) => t.subject).sort();
    expect(await ourSubjects(SortOrder.asc)).toEqual(asc);
    expect(await ourSubjects(SortOrder.desc)).toEqual([...asc].reverse());
  });

  // Null ordering is Postgres behaviour (Prisma `nulls: "last"`), so it needs the real DB.
  test("sorts by customer name then email, unnamed customers last in both directions", async () => {
    const run = uid();
    // Created out of order; the unnamed customer's email would sort first alphabetically.
    const mk = async (email: string, name?: string) => {
      const { ticketId } = await createTicket({
        subject: `Cust ${run}`,
        from: name === undefined ? { email } : { email, name },
      });
      return ticketId;
    };
    const b = await mk(`${run}-b@example.com`, `${run} B`);
    const unnamed = await mk(`${run}-0@example.com`);
    const a = await mk(`${run}-z@example.com`, `${run} A`);
    const cookie = await agentCookie();
    const ours = (order: SortOrderValue) =>
      walkSorted(cookie, TicketSortField.customer, order, (t) => t.customer.email.includes(run)).then((ts) =>
        ts.map((t) => t.id),
      );

    expect(await ours(SortOrder.asc)).toEqual([a, b, unnamed]);
    expect(await ours(SortOrder.desc)).toEqual([b, a, unnamed]);
  });

  // The enum's declaration order lives in Postgres (open, resolved, closed), not in
  // JS, and differs from alphabetical order, so only the real DB can prove it.
  test("sorts by status in workflow order, not alphabetically", async () => {
    const run = uid();
    const withStatus = async (status: TicketStatusValue) => {
      const { id } = await newTicket(`${run} ${status}`);
      await db.ticket.update({ where: { id }, data: { status } });
      return id;
    };
    const resolved = await withStatus(TicketStatus.resolved);
    const closed = await withStatus(TicketStatus.closed);
    const open = await withStatus(TicketStatus.open);
    const cookie = await agentCookie();
    const ours = (order: SortOrderValue) =>
      walkSorted(cookie, TicketSortField.status, order, (t) => t.subject.includes(run)).then((ts) =>
        ts.map((t) => t.id),
      );

    expect(await ours(SortOrder.asc)).toEqual([open, resolved, closed]);
    expect(await ours(SortOrder.desc)).toEqual([closed, resolved, open]);
  });

  // Enum declaration order and NULLS LAST are Postgres behaviour; unit tests only check the orderBy shape.
  test("sorts by category in enum order, uncategorized last in both directions", async () => {
    const run = uid();
    const withCategory = async (tag: string, category: TicketCategoryValue | null) => {
      const { id } = await newTicket(`${run} ${tag}`);
      if (category) await db.ticket.update({ where: { id }, data: { category } });
      return id;
    };
    // Created scrambled so insertion/id order can't pass the test.
    const technical = await withCategory("t", TicketCategory.technical_question);
    const uncategorized = await withCategory("n", null);
    const refund = await withCategory("r", TicketCategory.refund_request);
    const general = await withCategory("g", TicketCategory.general_question);
    const cookie = await agentCookie();
    const ours = (order: SortOrderValue) =>
      walkSorted(cookie, TicketSortField.category, order, (t) => t.subject.includes(run)).then((ts) =>
        ts.map((t) => t.id),
      );

    expect(await ours(SortOrder.asc)).toEqual([general, technical, refund, uncategorized]);
    expect(await ours(SortOrder.desc)).toEqual([refund, technical, general, uncategorized]);
  });

  // One bad value shows the route answers with the schema's message; the rules
  // are unit-tested in core/src/schemas/tickets.test.ts.
  test("rejects ?sort=bogus with 400 and the schema message", async () => {
    const res = await listTickets(await agentCookie(), "?sort=bogus");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "sort must be one of: id, subject, customer, status, category, createdAt",
    });
  });

  // The WHERE must reach both findMany and count in Postgres, so only the real DB
  // proves `total` is the filtered total.
  test("filters by category in the database; total counts only the matches", async () => {
    const run = uid();
    const withCategory = async (tag: string, category: TicketCategoryValue | null) => {
      const { id } = await newTicket(`${run} ${tag}`);
      if (category) await db.ticket.update({ where: { id }, data: { category } });
      return id;
    };
    const refundA = await withCategory("r1", TicketCategory.refund_request);
    const refundB = await withCategory("r2", TicketCategory.refund_request);
    const technical = await withCategory("t", TicketCategory.technical_question);
    const uncategorized = await withCategory("n", null);
    const cookie = await agentCookie();

    const { tickets, total, filters } = await walkCategory(cookie, TicketCategory.refund_request);
    const ids = tickets.map((t) => t.id);
    expect(tickets.every((t) => t.category === TicketCategory.refund_request)).toBe(true);
    expect(ids).toEqual(expect.arrayContaining([refundA, refundB]));
    expect(ids).not.toContain(technical);
    expect(ids).not.toContain(uncategorized);
    expect(filters).toEqual({ category: TicketCategory.refund_request });

    // Parallel specs may add tickets at any moment, so a db.ticket.count() taken
    // before/after the API calls could race. Instead the filtered total must equal
    // what one full walk collected, and be below the unfiltered total (read after,
    // when it can only have grown).
    expect(total).toBe(tickets.length);
    const unfiltered = (await (await listTickets(cookie)).json()) as TicketList;
    expect(unfiltered.filters).toEqual({});
    expect(total).toBeLessThan(unfiltered.total);
  });

  // One bad value shows the route answers with the schema's message; the rules
  // are unit-tested in core.
  test("rejects ?category=bogus with 400 and the schema message", async () => {
    const res = await listTickets(await agentCookie(), "?category=bogus");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "category must be one of: general_question, technical_question, refund_request",
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
