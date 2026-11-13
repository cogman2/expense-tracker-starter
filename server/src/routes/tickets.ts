// The ticket list. Tickets are created by the inbound-email webhook
// (./webhooks.ts); this is how agents see them. Every signed-in user may read
// it — working tickets is the agent's job — so only requireAuth guards it.
import express from "express";
import {
  TICKETS_PAGE_SIZE,
  createReplySchema,
  ticketIdParamSchema,
  ticketListQuerySchema,
  updateTicketSchema,
} from "core";
import { prisma } from "../db";
import { pageWindow } from "../pagination";
import { requireAuth } from "../require-auth";
import { HttpError } from "../http-error";
import { parseBody, parseOrThrow } from "../schemas";
import { activeFilters, ticketWhere } from "../ticket-filters";
import { ticketOrderBy } from "../ticket-sort";

export const ticketsRouter = express.Router();

// What every ticket payload says about its assignee: enough to show and pick
// them, never their email or role.
const ASSIGNEE_SELECT = { select: { id: true, name: true } } as const;

// A ticket as the list shows it, and the part of the detail page above the
// thread. Explicit fields keep message bodies (and everything else) out.
const TICKET_ROW_SELECT = {
  id: true,
  subject: true,
  status: true,
  category: true,
  createdAt: true,
  customer: { select: { name: true, email: true } },
  assignee: ASSIGNEE_SELECT,
} as const;

// A reply as every payload shows it. The author is shown like an assignee: by
// name, never by email or role.
const REPLY_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: ASSIGNEE_SELECT,
} as const;

/** The ticket's id, or a 404 when no ticket has it. For routes that write to one. */
async function findTicketOr404(id: number): Promise<{ id: number }> {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true } });
  if (!ticket) throw new HttpError(404, "ticket not found");
  return ticket;
}

// One page at a time, narrowed by any filters (?category=…, from core's
// TICKET_FILTERS) and in the order ?sort=&order= ask for (newest first when
// they're missing). Filtering and sorting happen here, not in the browser, so
// they hold across every page, and `total` counts only the matching tickets —
// the count shares findMany's `where`. ticketOrderBy (../ticket-sort.ts) breaks
// ties by id, so a ticket can't appear on two pages or on none. A page past the
// end is an empty list, not an error. Explicit `select` keeps the payload to
// what the list shows — no message bodies.
ticketsRouter.get("/api/tickets", requireAuth, async (req, res) => {
  const query = parseOrThrow(ticketListQuerySchema, req.query);
  const { page, sort, order } = query;
  const filters = activeFilters(query);
  const where = ticketWhere(filters);

  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      orderBy: ticketOrderBy(sort, order),
      ...pageWindow(page, TICKETS_PAGE_SIZE),
      select: TICKET_ROW_SELECT,
    }),
    prisma.ticket.count({ where }),
  ]);

  res.json({
    tickets,
    total,
    page,
    pageSize: TICKETS_PAGE_SIZE,
    sort,
    order,
    filters,
  });
});

// The staff a ticket can be assigned to: every active user, admin or agent, by
// name. Registered before /api/tickets/:id, which would otherwise take
// "assignees" as an id and answer 400.
ticketsRouter.get("/api/tickets/assignees", requireAuth, async (_req, res) => {
  const assignees = await prisma.user.findMany({
    where: { deletedAt: null },
    select: ASSIGNEE_SELECT.select,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  res.json({ assignees });
});

// One ticket, its email thread and its staff replies, each oldest first. Same
// guard as the list.
// The messages carry bodyText only: bodyHtml is untrusted inbound markup the
// client must never render, so it stays out of the payload, as do the threading
// headers (messageId, inReplyTo, references), which only the webhook needs.
ticketsRouter.get("/api/tickets/:id", requireAuth, async (req, res) => {
  const id = parseOrThrow(ticketIdParamSchema, req.params.id);

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      ...TICKET_ROW_SELECT,
      messages: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true,
          fromEmail: true,
          fromName: true,
          subject: true,
          bodyText: true,
          receivedAt: true,
        },
      },
      // The id breaks ties, so replies posted in the same millisecond keep
      // one order across reloads.
      replies: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: REPLY_SELECT,
      },
    },
  });
  if (!ticket) throw new HttpError(404, "ticket not found");
  res.json({ ticket });
});

// A partial update of the ticket: its assignee ({ assigneeId: null } unassigns),
// status and/or category ({ category: null } uncategorizes). Absent fields are
// left as they are. Any signed-in user may, as anyone may read the list: agents
// pick tickets up, hand them on, categorize and resolve them. An assignee must
// be an active user — a soft-deleted one is gone as far as the API is concerned.
//
// When an assignee is named, the check and the write share a transaction that
// holds the assignee's row FOR SHARE, so they can't interleave with
// DELETE /api/users/:id (./users.ts): a delete that started first is waited for
// and the user then reads as gone (400); one that starts after waits for this
// commit, then unassigns the ticket. Checked separately, a ticket could be left
// assigned to a deleted user.
ticketsRouter.patch("/api/tickets/:id", requireAuth, async (req, res) => {
  const id = parseOrThrow(ticketIdParamSchema, req.params.id);
  // Undefined fields are skipped by Prisma, so only what was sent changes.
  const { assigneeId, status, category } = parseBody(updateTicketSchema, req.body);

  const ticket = await findTicketOr404(id);

  const updated = await prisma.$transaction(async (tx) => {
    if (typeof assigneeId === "string") {
      const active = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User"
        WHERE "id" = ${assigneeId} AND "deletedAt" IS NULL
        FOR SHARE`;
      if (active.length === 0) return null;
    }
    return tx.ticket.update({
      where: { id: ticket.id },
      data: { assigneeId, status, category },
      select: { id: true, status: true, category: true, assignee: ASSIGNEE_SELECT },
    });
  });
  if (!updated) throw new HttpError(400, "assignee must be an active user");
  res.json({ ticket: updated });
});

// Posts a staff reply to the ticket, authored by whoever is signed in. Any
// signed-in user may, as with PATCH: answering tickets is the agent's job.
// Nothing is emailed yet — outbound delivery comes with Phase 6 — so this only
// stores the reply for the thread.
ticketsRouter.post("/api/tickets/:id/replies", requireAuth, async (req, res) => {
  const id = parseOrThrow(ticketIdParamSchema, req.params.id);
  const { body } = parseBody(createReplySchema, req.body);

  const ticket = await findTicketOr404(id);
  // Nothing deletes tickets today, so the lookup above can't go stale before
  // this insert. When ticket deletion lands, answer the foreign-key miss (P2003)
  // with a 404 rather than the error handler's 500.
  const reply = await prisma.reply.create({
    data: { ticketId: ticket.id, authorId: req.auth!.user.id, body },
    select: REPLY_SELECT,
  });
  res.status(201).json({ reply });
});
