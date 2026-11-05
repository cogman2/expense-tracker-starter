import { describe, expect, test } from "bun:test";
import { pageWindow } from "./pagination";

describe("pageWindow", () => {
  test("page 1 starts at the first row", () => {
    expect(pageWindow(1, 25)).toEqual({ skip: 0, take: 25 });
  });

  test("page 2 starts right after page 1", () => {
    expect(pageWindow(2, 25)).toEqual({ skip: 25, take: 25 });
  });

  test("later pages advance a full page at a time", () => {
    expect(pageWindow(3, 25)).toEqual({ skip: 50, take: 25 });
  });
});
