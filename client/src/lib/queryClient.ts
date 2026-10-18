// The app's QueryClient and the retry policy behind it. The policy lives here
// as a named export so specs can build their own client with the same rules.
import { QueryClient } from "@tanstack/react-query";
import axios from "axios";

const MAX_ATTEMPTS = 3;

/**
 * Status-aware retry. A blanket retry count is wrong for this API:
 * - a cancellation is not a failure, it is us abandoning the request;
 * - 4xx (401/403/409/400) cannot succeed on a second identical try, so
 *   retrying only delays the error the user needs to see;
 * - network errors and 5xx are the transient ones worth retrying.
 */
export function shouldRetryRequest(
  failureCount: number,
  error: unknown,
): boolean {
  if (axios.isCancel(error)) {
    return false;
  }
  if (failureCount >= MAX_ATTEMPTS) {
    return false;
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    // No response at all means a network-level failure — worth retrying.
    if (status === undefined) {
      return true;
    }
    return status >= 500;
  }
  return false;
}

/** Exponential backoff, capped so a long outage does not stall for minutes. */
export function retryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 30_000);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryRequest,
      retryDelay,
      // Serve cached rows on the way back to a page, then revalidate, rather
      // than blanking the list on every navigation.
      staleTime: 30_000,
    },
    mutations: {
      // POST /api/users has no idempotency key: a retry after a create that
      // actually succeeded comes back 409, so the admin would see "already
      // exists" for a user they just made. Writes stay single-shot.
      retry: false,
    },
  },
});
