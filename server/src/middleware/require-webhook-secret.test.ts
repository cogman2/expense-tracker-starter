import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { requireWebhookSecret } from "./require-webhook-secret";

// Just enough of Express's req/res for the guard: a header lookup on the way in,
// and a status/json pair recorded on the way out.
function run(header: string | undefined) {
  const req = {
    get: (name: string) =>
      name.toLowerCase() === "x-webhook-secret" ? header : undefined,
  } as unknown as Request;
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  const next = mock(() => {});
  requireWebhookSecret(req, res, next as unknown as NextFunction);
  return { sent, next };
}

const original = process.env.WEBHOOK_SECRET;

beforeEach(() => {
  process.env.WEBHOOK_SECRET = "s3cret-value";
});

afterEach(() => {
  if (original === undefined) delete process.env.WEBHOOK_SECRET;
  else process.env.WEBHOOK_SECRET = original;
});

describe("requireWebhookSecret", () => {
  test("passes a request carrying the configured secret", () => {
    const { sent, next } = run("s3cret-value");
    expect(next).toHaveBeenCalledTimes(1);
    expect(sent.status).toBeUndefined();
  });

  test("rejects a missing secret with 401", () => {
    const { sent, next } = run(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(sent).toEqual({ status: 401, body: { error: "unauthorized" } });
  });

  test("rejects a wrong secret of the same length with 401", () => {
    const { sent, next } = run("s3cret-valuX");
    expect(next).not.toHaveBeenCalled();
    expect(sent).toEqual({ status: 401, body: { error: "unauthorized" } });
  });

  test("rejects a wrong secret of a different length with 401, without throwing", () => {
    const { sent, next } = run("short");
    expect(next).not.toHaveBeenCalled();
    expect(sent).toEqual({ status: 401, body: { error: "unauthorized" } });
  });

  test("closes the webhook with 503 when no secret is configured", () => {
    delete process.env.WEBHOOK_SECRET;
    const { sent, next } = run("anything");
    expect(next).not.toHaveBeenCalled();
    expect(sent).toEqual({ status: 503, body: { error: "webhook not configured" } });
  });

  test("treats an empty configured secret as not configured, even for an empty header", () => {
    process.env.WEBHOOK_SECRET = "";
    const { sent, next } = run("");
    expect(next).not.toHaveBeenCalled();
    expect(sent.status).toBe(503);
  });
});
