// The ticket list. Tickets are created by the inbound-email webhook
// (./webhooks.ts); this is how agents see them. Every signed-in user may read
// it — working tickets is the agent's job — so only requireAuth guards it.
import express from "express";
import {
  TICKETS_PAGE_SIZE,
  assignTicketSchema,
  ticketIdParamSchema,
  ticketListQuerySchema,
} from "core";
import { prisma } from "../db";
import { pageWindow } from "../pagination";
import { requireAuth } from "../require-auth";
import { firstIssueMessage } from "../schemas";
import { activeFilters, ticketWhere } from "../ticket-filters";
import { ticketOrderBy } from "../ticket-sort";

export const ticketsRouter = express.Router();

// What every ticket payload says about its assignee: enough to show and pick
// them, never their email or role.
const ASSIGNEE_SELECT = { select: { id: true, name: true } } as const;

// One page at a time, narrowed by any filters (?category=…, from core's
// TICKET_FILTERS) and in the order ?sort=&order= ask for (newest first when
// they're missing). Filtering and sorting happen here, not in the browser, so
// they hold across every page, and `total` counts only the matching tickets —
// the count shares findMany's `where`. ticketOrderBy (../ticket-sort.ts) breaks
// ties by id, so a ticket can't appear on two pages or on none. A page past the
// end is an empty list, not an error. Explicit `select` keeps the payload to
// what the list shows — no message bodies.
ticketsRouter.get("/api/tickets", requireAuth, async (req, res, next) => {
  const parsed = ticketListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssueMessage(parsed.error) });
    return;
  }
  const { page, sort, order } = parsed.data;
  const filters = activeFilters(parsed.data);
  const where = ticketWhere(filters);

  // Express 4 does not catch a rejected async handler; hand a database failure
  // to the JSON error handler (src/middleware/error-handler.ts) as a 500.
  try {
    const [tickets, total] = await prisma.$transaction([
      prisma.ticket.findMany({
        where,
        orderBy: ticketOrderBy(sort, order),
        ...pageWindow(page, TICKETS_PAGE_SIZE),
        select: {
          id: true,
          subject: true,
          status: true,
          category: true,
          createdAt: true,
          customer: { select: { name: true, email: true } },
          assignee: ASSIGNEE_SELECT,
        },
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
  } catch (err) {
    next(err);
  }
});

// The staff a ticket can be assigned to: every active user, admin or agent, by
// name. Registered before /api/tickets/:id, which would otherwise take
// "assignees" as an id and answer 400.
ticketsRouter.get("/api/tickets/assignees", requireAuth, async (_req, res, next) => {
  try {
    const assignees = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    res.json({ assignees });
  } catch (err) {
    next(err);
  }
});

// One ticket and its email thread, oldest message first. Same guard as the list.
// The messages carry bodyText only: bodyHtml is untrusted inbound markup the
// client must never render, so it stays out of the payload, as do the threading
// headers (messageId, inReplyTo, references), which only the webhook needs.
ticketsRouter.get("/api/tickets/:id", requireAuth, async (req, res, next) => {
  const parsed = ticketIdParamSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssueMessage(parsed.error) });
    return;
  }

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: parsed.data },
      select: {
        id: true,
        subject: true,
        status: true,
        category: true,
        createdAt: true,
        customer: { select: { name: true, email: true } },
        assignee: ASSIGNEE_SELECT,
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
      },
    });
    if (!ticket) {
      res.status(404).json({ error: "ticket not found" });
      return;
    }
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});

// Assigns the ticket to a staff user, or unassigns it ({ assigneeId: null }).
// Any signed-in user may, as anyone may read the list: agents pick tickets up
// and hand them on. The assignee must be an active user — a soft-deleted one is
// gone as far as the API is concerned.
//
// The check and the write share a transaction that holds the assignee's row
// FOR SHARE, so they can't interleave with DELETE /api/users/:id (./users.ts):
// a delete that started first is waited for and the user then reads as gone
// (400); one that starts after waits for this commit, then unassigns the ticket.
// Checked separately, a ticket could be left assigned to a deleted user.
ticketsRouter.patch("/api/tickets/:id", requireAuth, async (req, res, next) => {
  const id = ticketIdParamSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: firstIssueMessage(id.error) });
    return;
  }
  const body = assignTicketSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: firstIssueMessage(body.error) });
    return;
  }
  const { assigneeId } = body.data;

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: id.data },
      select: { id: true },
    });
    if (!ticket) {
      res.status(404).json({ error: "ticket not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (assigneeId !== null) {
        const active = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "User"
          WHERE "id" = ${assigneeId} AND "deletedAt" IS NULL
          FOR SHARE`;
        if (active.length === 0) return null;
      }
      return tx.ticket.update({
        where: { id: ticket.id },
        data: { assigneeId },
        select: { id: true, assignee: ASSIGNEE_SELECT },
      });
    });
    if (!updated) {
      res.status(400).json({ error: "assignee must be an active user" });
      return;
    }
    res.json({ ticket: updated });
  } catch (err) {
    next(err);
  }
});
