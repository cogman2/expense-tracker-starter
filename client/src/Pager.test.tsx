import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pager } from "./Pager";

// The pager on its own: what it renders and what it reports. How the tickets
// page turns a report into a URL is TicketsPage.test.tsx.

afterEach(cleanup);

const nav = () => screen.getByRole("navigation", { name: "Pages" });
const button = (name: string) => within(nav()).getByRole("button", { name });
/** The page buttons' labels, with the gaps, as a reader scans the row. */
const pageRow = () =>
  Array.from(nav().querySelectorAll("button[aria-label^='Page '], [aria-hidden='true']"))
    .filter((el) => el.tagName !== "svg")
    .map((el) => (el.tagName === "BUTTON" ? el.textContent : "…"));

/**
 * Unavailable, but still focusable: aria-disabled and NOT natively disabled.
 * The second half is the regression check — a natively disabled control loses
 * keyboard focus to <body> the moment it disables itself for a page load.
 */
function expectUnavailable(el: HTMLElement) {
  expect(el).toHaveAttribute("aria-disabled", "true");
  expect(el).not.toBeDisabled();
}
function expectAvailable(el: HTMLElement) {
  expect(el).not.toHaveAttribute("aria-disabled");
  expect(el).not.toBeDisabled();
}

function renderPager(page: number, totalPages: number, props: { disabled?: boolean } = {}) {
  const onPageChange = mock();
  render(
    <Pager
      page={page}
      totalPages={totalPages}
      onPageChange={onPageChange}
      label="Pages"
      {...props}
    />,
  );
  return onPageChange;
}

describe("Pager", () => {
  test("renders nothing for a single page", () => {
    renderPager(1, 1);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("shows the page window, with the current page marked", () => {
    renderPager(5, 20);
    expect(pageRow()).toEqual(["1", "…", "4", "5", "6", "…", "20"]);
    expect(button("Page 5")).toHaveAttribute("aria-current", "page");
    expect(button("Page 4")).not.toHaveAttribute("aria-current");
  });

  test("First and Previous are disabled on the first page", () => {
    renderPager(1, 20);
    expectUnavailable(button("First"));
    expectUnavailable(button("Previous"));
    expectAvailable(button("Next"));
    expectAvailable(button("Last"));
  });

  test("Next and Last are disabled on the last page", () => {
    renderPager(20, 20);
    expectUnavailable(button("Next"));
    expectUnavailable(button("Last"));
    expectAvailable(button("First"));
    expectAvailable(button("Previous"));
  });

  test("each control reports the page it leads to", async () => {
    const onPageChange = renderPager(5, 20);
    const user = userEvent.setup();

    await user.click(button("First"));
    await user.click(button("Previous"));
    await user.click(button("Page 6"));
    await user.click(button("Next"));
    await user.click(button("Last"));
    expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([1, 4, 6, 6, 20]);
  });

  test("clicking the current page reports nothing", async () => {
    const onPageChange = renderPager(5, 20);
    await userEvent.setup().click(button("Page 5"));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  test("makes every control unavailable while disabled, e.g. as a page loads", () => {
    renderPager(5, 20, { disabled: true });
    for (const control of within(nav()).getAllByRole("button")) {
      expectUnavailable(control);
    }
    // The field stays focusable too: read-only, not disabled.
    const field = screen.getByLabelText("Go to page");
    expect(field).toHaveAttribute("readonly");
    expect(field).not.toBeDisabled();
  });

  test("activating an unavailable control does nothing, by mouse or keyboard", async () => {
    const onPageChange = renderPager(5, 20, { disabled: true });
    const user = userEvent.setup();

    await user.click(button("Next"));
    await user.click(button("Page 6"));
    button("Last").focus();
    await user.keyboard("{Enter}");
    // The jump form ignores a submit while loading.
    await user.click(button("Go"));
    expect(onPageChange).not.toHaveBeenCalled();
    // Focus is still on the pager, not thrown back to <body>.
    expect(document.activeElement).toBe(button("Go"));
  });

  test("the end controls are unavailable but clicking them does nothing", async () => {
    const onPageChange = renderPager(1, 20);
    const user = userEvent.setup();
    await user.click(button("First"));
    await user.click(button("Previous"));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  describe("jump to page", () => {
    test("is offered only when some pages are hidden (more than 7)", () => {
      renderPager(1, 7);
      expect(screen.queryByLabelText("Go to page")).toBeNull();
      cleanup();
      renderPager(1, 8);
      expect(screen.getByLabelText("Go to page")).toBeTruthy();
    });

    test("goes to the page typed, on Enter or Go", async () => {
      const onPageChange = renderPager(1, 20);
      const user = userEvent.setup();
      const field = screen.getByLabelText("Go to page");

      await user.type(field, "12{Enter}");
      await user.type(field, " 7 ");
      await user.click(button("Go"));
      expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([12, 7]);
      expect(field).toHaveValue("");
    });

    test("refuses anything but a page in range, marking the field invalid", async () => {
      const onPageChange = renderPager(1, 20);
      const user = userEvent.setup();
      const field = screen.getByLabelText("Go to page");

      for (const bad of ["", "0", "21", "abc", "1.5", "-3", "1e1"]) {
        await user.clear(field);
        if (bad) await user.type(field, bad);
        await user.click(button("Go"));
        expect(field).toHaveAttribute("aria-invalid", "true");
      }
      expect(onPageChange).not.toHaveBeenCalled();

      // Editing clears the error; a valid page then goes through.
      await user.clear(field);
      expect(field).not.toHaveAttribute("aria-invalid");
      await user.type(field, "20{Enter}");
      expect(onPageChange).toHaveBeenCalledWith(20);
    });

    test("a new page clears what was typed and any error, keeping focus in the field", async () => {
      const onPageChange = mock();
      const user = userEvent.setup();
      const pager = (page: number) => (
        <Pager page={page} totalPages={20} onPageChange={onPageChange} label="Pages" />
      );
      const { rerender } = render(pager(1));
      const field = screen.getByLabelText("Go to page");

      await user.type(field, "abc");
      await user.click(button("Go"));
      expect(field).toHaveAttribute("aria-invalid", "true");
      await user.type(field, "x");
      // The parent moves to page 2 (say, the reader clicked Next).
      field.focus();
      rerender(pager(2));
      expect(screen.getByLabelText("Go to page")).toHaveValue("");
      expect(screen.getByLabelText("Go to page")).not.toHaveAttribute("aria-invalid");
      // Same element, so a reader typing a jump keeps their place.
      expect(screen.getByLabelText("Go to page")).toBe(field);
      expect(document.activeElement).toBe(field);
    });

    test("the hint names the valid range", () => {
      renderPager(1, 20);
      expect(screen.getByLabelText("Go to page")).toHaveAccessibleDescription("1–20");
    });
  });
});
