// Pure ordering for the ticket list, kept out of the route so unit tests can
// import it without a database (like pagination.ts). Type-only Prisma import:
// nothing from the generated client loads at runtime.
import { TicketSortField, type SortOrderValue, type TicketSortFieldValue } from "core";
import type { Prisma } from "./generated/prisma/client";

type TicketOrderBy = Prisma.TicketOrderByWithRelationInput;

/**
 * The Prisma orderBy for one sort column and direction. Every sort but `id`
 * ends with the id in the same direction: it breaks ties (same subject, same
 * instant), so a ticket can't appear on two pages or on none.
 *
 * `customer` sorts as the list shows it — by name, then by address. Customers
 * who never gave a name sort last in both directions rather than bunching at
 * one end. `status` follows the Postgres enum's declaration order
 * (open → resolved → closed), i.e. workflow order, not alphabetical.
 */
export function ticketOrderBy(
  sort: TicketSortFieldValue,
  order: SortOrderValue,
): TicketOrderBy[] {
  const tieBreak: TicketOrderBy = { id: order };

  switch (sort) {
    case TicketSortField.id:
      return [tieBreak];
    case TicketSortField.customer:
      return [
        { customer: { name: { sort: order, nulls: "last" } } },
        { customer: { email: order } },
        tieBreak,
      ];
    case TicketSortField.subject:
    case TicketSortField.status:
    case TicketSortField.createdAt:
      return [{ [sort]: order }, tieBreak];
  }
}
