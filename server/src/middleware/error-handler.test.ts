import { describe, expect, test } from "bun:test";
import { describeError } from "./error-handler";

// Shaped like the errors body-parser raises (via http-errors).
const bodyError = (type: string, status: number) =>
  Object.assign(new Error("parser detail"), { type, status, expose: true });

describe("describeError", () => {
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
