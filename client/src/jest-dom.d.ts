// Teaches bun:test's `expect` about the jest-dom matchers registered in
// ../testSetup.ts. Mirrors the augmentation @testing-library/jest-dom ships as
// types/bun.d.ts, which its exports map does not expose for direct import.
import type { expect } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
