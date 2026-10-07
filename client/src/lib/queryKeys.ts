// Central query-key factory. Keys are hierarchical so a broad invalidation
// covers every narrower variant beneath it: invalidating `users.all` also
// refreshes every filtered or paginated list built by `users.list`.
//
// Keep new entities in this shape — it is what keeps filters and pagination
// cheap to add later.

/** Filters for the users list. Empty today; widen as the list grows. */
export interface UserFilters {
  role?: "admin" | "agent";
  search?: string;
}

export const queryKeys = {
  health: ["health"] as const,
  users: {
    all: ["users"] as const,
    list: (filters?: UserFilters) => ["users", "list", filters ?? {}] as const,
  },
} as const;
