// Server-side validation glue. The schemas themselves live in the core package
// (core/src/users.ts) so the client's forms and this server parse against one
// definition; what stays here is how a failed parse becomes an HTTP response, and
// the guard that keeps core's role union tied to the database's.
import type { z } from "zod";
import type { TicketCategoryValue, TicketStatusValue, UserRole } from "core";
import { HttpError } from "./http-error";
import type { Assert, SameMembers } from "./type-checks";
import type {
  Role,
  TicketCategory as PrismaTicketCategory,
  TicketStatus as PrismaTicketStatus,
} from "./generated/prisma/enums";

// Compile-time checks that core's unions and Prisma's enums are the same set,
// in both directions: core cannot offer a role (status, category) the column
// lacks, and a new one in the schema cannot go unoffered. A mismatch fails
// `bun run typecheck` here rather than at runtime in the adapter. Prisma's
// ticket enums are aliased because core exports constants with the same names.
export type RolesMatchPrisma = Assert<SameMembers<Role, UserRole>>;
export type TicketStatusesMatchPrisma = Assert<SameMembers<PrismaTicketStatus, TicketStatusValue>>;
export type TicketCategoriesMatchPrisma = Assert<
  SameMembers<PrismaTicketCategory, TicketCategoryValue>
>;

// The single message a failed parse answers with. Field order in the schema is
// what decides precedence when a request is wrong in more than one way.
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid request body";
}

/**
 * Parses untrusted input — a path param, the query — against a core schema and
 * returns the clean value, or throws a 400 carrying the first issue's message,
 * which the JSON error handler sends as `{ error }`.
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, firstIssueMessage(parsed.error));
  return parsed.data;
}

/**
 * parseOrThrow for a request body. Express 5 leaves req.body undefined when no
 * parser ran (a text/plain POST, say); that reads as an empty object, so the
 * schema answers with its own field message rather than a type error.
 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  return parseOrThrow(schema, body ?? {});
}
