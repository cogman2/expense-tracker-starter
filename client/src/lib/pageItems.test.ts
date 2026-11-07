import { describe, expect, test } from "bun:test";
import { pageItems } from "./pageItems";

const E = "ellipsis";

describe("pageItems", () => {
  test("no pages for an empty list", () => {
    expect(pageItems(1, 0)).toEqual([]);
    expect(pageItems(1, -3)).toEqual([]);
  });

  test("a single page is just that page", () => {
    expect(pageItems(1, 1)).toEqual([1]);
  });

  test("shows every page while they fit (7 or fewer)", () => {
    expect(pageItems(1, 2)).toEqual([1, 2]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("near the start, hides the pages before the last behind one ellipsis", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, E, 20]);
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, E, 20]);
  });

  test("near the end, hides the pages after the first behind one ellipsis", () => {
    expect(pageItems(20, 20)).toEqual([1, E, 16, 17, 18, 19, 20]);
    expect(pageItems(17, 20)).toEqual([1, E, 16, 17, 18, 19, 20]);
  });

  test("in the middle, shows the current page and its neighbours between two ellipses", () => {
    expect(pageItems(5, 20)).toEqual([1, E, 4, 5, 6, E, 20]);
    expect(pageItems(10, 20)).toEqual([1, E, 9, 10, 11, E, 20]);
    expect(pageItems(16, 20)).toEqual([1, E, 15, 16, 17, E, 20]);
  });

  test("never hides a single page behind an ellipsis", () => {
    // Page 4 of 8: hiding only page 2 or only page 6 would gain nothing.
    expect(pageItems(4, 8)).toEqual([1, 2, 3, 4, 5, E, 8]);
    expect(pageItems(5, 8)).toEqual([1, E, 4, 5, 6, 7, 8]);
    for (let current = 1; current <= 30; current++) {
      const items = pageItems(current, 30);
      items.forEach((item, i) => {
        if (item !== E) return;
        const before = items[i - 1] as number;
        const after = items[i + 1] as number;
        expect(after - before).toBeGreaterThan(2);
      });
    }
  });

  test("always includes the first, last and current page, in order, at a constant length", () => {
    for (let current = 1; current <= 30; current++) {
      const items = pageItems(current, 30);
      const pages = items.filter((item): item is number => item !== E);
      expect(items).toHaveLength(7);
      expect(pages[0]).toBe(1);
      expect(pages.at(-1)).toBe(30);
      expect(pages).toContain(current);
      expect([...pages].sort((a, b) => a - b)).toEqual(pages);
    }
  });

  test("clamps a current page outside the range", () => {
    expect(pageItems(0, 20)).toEqual(pageItems(1, 20));
    expect(pageItems(99, 20)).toEqual(pageItems(20, 20));
  });

  test("more siblings widen the window around the current page", () => {
    expect(pageItems(10, 20, 2)).toEqual([1, E, 8, 9, 10, 11, 12, E, 20]);
  });
});
