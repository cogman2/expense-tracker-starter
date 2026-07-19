import { createAuthClient } from "better-auth/react";

// No baseURL: the client targets the current origin + `/api/auth`, which the
// Vite dev proxy forwards to the Express server's Better Auth mount.
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
