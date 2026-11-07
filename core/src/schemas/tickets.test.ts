import { describe, expect, test } from "bun:test";
import {
  SORT_ORDERS,
  SortOrder,
  TICKET_CATEGORIES,
  TICKET_SORT_FIELDS,
  TICKET_STATUSES,
  TicketCategory,
  TicketSortField,
  TicketStatus,
} from "../constants/tickets";
import {
  inboundEmailSchema,
  NO_SUBJECT,
  ticketIdParamSchema,
  ticketListQuerySchema,
  type TicketListQuery,
  updateTicketSchema,
} from "./tickets";

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

  test("a blank or whitespace-only sender name is no name", () => {
    for (const name of ["", "   ", "\t\n "]) {
      const parsed = inboundEmailSchema.parse({ ...valid, from: { ...valid.from, name } });
      expect(parsed.from.name).toBeUndefined();
    }
    const { name: _omitted, ...nameless } = valid.from;
    expect(inboundEmailSchema.parse({ ...valid, from: nameless }).from.name).toBeUndefined();
  });

  test("a real name keeps its inner spacing once trimmed", () => {
    const parsed = inboundEmailSchema.parse({ ...valid, from: { ...valid.from, name: "  Mary  Ann  " } });
    expect(parsed.from.name).toBe("Mary  Ann");
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
  test("a missing page and sort mean the first page, newest first", () => {
    expect(ticketListQuerySchema.parse({})).toEqual({
      page: 1,
      sort: TicketSortField.createdAt,
      order: SortOrder.desc,
    });
  });

  test("coerces the query-string value to a number", () => {
    expect(ticketListQuerySchema.parse({ page: "2" }).page).toBe(2);
  });

  test("accepts every sort field in either order", () => {
    for (const sort of TICKET_SORT_FIELDS) {
      for (const order of SORT_ORDERS) {
        expect(ticketListQuerySchema.parse({ sort, order })).toEqual({
          page: 1,
          sort,
          order,
        });
      }
    }
  });

  test("rejects an unknown sort field", () => {
    for (const sort of ["bogus", "", "createdat", "customer.name"]) {
      const parsed = ticketListQuerySchema.safeParse({ sort });
      expect(parsed.error?.issues[0]?.message).toBe(
        "sort must be one of: id, subject, customer, status, category, assignee, createdAt",
      );
    }
  });

  test("rejects an unknown order", () => {
    for (const order of ["ASC", "up", ""]) {
      const parsed = ticketListQuerySchema.safeParse({ order });
      expect(parsed.error?.issues[0]?.message).toBe("order must be asc or desc");
    }
  });

  test("reports the sort before the order when both are invalid", () => {
    const parsed = ticketListQuerySchema.safeParse({ sort: "bogus", order: "up" });
    expect(parsed.error?.issues[0]?.message).toBe(
      "sort must be one of: id, subject, customer, status, category, assignee, createdAt",
    );
  });

  test("reports the page before the sort when both are invalid", () => {
    const parsed = ticketListQuerySchema.safeParse({ page: "0", sort: "bogus" });
    expect(parsed.error?.issues[0]?.message).toBe(
      "page must be a whole number of 1 or more",
    );
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

  test("accepts each category as a filter", () => {
    for (const category of TICKET_CATEGORIES) {
      expect(ticketListQuerySchema.parse({ category }).category).toBe(category);
    }
  });

  test("rejects an unknown category, including its display label", () => {
    for (const category of ["bogus", "", "Refund Request", "REFUND_REQUEST"]) {
      const parsed = ticketListQuerySchema.safeParse({ category });
      expect(parsed.error?.issues[0]?.message).toBe(
        "category must be one of: general_question, technical_question, refund_request",
      );
    }
  });

  test("reports the sort before a filter when both are invalid", () => {
    const parsed = ticketListQuerySchema.safeParse({ sort: "bogus", category: "bogus" });
    expect(parsed.error?.issues[0]?.message).toBe(
      "sort must be one of: id, subject, customer, status, category, assignee, createdAt",
    );
  });

  test("types the category as the category union, not string", () => {
    const query: TicketListQuery = {
      page: 1,
      sort: TicketSortField.createdAt,
      order: SortOrder.desc,
      category: TicketCategory.refund_request,
    };
    // @ts-expect-error — only the registry's values type-check.
    const bad: TicketListQuery = { ...query, category: "not_a_category" };
    expect(String(bad.category)).toBe("not_a_category");
  });
});

describe("ticketIdParamSchema", () => {
  test("coerces a numeric path param to its id", () => {
    expect(ticketIdParamSchema.parse("42")).toBe(42);
  });

  test("rejects anything that is not a positive whole number that fits an id", () => {
    for (const id of ["0", "-1", "1.5", "abc", "", "2147483648", undefined]) {
      const parsed = ticketIdParamSchema.safeParse(id);
      expect(parsed.error?.issues[0]?.message).toBe(
        "ticket id must be a whole number of 1 or more",
      );
    }
  });

  // Number() would read each of these as an id, so /api/tickets/0x10 reached
  // ticket 16. Only the plain decimal form names a ticket, so each has one URL.
  test("rejects numbers Number() accepts but that aren't plain decimal ids", () => {
    for (const id of ["0x10", "0b11", "0o7", "1e3", "+7", " 7", "7 ", "\t7", "7.0", "007"]) {
      const parsed = ticketIdParamSchema.safeParse(id);
      expect(parsed.error?.issues[0]?.message, JSON.stringify(id)).toBe(
        "ticket id must be a whole number of 1 or more",
      );
    }
  });
});

describe("updateTicketSchema", () => {
  const EMPTY = "provide at least one of: assigneeId, status, category";
  const messageFor = (body: unknown) =>
    updateTicketSchema.safeParse(body).error?.issues[0]?.message;

  test("takes a user id, trimmed, or null to unassign", () => {
    expect(updateTicketSchema.parse({ assigneeId: " u1 " })).toEqual({ assigneeId: "u1" });
    expect(updateTicketSchema.parse({ assigneeId: null })).toEqual({ assigneeId: null });
  });

  // Control characters can't be in a user id, and Postgres refuses a NUL byte in
  // a text parameter outright — the lookup would be a 500, not this 400.
  test("rejects a blank, non-string or control-character assignee", () => {
    for (const assigneeId of ["", "  ", 7, "a\u0000b", "a\nb"]) {
      expect(messageFor({ assigneeId }), JSON.stringify(assigneeId)).toBe(
        "assigneeId must be a user id or null",
      );
    }
  });

  test("takes every status, but never null", () => {
    for (const status of TICKET_STATUSES) {
      expect(updateTicketSchema.parse({ status })).toEqual({ status });
    }
    for (const status of [null, "pending", "OPEN", 1]) {
      expect(messageFor({ status }), JSON.stringify(status)).toBe(
        "status must be one of: open, resolved, closed",
      );
    }
  });

  test("takes every category, or null to uncategorize", () => {
    for (const category of TICKET_CATEGORIES) {
      expect(updateTicketSchema.parse({ category })).toEqual({ category });
    }
    expect(updateTicketSchema.parse({ category: null })).toEqual({ category: null });
    for (const category of ["billing", "", 1]) {
      expect(messageFor({ category }), JSON.stringify(category)).toBe(
        "category must be one of: general_question, technical_question, refund_request, or null",
      );
    }
  });

  test("updates several fields at once, leaving absent ones out", () => {
    expect(
      updateTicketSchema.parse({
        status: TicketStatus.resolved,
        category: TicketCategory.refund_request,
      }),
    ).toEqual({ status: TicketStatus.resolved, category: TicketCategory.refund_request });
  });

  test("reports assigneeId, then status, then category when several are wrong", () => {
    expect(messageFor({ assigneeId: 7, status: "x", category: "x" })).toBe(
      "assigneeId must be a user id or null",
    );
    expect(messageFor({ status: "x", category: "x" })).toBe(
      "status must be one of: open, resolved, closed",
    );
    // A valid field doesn't hide a later invalid one.
    expect(messageFor({ assigneeId: "u1", status: "x" })).toBe(
      "status must be one of: open, resolved, closed",
    );
    expect(messageFor({ assigneeId: null, status: TicketStatus.open, category: "x" })).toBe(
      "category must be one of: general_question, technical_question, refund_request, or null",
    );
  });

  test("rejects a body with nothing to update", () => {
    for (const body of [{}, { foo: 1 }, { status: undefined }]) {
      expect(messageFor(body), JSON.stringify(body)).toBe(EMPTY);
    }
  });

  test("answers a body that is not an object with the same message", () => {
    for (const body of [undefined, null, [], "u1"]) {
      expect(messageFor(body), JSON.stringify(body)).toBe(EMPTY);
    }
  });
});
