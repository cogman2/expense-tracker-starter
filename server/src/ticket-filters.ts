// Pure filtering for the ticket list, kept out of the route so unit tests can
// import it without a database (like ticket-sort.ts). It knows no filter by
// name: every entry in core's TICKET_FILTERS (core/src/filters/tickets.ts) is
// keyed by the Ticket column it narrows, so a new entry filters here with no
// change to this file. Type-only Prisma import.
import { TICKET_FILTER_KEYS, type TicketFilterKey, type TicketFilterValue, type TicketFilterValues } from "core";
import type { Prisma } from "./generated/prisma/client";

type TicketWhere = Prisma.TicketWhereInput;

// Compile-time check that every filter key is a Ticket column that accepts the
// filter's values as an equality match. A registry entry keyed by something
// that isn't a column — or whose values the column can't hold — fails
// `bun run typecheck` here, which is what makes the loop below safe.
type Assert<T extends true> = T;
type FilterMatchesColumn<K extends TicketFilterKey> = K extends keyof TicketWhere
  ? [TicketFilterValue<K>] extends [TicketWhere[K]]
    ? true
    : false
  : false;
export type TicketFiltersMatchColumns = Assert<
  FilterMatchesColumn<TicketFilterKey> extends true ? true : false
>;

/**
 * Just the filters from a parsed query, and only those present: what the list
 * is narrowed by, as the route echoes it back. Page, sort and order are dropped.
 */
export function activeFilters(query: TicketFilterValues): TicketFilterValues {
  const filters: Partial<Record<TicketFilterKey, unknown>> = {};
  for (const key of TICKET_FILTER_KEYS) {
    const value = query[key];
    if (value !== undefined) filters[key] = value;
  }
  // Each key was copied from `query` under the same key, so the types carry over.
  return filters as TicketFilterValues;
}

/**
 * The Prisma `where` for the active filters: an equality match per filter
 * present, ANDed together. No filters means every ticket (`{}`). Anything else
 * in the query — page, sort, order — is ignored.
 */
export function ticketWhere(query: TicketFilterValues): TicketWhere {
  // Sound by TicketFiltersMatchColumns: each key is a column taking its value.
  return activeFilters(query) as TicketWhere;
}
