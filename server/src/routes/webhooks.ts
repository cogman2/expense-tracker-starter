// Machine-to-machine endpoints. No session: callers prove themselves with the
// shared secret (../middleware/require-webhook-secret.ts).
//
// Mounted in src/index.ts ABOVE the global express.json(): emails routinely
// exceed its 100 KB default, and once the global parser has read a body a
// route-level parser cannot raise the limit. This router parses its own bodies.
import express from "express";
import { inboundEmailSchema } from "core";
import { ingestEmail } from "../inbound";
import { isForSupport, supportAddressFrom } from "../inbound-rules";
import { requireWebhookSecret } from "../middleware/require-webhook-secret";
import { firstIssueMessage } from "../schemas";

export const webhooksRouter = express.Router();

// One parsed email, provider-agnostic (core/src/schemas/tickets.ts). The secret
// is checked before the body is read, so an unauthenticated caller cannot make
// the server parse 5 MB.
webhooksRouter.post(
  "/api/webhooks/inbound-email",
  requireWebhookSecret,
  express.json({ limit: "5mb" }),
  async (req, res) => {
    const parsed = inboundEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstIssueMessage(parsed.error) });
      return;
    }

    // Without a support address every email would look misaddressed and be
    // dropped below, so an unset one closes the webhook, like an unset secret.
    const supportAddress = supportAddressFrom();
    if (!supportAddress) {
      res.status(503).json({ error: "webhook not configured" });
      return;
    }

    // Mail that reached the webhook but is not for support (a CC'd alias, a
    // misrouted forward) is acknowledged with a 2xx so the sender does not retry
    // it, and dropped.
    if (!isForSupport(parsed.data.to, supportAddress)) {
      res.status(202).json({ outcome: "ignored" });
      return;
    }

    // Express 4 does not catch a rejected async handler, which would leave the
    // sender's request hanging. A 500 tells it to retry; the duplicate check makes
    // that retry safe.
    try {
      const { ticketId, outcome } = await ingestEmail(parsed.data);
      res.status(outcome === "created" ? 201 : 200).json({ ticketId, outcome });
    } catch (err) {
      console.error("[webhooks] inbound email failed", err);
      res.status(500).json({ error: "could not store the email" });
    }
  },
);
