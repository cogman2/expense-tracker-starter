import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";

// Email/password auth with database-backed sessions. Using a Prisma database
// adapter means sessions are persisted in the `sessions` table by default
// (no cookie-cache opt-in), which is what we want here.
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    // Sign-in stays enabled; the public sign-up endpoint is turned off.
    // Accounts must be provisioned another way (e.g. admin/seed).
    disableSignUp: true,
  },
});
