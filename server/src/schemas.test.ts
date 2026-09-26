import { describe, expect, test } from "bun:test";
import { createUserBodySchema, firstIssueMessage } from "./schemas";

const valid = {
  name: "New Person",
  email: "new@example.com",
  password: "password123",
  // `as const` so the fixture satisfies the schema's narrowed input type.
  role: "agent" as const,
};

/** The 400 message the route would answer with for `body`. */
function messageFor(body: unknown): string {
  const parsed = createUserBodySchema.safeParse(body);
  if (parsed.success) throw new Error("expected the body to be rejected");
  return firstIssueMessage(parsed.error);
}

describe("createUserBodySchema", () => {
  test("accepts a valid body unchanged", () => {
    const parsed = createUserBodySchema.parse(valid);

    expect(parsed).toEqual(valid);
  });

  test("trims the name and lowercases the email", () => {
    const parsed = createUserBodySchema.parse({
      ...valid,
      name: "  New Person  ",
      email: "  Ada@Example.COM  ",
    });

    expect(parsed.name).toBe("New Person");
    // Lowercased so the duplicate-email check and sign-in agree on one spelling.
    expect(parsed.email).toBe("ada@example.com");
  });

  test("rejects a whitespace-only name", () => {
    expect(messageFor({ ...valid, name: "   " })).toBe("name is required");
  });

  test("rejects an unparseable email", () => {
    expect(messageFor({ ...valid, email: "not-an-email" })).toBe(
      "a valid email is required",
    );
  });

  test("rejects a password shorter than 8 characters", () => {
    expect(messageFor({ ...valid, password: "short" })).toBe(
      "password must be at least 8 characters",
    );
  });

  test("rejects a role outside the Prisma enum", () => {
    expect(messageFor({ ...valid, role: "superuser" })).toBe(
      "role must be one of admin, agent",
    );
  });

  test("names the field rather than reporting a type error when one is missing", () => {
    const { email, password, role } = valid;

    expect(messageFor({ email, password, role })).toBe("name is required");
  });

  test("reports the first failing field when several are invalid", () => {
    // Field order in the schema is the precedence the route inherits.
    expect(messageFor({ name: "", email: "nope", password: "x", role: "nope" })).toBe(
      "name is required",
    );
  });

  test("rejects a body that is not an object", () => {
    expect(messageFor({})).toBe("name is required");
    expect(messageFor(undefined)).toBeTruthy();
  });

  test("rejects non-string fields rather than coercing them", () => {
    expect(messageFor({ ...valid, name: 42 })).toBe("name is required");
    expect(messageFor({ ...valid, password: null })).toBe(
      "password must be at least 8 characters",
    );
  });
});
