import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";

// Email/password auth with database-backed sessions. Using a Prisma database
// adapter means sessions are persisted in the `sessions` table by default
// (no cookie-cache opt-in), which is what we want here.
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  // The browser talks to the app from the Vite dev origin (proxied to here),
  // so it must be trusted or Better Auth rejects requests with "Invalid
  // origin". Override via BETTER_AUTH_TRUSTED_ORIGINS (comma-separated).
  trustedOrigins: (
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    // Sign-in stays enabled; the public sign-up endpoint is turned off.
    // Accounts must be provisioned another way (e.g. the db:seed script).
    disableSignUp: true,
  },
  // Helpdesk role. `input: false` keeps it out of any client-supplied payload;
  // it's set server-side (e.g. by the seed script). Defaults to "agent".
  user: {
    additionalFields: {
      role: {
        type: ["admin", "agent"],
        required: false,
        defaultValue: "agent",
        input: false,
      },
    },
  },
});
