// The pure rules of inbound email handling: no database, no HTTP, so they are
// unit-tested directly (inbound-rules.test.ts).

// "[Ticket #42]" anywhere in the subject, as outbound replies will write it.
const TICKET_TOKEN = /\[Ticket #(\d+)\]/i;

/** The ticket number in a subject's `[Ticket #N]` token, or null if none. */
export function parseTicketToken(subject: string): number | null {
  const match = TICKET_TOKEN.exec(subject);
  if (!match) return null;
  const id = Number(match[1]);
  // Ticket ids are Postgres INTs; anything larger cannot exist.
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

/** Whether the support address is among the recipients (case-insensitive). */
export function isForSupport(to: string[], supportAddress: string): boolean {
  const wanted = supportAddress.trim().toLowerCase();
  return wanted !== "" && to.some((address) => address.toLowerCase() === wanted);
}

/**
 * The configured support address, or null when there is none. Blank or
 * whitespace-only counts as none: it would otherwise pass a truthiness check and
 * then match no recipient, silently ignoring every email.
 */
export function supportAddressFrom(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const address = env.SUPPORT_EMAIL_ADDRESS?.trim().toLowerCase();
  return address ? address : null;
}
