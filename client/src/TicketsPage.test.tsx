import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { SortOrder, TicketCategory, TicketSortField, TicketStatus } from "core";
import { renderWithQuery } from "./testRender";
import { fakeHttp, httpCalls, restoreHttp, type FakeResponse } from "./testHttp";
import { TicketsPage } from "./TicketsPage";
import type { TicketPage, TicketRow } from "./lib/api";

// The page runs against the real lib/api module; only the network is faked, so
// these specs also cover getTickets' URL and query string.

const ticket = (id: number, overrides: Partial<TicketRow> = {}): TicketRow => ({
  id,
  subject: `Subject ${id}`,
  status: TicketStatus.open,
  category: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  customer: { name: `Customer ${id}`, email: `c${id}@example.com` },
  ...overrides,
});

const pageOf = (tickets: TicketRow[], page: number, total: number): TicketPage => ({
  tickets,
  total,
  page,
  pageSize: 25,
  sort: TicketSortField.createdAt,
  order: SortOrder.desc,
  filters: {},
});

/** Answers each GET with whatever `respond` returns for the requested page. */
let respond: (page: number) => FakeResponse;

beforeEach(() => {
  respond = () => ({ status: 200, data: pageOf([], 1, 0) });
  fakeHttp((config) => respond(Number(config.params?.page)));
});

afterEach(() => {
  cleanup();
  restoreHttp();
});

// Shows the router's query string, so specs can check what the page writes to
// the URL — MemoryRouter keeps it in memory, out of window.location.
function LocationProbe() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

const locationSearch = () => screen.getByTestId("location-search").textContent;

function renderAt(url = "/tickets") {
  return renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <TicketsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const requestedPages = () =>
  httpCalls().map((call) => [call.url, call.params?.page]);

/** Each request's page and sort, in order: what the server was asked for. */
const requestedQueries = () =>
  httpCalls().map((call) => ({
    page: call.params?.page,
    sort: call.params?.sort,
    order: call.params?.order,
  }));

/** Each request's category param — undefined when the list was unfiltered. */
const requestedCategories = () => httpCalls().map((call) => call.params?.category);

const categoryChoice = (name: string) =>
  within(screen.getByRole("group", { name: "Category" })).getByRole("button", { name });

const header = (name: string) => screen.getByRole("columnheader", { name });
const sortButton = (name: string) => screen.getByRole("button", { name });

describe("TicketsPage", () => {
  test("shows each ticket's number, subject, customer, status, category and date", async () => {
    respond = () => ({
      status: 200,
      data: pageOf(
        [
          ticket(42, {
            status: TicketStatus.resolved,
            category: TicketCategory.refund_request,
          }),
          ticket(41),
        ],
        1,
        2,
      ),
    });
    renderAt();

    const row = (await screen.findByRole("cell", { name: "#42" })).closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "#42",
      "Subject 42",
      "Customer 42",
      TicketStatus.resolved,
      "Refund Request",
      new Date("2026-10-01T12:00:00.000Z").toLocaleDateString(),
    ]);
    expect(requestedPages()).toEqual([["/api/tickets", 1]]);
  });

  test("keeps the server's order (newest first)", async () => {
    respond = () => ({ status: 200, data: pageOf([ticket(3), ticket(2), ticket(1)], 1, 3) });
    renderAt();

    await screen.findByRole("cell", { name: "#3" });
    const ids = screen
      .getAllByRole("row")
      .slice(1) // header
      .map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(ids).toEqual(["#3", "#2", "#1"]);
  });

  test("shows the customer's email when they gave no name", async () => {
    respond = () => ({
      status: 200,
      data: pageOf([ticket(7, { customer: { name: null, email: "anon@example.com" } })], 1, 1),
    });
    renderAt();

    expect(await screen.findByRole("cell", { name: "anon@example.com" })).toBeTruthy();
  });

  test("says so when there are no tickets", async () => {
    renderAt();
    expect(await screen.findByText("No tickets yet.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Ticket pages" })).toBeNull();
  });

  test("shows an error when the list cannot load", async () => {
    respond = () => ({ status: 500, data: { error: "internal server error" } });
    renderAt();
    expect(await screen.findByText("Could not load tickets.")).toBeTruthy();
  });

  test("pages forward and back through ?page=, disabling the buttons at either end", async () => {
    const firstPage = Array.from({ length: 25 }, (_, i) => ticket(30 - i));
    respond = (page) =>
      page === 2
        ? { status: 200, data: pageOf([ticket(5), ticket(4)], 2, 27) }
        : { status: 200, data: pageOf(firstPage, 1, 27) };
    const user = userEvent.setup();
    renderAt();

    await screen.findByRole("cell", { name: "#30" });
    expect(screen.getByText("Showing 1–25 of 27")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    const previous = () => screen.getByRole("button", { name: "Previous" });
    const next = () => screen.getByRole("button", { name: "Next" });
    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
    expect(locationSearch()).toBe("");

    await user.click(next());
    await screen.findByRole("cell", { name: "#5" });
    expect(locationSearch()).toBe("?page=2");
    expect(screen.getByText("Showing 26–27 of 27")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect(next()).toBeDisabled();
    expect(previous()).toBeEnabled();

    await user.click(previous());
    await screen.findByRole("cell", { name: "#30" });
    // Page 1 is the bare URL: Previous drops the parameter rather than writing ?page=1.
    expect(locationSearch()).toBe("");
    expect(requestedPages().map(([, page]) => page)).toEqual([1, 2, 1]);
  });

  test("opens on the page named in the URL", async () => {
    respond = (page) => ({ status: 200, data: pageOf([ticket(5)], page, 26) });
    renderAt("/tickets?page=2");

    await screen.findByRole("cell", { name: "#5" });
    expect(requestedPages()).toEqual([["/api/tickets", 2]]);
  });

  test("treats an invalid page in the URL as the first page", async () => {
    renderAt("/tickets?page=abc");
    await screen.findByText("No tickets yet.");
    expect(requestedPages()).toEqual([["/api/tickets", 1]]);
  });

  test("offers the first page when the URL names a page past the end", async () => {
    respond = (page) =>
      page === 9
        ? { status: 200, data: pageOf([], 9, 3) }
        : { status: 200, data: pageOf([ticket(3)], 1, 3) };
    const user = userEvent.setup();
    renderAt("/tickets?page=9");

    await screen.findByText(/No tickets on this page/);
    await user.click(screen.getByRole("button", { name: "Go to the first page" }));
    expect(await screen.findByRole("cell", { name: "#3" })).toBeTruthy();
  });
});

// The server sorts; these specs check what the page asks it for, what it writes
// to the URL, and how the headers report the current order. The fake answers
// every sort with the same rows — ordering itself is the server's job, covered
// by server/src/ticket-sort.test.ts and e2e/tickets-list.spec.ts.
describe("TicketsPage sorting", () => {
  const onePage = () => ({ status: 200, data: pageOf([ticket(1)], 1, 1) });

  test("asks for newest first by default and marks Created as sorted", async () => {
    respond = onePage;
    renderAt();

    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries()).toEqual([
      { page: 1, sort: TicketSortField.createdAt, order: SortOrder.desc },
    ]);
    expect(header("Created")).toHaveAttribute("aria-sort", "descending");
    for (const name of ["Ticket #", "Subject", "Customer", "Status", "Category"]) {
      expect(header(name)).toHaveAttribute("aria-sort", "none");
    }
    expect(locationSearch()).toBe("");
  });

  test("clicking a text header sorts A→Z, and clicking again reverses it", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Subject"));
    expect(locationSearch()).toBe("?sort=subject&order=asc");
    expect(header("Subject")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Created")).toHaveAttribute("aria-sort", "none");

    await user.click(sortButton("Subject"));
    expect(locationSearch()).toBe("?sort=subject&order=desc");
    expect(header("Subject")).toHaveAttribute("aria-sort", "descending");

    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries().map(({ sort, order }) => [sort, order])).toEqual([
      [TicketSortField.createdAt, SortOrder.desc],
      [TicketSortField.subject, SortOrder.asc],
      [TicketSortField.subject, SortOrder.desc],
    ]);
  });

  test("clicking the ticket number sorts highest first", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Ticket #"));
    expect(locationSearch()).toBe("?sort=id&order=desc");
    expect(requestedQueries().at(-1)).toEqual({
      page: 1,
      sort: TicketSortField.id,
      order: SortOrder.desc,
    });
  });

  test("going back to the default order drops the sort from the URL", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt("/tickets?sort=status&order=asc");
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Created"));
    expect(locationSearch()).toBe("");
  });

  test("changing the sort returns to the first page", async () => {
    respond = (page) => ({ status: 200, data: pageOf([ticket(page)], page, 60) });
    const user = userEvent.setup();
    renderAt("/tickets?page=2");
    await screen.findByRole("cell", { name: "#2" });

    await user.click(sortButton("Customer"));
    expect(locationSearch()).toBe("?sort=customer&order=asc");
    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries().at(-1)).toEqual({
      page: 1,
      sort: TicketSortField.customer,
      order: SortOrder.asc,
    });
  });

  test("opens with the sort named in the URL", async () => {
    respond = onePage;
    renderAt("/tickets?sort=status&order=asc");

    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries()).toEqual([
      { page: 1, sort: TicketSortField.status, order: SortOrder.asc },
    ]);
    expect(header("Status")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Created")).toHaveAttribute("aria-sort", "none");
  });

  test("treats an unknown sort or order in the URL as the default", async () => {
    respond = onePage;
    renderAt("/tickets?sort=bogus&order=sideways");

    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries()).toEqual([
      { page: 1, sort: TicketSortField.createdAt, order: SortOrder.desc },
    ]);
    expect(header("Created")).toHaveAttribute("aria-sort", "descending");
  });

  test("Next and Previous keep the sort", async () => {
    respond = (page) =>
      page === 2
        ? { status: 200, data: pageOf([ticket(26)], 2, 26) }
        : { status: 200, data: pageOf(Array.from({ length: 25 }, (_, i) => ticket(i + 1)), 1, 26) };
    const user = userEvent.setup();
    renderAt("/tickets?sort=subject&order=asc");
    await screen.findByRole("cell", { name: "#1" });

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("cell", { name: "#26" });
    expect(locationSearch()).toBe("?page=2&sort=subject&order=asc");

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("cell", { name: "#1" });
    expect(locationSearch()).toBe("?sort=subject&order=asc");
    expect(requestedQueries()).toEqual([
      { page: 1, sort: TicketSortField.subject, order: SortOrder.asc },
      { page: 2, sort: TicketSortField.subject, order: SortOrder.asc },
      { page: 1, sort: TicketSortField.subject, order: SortOrder.asc },
    ]);
  });
});

describe("TicketsPage sorting — first clicks, loading and edge cases", () => {
  const onePage = () => ({ status: 200, data: pageOf([ticket(1)], 1, 1) });

  test("every column header is a sort button", async () => {
    respond = onePage;
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Ticket #",
      "Subject",
      "Customer",
      "Status",
      "Category",
      "Created",
    ]);
    for (const h of headers) {
      expect(within(h).getByRole("button")).toBeTruthy();
    }
  });

  test("Customer and Status sort A→Z on their first click", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Customer"));
    expect(locationSearch()).toBe("?sort=customer&order=asc");
    expect(header("Customer")).toHaveAttribute("aria-sort", "ascending");

    await user.click(sortButton("Status"));
    expect(locationSearch()).toBe("?sort=status&order=asc");
    expect(header("Status")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Customer")).toHaveAttribute("aria-sort", "none");
  });

  test("clicking the already-sorted Created header flips to oldest first", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Created"));
    expect(locationSearch()).toBe("?sort=createdAt&order=asc");
    expect(header("Created")).toHaveAttribute("aria-sort", "ascending");
    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries().at(-1)).toEqual({
      page: 1,
      sort: TicketSortField.createdAt,
      order: SortOrder.asc,
    });
  });

  test("the loading skeleton already shows the requested sort", async () => {
    respond = () => ({ status: 200, pending: true });
    renderAt("/tickets?sort=subject&order=desc");

    expect(await screen.findByRole("columnheader", { name: "Subject" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(header("Created")).toHaveAttribute("aria-sort", "none");
    expect(screen.queryByRole("cell", { name: "#1" })).toBeNull();
  });

  test("keeps the current rows on screen while a new order loads", async () => {
    fakeHttp((config) =>
      config.params?.sort === TicketSortField.subject
        ? { status: 200, pending: true }
        : onePage(),
    );
    const user = userEvent.setup();
    const { container } = renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Subject"));
    // The header reflects the click at once; the old rows stay until the new
    // order arrives, rather than flashing back to the skeleton.
    expect(header("Subject")).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("cell", { name: "#1" })).toBeTruthy();
    expect(container.querySelector("section")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("the first-page link from past the end keeps the sort", async () => {
    respond = (page) =>
      page === 9
        ? { status: 200, data: pageOf([], 9, 3) }
        : { status: 200, data: pageOf([ticket(3)], 1, 3) };
    const user = userEvent.setup();
    renderAt("/tickets?page=9&sort=status&order=asc");

    await screen.findByText(/No tickets on this page/);
    await user.click(screen.getByRole("button", { name: "Go to the first page" }));
    await screen.findByRole("cell", { name: "#3" });
    expect(locationSearch()).toBe("?sort=status&order=asc");
    expect(requestedQueries().at(-1)).toEqual({
      page: 1,
      sort: TicketSortField.status,
      order: SortOrder.asc,
    });
  });

  test("shows the error when a sorted request fails", async () => {
    fakeHttp((config) =>
      config.params?.sort === TicketSortField.customer
        ? { status: 500, data: { error: "internal server error" } }
        : onePage(),
    );
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Customer"));
    expect(await screen.findByText("Could not load tickets.")).toBeTruthy();
  });
});

// The server filters; these specs check what the page asks it for and writes to
// the URL. The fake answers by category where it matters — the matching itself
// is server/src/ticket-filters.test.ts and e2e/tickets-list.spec.ts.
describe("TicketsPage filtering by category", () => {
  const onePage = () => ({ status: 200, data: pageOf([ticket(1)], 1, 1) });

  test("starts unfiltered, with All pressed", async () => {
    respond = onePage;
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    expect(requestedCategories()).toEqual([undefined]);
    expect(categoryChoice("All")).toHaveAttribute("aria-pressed", "true");
    expect(locationSearch()).toBe("");
  });

  test("choosing a category requests it and writes it to the URL", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(categoryChoice("Refund Request"));
    expect(locationSearch()).toBe("?category=refund_request");
    expect(categoryChoice("Refund Request")).toHaveAttribute("aria-pressed", "true");
    expect(categoryChoice("All")).toHaveAttribute("aria-pressed", "false");
    await screen.findByRole("cell", { name: "#1" });
    expect(requestedCategories()).toEqual([undefined, TicketCategory.refund_request]);
  });

  test("All clears the filter", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt("/tickets?category=technical_question");
    await screen.findByRole("cell", { name: "#1" });

    await user.click(categoryChoice("All"));
    expect(locationSearch()).toBe("");
    await screen.findByRole("cell", { name: "#1" });
    expect(requestedCategories()).toEqual([TicketCategory.technical_question, undefined]);
  });

  test("opens with the category named in the URL", async () => {
    respond = onePage;
    renderAt("/tickets?category=general_question");
    await screen.findByRole("cell", { name: "#1" });

    expect(requestedCategories()).toEqual([TicketCategory.general_question]);
    expect(categoryChoice("General Question")).toHaveAttribute("aria-pressed", "true");
  });

  test("treats an unknown category in the URL — even a display name — as All", async () => {
    for (const bad of ["bogus", "Refund%20Request"]) {
      respond = onePage;
      fakeHttp((config) => respond(Number(config.params?.page)));
      renderAt(`/tickets?category=${bad}`);
      await screen.findByRole("cell", { name: "#1" });

      expect(requestedCategories()).toEqual([undefined]);
      expect(categoryChoice("All")).toHaveAttribute("aria-pressed", "true");
      cleanup();
    }
  });

  test("a new filter returns to page 1 and keeps the sort", async () => {
    respond = (page) => ({ status: 200, data: pageOf([ticket(page)], page, 60) });
    const user = userEvent.setup();
    renderAt("/tickets?page=2&sort=subject&order=asc");
    await screen.findByRole("cell", { name: "#2" });

    await user.click(categoryChoice("Technical Question"));
    expect(locationSearch()).toBe("?sort=subject&order=asc&category=technical_question");
    await screen.findByRole("cell", { name: "#1" });
    expect(requestedQueries().at(-1)).toEqual({
      page: 1,
      sort: TicketSortField.subject,
      order: SortOrder.asc,
    });
    expect(requestedCategories().at(-1)).toBe(TicketCategory.technical_question);
  });

  test("sorting keeps the filter", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt("/tickets?category=refund_request");
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Customer"));
    expect(locationSearch()).toBe("?sort=customer&order=asc&category=refund_request");
    await screen.findByRole("cell", { name: "#1" });
    expect(requestedCategories()).toEqual([
      TicketCategory.refund_request,
      TicketCategory.refund_request,
    ]);
  });

  test("Next and Previous keep the filter", async () => {
    respond = (page) =>
      page === 2
        ? { status: 200, data: pageOf([ticket(26)], 2, 26) }
        : { status: 200, data: pageOf(Array.from({ length: 25 }, (_, i) => ticket(i + 1)), 1, 26) };
    const user = userEvent.setup();
    renderAt("/tickets?category=general_question");
    await screen.findByRole("cell", { name: "#1" });

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("cell", { name: "#26" });
    expect(locationSearch()).toBe("?page=2&category=general_question");

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("cell", { name: "#1" });
    expect(locationSearch()).toBe("?category=general_question");
    expect(requestedCategories()).toEqual([
      TicketCategory.general_question,
      TicketCategory.general_question,
      TicketCategory.general_question,
    ]);
  });

  test("says no tickets match when a filter finds none", async () => {
    // Like the server, the fake echoes the filter it applied.
    fakeHttp((config) =>
      config.params?.category === TicketCategory.refund_request
        ? {
            status: 200,
            data: { ...pageOf([], 1, 0), filters: { category: TicketCategory.refund_request } },
          }
        : onePage(),
    );
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(categoryChoice("Refund Request"));
    expect(await screen.findByText("No tickets match this filter.")).toBeTruthy();
    expect(screen.queryByText("No tickets yet.")).toBeNull();
    // The filter stays usable, so the reader can widen the search again.
    await user.click(categoryChoice("All"));
    expect(await screen.findByRole("cell", { name: "#1" })).toBeTruthy();
  });

  test("an empty list with no filter still says there are no tickets yet", async () => {
    renderAt();
    expect(await screen.findByText("No tickets yet.")).toBeTruthy();
    expect(screen.queryByText("No tickets match this filter.")).toBeNull();
  });

  test("the filter stays available when the list fails to load", async () => {
    respond = () => ({ status: 500, data: { error: "internal server error" } });
    renderAt("/tickets?category=refund_request");

    await screen.findByText("Could not load tickets.");
    expect(categoryChoice("Refund Request")).toHaveAttribute("aria-pressed", "true");
  });

  test("shows each category by its display name and uncategorized as a dash", async () => {
    respond = () => ({
      status: 200,
      data: pageOf(
        [
          ticket(4, { category: TicketCategory.general_question }),
          ticket(3, { category: TicketCategory.technical_question }),
          ticket(2, { category: TicketCategory.refund_request }),
          ticket(1, { category: null }),
        ],
        1,
        4,
      ),
    });
    renderAt();
    await screen.findByRole("cell", { name: "#4" });

    const categoryCells = screen
      .getAllByRole("row")
      .slice(1) // header
      .map((row) => within(row).getAllByRole("cell")[4]!.textContent);
    expect(categoryCells).toEqual([
      "General Question",
      "Technical Question",
      "Refund Request",
      "—",
    ]);
  });

  test("the Category header sorts by category, A→Z first", async () => {
    respond = onePage;
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("cell", { name: "#1" });

    await user.click(sortButton("Category"));
    expect(locationSearch()).toBe("?sort=category&order=asc");
    expect(header("Category")).toHaveAttribute("aria-sort", "ascending");
  });
});

// While a new page, sort or filter loads, the previous response stays on screen
// (keepPreviousData). Everything describing the list must match those rows, not
// the URL that is still loading.
describe("TicketsPage while a change loads", () => {
  test("keeps the no-match message for the filter still shown, not 'No tickets yet.'", async () => {
    fakeHttp((config) =>
      config.params?.category
        ? {
            status: 200,
            data: { ...pageOf([], 1, 0), filters: { category: TicketCategory.refund_request } },
          }
        : { status: 200, pending: true },
    );
    const user = userEvent.setup();
    renderAt("/tickets?category=refund_request");
    await screen.findByText("No tickets match this filter.");

    await user.click(categoryChoice("All"));
    expect(locationSearch()).toBe("");
    expect(screen.getByText("No tickets match this filter.")).toBeTruthy();
    expect(screen.queryByText("No tickets yet.")).toBeNull();
  });

  test("the range, page number and buttons describe the rows shown", async () => {
    const page2 = Array.from({ length: 2 }, (_, i) => ticket(i + 1));
    fakeHttp((config) =>
      config.params?.category
        ? { status: 200, pending: true }
        : { status: 200, data: pageOf(page2, 2, 27) },
    );
    const user = userEvent.setup();
    renderAt("/tickets?page=2");
    await screen.findByRole("cell", { name: "#1" });
    expect(screen.getByText("Showing 26–27 of 27")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();

    // The URL moves to page 1 of the filter; the screen still shows page 2.
    await user.click(categoryChoice("Refund Request"));
    expect(locationSearch()).toBe("?category=refund_request");
    expect(screen.getByText("Showing 26–27 of 27")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    // Paging off rows that are about to be replaced would land somewhere odd.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
