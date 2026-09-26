// Request-body schemas. Routes parse untrusted input through these rather than
// hand-checking fields, so a route stays about routing and the rules live in one
// readable place. The client's form schemas (client/src/UsersPage.tsx) mirror
// these for UX; these are the authority.
import { z } from "zod";
import { Role } from "./generated/prisma/enums";

const MIN_PASSWORD_LENGTH = 8;
const VALID_ROLES = Object.values(Role);

// Message wording is part of the API: e2e/user-creation.spec.ts asserts these
// strings. Each field states its message twice — once as the schema-level `error`
// (a missing field arrives as undefined, whose default message would be zod's
// "expected string, received undefined") and once on the check that follows.
export const createUserBodySchema = z.object({
  name: z.string({ error: "name is required" }).trim().min(1, "name is required"),
  // Trim and lowercase BEFORE the format check, which is what the old EMAIL_RE
  // ladder did. z.email() is its own schema rather than a check on ZodString, so
  // chaining .trim() onto it would validate the untrimmed value — hence the pipe.
  email: z
    .string({ error: "a valid email is required" })
    .trim()
    .toLowerCase()
    .pipe(z.email("a valid email is required")),
  password: z
    .string({
      error: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    })
    .min(
      MIN_PASSWORD_LENGTH,
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
  // Straight off the Prisma enum, so the accepted roles cannot drift from the
  // column's type.
  role: z.enum(Role, { error: `role must be one of ${VALID_ROLES.join(", ")}` }),
});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;

// The single message a failed parse answers with. Field order in the schema is
// what decides precedence when a request is wrong in more than one way.
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid request body";
}
