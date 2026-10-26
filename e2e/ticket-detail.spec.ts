import { expect, test } from "@playwright/test";
import { SortOrder, TICKETS_PAGE_SIZE, TicketSortField, TicketStatus } from "core";
import { AGENT, loginAndWaitForHome } from "./auth-helpers";
import { db } from "./db";
import { buildEmail, createTicket, send, uid } from "./inbound-helpers";

// Rendering, 404/error states and the back-link round trip are unit-tested in
// client/src/TicketDetailPage.test.tsx; this spec keeps what needs the real stack.
const SERVER_URL = "http://localhost:3000";

async function agentCookie(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: AGENT.email, password: AGENT.password }),
  });
  expect(res.ok).toBe(true);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function getTicket(id: string | number, cookie?: string) {
  return fetch(`${SERVER_URL}/api/tickets/${id}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test.describe("GET /api/tickets/:id", () => {
  test("is 401 when unauthenticated", async () => {
    const res = await getTicket(1);
    expect(res.status).toBe(401);
  });

  for (const id of ["abc", "0"]) {
    test(`rejects id "${id}" with 400 and the schema message`, async () => {
      const res = await getTicket(id, await agentCookie());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ticket id must be a whole number of 1 or more" });
    });
  }

  test("is 404 for a well-formed id that does not exist", async () => {
    const res = await getTicket(2147483647, await agentCookie());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ticket not found" });
  });

  test("returns the ticket with its messages oldest first and no HTML or threading fields", async () => {
    const tag = uid();
    const subject = `Detail ${tag}`;
    const first = buildEmail({
      subject,
      from: { email: `detail-${tag}@example.com`, name: `Customer ${tag}` },
      text: `First message ${tag}`,
      html: `<p>First html ${tag}</p>`,
    });
    const { ticketId } = await createTicket(first);
    const { result } = await send(
      {
        subject: `Re: ${subject}`,
        from: first.from,
        text: `Reply message ${tag}`,
        html: `<p>Reply html ${tag}</p>`,
        inReplyTo: `<${first.messageId}>`,
      },
      200,
    );
    expect(result.ticketId).toBe(ticketId);

    const res = await getTicket(ticketId, await agentCookie());
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as {
      ticket: {
        id: number;
        subject: string;
        status: string;
        category: string | null;
        createdAt: string;
        customer: { name: string | null; email: string };
        messages: Record<string, unknown>[];
      };
    };

    expect(ticket).toMatchObject({
      id: ticketId,
      subject,
      status: TicketStatus.open,
      customer: { name: `Customer ${tag}`, email: `detail-${tag}@example.com` },
    });
    expect(ticket).toHaveProperty("category");
    expect(Number.isNaN(Date.parse(ticket.createdAt))).toBe(false);

    expect(ticket.messages.map((m) => m.bodyText)).toEqual([
      `First message ${tag}`,
      `Reply message ${tag}`,
    ]);
    for (const m of ticket.messages) {
      expect(Object.keys(m).sort()).toEqual(
        ["bodyText", "fromEmail", "fromName", "id", "receivedAt", "subject"].sort(),
      );
      for (const key of ["bodyHtml", "messageId", "inReplyTo", "references"]) {
        expect(m).not.toHaveProperty(key);
      }
    }
    expect(Date.parse(String(ticket.messages[0]!.receivedAt))).toBeLessThanOrEqual(
      Date.parse(String(ticket.messages[1]!.receivedAt)),
    );
  });
});

test.describe("Ticket detail page (agent)", () => {
  test("clicking a ticket's subject on the list opens its detail page", async ({ page }) => {
    const tag = uid();
    const subject = `Open ${tag}`;
    const text = `Body for ${tag}`;
    const { ticketId } = await createTicket({ subject, text });

    // Oldest id first, the ticket's page is fixed: ids never change and no spec
    // deletes tickets, so parallel specs only add tickets after it.
    const before = await db.ticket.count({ where: { id: { lt: ticketId } } });
    const listPage = Math.floor(before / TICKETS_PAGE_SIZE) + 1;

    await loginAndWaitForHome(page, AGENT.email, AGENT.password);
    await page.goto(
      `/tickets?sort=${TicketSortField.id}&order=${SortOrder.asc}&page=${listPage}`,
    );
    await page.getByRole("link", { name: subject }).click();

    await expect(page).toHaveURL(`/tickets/${ticketId}`);
    await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();
  });
});
