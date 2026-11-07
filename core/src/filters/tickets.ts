// The filters GET /api/tickets understands, declared once. Each entry is keyed
// by the Ticket column it narrows and carries everything every layer needs:
//
// - core/src/schemas/tickets.ts turns each entry into an optional query param
//   (`?category=refund_request`), validated against `values`;
// - server/src/ticket-filters.ts turns each present param into a Prisma
//   `where` clause (`{ category: "refund_request" }`);
// - client/src/TicketFilters.tsx renders one control per entry, captioned by
//   `label`, with a choice per value shown as its `optionLabels` entry.
//
// To add a filter, add an entry — e.g. by status:
//
//   status: defineFilter({
//     label: "Status",
//     values: TICKET_STATUSES,
//     optionLabels: { open: "Open", resolved: "Resolved", closed: "Closed" },
//   }),
//
// The key must be a Ticket column whose values are `values` (the server's
// typing enforces it); nothing else needs to change.
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS } from "../constants/tickets";

/** One filter: its caption, the values it accepts, and how each value reads. */
export interface FilterDefinition<V extends string> {
  label: string;
  values: readonly [V, ...V[]];
  optionLabels: { readonly [K in V]: string };
}

/**
 * Identity, for inference: it ties `optionLabels` to `values`, so a value
 * without a label fails the build. A label for a value the filter doesn't
 * accept is NOT caught here — TypeScript doesn't check excess keys on an object
 * passed by reference — so give each labels map its own `satisfies` clause, as
 * TICKET_CATEGORY_LABELS does (core/src/constants/tickets.ts). The registry test
 * (./tickets.test.ts) also checks every filter's labels match its values.
 */
export const defineFilter = <V extends string>(definition: FilterDefinition<V>) =>
  definition;

export const TICKET_FILTERS = {
  category: defineFilter({
    label: "Category",
    values: TICKET_CATEGORIES,
    optionLabels: TICKET_CATEGORY_LABELS,
  }),
};

export type TicketFilterKey = keyof typeof TICKET_FILTERS;

/** The registry's keys, in declaration order (the order the controls render in). */
export const TICKET_FILTER_KEYS = Object.keys(TICKET_FILTERS) as TicketFilterKey[];

/** The value one filter accepts, e.g. TicketFilterValue<"category">. */
export type TicketFilterValue<K extends TicketFilterKey> =
  (typeof TICKET_FILTERS)[K]["values"][number];

/** The active filters: each key present narrows the list; absent means all. */
export type TicketFilterValues = { [K in TicketFilterKey]?: TicketFilterValue<K> };
