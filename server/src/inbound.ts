// Turns one inbound support email into a ticket, or adds it to the ticket it
// answers. HTTP lives in routes/webhooks.ts; the pure rules this relies on live
// in inbound-rules.ts, which unit tests import without a database.
import { TicketStatus, type InboundEmailInput } from "core";
import { prisma } from "./db";
import { Prisma } from "./generated/prisma/client";
import { parseTicketToken } from "./inbound-rules";

export type IngestOutcome = "created" | "appended" | "duplicate";

export async function ingestEmail(
  email: InboundEmailInput,
): Promise<{ ticketId: number; outcome: IngestOutcome }> {
  try {
    return await prisma.$transaction(async (tx) => {
      // A redelivery (providers retry on timeouts) is answered, not stored again.
      const seen = await tx.message.findUnique({
        where: { messageId: email.messageId },
        select: { ticketId: true },
      });
      if (seen) return { ticketId: seen.ticketId, outcome: "duplicate" };

      const ticket = await findThreadTicket(tx, email);

      // One customer per address; a name learned later fills a blank one.
      const customer = await tx.customer.upsert({
        where: { email: email.from.email },
        create: { email: email.from.email, name: email.from.name ?? null },
        update: {},
      });
      if (!customer.name && email.from.name) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { name: email.from.name },
        });
      }

      const message = {
        messageId: email.messageId,
        inReplyTo: email.inReplyTo ?? null,
        references: email.references,
        fromEmail: email.from.email,
        fromName: email.from.name ?? null,
        subject: email.subject,
        bodyText: email.text,
        bodyHtml: email.html ?? null,
      };

      if (ticket) {
        await tx.message.create({ data: { ...message, ticketId: ticket.id } });
        // The customer wrote again, so a ticket that was finished is not any more.
        if (ticket.status !== TicketStatus.open) {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { status: TicketStatus.open },
          });
        }
        return { ticketId: ticket.id, outcome: "appended" };
      }

      const created = await tx.ticket.create({
        data: {
          subject: email.subject,
          customerId: customer.id,
          messages: { create: message },
        },
        select: { id: true },
      });
      return { ticketId: created.id, outcome: "created" };
    });
  } catch (err) {
    // Two deliveries of the same email racing past the duplicate check: the
    // unique messageId lets one through, and the loser is a duplicate too.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const seen = await prisma.message.findUnique({
        where: { messageId: email.messageId },
        select: { ticketId: true },
      });
      if (seen) return { ticketId: seen.ticketId, outcome: "duplicate" };
    }
    throw err;
  }
}

// The ticket this email continues, if any. The subject token is checked against
// the sender, because ticket numbers are sequential and easy to guess; the reply
// headers are not, since they carry Message-IDs only a recipient would know.
async function findThreadTicket(
  tx: Prisma.TransactionClient,
  email: InboundEmailInput,
) {
  const tokenId = parseTicketToken(email.subject);
  if (tokenId !== null) {
    const ticket = await tx.ticket.findFirst({
      where: { id: tokenId, customer: { email: email.from.email } },
      select: { id: true, status: true },
    });
    if (ticket) return ticket;
  }

  const ids = [email.inReplyTo, ...email.references].filter(
    (id): id is string => !!id,
  );
  if (ids.length === 0) return null;
  const earlier = await tx.message.findFirst({
    where: { messageId: { in: ids } },
    orderBy: { receivedAt: "desc" },
    select: { ticket: { select: { id: true, status: true } } },
  });
  return earlier?.ticket ?? null;
}
