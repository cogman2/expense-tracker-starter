// Compile-time checks. Nothing here exists at runtime: a check that fails makes
// `bun run typecheck` fail at the line that uses it.

/** Compiles only when `T` is `true`. */
export type Assert<T extends true> = T;

/**
 * `true` when A and B are the same set of members, in both directions — e.g. a
 * union in core and the Prisma enum it must match: neither can have a value the
 * other lacks. Wrapped in tuples so unions are compared whole, not member by
 * member.
 */
export type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// SameMembers must reject a missing or extra member, or every check built on it
// would pass vacuously.
export type SameMembersRejectsMismatch = Assert<
  SameMembers<"a", "a" | "b"> extends false
    ? SameMembers<"a" | "b", "a"> extends false
      ? SameMembers<"a" | "b", "b" | "a">
      : false
    : false
>;
