// The ticket list. Tickets are created by the inbound-email webhook
// (./webhooks.ts); this is how agents see them. Every signed-in user may read
// it — working tickets is the agent's job — so only requireAuth guards it.
import express from "express";
import { TICKETS_PAGE_SIZE, ticketListQuerySchema } from "core";
import { prisma } from "../db";
import { pageWindow } from "../pagination";
import { requireAuth } from "../require-auth";
import { firstIssueMessage } from "../schemas";

export const ticketsRouter = express.Router();

// Newest first, one page at a time. The id breaks ties between tickets created
// in the same instant, so a ticket can't appear on two pages or on none. A page
// past the end is an empty list, not an error. Explicit `select` keeps the
// payload to what the list shows — no message bodies.
ticketsRouter.get("/api/tickets", requireAuth, async (req, res, next) => {
  const parsed = ticketListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssueMessage(parsed.error) });
    return;
  }
  const { page } = parsed.data;

  // Express 4 does not catch a rejected async handler; hand a database failure
  // to the JSON error handler (src/middleware/error-handler.ts) as a 500.
  try {
    const [tickets, total] = await prisma.$transaction([
      prisma.ticket.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageWindow(page, TICKETS_PAGE_SIZE),
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          customer: { select: { name: true, email: true } },
        },
      }),
      prisma.ticket.count(),
    ]);

    res.json({ tickets, total, page, pageSize: TICKETS_PAGE_SIZE });
  } catch (err) {
    next(err);
  }
});
