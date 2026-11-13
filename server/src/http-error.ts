/**
 * An error a route throws to answer with a particular status and `{ error }`
 * message — a 404 for a missing ticket, a 409 for a taken email. Express 5
 * hands it to the JSON error handler (./middleware/error-handler.ts), which
 * answers with exactly this status and message, so the message must be worded
 * for the API.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
