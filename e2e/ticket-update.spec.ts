import { expect, test } from "@playwright/test";
import { TicketCategory, TicketStatus } from "core";
import { SERVER_URL, agentCookie, patchTicket } from "./api-helpers";
import { ADMIN } from "./auth-helpers";
import { db } from "./db";
import { createTicket } from "./inbound-helpers";

// PATCH /api/tickets/:id as a partial update (status, category, assignee) against
// the real database. Kept elsewhere so this spec doesn't repeat them:
// - the pickers: client/src/TicketDetailPage.test.tsx
// - the body's rules and 400 wording: core/src/schemas/tickets.test.ts
// - 401, 404, a malformed id, an empty body and soft-deleted assignees:
//   e2e/ticket-assignment.spec.ts
type Assignee = { id: string; name: string };
type TicketFields = {
  id: number;
  status: string;
  category: string | null;
  assignee: Assignee | null;
};

async function getTicket(id: number, cookie: string): Promise<TicketFields> {
  const res = await fetch(`${SERVER_URL}/api/tickets/${id}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const { ticket } = (await res.json()) as { ticket: TicketFields };
  return ticket;
}

const adminAssignee = async (): Promise<Assignee> => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  return { id: admin.id, name: ADMIN.name };
};

test.describe("PATCH /api/tickets/:id partial update", () => {
  test("sets assignee, status and category in one request and persists all three", async () => {
    const cookie = await agentCookie();
    const admin = await adminAssignee();
    const { ticketId } = await createTicket();

    const res = await patchTicket(
      ticketId,
      {
        assigneeId: admin.id,
        status: TicketStatus.resolved,
        category: TicketCategory.refund_request,
      },
      cookie,
    );
    expect(res.status).toBe(200);
    const expected = {
      id: ticketId,
      status: TicketStatus.resolved,
      category: TicketCategory.refund_request,
      assignee: admin,
    };
    expect(await res.json()).toEqual({ ticket: expected });
    expect(await getTicket(ticketId, cookie)).toMatchObject(expected);
  });

  test("updating only the status leaves the assignee and category untouched", async () => {
    const cookie = await agentCookie();
    const admin = await adminAssignee();
    const { ticketId } = await createTicket();
    const setup = await patchTicket(
      ticketId,
      { assigneeId: admin.id, category: TicketCategory.technical_question },
      cookie,
    );
    expect(setup.status).toBe(200);

    const res = await patchTicket(ticketId, { status: TicketStatus.closed }, cookie);
    expect(res.status).toBe(200);
    const expected = {
      id: ticketId,
      status: TicketStatus.closed,
      category: TicketCategory.technical_question,
      assignee: admin,
    };
    expect(await res.json()).toEqual({ ticket: expected });
    expect(await getTicket(ticketId, cookie)).toMatchObject(expected);
  });

  test("assigneeId: null with category: null clears both, leaving the status", async () => {
    const cookie = await agentCookie();
    const admin = await adminAssignee();
    const { ticketId } = await createTicket();
    const setup = await patchTicket(
      ticketId,
      { assigneeId: admin.id, category: TicketCategory.general_question },
      cookie,
    );
    expect(setup.status).toBe(200);

    const res = await patchTicket(ticketId, { assigneeId: null, category: null }, cookie);
    expect(res.status).toBe(200);
    const expected = { id: ticketId, status: TicketStatus.open, category: null, assignee: null };
    expect(await res.json()).toEqual({ ticket: expected });
    expect(await getTicket(ticketId, cookie)).toMatchObject(expected);
  });

  // The assignee check runs before the write, inside one transaction: a refused
  // assignee must not let the request's other fields through.
  test("a rejected assignee writes nothing, not even the other fields", async () => {
    const cookie = await agentCookie();
    const { ticketId } = await createTicket();

    const res = await patchTicket(
      ticketId,
      {
        assigneeId: "no-such-user",
        status: TicketStatus.closed,
        category: TicketCategory.technical_question,
      },
      cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "assignee must be an active user" });
    expect(await getTicket(ticketId, cookie)).toMatchObject({
      id: ticketId,
      status: TicketStatus.open,
      category: null,
      assignee: null,
    });
  });
});
