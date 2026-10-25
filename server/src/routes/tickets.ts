// The ticket list. Tickets are created by the inbound-email webhook
// (./webhooks.ts); this is how agents see them. Every signed-in user may read
// it — working tickets is the agent's job — so only requireAuth guards it.
import express from "express";
import { TICKETS_PAGE_SIZE, ticketListQuerySchema } from "core";
import { prisma } from "../db";
import { pageWindow } from "../pagination";
import { requireAuth } from "../require-auth";
import { firstIssueMessage } from "../schemas";
import { activeFilters, ticketWhere } from "../ticket-filters";
import { ticketOrderBy } from "../ticket-sort";

export const ticketsRouter = express.Router();

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
