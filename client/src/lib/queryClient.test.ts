import { describe, expect, test } from "bun:test";
import { AxiosError, CanceledError } from "axios";
import { queryClient, retryDelay, shouldRetryRequest } from "./queryClient";

// Builds an AxiosError carrying a response, the way a settled non-2xx does.
function httpError(status: number): AxiosError {
  const config = { headers: {} } as never;
  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 400 && status < 500
      ? AxiosError.ERR_BAD_REQUEST
      : AxiosError.ERR_BAD_RESPONSE,
    config,
    {},
    {
      data: {},
      status,
      statusText: String(status),
      headers: {},
      config,
    },
  );
}

describe("shouldRetryRequest", () => {
  test.each([400, 401, 403, 409, 422])(
    "does not retry %i — a second identical try cannot succeed",
    (status) => {
      expect(shouldRetryRequest(0, httpError(status))).toBe(false);
    },
  );

  test.each([500, 502, 503])("retries %i", (status) => {
    expect(shouldRetryRequest(0, httpError(status))).toBe(true);
  });

  test("retries a network error, which has no response", () => {
    const err = new AxiosError("Network Error", AxiosError.ERR_NETWORK);

    expect(err.response).toBeUndefined();
    expect(shouldRetryRequest(0, err)).toBe(true);
  });

  test("never retries a cancellation", () => {
    // Abandoning a request is not a failure to recover from — retrying one
    // would resurrect work the caller already walked away from.
    expect(shouldRetryRequest(0, new CanceledError("canceled"))).toBe(false);
  });

  test("stops after 3 attempts", () => {
    const err = httpError(500);

    expect(shouldRetryRequest(2, err)).toBe(true);
    expect(shouldRetryRequest(3, err)).toBe(false);
    expect(shouldRetryRequest(9, err)).toBe(false);
  });

  test("does not retry a non-axios error", () => {
    expect(shouldRetryRequest(0, new Error("boom"))).toBe(false);
  });
});

describe("retryDelay", () => {
  test("backs off exponentially", () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
  });

  test("caps so a long outage does not stall for minutes", () => {
    expect(retryDelay(20)).toBe(30_000);
  });
});

describe("queryClient defaults", () => {
  test("writes are single-shot — POST /api/users is not idempotent", () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  test("reads use the status-aware predicate", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(
      shouldRetryRequest,
    );
  });
});
