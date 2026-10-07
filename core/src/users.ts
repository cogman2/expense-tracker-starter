import { z } from "zod";

/**
 * The roles a staff account can hold. The single source of truth for both the
 * client's role picker and the server's column: server/src/schemas.ts asserts at
 * compile time that this matches Prisma's Role enum.
 */
export const ROLES = ["admin", "agent"] as const;

export type UserRole = (typeof ROLES)[number];

export const MIN_PASSWORD_LENGTH = 8;

/**
 * The POST /api/users payload, used by the server to validate the request and by
 * the client's create-user form through zodResolver. One definition so the rules
 * cannot drift between the two.
 *
 * Messages are worded for the API, since the server returns them verbatim as
 * `{ error }` and e2e/user-creation.spec.ts asserts them; the form shows the same
 * strings. Each field states its message twice — once as the schema-level `error`,
 * because a missing field arrives as undefined and would otherwise report zod's
 * "expected string, received undefined", and once on the check that follows.
 *
 * Field order is meaningful: the server answers with the first issue only, so this
 * order is the precedence a multiply-invalid body gets.
 */
export const createUserSchema = z.object({
  name: z.string({ error: "name is required" }).trim().min(1, "name is required"),
  // Trim and lowercase BEFORE the format check. z.email() is its own schema
  // rather than a check on ZodString, so chaining .trim() onto it would validate
  // the untrimmed value — hence the pipe. Lowercasing here is what keeps the
  // duplicate-email check and later sign-ins agreeing on one spelling.
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
  role: z.enum(ROLES, { error: `role must be one of ${ROLES.join(", ")}` }),
});

/** The parsed payload: trimmed name, lowercased email, narrowed role. */
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * The PATCH /api/users/:id payload: the same name/email/role rules as creation,
 * minus the password. Derived with .omit() rather than written out again so the
 * trim, the lowercase-then-email pipe, the role enum, the message wording and the
 * field order all stay defined once.
 *
 * Passwords are deliberately not editable here — changing someone's credentials
 * is a different operation with different risk.
 */
export const updateUserSchema = createUserSchema.omit({ password: true });

/** The parsed update payload: trimmed name, lowercased email, narrowed role. */
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
