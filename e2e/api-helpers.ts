import { expect } from "@playwright/test";
import { ADMIN, AGENT } from "./auth-helpers";

// Server-side checks use native fetch() with manual cookie threading:
// Playwright's APIRequestContext is unreliable on Bun (see user-editing.spec.ts).
export const SERVER_URL = "http://localhost:3000";

/** The `name=value` part of a response's Set-Cookie: what later requests send back. */
export function sessionCookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Expected a Set-Cookie header on the response");
  }
  return setCookie.split(";")[0]!;
}

/** Signs in through Better Auth; asserts nothing, so callers can test failures. */
export function signIn(email: string, password: string) {
  return fetch(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

/** Signs in, asserts it worked, and returns the session cookie. */
export async function signInCookie(email: string, password: string): Promise<string> {
  const res = await signIn(email, password);
  expect(res.status).toBe(200);
  return sessionCookieFrom(res);
}

export const adminCookie = () => signInCookie(ADMIN.email, ADMIN.password);
export const agentCookie = () => signInCookie(AGENT.email, AGENT.password);

/** PATCH /api/tickets/:id. A string body is sent as-is (for malformed JSON). */
export function patchTicket(id: string | number, body: unknown, cookie?: string) {
  return fetch(`${SERVER_URL}/api/tickets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
