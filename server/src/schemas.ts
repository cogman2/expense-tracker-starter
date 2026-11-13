// Server-side validation glue. The schemas themselves live in the core package
// (core/src/users.ts) so the client's forms and this server parse against one
// definition; what stays here is how a failed parse becomes an HTTP response, and
// the guard that keeps core's role union tied to the database's.
import type { z } from "zod";
import { ROLES, TICKET_CATEGORIES, TICKET_STATUSES } from "core";
import { HttpError } from "./http-error";
import type {
  Role,
  TicketCategory as PrismaTicketCategory,
  TicketStatus as PrismaTicketStatus,
} from "./generated/prisma/enums";

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

// The same guard for ticket statuses (core/src/constants/tickets.ts). Prisma's
// enum is aliased because core exports its own `TicketStatus` constant.
export type TicketStatusesMatchPrisma = Assert<
  [PrismaTicketStatus] extends [(typeof TICKET_STATUSES)[number]]
    ? [(typeof TICKET_STATUSES)[number]] extends [PrismaTicketStatus]
      ? true
      : false
    : false
>;

// And for ticket categories, aliased for the same reason.
export type TicketCategoriesMatchPrisma = Assert<
  [PrismaTicketCategory] extends [(typeof TICKET_CATEGORIES)[number]]
    ? [(typeof TICKET_CATEGORIES)[number]] extends [PrismaTicketCategory]
      ? true
      : false
    : false
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
