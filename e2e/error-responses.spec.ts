import { expect, test } from "@playwright/test";
import { TEST_WEBHOOK_SECRET } from "./webhook-env";

// Covers the app-wide JSON error handler (server/src/middleware/error-handler.ts).
//
// Tooling note: native `fetch()` is used instead of Playwright's `request`
// fixture, as in the other API specs (see e2e/user-editing.spec.ts).
const SERVER_URL = "http://localhost:3000";
const WEBHOOK_URL = `${SERVER_URL}/api/webhooks/inbound-email`;
const USERS_URL = `${SERVER_URL}/api/users`;

const MALFORMED_JSON = '{"name": "oops", ';

function post(url: string, body: string, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

/** A syntactically valid JSON body of roughly `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  return JSON.stringify({ padding: "a".repeat(bytes) });
}

/** Asserts the JSON content type, the exact body, and that nothing leaks. */
async function expectJsonError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/json");
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error });
  expect(text).not.toContain("node_modules");
  expect(text).not.toContain("at ");
  expect(text).not.toMatch(/\.(ts|js):\d+/);
}

test.describe("webhook route errors", () => {
  const secret = { "X-Webhook-Secret": TEST_WEBHOOK_SECRET };

  test("malformed JSON with the correct secret gets 400 invalid JSON body", async () => {
    const res = await post(WEBHOOK_URL, MALFORMED_JSON, secret);
    await expectJsonError(res, 400, "invalid JSON body");
  });

  test("a body over 5 MB gets 413 request body too large", async () => {
    const res = await post(WEBHOOK_URL, jsonOfSize(5.5 * 1024 * 1024), secret);
    await expectJsonError(res, 413, "request body too large");
  });

  test("a wrong secret is rejected before the malformed body is parsed", async () => {
    const res = await post(WEBHOOK_URL, MALFORMED_JSON, {
      "X-Webhook-Secret": "not-the-secret",
    });
    await expectJsonError(res, 401, "unauthorized");
  });
});

test.describe("global body parser errors", () => {
  test("POST /api/users with malformed JSON gets 400 invalid JSON body", async () => {
    const res = await post(USERS_URL, MALFORMED_JSON);
    await expectJsonError(res, 400, "invalid JSON body");
  });

  test("POST /api/users with a ~200 KB body gets 413 request body too large", async () => {
    const res = await post(USERS_URL, jsonOfSize(200 * 1024));
    await expectJsonError(res, 413, "request body too large");
  });
});
