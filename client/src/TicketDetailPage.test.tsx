import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { TicketCategory, TicketStatus } from "core";
import { renderWithQuery } from "./testRender";
import { fakeHttp, httpCalls, restoreHttp, type FakeResponse } from "./testHttp";
import { TicketDetailPage } from "./TicketDetailPage";
import type { TicketAssignee, TicketDetail, TicketReply } from "./lib/api";
import { REPLY_MAX_LENGTH, type CreateReplyInput, type UpdateTicketInput } from "core";

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
  replies: [],
  ...overrides,
});

const ALEX: TicketAssignee = { id: "u1", name: "Alex Admin" };
const SAM: TicketAssignee = { id: "u2", name: "Sam Agent" };

/** What the real server answers a POST of `body` with, as signed-in Sam. */
const replyFrom = (body: CreateReplyInput, id = "r-new"): TicketReply => ({
  id,
  body: body.body.trim(),
  createdAt: "2026-10-03T10:00:00.000Z",
  author: SAM,
});

/** Answers GET /api/tickets/:id. */
let respond: () => FakeResponse;
/** Answers GET /api/tickets/assignees. */
let respondAssignees: () => FakeResponse;
/** Answers PATCH /api/tickets/:id, given the body sent. */
let respondUpdate: (body: UpdateTicketInput) => FakeResponse | Promise<FakeResponse>;
/** Answers POST /api/tickets/:id/replies, given the body sent. */
let respondReply: (body: CreateReplyInput) => FakeResponse | Promise<FakeResponse>;

/** What the real server answers a PATCH with: the ticket's editable fields, as saved. */
function saved(body: UpdateTicketInput, ticket: TicketDetail = detail()): FakeResponse {
  const assignee =
    body.assigneeId === undefined
      ? ticket.assignee
      : ([ALEX, SAM].find((a) => a.id === body.assigneeId) ?? null);
  return {
    status: 200,
    data: {
      ticket: {
        id: ticket.id,
        status: body.status ?? ticket.status,
        category: body.category === undefined ? ticket.category : body.category,
        assignee,
      },
    },
  };
}

beforeEach(() => {
  respond = () => ({ status: 200, data: { ticket: detail() } });
  respondAssignees = () => ({ status: 200, data: { assignees: [ALEX, SAM] } });
  respondUpdate = (body) => saved(body);
  respondReply = (body) => ({ status: 201, data: { reply: replyFrom(body) } });
  fakeHttp((config) => {
    if (config.method === "patch") return respondUpdate(JSON.parse(config.data));
    if (config.method === "post") return respondReply(JSON.parse(config.data));
    if (config.url === "/api/tickets/assignees") return respondAssignees();
    return respond();
  });
});

/** The PATCH bodies sent, in order. */
const patchBodies = () =>
  httpCalls()
    .filter((call) => call.method === "patch")
    .map((call) => [call.url, JSON.parse(call.data)]);

const assigneeSelect = () => screen.findByRole("combobox", { name: "Assignee" });
const statusSelect = () => screen.findByRole("combobox", { name: "Status" });
const categorySelect = () => screen.findByRole("combobox", { name: "Category" });

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
    for (const text of ["#42", "Jane Doe", "jane@example.com"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(await statusSelect()).toHaveDisplayValue("Open");
    expect(await categorySelect()).toHaveDisplayValue("Technical Question");
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

    expect(await categorySelect()).toHaveDisplayValue("—");
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
    // The link renders before the ticket; let the ticket (and its reply form)
    // settle so no update lands after the test ends.
    await screen.findByRole("heading", { name: "Can't log in" });

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
    respondUpdate = (body) => {
      assignee = ALEX;
      return saved(body);
    };
    renderAt();

    const select = await assigneeSelect();
    expect(select).toHaveDisplayValue("Unassigned");
    await user.selectOptions(select, "Alex Admin");

    await waitFor(() => expect(select).toHaveDisplayValue("Alex Admin"));
    expect(patchBodies()).toEqual([["/api/tickets/42", { assigneeId: ALEX.id }]]);
    // The staff list is refetched only by invalidating every ["tickets", …] query,
    // the prefix the list's queries live under too — so the list picks it up.
    await waitFor(() => {
      const calls = httpCalls();
      const after = calls.slice(calls.findIndex((call) => call.method === "patch") + 1);
      expect(after.map((call) => call.url)).toEqual(
        expect.arrayContaining(["/api/tickets/42", "/api/tickets/assignees"]),
      );
    });
  });

  test("Unassigned sends null", async () => {
    const user = userEvent.setup();
    respond = () => ({ status: 200, data: { ticket: detail({ assignee: ALEX }) } });
    renderAt();

    await user.selectOptions(await assigneeSelect(), "Unassigned");

    expect(patchBodies()).toEqual([["/api/tickets/42", { assigneeId: null }]]);
  });

  test("shows the server's message when assigning fails, or a fallback without one", async () => {
    const cases: [FakeResponse, string][] = [
      [{ status: 400, data: { error: "assignee must be an active user" } }, "assignee must be an active user"],
      [{ status: 500 }, "Could not assign the ticket."],
    ];
    for (const [failure, message] of cases) {
      const user = userEvent.setup();
      respondUpdate = () => failure;
      renderAt();

      await user.selectOptions(await assigneeSelect(), "Sam Agent");

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(await assigneeSelect()).toHaveDisplayValue("Unassigned");
      cleanup();
    }
  });

  test("reads as text, or Unassigned, when the staff list cannot load", async () => {
    respondAssignees = () => ({ status: 400, data: { error: "boom" } });
    for (const [assignee, text] of [[SAM, "Sam Agent"], [null, "Unassigned"]] as const) {
      respond = () => ({ status: 200, data: { ticket: detail({ assignee }) } });
      renderAt();

      await screen.findByRole("heading", { name: "Can't log in" });
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
      cleanup();
    }
  });

  test("keeps the current assignee selectable when the staff list lacks them", async () => {
    const former: TicketAssignee = { id: "u9", name: "Former Staff" };
    respond = () => ({ status: 200, data: { ticket: detail({ assignee: former }) } });
    renderAt();

    const select = await assigneeSelect();
    expect(select).toHaveDisplayValue("Former Staff");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Unassigned",
      "Former Staff",
      "Alex Admin",
      "Sam Agent",
    ]);
  });
});

describe("TicketDetailPage status and category", () => {
  test("offers every status and category by label, with a dash for none", async () => {
    renderAt();

    const statuses = within(await statusSelect()).getAllByRole("option");
    expect(statuses.map((o) => o.textContent)).toEqual(["Open", "Resolved", "Closed"]);
    const categories = within(await categorySelect()).getAllByRole("option");
    expect(categories.map((o) => o.textContent)).toEqual([
      "—",
      "General Question",
      "Technical Question",
      "Refund Request",
    ]);
  });

  test("picking a status saves only the status", async () => {
    const user = userEvent.setup();
    // Like the real server, later reads see the change: saving refetches.
    let status: TicketDetail["status"] = TicketStatus.open;
    respond = () => ({ status: 200, data: { ticket: detail({ status }) } });
    respondUpdate = (body) => {
      status = body.status ?? status;
      return saved(body, detail({ status }));
    };
    renderAt();

    const select = await statusSelect();
    await user.selectOptions(select, "Resolved");

    await waitFor(() => expect(select).toHaveDisplayValue("Resolved"));
    expect(patchBodies()).toEqual([["/api/tickets/42", { status: TicketStatus.resolved }]]);
  });

  test("picking a category saves it, and the dash sends null", async () => {
    const user = userEvent.setup();
    const cases = [
      [null, "Refund Request", TicketCategory.refund_request],
      [TicketCategory.technical_question, "—", null],
    ] as const;
    for (const [current, option, sent] of cases) {
      respond = () => ({ status: 200, data: { ticket: detail({ category: current }) } });
      renderAt();

      await user.selectOptions(await categorySelect(), option);

      expect(patchBodies().at(-1)).toEqual(["/api/tickets/42", { category: sent }]);
      cleanup();
    }
  });

  test("disables only the picker that is saving", async () => {
    const user = userEvent.setup();
    respondUpdate = () => ({ status: 200, pending: true });
    renderAt();

    await user.selectOptions(await statusSelect(), "Closed");

    expect(await statusSelect()).toBeDisabled();
    expect(await categorySelect()).toBeEnabled();
    expect(await assigneeSelect()).toBeEnabled();
  });

  // The server's own message is shown the same way for every picker (see the
  // assignment tests); only the fallbacks differ.
  test("says which field could not be saved when the server gives no message", async () => {
    const cases: [() => Promise<HTMLElement>, string, string][] = [
      [statusSelect, "Closed", "Could not update the status."],
      [categorySelect, "Refund Request", "Could not update the category."],
    ];
    for (const [select, option, message] of cases) {
      const user = userEvent.setup();
      respondUpdate = () => ({ status: 500 });
      renderAt();

      await user.selectOptions(await select(), option);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(await select()).not.toHaveDisplayValue(option);
      cleanup();
    }
  });
});

describe("TicketDetailPage concurrent saves", () => {
  test("a late answer doesn't overwrite a field another picker saved since", async () => {
    const user = userEvent.setup();
    // The server's state; the status save commits first but answers last.
    let server = detail();
    let deliverStatus!: () => void;
    // Refetches never land, so only the PATCH answers update the page.
    const first = detail();
    let loaded = false;
    respond = () => {
      if (loaded) return { status: 200, pending: true };
      loaded = true;
      return { status: 200, data: { ticket: first } };
    };
    respondUpdate = (body) => {
      server = { ...server, ...body } as TicketDetail;
      const answer = saved({}, server); // a snapshot as of this commit
      if (body.status === undefined) return answer;
      return new Promise<FakeResponse>((resolve) => (deliverStatus = () => resolve(answer)));
    };
    renderAt();

    await user.selectOptions(await statusSelect(), "Closed");
    await user.selectOptions(await categorySelect(), "Refund Request");
    await waitFor(async () =>
      expect(await categorySelect()).toHaveDisplayValue("Refund Request"),
    );
    deliverStatus();

    await waitFor(async () => expect(await statusSelect()).toHaveDisplayValue("Closed"));
    expect(await categorySelect()).toHaveDisplayValue("Refund Request");
  });

  test("keeps showing the ticket when the refetch after a save fails", async () => {
    const user = userEvent.setup();
    let loaded = false;
    respond = () => {
      if (loaded) return { status: 400, data: { error: "boom" } };
      loaded = true;
      return { status: 200, data: { ticket: detail() } };
    };
    renderAt();

    await user.selectOptions(await statusSelect(), "Resolved");

    await waitFor(() => expect(httpCalls().filter((c) => c.method === "get").length).toBeGreaterThan(2));
    expect(await statusSelect()).toHaveDisplayValue("Resolved");
    expect(screen.queryByText("Could not load ticket.")).toBeNull();
  });

  test("says the ticket was not found when a refetch after a save gets a 404", async () => {
    const user = userEvent.setup();
    let loaded = false;
    respond = () => {
      if (loaded) return { status: 404, data: { error: "ticket not found" } };
      loaded = true;
      return { status: 200, data: { ticket: detail() } };
    };
    renderAt();

    await user.selectOptions(await statusSelect(), "Resolved");

    // Gone wins over the copy already on screen.
    expect(await screen.findByText("Ticket not found.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status" })).toBeNull();
  });
});

describe("TicketDetailPage replies", () => {
  const OLDER: TicketReply = {
    id: "r1",
    body: "Hi Jane,\nTry resetting your password.",
    createdAt: "2026-10-01T13:00:00.000Z",
    author: ALEX,
  };
  const NEWER: TicketReply = {
    id: "r2",
    body: "Any luck?",
    createdAt: "2026-10-02T10:00:00.000Z",
    author: SAM,
  };

  const repliesList = () => screen.findByRole("list", { name: "Replies" });
  const replyBox = () => screen.findByRole("textbox", { name: "Reply" });
  const sendButton = () => screen.findByRole("button", { name: "Send reply" });
  const postCalls = () => httpCalls().filter((call) => call.method === "post");

  test("shows the replies below the messages, oldest first, by author", async () => {
    respond = () => ({ status: 200, data: { ticket: detail({ replies: [OLDER, NEWER] }) } });
    renderAt();

    expect(await screen.findByRole("list", { name: "Messages" })).toBeInTheDocument();
    const replies = within(await repliesList()).getAllByRole("listitem");
    expect(replies).toHaveLength(2);
    expect(replies[0]).toHaveTextContent("Alex Admin");
    expect(replies[0]).toHaveTextContent("Try resetting your password.");
    expect(replies[1]).toHaveTextContent("Sam Agent");
    expect(replies[1]).toHaveTextContent("Any luck?");
  });

  test("says when there are no replies yet", async () => {
    renderAt();

    expect(await screen.findByText("No replies yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Replies" })).not.toBeInTheDocument();
  });

  test("refuses a blank reply without asking the server", async () => {
    const user = userEvent.setup();
    renderAt();

    await user.type(await replyBox(), "   ");
    await user.click(await sendButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("reply body is required");
    expect(postCalls()).toEqual([]);
  });

  test("keeps all of a paste over the limit and says it is too long", async () => {
    const user = userEvent.setup();
    renderAt();

    // A maxLength would silently drop the overflow; the text must stay whole.
    const tooLong = "a".repeat(REPLY_MAX_LENGTH + 50);
    await user.click(await replyBox());
    await user.paste(tooLong);
    expect(await replyBox()).toHaveValue(tooLong);
    await user.click(await sendButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "reply body must be 10000 characters or fewer",
    );
    expect(postCalls()).toEqual([]);
  });

  test("two submits in the same tick post the reply once", async () => {
    const user = userEvent.setup();
    renderAt();

    await user.type(await replyBox(), "Just once.");
    // Both fire before React re-renders, so the disabled button can't stop the second.
    const form = (await replyBox()).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(async () => expect(await replyBox()).toHaveValue(""));
    expect(postCalls()).toHaveLength(1);
  });

  test("sending posts the trimmed body, adds the reply and clears the box", async () => {
    const user = userEvent.setup();
    // Like the real server, the refetch after posting sees the new reply.
    let replies: TicketReply[] = [];
    respond = () => ({ status: 200, data: { ticket: detail({ replies }) } });
    respondReply = (body) => {
      replies = [replyFrom(body)];
      return { status: 201, data: { reply: replies[0] } };
    };
    renderAt();

    await user.type(await replyBox(), "  Fixed it for you.  ");
    await user.click(await sendButton());

    const replyItems = within(await repliesList()).getAllByRole("listitem");
    expect(replyItems).toHaveLength(1);
    expect(replyItems[0]).toHaveTextContent("Sam Agent");
    expect(replyItems[0]).toHaveTextContent("Fixed it for you.");
    expect(postCalls().map((call) => [call.url, JSON.parse(call.data)])).toEqual([
      ["/api/tickets/42/replies", { body: "Fixed it for you." }],
    ]);
    await waitFor(async () => expect(await replyBox()).toHaveValue(""));
  });

  test("disables sending while the reply is in flight", async () => {
    const user = userEvent.setup();
    respondReply = () => ({ status: 201, pending: true });
    renderAt();

    await user.type(await replyBox(), "On it.");
    await user.click(await sendButton());

    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(await replyBox()).toHaveAttribute("readonly");
  });

  test("shows the server's message when sending fails, or a fallback without one, and keeps the text", async () => {
    const user = userEvent.setup();
    respondReply = () => ({ status: 404, data: { error: "ticket not found" } });
    renderAt();

    await user.type(await replyBox(), "Hello?");
    await user.click(await sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("ticket not found");
    expect(await replyBox()).toHaveValue("Hello?");

    respondReply = () => ({ status: 500 });
    await user.click(await sendButton());
    await waitFor(async () =>
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not send the reply."),
    );
    expect(await replyBox()).toHaveValue("Hello?");
  });

  test("a successful retry clears the error from the failed send", async () => {
    const user = userEvent.setup();
    // Like the real server, later reads include the reply once it's stored.
    let replies: TicketReply[] = [];
    respond = () => ({ status: 200, data: { ticket: detail({ replies }) } });
    let attempts = 0;
    respondReply = (body) => {
      if (++attempts === 1) return { status: 500, data: { error: "database unavailable" } };
      replies = [replyFrom(body)];
      return { status: 201, data: { reply: replies[0] } };
    };
    renderAt();

    await user.type(await replyBox(), "Second time lucky.");
    await user.click(await sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("database unavailable");

    await user.click(await sendButton());

    expect(within(await repliesList()).getByRole("listitem")).toHaveTextContent(
      "Second time lucky.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(postCalls()).toHaveLength(2);
  });

  test("doesn't list the reply twice when a refetch brought it in first", async () => {
    const user = userEvent.setup();
    // Like the real server, the ticket includes the reply as soon as it's stored,
    // but the POST's own answer is held back until the test releases it.
    let replies: TicketReply[] = [];
    respond = () => ({ status: 200, data: { ticket: detail({ replies }) } });
    let release!: () => void;
    respondReply = (body) => {
      replies = [replyFrom(body)];
      return new Promise<FakeResponse>((resolve) => {
        release = () => resolve({ status: 201, data: { reply: replies[0] } });
      });
    };
    renderAt();

    await user.type(await replyBox(), "Only once, please.");
    await user.click(await sendButton());
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    // Saving the status refetches the ticket, which now has the reply.
    await user.selectOptions(await statusSelect(), TicketStatus.resolved);
    await waitFor(async () =>
      expect(within(await repliesList()).getAllByRole("listitem")).toHaveLength(1),
    );

    // Hold the refetch that follows the send, so what's listed is exactly what
    // the form wrote into the cache — a refetch would hide a duplicate.
    respond = () => ({ status: 200, pending: true });
    release();

    await waitFor(async () => expect(await replyBox()).toHaveValue(""));
    expect(within(await repliesList()).getAllByRole("listitem")).toHaveLength(1);
  });
});
