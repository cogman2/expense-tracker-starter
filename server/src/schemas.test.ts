import { describe, expect, test } from "bun:test";
import { createReplySchema, createUserSchema, ticketIdParamSchema } from "core";
import { HttpError } from "./http-error";
import { firstIssueMessage, parseBody, parseOrThrow } from "./schemas";

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

/** What parsing threw, so a test can check its status and message. */
function thrown(parse: () => unknown): HttpError {
  try {
    parse();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error("expected the parse to throw");
}

describe("parseOrThrow", () => {
  test("returns the schema's clean output", () => {
    expect(parseOrThrow(ticketIdParamSchema, "42")).toBe(42);
  });

  test("throws a 400 carrying the first issue's message", () => {
    const err = thrown(() => parseOrThrow(ticketIdParamSchema, "abc"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("ticket id must be a whole number of 1 or more");
  });
});

describe("parseBody", () => {
  test("returns the parsed body", () => {
    expect(parseBody(createReplySchema, { body: "  hi  " })).toEqual({ body: "hi" });
  });

  // Express 5 leaves req.body undefined when no parser ran (a text/plain POST).
  test("reads a missing body as {}, so the schema's field message answers", () => {
    const err = thrown(() => parseBody(createReplySchema, undefined));
    expect(err.status).toBe(400);
    expect(err.message).toBe("reply body is required");
  });
});
