import { describe, expect, test } from "bun:test";
import { SORT_ORDERS, SortOrder, TICKET_SORT_FIELDS, TicketSortField } from "core";
import { ticketOrderBy } from "./ticket-sort";

describe("ticketOrderBy", () => {
  test("the default sort is newest first, id breaking ties", () => {
    expect(ticketOrderBy(TicketSortField.createdAt, SortOrder.desc)).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  test("plain columns sort by that column, then id the same way", () => {
    expect(ticketOrderBy(TicketSortField.subject, SortOrder.asc)).toEqual([
      { subject: "asc" },
      { id: "asc" },
    ]);
    expect(ticketOrderBy(TicketSortField.status, SortOrder.desc)).toEqual([
      { status: "desc" },
      { id: "desc" },
    ]);
  });

  test("sorting by id needs no tie-break", () => {
    expect(ticketOrderBy(TicketSortField.id, SortOrder.asc)).toEqual([{ id: "asc" }]);
  });

  test("customer sorts by name (unnamed last), then email, then id", () => {
    for (const order of SORT_ORDERS) {
      expect(ticketOrderBy(TicketSortField.customer, order)).toEqual([
        { customer: { name: { sort: order, nulls: "last" } } },
        { customer: { email: order } },
        { id: order },
      ]);
    }
  });

  test("category sorts with uncategorized tickets last, then id", () => {
    for (const order of SORT_ORDERS) {
      expect(ticketOrderBy(TicketSortField.category, order)).toEqual([
        { category: { sort: order, nulls: "last" } },
        { id: order },
      ]);
    }
  });

  test("every sort ends with the id, so pages never overlap", () => {
    for (const sort of TICKET_SORT_FIELDS) {
      for (const order of SORT_ORDERS) {
        expect(ticketOrderBy(sort, order).at(-1)).toEqual({ id: order });
      }
    }
  });
});
