// Which page buttons a pager shows. Pure, so it is unit-tested on its own
// (pageItems.test.ts) and the Pager component (../Pager.tsx) only renders it.

/** A page number to show as a button, or a gap standing for hidden pages. */
export type PageItem = number | "ellipsis";

/**
 * The pages a pager shows for `current` of `total`: always the first and last
 * page, the current one and `siblings` on each side of it, with an ellipsis
 * for each run of hidden pages.
 *
 * The list keeps a constant length (2 × siblings + 5) once there are more
 * pages than that, so the buttons don't shift as the reader pages. A gap of
 * a single page is never an ellipsis — that page is shown instead, since "…"
 * would take the same room and hide it for nothing.
 *
 *   pageItems(5, 20) → [1, "ellipsis", 4, 5, 6, "ellipsis", 20]
 *   pageItems(2, 20) → [1, 2, 3, 4, 5, "ellipsis", 20]
 *
 * `current` is clamped into 1…total; a total below 1 has no pages.
 */
export function pageItems(current: number, total: number, siblings = 1): PageItem[] {
  if (total < 1) return [];
  const page = Math.min(Math.max(current, 1), total);
  const slots = 2 * siblings + 5; // first, last, current, two ellipses, siblings

  if (total <= slots) return range(1, total);

  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, total);
  // An ellipsis only where it hides two or more pages.
  const gapBefore = left > 3;
  const gapAfter = right < total - 2;
  // Pages beside first/last, so the list keeps its length near either end.
  const edge = slots - 2;

  if (!gapBefore) return [...range(1, edge), "ellipsis", total];
  if (!gapAfter) return [1, "ellipsis", ...range(total - edge + 1, total)];
  return [1, "ellipsis", ...range(left, right), "ellipsis", total];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
