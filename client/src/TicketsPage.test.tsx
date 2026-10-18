import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { TicketStatus } from "core";
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
  createdAt: "2026-10-01T12:00:00.000Z",
  customer: { name: `Customer ${id}`, email: `c${id}@example.com` },
  ...overrides,
});

const pageOf = (tickets: TicketRow[], page: number, total: number): TicketPage => ({
  tickets,
  total,
  page,
  pageSize: 25,
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

describe("TicketsPage", () => {
  test("shows each ticket's number, subject, customer, status and date", async () => {
    respond = () => ({
      status: 200,
      data: pageOf([ticket(42, { status: TicketStatus.resolved }), ticket(41)], 1, 2),
    });
    renderAt();

    const row = (await screen.findByRole("cell", { name: "#42" })).closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "#42",
      "Subject 42",
      "Customer 42",
      TicketStatus.resolved,
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
