import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { TicketCategory, TicketStatus } from "core";
import { renderWithQuery } from "./testRender";
import { fakeHttp, httpCalls, restoreHttp, type FakeResponse } from "./testHttp";
import { TicketDetailPage } from "./TicketDetailPage";
import type { TicketDetail } from "./lib/api";

// Runs against the real lib/api module; only the network is faked, so these
// specs also cover getTicket's URL.

const detail = (overrides: Partial<TicketDetail> = {}): TicketDetail => ({
  id: 42,
  subject: "Can't log in",
  status: TicketStatus.open,
  category: TicketCategory.technical_question,
  createdAt: "2026-10-01T12:00:00.000Z",
  customer: { name: "Jane Doe", email: "jane@example.com" },
  messages: [
    {
      id: "m1",
      fromEmail: "jane@example.com",
      fromName: "Jane Doe",
      subject: "Can't log in",
      bodyText: "Hello,\nI can't log in.",
      receivedAt: "2026-10-01T12:00:00.000Z",
    },
    {
      id: "m2",
      fromEmail: "jane@example.com",
      fromName: null,
      subject: "Re: Can't log in",
      bodyText: "Still broken.",
      receivedAt: "2026-10-02T09:30:00.000Z",
    },
  ],
  ...overrides,
});

let respond: () => FakeResponse;

beforeEach(() => {
  respond = () => ({ status: 200, data: { ticket: detail() } });
  fakeHttp(() => respond());
});

afterEach(() => {
  cleanup();
  restoreHttp();
});

function renderAt(url = "/tickets/42") {
  return renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TicketDetailPage", () => {
  test("requests the ticket in the URL and shows its details", async () => {
    renderAt();

    expect(await screen.findByRole("heading", { name: "Can't log in" })).toBeInTheDocument();
    expect(httpCalls().map((call) => call.url)).toEqual(["/api/tickets/42"]);
    for (const text of ["#42", TicketStatus.open, "Technical Question", "Jane Doe", "jane@example.com"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByText(new Date("2026-10-01T12:00:00.000Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });

  test("shows the thread oldest first, by name or by address", async () => {
    renderAt();

    const messages = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toHaveTextContent("Jane Doe <jane@example.com>");
    expect(messages[0]).toHaveTextContent("I can't log in.");
    expect(messages[1]).toHaveTextContent("jane@example.com");
    expect(messages[1]).not.toHaveTextContent("Jane Doe");
    expect(messages[1]).toHaveTextContent("Still broken.");
  });

  test("shows a dash for an uncategorized ticket", async () => {
    respond = () => ({ status: 200, data: { ticket: detail({ category: null }) } });
    renderAt();

    await screen.findByRole("heading", { name: "Can't log in" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("says when the ticket has no messages", async () => {
    respond = () => ({ status: 200, data: { ticket: detail({ messages: [] }) } });
    renderAt();

    expect(await screen.findByText("No messages.")).toBeInTheDocument();
  });

  test("says the ticket was not found on a 404", async () => {
    respond = () => ({ status: 404, data: { error: "ticket not found" } });
    renderAt();

    expect(await screen.findByText("Ticket not found.")).toBeInTheDocument();
  });

  test("treats a malformed id as not found, without asking the server", async () => {
    renderAt("/tickets/abc");

    expect(await screen.findByText("Ticket not found.")).toBeInTheDocument();
    expect(httpCalls()).toEqual([]);
  });

  test("shows an error when the ticket cannot load", async () => {
    respond = () => ({ status: 400, data: { error: "boom" } });
    renderAt();

    expect(await screen.findByText("Could not load ticket.")).toBeInTheDocument();
  });

  test("links back to the plain list when not opened from it", async () => {
    renderAt();

    expect(await screen.findByRole("link", { name: /back to tickets/i })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });
});
