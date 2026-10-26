import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { TicketCategory, TicketStatus } from "core";
import { renderWithQuery } from "./testRender";
import { fakeHttp, httpCalls, restoreHttp, type FakeResponse } from "./testHttp";
import { TicketDetailPage } from "./TicketDetailPage";
import type { TicketAssignee, TicketDetail } from "./lib/api";

// Runs against the real lib/api module; only the network is faked, so these
// specs also cover getTicket's URL.

const detail = (overrides: Partial<TicketDetail> = {}): TicketDetail => ({
  id: 42,
  subject: "Can't log in",
  status: TicketStatus.open,
  category: TicketCategory.technical_question,
  createdAt: "2026-10-01T12:00:00.000Z",
  customer: { name: "Jane Doe", email: "jane@example.com" },
  assignee: null,
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

const ALEX: TicketAssignee = { id: "u1", name: "Alex Admin" };
const SAM: TicketAssignee = { id: "u2", name: "Sam Agent" };

/** Answers GET /api/tickets/:id. */
let respond: () => FakeResponse;
/** Answers GET /api/tickets/assignees. */
let respondAssignees: () => FakeResponse;
/** Answers PATCH /api/tickets/:id, given the body sent. */
let respondAssign: (body: { assigneeId: string | null }) => FakeResponse;

beforeEach(() => {
  respond = () => ({ status: 200, data: { ticket: detail() } });
  respondAssignees = () => ({ status: 200, data: { assignees: [ALEX, SAM] } });
  respondAssign = ({ assigneeId }) => ({
    status: 200,
    data: { ticket: { id: 42, assignee: [ALEX, SAM].find((a) => a.id === assigneeId) ?? null } },
  });
  fakeHttp((config) => {
    if (config.method === "patch") return respondAssign(JSON.parse(config.data));
    if (config.url === "/api/tickets/assignees") return respondAssignees();
    return respond();
  });
});

/** The PATCH bodies sent, in order. */
const assignBodies = () =>
  httpCalls()
    .filter((call) => call.method === "patch")
    .map((call) => [call.url, JSON.parse(call.data)]);

const assigneeSelect = () => screen.findByRole("combobox", { name: "Assignee" });

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
    expect(httpCalls()[0]?.url).toBe("/api/tickets/42");
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

describe("TicketDetailPage assignment", () => {
  test("shows who the ticket is assigned to, or Unassigned", async () => {
    respond = () => ({ status: 200, data: { ticket: detail({ assignee: SAM }) } });
    renderAt();

    expect(await assigneeSelect()).toHaveDisplayValue("Sam Agent");
    const options = within(await assigneeSelect()).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Unassigned", "Alex Admin", "Sam Agent"]);
  });

  test("picking someone assigns the ticket to them", async () => {
    const user = userEvent.setup();
    // Like the real server, later reads see the assignment: saving refetches.
    let assignee: TicketAssignee | null = null;
    respond = () => ({ status: 200, data: { ticket: detail({ assignee }) } });
    respondAssign = () => {
      assignee = ALEX;
      return { status: 200, data: { ticket: { id: 42, assignee } } };
    };
    renderAt();

    const select = await assigneeSelect();
    expect(select).toHaveDisplayValue("Unassigned");
    await user.selectOptions(select, "Alex Admin");

    await waitFor(() => expect(select).toHaveDisplayValue("Alex Admin"));
    expect(assignBodies()).toEqual([["/api/tickets/42", { assigneeId: ALEX.id }]]);
  });

  test("Unassigned sends null", async () => {
    const user = userEvent.setup();
    respond = () => ({ status: 200, data: { ticket: detail({ assignee: ALEX }) } });
    renderAt();

    await user.selectOptions(await assigneeSelect(), "Unassigned");

    expect(assignBodies()).toEqual([["/api/tickets/42", { assigneeId: null }]]);
  });

  test("disables the picker while saving", async () => {
    const user = userEvent.setup();
    respondAssign = () => ({ status: 200, pending: true });
    renderAt();

    await user.selectOptions(await assigneeSelect(), "Sam Agent");

    expect(await assigneeSelect()).toBeDisabled();
  });

  test("shows the server's message when assigning fails", async () => {
    const user = userEvent.setup();
    respondAssign = () => ({ status: 400, data: { error: "assignee must be an active user" } });
    renderAt();

    await user.selectOptions(await assigneeSelect(), "Sam Agent");

    expect(await screen.findByRole("alert")).toHaveTextContent("assignee must be an active user");
    expect(await assigneeSelect()).toHaveDisplayValue("Unassigned");
  });

  test("reads as text when the staff list cannot load", async () => {
    respond = () => ({ status: 200, data: { ticket: detail({ assignee: SAM }) } });
    respondAssignees = () => ({ status: 400, data: { error: "boom" } });
    renderAt();

    await screen.findByRole("heading", { name: "Can't log in" });
    expect(await screen.findByText("Sam Agent")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
