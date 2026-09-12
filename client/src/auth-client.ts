import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

// No baseURL: the client targets the current origin + `/api/auth`, which the
// Vite dev proxy forwards to the Express server's Better Auth mount.
// `inferAdditionalFields` mirrors the server's `user.additionalFields` so the
// session's `user.role` is typed on the client (see server/src/auth.ts).
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: ["admin", "agent"] },
      },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
