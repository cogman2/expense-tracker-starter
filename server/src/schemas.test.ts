import { describe, expect, test } from "bun:test";
import { createUserSchema } from "core";
import { firstIssueMessage } from "./schemas";

// The schema's own rules are covered in core/src/users.test.ts. What matters here
// is the translation from a ZodError to the one message a 400 carries.
describe("firstIssueMessage", () => {
  test("returns the first issue's message", () => {
    const parsed = createUserSchema.safeParse({
      name: "",
      email: "nope",
      password: "x",
      role: "nope",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstIssueMessage(parsed.error)).toBe("name is required");
  });

  test("falls back when an error somehow carries no issues", () => {
    // Defensive: zod always populates issues, but the route must answer with
    // something rather than `undefined` if that ever changes.
    const empty = { issues: [] } as unknown as Parameters<typeof firstIssueMessage>[0];

    expect(firstIssueMessage(empty)).toBe("invalid request body");
  });
});
