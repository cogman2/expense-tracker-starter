import { expect, test } from "@playwright/test";
import { SERVER_URL, adminCookie, agentCookie, postReply, signInCookie } from "./api-helpers";
import { ADMIN, AGENT, loginAndWaitForHome } from "./auth-helpers";
import { Role } from "core";
import { db } from "./db";
import { createTicket } from "./inbound-helpers";

// POST /api/tickets/:id/replies against the real stack. Rendering, client
// validation and the schema's full rule matrix live in
// client/src/TicketDetailPage.test.tsx and core/src/schemas/tickets.test.ts.
type Reply = { id: string; body: string; createdAt: string; author: { id: string; name: string } };

async function getReplies(ticketId: number, cookie: string): Promise<Reply[]> {
  const res = await fetch(`${SERVER_URL}/api/tickets/${ticketId}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const { ticket } = (await res.json()) as { ticket: { replies: Reply[] } };
  return ticket.replies;
}

test.describe("POST /api/tickets/:id/replies", () => {
  test("is 401 when unauthenticated", async () => {
    const { ticketId } = await createTicket();
    const res = await postReply(ticketId, { body: "hello" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("is 404 for an unknown ticket", async () => {
    const res = await postReply(2147483647, { body: "hello" }, await agentCookie());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ticket not found" });
  });

  test("rejects a malformed ticket id with 400", async () => {
    const res = await postReply("abc", { body: "hello" }, await agentCookie());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ticket id must be a whole number of 1 or more" });
  });

  test("rejects a blank body with 400 and stores nothing", async () => {
    const cookie = await agentCookie();
    const { ticketId } = await createTicket();
    const res = await postReply(ticketId, { body: "   " }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "reply body is required" });
    expect(await getReplies(ticketId, cookie)).toEqual([]);
  });

  test("stores a trimmed reply authored by the session user and ignores a body authorId", async () => {
    const cookie = await agentCookie();
    const agent = await db.user.findUniqueOrThrow({ where: { email: AGENT.email } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    const { ticketId } = await createTicket();

    const res = await postReply(
      ticketId,
      { body: "  Thanks for reaching out.  \n", authorId: admin.id },
      cookie,
    );
    expect(res.status).toBe(201);
    const { reply } = (await res.json()) as { reply: Reply };
    expect(reply).toMatchObject({
      body: "Thanks for reaching out.",
      author: { id: agent.id, name: agent.name },
    });
    expect(Object.keys(reply.author).sort()).toEqual(["id", "name"]);

    expect(await getReplies(ticketId, cookie)).toEqual([reply]);
    const stored = await db.reply.findUniqueOrThrow({ where: { id: reply.id } });
    expect(stored.authorId).toBe(agent.id);
  });

  test("lets an admin post, and returns replies oldest first", async () => {
    const agent = await agentCookie();
    const admin = await adminCookie();
    const { ticketId } = await createTicket();

    const first = await postReply(ticketId, { body: "first from agent" }, agent);
    expect(first.status).toBe(201);
    const second = await postReply(ticketId, { body: "second from admin" }, admin);
    expect(second.status).toBe(201);

    const replies = await getReplies(ticketId, agent);
    expect(replies.map((r) => r.body)).toEqual(["first from agent", "second from admin"]);
    expect(replies.map((r) => r.author.name)).toEqual([AGENT.name, ADMIN.name]);
  });

  // That deletion revokes the user's session is e2e/user-deletion.spec.ts's job.
  test("keeps a soft-deleted user's replies, with their name", async () => {
    const admin = await adminCookie();
    const seededAgent = await agentCookie();
    const email = `reply-author-${test.info().testId}-${Date.now()}@example.com`;
    const created = await fetch(`${SERVER_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ name: "Departing Author", email, password: "password123", role: Role.agent }),
    });
    expect(created.status).toBe(201);
    const { user } = (await created.json()) as { user: { id: string; name: string } };

    const { ticketId } = await createTicket();
    const authorCookie = await signInCookie(email, "password123");
    const posted = await postReply(ticketId, { body: "Written before leaving." }, authorCookie);
    expect(posted.status).toBe(201);

    const del = await fetch(`${SERVER_URL}/api/users/${user.id}`, {
      method: "DELETE",
      headers: { Cookie: admin },
    });
    expect(del.status).toBe(204);

    const replies = await getReplies(ticketId, seededAgent);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      body: "Written before leaving.",
      author: { id: user.id, name: user.name },
    });
  });
});

// Rendering, clearing the box and the empty state are component-tested; this
// proves the real client and server persist a reply across a reload.
test.describe("replying from the ticket page", () => {
  test("an agent sends a reply that shows in the list and survives a reload", async ({ page }) => {
    const { ticketId } = await createTicket();
    const text = `Browser reply ${ticketId}`;

    await loginAndWaitForHome(page, AGENT.email, AGENT.password);
    await page.goto(`/tickets/${ticketId}`);

    const replies = page.getByRole("list", { name: "Replies" });
    await page.getByRole("textbox", { name: "Reply" }).fill(text);
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(replies.getByText(text)).toBeVisible();

    await page.reload();
    await expect(replies.getByText(text)).toBeVisible();
    await expect(replies.getByText(AGENT.name, { exact: true })).toBeVisible();
  });
});
