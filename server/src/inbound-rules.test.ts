import { describe, expect, test } from "bun:test";
import {
  isForSupport,
  parseTicketToken,
  supportAddressFrom,
} from "./inbound-rules";

describe("parseTicketToken", () => {
  test("reads the number from a [Ticket #N] token anywhere in the subject", () => {
    expect(parseTicketToken("Re: [Ticket #42] Can't log in")).toBe(42);
    expect(parseTicketToken("Can't log in [ticket #7]")).toBe(7);
  });

  test("returns null when there is no token", () => {
    expect(parseTicketToken("Can't log in")).toBeNull();
    expect(parseTicketToken("Ticket #42")).toBeNull();
  });

  test("rejects ids no ticket can have", () => {
    expect(parseTicketToken("[Ticket #0]")).toBeNull();
    expect(parseTicketToken("[Ticket #99999999999]")).toBeNull();
  });
});

describe("isForSupport", () => {
  test("matches the support address among the recipients, ignoring case", () => {
    expect(
      isForSupport(["sales@example.com", "support@example.com"], "Support@Example.com"),
    ).toBe(true);
  });

  test("is false when support is not a recipient", () => {
    expect(isForSupport(["sales@example.com"], "support@example.com")).toBe(false);
  });

  test("is false when no support address is configured", () => {
    expect(isForSupport(["support@example.com"], "")).toBe(false);
  });
});

describe("supportAddressFrom", () => {
  test("returns the configured address, trimmed and lowercased", () => {
    expect(supportAddressFrom({ SUPPORT_EMAIL_ADDRESS: " Support@Example.com " })).toBe(
      "support@example.com",
    );
  });

  test("treats unset, empty and whitespace-only as not configured", () => {
    expect(supportAddressFrom({})).toBeNull();
    expect(supportAddressFrom({ SUPPORT_EMAIL_ADDRESS: "" })).toBeNull();
    expect(supportAddressFrom({ SUPPORT_EMAIL_ADDRESS: "   " })).toBeNull();
  });
});
