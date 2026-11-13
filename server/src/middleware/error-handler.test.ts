import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response } from "express";
import { HttpError } from "../http-error";
import { describeError, jsonErrorHandler } from "./error-handler";

// Shaped like the errors body-parser raises (via http-errors).
const bodyError = (type: string, status: number) =>
  Object.assign(new Error("parser detail"), { type, status, expose: true });

describe("describeError", () => {
  test("an HttpError a route threw answers with its own status and message", () => {
    expect(describeError(new HttpError(404, "ticket not found"))).toEqual({
      status: 404,
      error: "ticket not found",
    });
    expect(describeError(new HttpError(409, "admin users cannot be deleted"))).toEqual({
      status: 409,
      error: "admin users cannot be deleted",
    });
  });

  test("malformed JSON is a 400 with our own wording", () => {
    expect(describeError(bodyError("entity.parse.failed", 400))).toEqual({
      status: 400,
      error: "invalid JSON body",
    });
  });

  test("an oversized body is a 413", () => {
    expect(describeError(bodyError("entity.too.large", 413))).toEqual({
      status: 413,
      error: "request body too large",
    });
  });

  test("an exposable client error of an unknown type keeps its status", () => {
    expect(describeError(bodyError("something.new", 422))).toEqual({
      status: 422,
      error: "bad request",
    });
  });

  test("a path param that isn't valid percent-encoding is a 400", () => {
    // Shaped like the router's decode failure: a URIError marked 400, not exposed.
    const err = Object.assign(new URIError("Failed to decode param '%E0%A4%A'"), {
      status: 400,
      statusCode: 400,
    });
    expect(describeError(err)).toEqual({ status: 400, error: "malformed URL" });
  });

  test("a URIError the router didn't mark as the client's is still a 500", () => {
    expect(describeError(new URIError("URI malformed"))).toEqual({
      status: 500,
      error: "internal server error",
    });
  });

  test("a client status not marked exposable is reported as a server error", () => {
    const err = Object.assign(new Error("secret detail"), { status: 400 });
    expect(describeError(err)).toEqual({ status: 500, error: "internal server error" });
  });

  test("anything else is a 500 that reveals nothing", () => {
    expect(describeError(new Error("db password is hunter2"))).toEqual({
      status: 500,
      error: "internal server error",
    });
    expect(describeError("thrown string")).toEqual({
      status: 500,
      error: "internal server error",
    });
    expect(describeError(null)).toEqual({ status: 500, error: "internal server error" });
  });
});

// The middleware itself, mounted the way src/index.ts mounts it, on Express 5:
// what a client actually receives when a route throws or rejects. Express 4
// never passed a rejected async handler on, so these requests hung — this is
// the guard against that coming back. No database: the routes fail on purpose.
describe("jsonErrorHandler on a real Express app", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.get("/async-http-error", async () => {
      await Promise.resolve();
      throw new HttpError(409, "admin users cannot be deleted");
    });
    app.get("/async-crash", async () => {
      await Promise.resolve();
      throw new Error("db password is hunter2");
    });
    app.use(jsonErrorHandler);

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  async function answer(path: string, init?: RequestInit) {
    const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(2000) });
    return {
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      body: await res.json(),
    };
  }

  test("an async route that rejects with an HttpError answers it as JSON, rather than hanging", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await answer("/async-http-error")).toMatchObject({
        status: 409,
        type: expect.stringContaining("application/json"),
        body: { error: "admin users cannot be deleted" },
      });
      // A refusal is the client's doing, not a fault worth logging.
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test("an async route that rejects with anything else is a JSON 500 that reveals nothing", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await answer("/async-crash")).toMatchObject({
        status: 500,
        type: expect.stringContaining("application/json"),
        body: { error: "internal server error" },
      });
      // The cause still reaches the server log.
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("jsonErrorHandler mid-response", () => {
  const req = {} as Request;
  const stubResponse = () => {
    const res = { headersSent: true, status: mock(() => res), json: mock(() => res) };
    return res;
  };

  // Once a response has started, a JSON body can't follow it; Express's own
  // handler is the one that can abort the connection.
  test("after the headers are sent it hands the error to Express instead", () => {
    const res = stubResponse();
    const next = mock(() => {});
    const err = new Error("failed mid-stream");
    jsonErrorHandler(err, req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
