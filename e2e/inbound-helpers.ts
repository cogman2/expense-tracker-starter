// Shared helpers for specs that drive POST /api/webhooks/inbound-email.
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { TEST_SUPPORT_EMAIL, TEST_WEBHOOK_SECRET } from "./webhook-env";

const ENDPOINT = "http://localhost:3000/api/webhooks/inbound-email";

export type EmailOverrides = Record<string, unknown>;
export type Outcome = { ticketId: number; outcome: string };

export function uid(): string {
  return randomUUID().slice(0, 8);
}

/** A valid email addressed to support; overrides replace top-level fields. */
export function buildEmail(overrides: EmailOverrides = {}) {
  const id = uid();
  return {
    messageId: `msg-${id}@mail.test`,
    from: { email: `customer-${id}@example.com`, name: "Test Customer" },
    to: [TEST_SUPPORT_EMAIL],
    subject: `Help needed ${id}`,
    text: "Something is broken.",
    ...overrides,
  };
}

/**
 * Native fetch, like the other API specs (Playwright's `request` is unreliable on
 * Bun). Sends the server's webhook secret unless told otherwise: pass another
 * string to send a wrong one, or null to send no X-Webhook-Secret header at all.
 */
export async function post(body: unknown, secret: string | null = TEST_WEBHOOK_SECRET) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "X-Webhook-Secret": secret }),
    },
    body: JSON.stringify(body),
  });
}

/** Posts an email and asserts the status; returns the sent email and the outcome. */
export async function send(overrides: EmailOverrides, status: number) {
  const email = buildEmail(overrides);
  const res = await post(email);
  expect(res.status).toBe(status);
  return { email, result: (await res.json()) as Outcome };
}

/** Posts an email that must create a ticket. */
export async function createTicket(overrides: EmailOverrides = {}) {
  const { email, result } = await send(overrides, 201);
  return { email, ticketId: result.ticketId };
}
