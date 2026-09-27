// Server-side validation glue. The schemas themselves live in the core package
// (core/src/users.ts) so the client's forms and this server parse against one
// definition; what stays here is how a failed parse becomes an HTTP response, and
// the guard that keeps core's role union tied to the database's.
import type { z } from "zod";
import { ROLES } from "core";
import type { Role } from "./generated/prisma/enums";

// Compile-time check that core's ROLES and Prisma's Role enum are the same set,
// in both directions: core cannot offer a role the column lacks, and a new role
// in the schema cannot go unoffered. A mismatch fails `bun run typecheck` here
// rather than at runtime in the adapter.
type Assert<T extends true> = T;
export type RolesMatchPrisma = Assert<
  [Role] extends [(typeof ROLES)[number]]
    ? [(typeof ROLES)[number]] extends [Role]
      ? true
      : false
    : false
>;

// The single message a failed parse answers with. Field order in the schema is
// what decides precedence when a request is wrong in more than one way.
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid request body";
}
