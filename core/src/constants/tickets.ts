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

/**
 * What a ticket is about. Optional on a ticket: inbound email arrives
 * uncategorized, so the column is null until someone sets it. server/src/schemas.ts
 * asserts at compile time that this matches Prisma's TicketCategory enum.
 */
export const TICKET_CATEGORIES = [
  "general_question",
  "technical_question",
  "refund_request",
] as const;

export type TicketCategoryValue = (typeof TICKET_CATEGORIES)[number];

/** The categories by name, kept exhaustive and exact like `TicketStatus`. */
export const TicketCategory = {
  general_question: "general_question",
  technical_question: "technical_question",
  refund_request: "refund_request",
} as const satisfies { [C in TicketCategoryValue]: C };
