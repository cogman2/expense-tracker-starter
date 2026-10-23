import { describe, expect, test } from "bun:test";
import { SortOrder, TICKET_CATEGORIES, TicketCategory, TicketSortField } from "core";
import { activeFilters, ticketWhere } from "./ticket-filters";

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

describe("activeFilters", () => {
  test("keeps only the filters present, dropping page and sort", () => {
    const query = {
      page: 2,
      sort: TicketSortField.createdAt,
      order: SortOrder.desc,
      category: TicketCategory.general_question,
    };
    expect(activeFilters(query)).toEqual({ category: TicketCategory.general_question });
    expect(activeFilters({ category: undefined })).toEqual({});
  });
});
