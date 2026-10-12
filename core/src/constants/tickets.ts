/**
 * The states a ticket moves through. The single source of truth for both sides:
 * server/src/schemas.ts asserts at compile time that this matches Prisma's
 * TicketStatus enum.
 */
export const TICKET_STATUSES = ["open", "resolved", "closed"] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

/**
 * The statuses by name, so code that means one particular status says
 * `TicketStatus.open` rather than repeating the string. The `satisfies` clause
 * keeps it exhaustive and exact, as with `Role` in ../users.ts.
 */
export const TicketStatus = {
  open: "open",
  resolved: "resolved",
  closed: "closed",
} as const satisfies { [S in TicketStatusValue]: S };
