import type { NextFunction, Request, Response } from "express";

// Express's built-in fallback answers errors with an HTML page — in any
// environment but production, one carrying the stack trace and absolute file
// paths. Every response this API gives is JSON `{ error }`, so this handler,
// registered last in src/index.ts, keeps failures in that shape too.

// The errors body-parser raises carry a `type` naming what went wrong, plus a
// 4xx `status` and `expose: true` (its message is safe to show). These are the
// ones a client can cause; the wording is ours rather than the parser's.
const BODY_ERROR_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "invalid JSON body",
  "entity.too.large": "request body too large",
  "encoding.unsupported": "unsupported content encoding",
  "charset.unsupported": "unsupported charset",
  "request.aborted": "request aborted",
  "request.size.invalid": "request size did not match content length",
};

interface HttpError {
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
  type?: unknown;
}

/** The status and message to answer an error with. Pure, for unit tests. */
export function describeError(err: unknown): { status: number; error: string } {
  const e = (typeof err === "object" && err !== null ? err : {}) as HttpError;
  const status = Number(e.status ?? e.statusCode);

  // Only a client error the thrower marked safe to expose keeps its status;
  // anything else is reported as a server error, with nothing about its cause.
  if (e.expose === true && status >= 400 && status < 500) {
    const known = typeof e.type === "string" ? BODY_ERROR_MESSAGES[e.type] : undefined;
    return { status, error: known ?? "bad request" };
  }
  return { status: 500, error: "internal server error" };
}

// Express recognizes error middleware by its four parameters, so `_next` must
// stay even though it is only used once the response has started.
export function jsonErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  // Too late to send a body of our own; let Express close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, error } = describeError(err);
  if (status >= 500) console.error("[server] unhandled error", err);
  res.status(status).json({ error });
}
