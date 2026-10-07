import { describe, expect, test } from "bun:test";
import {
  createUserSchema,
  MIN_PASSWORD_LENGTH,
  ROLES,
  updateUserSchema,
} from "./users";

const valid = {
  name: "New Person",
  email: "new@example.com",
  password: "password123",
  // `as const` so the fixture satisfies the schema's narrowed input type.
  role: "agent" as const,
};

/** The first issue's message — what the server answers a rejected body with. */
function messageFor(body: unknown): string {
  const parsed = createUserSchema.safeParse(body);
  if (parsed.success) throw new Error("expected the body to be rejected");
  return parsed.error.issues[0]!.message;
}

describe("createUserSchema", () => {
  test("accepts a valid payload unchanged", () => {
    expect(createUserSchema.parse(valid)).toEqual(valid);
  });

  test("trims the name and lowercases the email", () => {
    const parsed = createUserSchema.parse({
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

  test("rejects a password shorter than the minimum", () => {
    expect(messageFor({ ...valid, password: "a".repeat(MIN_PASSWORD_LENGTH - 1) })).toBe(
      "password must be at least 8 characters",
    );
  });

  test("rejects a role outside ROLES", () => {
    expect(messageFor({ ...valid, role: "superuser" })).toBe(
      `role must be one of ${ROLES.join(", ")}`,
    );
  });

  test("names the field rather than reporting a type error when one is missing", () => {
    const { email, password, role } = valid;

    expect(messageFor({ email, password, role })).toBe("name is required");
  });

  test("reports the first failing field when several are invalid", () => {
    // Field order in the schema is the precedence the server's response inherits.
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

describe("updateUserSchema", () => {
  // It is createUserSchema minus the password, so the shared rules are already
  // covered above. These cases pin what .omit() changes, and that the inherited
  // rules really did come along.
  const { password, ...withoutPassword } = valid;

  test("accepts a payload with no password", () => {
    expect(updateUserSchema.parse(withoutPassword)).toEqual(withoutPassword);
  });

  test("ignores a password if one is sent", () => {
    const parsed = updateUserSchema.parse({ ...withoutPassword, password: "x" });

    expect(parsed).not.toHaveProperty("password");
  });

  test("still trims the name and lowercases the email", () => {
    const parsed = updateUserSchema.parse({
      ...withoutPassword,
      name: "  New Person  ",
      email: "  Ada@Example.COM  ",
    });

    expect(parsed.name).toBe("New Person");
    expect(parsed.email).toBe("ada@example.com");
  });

  test("still rejects an unparseable email and a bad role", () => {
    const badEmail = updateUserSchema.safeParse({
      ...withoutPassword,
      email: "not-an-email",
    });
    const badRole = updateUserSchema.safeParse({
      ...withoutPassword,
      role: "superuser",
    });

    expect(badEmail.success).toBe(false);
    expect(badEmail.success || badEmail.error.issues[0]!.message).toBe(
      "a valid email is required",
    );
    expect(badRole.success).toBe(false);
    expect(badRole.success || badRole.error.issues[0]!.message).toBe(
      `role must be one of ${ROLES.join(", ")}`,
    );
  });
});
