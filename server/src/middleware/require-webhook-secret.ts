import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Route guard for machine-to-machine webhooks, which carry no session: the
// caller must send the shared secret from WEBHOOK_SECRET in the
// X-Webhook-Secret header. The counterpart of requireAuth (../require-auth.ts)
// for callers that are services rather than signed-in staff.
export function requireWebhookSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Read per request so tests and deployments can set it after import. An unset
  // secret closes the webhook rather than opening it: with no secret configured,
  // every request would otherwise compare against "" and anyone could post.
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "webhook not configured" });
    return;
  }

  const provided = req.get("X-Webhook-Secret") ?? "";
  // timingSafeEqual throws on unequal lengths, so lengths are compared first.
  // That reveals only the length, not the content.
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
