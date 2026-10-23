import { describe, expect, test } from "bun:test";
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS } from "../constants/tickets";
import { defineFilter, TICKET_FILTER_KEYS, TICKET_FILTERS } from "./tickets";

describe("TICKET_FILTERS", () => {
  test("filters by category, the only filter today", () => {
    expect(TICKET_FILTER_KEYS).toEqual(["category"]);
    expect(TICKET_FILTERS.category.label).toBe("Category");
    expect(TICKET_FILTERS.category.values).toEqual(TICKET_CATEGORIES);
  });

  test("shows each category under its display name", () => {
    expect(TICKET_CATEGORY_LABELS).toEqual({
      general_question: "General Question",
      technical_question: "Technical Question",
      refund_request: "Refund Request",
    });
    expect(TICKET_FILTERS.category.optionLabels).toBe(TICKET_CATEGORY_LABELS);
  });

  test("every filter labels exactly the values it accepts", () => {
    for (const key of TICKET_FILTER_KEYS) {
      const { values, optionLabels } = TICKET_FILTERS[key];
      expect(Object.keys(optionLabels).sort()).toEqual([...values].sort());
      for (const label of Object.values(optionLabels)) {
        expect(label.trim()).not.toBe("");
      }
    }
  });

  // A compile-time check: the @ts-expect-error line fails `bun run typecheck`
  // if defineFilter ever stops rejecting a value that has no label.
  test("defineFilter needs a label for every value it accepts", () => {
    const complete = defineFilter({
      label: "Example",
      values: ["a", "b"],
      optionLabels: { a: "A", b: "B" },
    });
    expect(complete.optionLabels.b).toBe("B");

    const labelsMissingB = { a: "A" };
    // @ts-expect-error — "b" is accepted but has no label.
    defineFilter({ label: "Example", values: ["a", "b"], optionLabels: labelsMissingB });
  });
});
