import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR, validatePayers, type PayerEntry } from "../src";

const ORDER = ["A", "B", "C"];

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const check = (total: number, payers: PayerEntry[]) =>
  codeOf(() => validatePayers(total, payers, ORDER));

describe("validatePayers", () => {
  it("accepts one payer or several that add up to the total", () => {
    expect(check(1000, [{ memberId: "A", amountMinor: 1000 }])).toBeUndefined();
    expect(
      check(1000, [
        { memberId: "B", amountMinor: 700 },
        { memberId: "A", amountMinor: 300 },
      ]),
    ).toBeUndefined();
  });

  it("accepts the largest amount", () => {
    expect(
      check(MAX_AMOUNT_MINOR, [{ memberId: "A", amountMinor: MAX_AMOUNT_MINOR }]),
    ).toBeUndefined();
  });

  it("rejects no payers", () => {
    expect(check(1000, [])).toBe("NO_PAYERS");
  });

  it("rejects unknown and repeated payers", () => {
    expect(check(1000, [{ memberId: "Z", amountMinor: 1000 }])).toBe("UNKNOWN_MEMBER");
    expect(
      check(1000, [
        { memberId: "A", amountMinor: 500 },
        { memberId: "A", amountMinor: 500 },
      ]),
    ).toBe("DUPLICATE_MEMBER");
  });

  it("rejects amounts that are zero, negative, fractional or too large", () => {
    expect(check(1000, [{ memberId: "A", amountMinor: 0 }])).toBe("NON_POSITIVE_AMOUNT");
    expect(check(1000, [{ memberId: "A", amountMinor: -5 }])).toBe("NON_POSITIVE_AMOUNT");
    expect(check(1000, [{ memberId: "A", amountMinor: 10.5 }])).toBe("UNSAFE_INTEGER");
    expect(check(1000, [{ memberId: "A", amountMinor: MAX_AMOUNT_MINOR + 1 }])).toBe(
      "AMOUNT_TOO_LARGE",
    );
  });

  it("rejects amounts that do not add up to the total", () => {
    expect(check(1000, [{ memberId: "A", amountMinor: 999 }])).toBe("PAYER_TOTAL_MISMATCH");
    expect(
      check(1000, [
        { memberId: "A", amountMinor: 600 },
        { memberId: "B", amountMinor: 600 },
      ]),
    ).toBe("PAYER_TOTAL_MISMATCH");
  });
});
