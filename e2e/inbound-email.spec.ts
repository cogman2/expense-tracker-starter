import { expect, test } from "@playwright/test";
import { buildEmail, createTicket, post, uid } from "./inbound-helpers";
import { TEST_SUPPORT_EMAIL } from "./webhook-env";

// Covers POST /api/webhooks/inbound-email (server/src/routes/webhooks.ts) at the
// HTTP level: what the response says. What gets stored — and most threading,
// duplicate and reopen behavior — is asserted against the database in
// e2e/inbound-storage.spec.ts; the secret, malformed and oversized bodies in
// e2e/error-responses.spec.ts.
//
// NOTE on tooling: like the other API specs (see e2e/user-editing.spec.ts),
// these use the runtime's native `fetch()` rather than Playwright's `request`
// fixture, which is unreliable under `bun run test:e2e`.

test.describe("inbound email webhook: validation and limits", () => {
  // One case is enough here: it proves the route answers with the schema's own
  // message. The rules themselves are unit-tested in core/src/schemas/tickets.test.ts.
  test("rejects a body without messageId with 400 and the schema message", async () => {
    const { messageId: _omitted, ...withoutId } = buildEmail();
    const res = await post(withoutId);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "messageId is required" });
  });

  test("accepts a body over the global 100 KB limit (route allows 5 MB)", async () => {
    const res = await post(buildEmail({ text: "x".repeat(300 * 1024) }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("created");
  });
});

test.describe("inbound email webhook: threading", () => {
  test("a [Ticket #N] email from a different sender creates a new ticket", async () => {
    const { ticketId } = await createTicket();
    const res = await post(buildEmail({ subject: `Re: hi [Ticket #${ticketId}]` }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ticketId: number; outcome: string };
    expect(json.outcome).toBe("created");
    expect(json.ticketId).not.toBe(ticketId);
  });

  test("a reply via References only is appended", async () => {
    const { email, ticketId } = await createTicket();
    const res = await post(
      buildEmail({ references: [`<unrelated-${uid()}@mail.test>`, `<${email.messageId}>`] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticketId, outcome: "appended" });
  });
});

test.describe("inbound email webhook: recipients", () => {
  // A mail client may upper-case the support address, and real mail is often
  // sent to several people: support in either form must still make a ticket.
  test("support in mixed case among several recipients is accepted", async () => {
    const res = await post(
      buildEmail({ to: ["someone-else@example.com", TEST_SUPPORT_EMAIL.toUpperCase()] }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("created");
  });
});
