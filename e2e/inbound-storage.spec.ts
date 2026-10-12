import { expect, test } from "@playwright/test";
import { TicketStatus } from "core";
import { db } from "./db";
import {
  buildEmail,
  createTicket,
  post,
  send,
  uid,
  type Outcome,
} from "./inbound-helpers";

// What POST /api/webhooks/inbound-email actually STORES, read straight from the
// isolated e2e database (e2e/db.ts). Every test uses unique message ids and
// sender addresses, so tests stay independent under fullyParallel.
test.afterAll(async () => {
  await db.$disconnect();
});

const messageCount = (messageId: string) => db.message.count({ where: { messageId } });

test.describe("inbound email storage: stored data", () => {
  test("a new email stores the ticket, customer and normalized message fields", async () => {
    const id = uid();
    const sender = `Jane-${id}@X.test`;
    const { email, result } = await send(
      {
        messageId: `<new-${id}@mail.test>`,
        from: { email: sender, name: "  Jane Doe  " },
        subject: `  Printer on fire ${id}  `,
        text: "plain body",
        html: "<p>html body</p>",
        inReplyTo: `<parent-${id}@mail.test>`,
        references: [`<root-${id}@mail.test>`, ` <parent-${id}@mail.test> `],
      },
      201,
    );
    expect(email.messageId).toBe(`<new-${id}@mail.test>`);

    const ticket = await db.ticket.findUniqueOrThrow({
      where: { id: result.ticketId },
      include: { customer: true, messages: true },
    });
    expect(ticket.subject).toBe(`Printer on fire ${id}`);
    expect(ticket.status).toBe(TicketStatus.open);
    expect(ticket.customer.email).toBe(sender.toLowerCase());
    expect(ticket.customer.name).toBe("Jane Doe");

    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]).toMatchObject({
      messageId: `new-${id}@mail.test`,
      fromEmail: sender.toLowerCase(),
      fromName: "Jane Doe",
      subject: `Printer on fire ${id}`,
      bodyText: "plain body",
      bodyHtml: "<p>html body</p>",
      inReplyTo: `parent-${id}@mail.test`,
      references: [`root-${id}@mail.test`, `parent-${id}@mail.test`],
    });
  });

  test("an email without a subject is stored as '(no subject)' on ticket and message", async () => {
    const id = uid();
    const { result } = await send({ messageId: `nosubj-${id}@mail.test`, subject: undefined }, 201);

    const ticket = await db.ticket.findUniqueOrThrow({
      where: { id: result.ticketId },
      include: { messages: true },
    });
    expect(ticket.subject).toBe("(no subject)");
    expect(ticket.messages.map((m) => m.subject)).toEqual(["(no subject)"]);
  });

  test("optional fields absent are stored as null / empty", async () => {
    const { result } = await send({ from: { email: `bare-${uid()}@example.com` } }, 201);
    const message = await db.message.findFirstOrThrow({ where: { ticketId: result.ticketId } });
    expect(message.fromName).toBeNull();
    expect(message.bodyHtml).toBeNull();
    expect(message.inReplyTo).toBeNull();
    expect(message.references).toEqual([]);
  });
});

test.describe("inbound email storage: customers", () => {
  test("the same address in different case is ONE customer", async () => {
    const id = uid();
    await createTicket({ from: { email: `Jane-${id}@X.test`, name: "Jane" } });
    await createTicket({ from: { email: `jane-${id}@x.test`, name: "Jane" } });

    const customers = await db.customer.findMany({ where: { email: `jane-${id}@x.test` } });
    expect(customers).toHaveLength(1);
    expect(await db.ticket.count({ where: { customerId: customers[0]!.id } })).toBe(2);
  });

  test("a later email fills a missing customer name", async () => {
    const email = `noname-${uid()}@example.com`;
    await createTicket({ from: { email } });
    expect((await db.customer.findUniqueOrThrow({ where: { email } })).name).toBeNull();

    await createTicket({ from: { email, name: "Filled In" } });
    expect((await db.customer.findUniqueOrThrow({ where: { email } })).name).toBe("Filled In");
  });

  test("a later email with a different name does not overwrite an existing name", async () => {
    const email = `named-${uid()}@example.com`;
    await createTicket({ from: { email, name: "Original Name" } });
    await createTicket({ from: { email, name: "Someone Else" } });
    expect((await db.customer.findUniqueOrThrow({ where: { email } })).name).toBe("Original Name");
  });
});

test.describe("inbound email storage: nothing stored", () => {
  test("a duplicate does not add a message or ticket", async () => {
    const { email, ticketId } = await createTicket();
    const ticketsBefore = await db.ticket.count();
    expect(await messageCount(email.messageId)).toBe(1);

    const res = await post(email);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticketId, outcome: "duplicate" });

    expect(await messageCount(email.messageId)).toBe(1);
    expect(await db.message.count({ where: { ticketId } })).toBe(1);
    // Other tests create tickets concurrently, so only assert it did not shrink.
    expect(await db.ticket.count()).toBeGreaterThanOrEqual(ticketsBefore);
  });

  test("a redelivered reply is a duplicate of its thread and adds no message", async () => {
    const { email: first, ticketId } = await createTicket();
    const { email: reply, result } = await send({ inReplyTo: `<${first.messageId}>` }, 200);
    expect(result).toEqual({ ticketId, outcome: "appended" });
    expect(await db.message.count({ where: { ticketId } })).toBe(2);

    // The provider retries the reply: same Message-ID, same body.
    const res = await post(reply);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticketId, outcome: "duplicate" });

    expect(await messageCount(reply.messageId)).toBe(1);
    expect(await db.message.count({ where: { ticketId } })).toBe(2);
  });

  test("an email for another address is ignored and stores nothing", async () => {
    const email = buildEmail({ to: ["someone-else@example.com"] });
    const res = await post(email);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ outcome: "ignored" });

    expect(await db.customer.findUnique({ where: { email: email.from.email } })).toBeNull();
    expect(await messageCount(email.messageId)).toBe(0);
  });

  // The secret is the webhook's only gate, so a rejected request must leave no
  // trace. Re-sending the same email with the right secret afterwards proves the
  // 401 came from the secret, not from anything wrong with the email itself.
  for (const [label, secret] of [
    ["a wrong secret", "not-the-webhook-secret"],
    ["no secret", null],
  ] as const) {
    test(`a valid email with ${label} is rejected with 401 and stores nothing`, async () => {
      const email = buildEmail();
      const res = await post(email, secret);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });

      expect(await db.customer.findUnique({ where: { email: email.from.email } })).toBeNull();
      expect(await messageCount(email.messageId)).toBe(0);

      const accepted = await post(email);
      expect(accepted.status).toBe(201);
      expect(await messageCount(email.messageId)).toBe(1);
    });
  }

  test("an invalid body stores nothing", async () => {
    const { text: _omitted, ...invalid } = buildEmail();
    const res = await post(invalid);
    expect(res.status).toBe(400);

    expect(await db.customer.findUnique({ where: { email: invalid.from.email } })).toBeNull();
    expect(await messageCount(invalid.messageId)).toBe(0);
  });
});

test.describe("inbound email storage: reopening", () => {
  for (const status of [TicketStatus.resolved, TicketStatus.closed]) {
    test(`a [Ticket #N] reply reopens a ${status} ticket`, async () => {
      const { email, ticketId } = await createTicket();
      await db.ticket.update({ where: { id: ticketId }, data: { status } });

      const { result } = await send(
        { from: email.from, subject: `Re: ${email.subject} [Ticket #${ticketId}]` },
        200,
      );
      expect(result).toEqual({ ticketId, outcome: "appended" });
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(
        TicketStatus.open,
      );
      expect(await db.message.count({ where: { ticketId } })).toBe(2);
    });

    test(`an In-Reply-To reply reopens a ${status} ticket`, async () => {
      const { email, ticketId } = await createTicket();
      await db.ticket.update({ where: { id: ticketId }, data: { status } });

      const { result } = await send({ inReplyTo: `<${email.messageId}>` }, 200);
      expect(result).toEqual({ ticketId, outcome: "appended" });
      expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(
        TicketStatus.open,
      );
    });
  }

  test("a reply to an already-open ticket leaves it open", async () => {
    const { email, ticketId } = await createTicket();
    await send({ inReplyTo: email.messageId }, 200);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(
      TicketStatus.open,
    );
  });
});

test.describe("inbound email storage: concurrent duplicates", () => {
  for (let run = 1; run <= 5; run++) {
    test(`two identical parallel deliveries store one message (run ${run})`, async () => {
      const email = buildEmail();
      const responses = await Promise.all([post(email), post(email)]);
      const bodies = await Promise.all(
        responses.map(async (res) => ({ status: res.status, json: (await res.json()) as Outcome })),
      );

      expect(bodies.map((b) => b.status).sort()).toEqual([200, 201]);
      const created = bodies.find((b) => b.status === 201)!;
      const duplicate = bodies.find((b) => b.status === 200)!;
      expect(created.json.outcome).toBe("created");
      expect(duplicate.json.outcome).toBe("duplicate");
      expect(duplicate.json.ticketId).toBe(created.json.ticketId);

      expect(await messageCount(email.messageId)).toBe(1);
      expect(await db.ticket.count({ where: { customer: { email: email.from.email } } })).toBe(1);
    });
  }
});

test.describe("inbound email storage: threading precedence", () => {
  test("a nonexistent [Ticket #N] falls back to a valid In-Reply-To", async () => {
    const { email, ticketId } = await createTicket();
    const { result } = await send(
      {
        from: email.from,
        subject: "Re: hello [Ticket #2000000000]",
        inReplyTo: `<${email.messageId}>`,
      },
      200,
    );
    expect(result).toEqual({ ticketId, outcome: "appended" });
  });

  test("the subject token wins over In-Reply-To", async () => {
    const a = await createTicket();
    const b = await createTicket();

    const { email, result } = await send(
      {
        from: a.email.from,
        subject: `Re: x [Ticket #${a.ticketId}]`,
        inReplyTo: `<${b.email.messageId}>`,
      },
      200,
    );
    expect(result).toEqual({ ticketId: a.ticketId, outcome: "appended" });
    expect((await db.message.findUniqueOrThrow({ where: { messageId: email.messageId } })).ticketId).toBe(
      a.ticketId,
    );
    expect(await db.message.count({ where: { ticketId: b.ticketId } })).toBe(1);
  });

  test("a reply from a different address via In-Reply-To joins the ticket without changing its customer", async () => {
    const a = await createTicket();
    const colleague = `colleague-${uid()}@example.com`;

    const { email, result } = await send(
      { from: { email: colleague, name: "Colleague" }, inReplyTo: `<${a.email.messageId}>` },
      200,
    );
    expect(result).toEqual({ ticketId: a.ticketId, outcome: "appended" });

    const message = await db.message.findUniqueOrThrow({ where: { messageId: email.messageId } });
    expect(message.ticketId).toBe(a.ticketId);
    expect(message.fromEmail).toBe(colleague);

    const ticket = await db.ticket.findUniqueOrThrow({
      where: { id: a.ticketId },
      include: { customer: true },
    });
    expect(ticket.customer.email).toBe(a.email.from.email);
    expect(await db.customer.findUnique({ where: { email: colleague } })).not.toBeNull();
  });
});
