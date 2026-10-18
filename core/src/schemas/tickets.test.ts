import { describe, expect, test } from "bun:test";
import { inboundEmailSchema, NO_SUBJECT, ticketListQuerySchema } from "./tickets";

const valid = {
  messageId: "<abc123@mail.example.com>",
  from: { email: "Jane@Example.com", name: " Jane Doe " },
  to: ["Support@Example.com"],
  subject: "  Can't log in  ",
  text: "Hello, I can't log in.",
};

/** The first issue's message — what the server answers a rejected body with. */
function messageFor(body: unknown): string {
  const parsed = inboundEmailSchema.safeParse(body);
  if (parsed.success) throw new Error("expected the body to be rejected");
  return parsed.error.issues[0]!.message;
}

describe("inboundEmailSchema", () => {
  test("normalizes ids, addresses, names and the subject", () => {
    expect(inboundEmailSchema.parse(valid)).toEqual({
      messageId: "abc123@mail.example.com",
      from: { email: "jane@example.com", name: "Jane Doe" },
      to: ["support@example.com"],
      subject: "Can't log in",
      text: "Hello, I can't log in.",
      references: [],
    });
  });

  test("strips angle brackets from the reply headers", () => {
    const parsed = inboundEmailSchema.parse({
      ...valid,
      inReplyTo: "<first@mail.example.com>",
      references: ["<root@mail.example.com>", "first@mail.example.com"],
    });
    expect(parsed.inReplyTo).toBe("first@mail.example.com");
    expect(parsed.references).toEqual([
      "root@mail.example.com",
      "first@mail.example.com",
    ]);
  });

  test("a missing or blank subject falls back to a placeholder", () => {
    const { subject: _omitted, ...withoutSubject } = valid;
    expect(inboundEmailSchema.parse(withoutSubject).subject).toBe(NO_SUBJECT);
    expect(inboundEmailSchema.parse({ ...valid, subject: "   " }).subject).toBe(
      NO_SUBJECT,
    );
  });

  test("names the field rather than reporting a type error when one is missing", () => {
    expect(messageFor({ ...valid, messageId: undefined })).toBe(
      "messageId is required",
    );
    expect(messageFor({ ...valid, from: undefined })).toBe(
      "a valid from.email is required",
    );
    expect(messageFor({ ...valid, text: undefined })).toBe("text is required");
  });

  test("rejects a Message-ID that is only brackets", () => {
    expect(messageFor({ ...valid, messageId: " <> " })).toBe(
      "messageId is required",
    );
  });

  test("rejects an invalid sender or recipient", () => {
    expect(messageFor({ ...valid, from: { email: "nope" } })).toBe(
      "a valid from.email is required",
    );
    expect(messageFor({ ...valid, to: ["nope"] })).toBe(
      "to must contain only valid email addresses",
    );
    expect(messageFor({ ...valid, to: [] })).toBe(
      "to must contain at least one address",
    );
  });

  test("reports the first failing field when several are invalid", () => {
    expect(messageFor({ ...valid, messageId: "", to: [], text: 1 })).toBe(
      "messageId is required",
    );
  });

  test("rejects a body that is not an object", () => {
    expect(inboundEmailSchema.safeParse("hello").success).toBe(false);
  });
});

describe("ticketListQuerySchema", () => {
  test("a missing page means the first page", () => {
    expect(ticketListQuerySchema.parse({})).toEqual({ page: 1 });
  });

  test("coerces the query-string value to a number", () => {
    expect(ticketListQuerySchema.parse({ page: "2" })).toEqual({ page: 2 });
  });

  test("rejects a page that is not a whole number of 1 or more", () => {
    for (const page of ["0", "-1", "abc", "1.5", ""]) {
      const parsed = ticketListQuerySchema.safeParse({ page });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(
        "page must be a whole number of 1 or more",
      );
    }
  });

  test("rejects an absurdly large page", () => {
    const parsed = ticketListQuerySchema.safeParse({ page: "1e12" });
    expect(parsed.error?.issues[0]?.message).toBe("page is too large");
  });
});
