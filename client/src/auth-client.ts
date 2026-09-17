import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

// No baseURL: the client targets the current origin + `/api/auth`, which the
// Vite dev proxy forwards to the Express server's Better Auth mount.
// `inferAdditionalFields` mirrors the server's `user.additionalFields` so the
// session's `user.role` is typed on the client (see server/src/auth.ts).
export const authClient = createAuthClient({
  // Retry the session fetch on transient failures. Without this a single
  // network blip on /api/auth/get-session resolves to "no session", and the
  // route guards sign the user out.
  //
  // shouldRetry is not optional here: better-fetch's default retries *any*
  // failed response, and a 401 is the normal answer for a logged-out visitor —
  // retrying it would delay every redirect to /login by the full backoff.
  // Mirrors the read policy in lib/queryClient.ts: transport failures and 5xx
  // only. A null response means the request never completed.
  fetchOptions: {
    retry: {
      type: "exponential",
      attempts: 2,
      baseDelay: 300,
      maxDelay: 2000,
      shouldRetry: (response: Response | null) =>
        response === null || response.status >= 500,
    },
  },
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: ["admin", "agent"] },
      },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
