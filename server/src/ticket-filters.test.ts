import { describe, expect, test } from "bun:test";
import { SortOrder, TICKET_CATEGORIES, TicketCategory, TicketSortField } from "core";
import { ticketWhere, type ColumnAccepts } from "./ticket-filters";

describe("ticketWhere", () => {
  test("no filters means every ticket", () => {
    expect(ticketWhere({})).toEqual({});
  });

  test("a category narrows to that category", () => {
    for (const category of TICKET_CATEGORIES) {
      expect(ticketWhere({ category })).toEqual({ category });
    }
  });

  test("ignores the page and sort that share the query", () => {
    const query = {
      page: 3,
      sort: TicketSortField.subject,
      order: SortOrder.asc,
      category: TicketCategory.refund_request,
    };
    expect(ticketWhere(query)).toEqual({ category: TicketCategory.refund_request });
  });

  test("an explicitly undefined filter is no filter", () => {
    expect(ticketWhere({ category: undefined })).toEqual({});
  });
});

// Compile-time checks of the guard that keeps ticketWhere's cast safe. Each
// expected-error line below fails `bun run typecheck` if ColumnAccepts ever
// starts accepting what it should reject (assigning `true` only type-checks
// where the result is `true`). That it accepts a real filter column is proven
// by TicketFiltersMatchColumns itself, in ticket-filters.ts.
describe("ColumnAccepts", () => {
  test("rejects a non-column, a relation, and values the column can't hold", () => {
    // @ts-expect-error — not a Ticket column.
    const notAColumn: ColumnAccepts<"notAColumn", "x"> = true;
    // @ts-expect-error — a relation, not a column a string can match.
    const relation: ColumnAccepts<"customer", "x"> = true;
    // @ts-expect-error — not a TicketCategory value.
    const wrongValue: ColumnAccepts<"category", "bogus"> = true;
    expect([notAColumn, relation, wrongValue]).toHaveLength(3);
  });
});
