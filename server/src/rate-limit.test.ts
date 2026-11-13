import { afterEach, describe, expect, test } from "bun:test";
import { envCount, envMinutes } from "./rate-limit";

// The limiters only run in production, so a bad override would surface there
// first. These pin how an override is read: a positive number wins, anything
// else falls back to the default rather than disabling or zeroing the limit.
const VAR = "RATE_LIMIT_TEST_SETTING";

afterEach(() => {
  delete process.env[VAR];
});

describe("envCount", () => {
  test("uses the fallback when the variable is unset", () => {
    expect(envCount(VAR, 10)).toBe(10);
  });

  test("uses a positive override, fractions included", () => {
    process.env[VAR] = "25";
    expect(envCount(VAR, 10)).toBe(25);
    process.env[VAR] = "0.5";
    expect(envCount(VAR, 10)).toBe(0.5);
  });

  test("falls back on zero, negatives, junk, an empty string or Infinity", () => {
    for (const value of ["0", "-5", "lots", "", "Infinity", "NaN"]) {
      process.env[VAR] = value;
      expect(envCount(VAR, 10), JSON.stringify(value)).toBe(10);
    }
  });
});

describe("envMinutes", () => {
  test("returns milliseconds: the fallback, or the override", () => {
    expect(envMinutes(VAR, 15)).toBe(15 * 60 * 1000);
    process.env[VAR] = "2";
    expect(envMinutes(VAR, 15)).toBe(2 * 60 * 1000);
  });

  test("falls back the same way envCount does", () => {
    process.env[VAR] = "0";
    expect(envMinutes(VAR, 15)).toBe(15 * 60 * 1000);
  });
});
