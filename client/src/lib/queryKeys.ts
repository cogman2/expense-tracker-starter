import type { TicketListQuery, UserRole } from "core";

// Central query-key factory. Keys are hierarchical so a broad invalidation
// covers every narrower variant beneath it: invalidating `users.all` also
// refreshes every filtered or paginated list built by `users.list`.
//
// Keep new entities in this shape — it is what keeps filters and pagination
// cheap to add later.

/** Filters for the users list. Empty today; widen as the list grows. */
export interface UserFilters {
  role?: UserRole;
  search?: string;
}

/**
 * Which slice of the ticket list: the page, its server-side sort and any
 * filters (core's TICKET_FILTERS) — the whole GET /api/tickets query, so each
 * page, ordering and selection caches separately. Not to be confused with the
 * TicketFilters component (client/src/TicketFilters.tsx), the filter controls.
 */
export type TicketListKey = TicketListQuery;

export const queryKeys = {
  health: ["health"] as const,
  users: {
    all: ["users"] as const,
    list: (filters?: UserFilters) => ["users", "list", filters ?? {}] as const,
  },
  tickets: {
    all: ["tickets"] as const,
    list: (query: TicketListKey) => ["tickets", "list", query] as const,
    detail: (id: number) => ["tickets", "detail", id] as const,
  },
} as const;
