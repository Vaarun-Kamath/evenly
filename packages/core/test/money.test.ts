import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_MINOR,
  assertSafeInteger,
  assertWithinMaxAmount,
  formatMinor,
  minorToDecimalString,
  parseAmount,
  parseDecimalToUnits,
  unitsToDecimalString,
} from "../src";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("assertSafeInteger", () => {
  it("returns safe integers unchanged", () => {
    expect(assertSafeInteger(0)).toBe(0);
    expect(assertSafeInteger(-5)).toBe(-5);
    expect(assertSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects %s", (value) => {
    expect(codeOf(() => assertSafeInteger(value))).toBe("UNSAFE_INTEGER");
  });

  it("names the value in the message", () => {
    expect(() => assertSafeInteger(1.5, "total")).toThrow(/total must be a safe integer/);
  });
});

describe("parseDecimalToUnits", () => {
  it.each([
    ["12", 2, 1200],
    ["12.5", 2, 1250],
    ["12.50", 2, 1250],
    [".5", 2, 50],
    ["5.", 2, 500],
    ["0", 2, 0],
    ["0001.10", 2, 110],
    ["  7  ", 0, 7],
    ["100.00", 0, 100],
    ["1.234", 3, 1234],
    ["9007199254740991", 0, Number.MAX_SAFE_INTEGER],
  ])("parses %j with %i decimals as %i", (input, decimals, expected) => {
    expect(parseDecimalToUnits(input, decimals)).toBe(expected);
  });

  it.each(["", " ", ".", "abc", "1.2.3", "-5", "+5", "1,000", "1e3", "0x10", "１２"])(
    "rejects %j as not a number",
    (input) => {
      expect(codeOf(() => parseDecimalToUnits(input, 2))).toBe("INVALID_AMOUNT");
    },
  );

  it.each([
    ["12.345", 2],
    ["1.5", 0],
    ["0.001", 2],
  ])("rejects %j with %i decimals instead of rounding", (input, decimals) => {
    expect(codeOf(() => parseDecimalToUnits(input, decimals))).toBe("TOO_MANY_DECIMALS");
  });

  it("rejects values beyond the safe integer range", () => {
    expect(codeOf(() => parseDecimalToUnits("9007199254740993", 0))).toBe("UNSAFE_INTEGER");
    expect(codeOf(() => parseDecimalToUnits("90071992547409.93", 2))).toBe("UNSAFE_INTEGER");
  });

  it("uses the label in the message", () => {
    expect(() => parseDecimalToUnits("x", 2, "percentage")).toThrow(/percentage "x"/);
  });
});

describe("parseAmount", () => {
  it.each([
    ["1000", "INR", 100000],
    ["333.34", "INR", 33334],
    ["1000", "JPY", 1000],
    ["1.234", "KWD", 1234],
  ])("parses %j in %s as %i", (input, currency, expected) => {
    expect(parseAmount(input, currency)).toBe(expected);
  });

  it("rejects a currency with no exponent and a too-precise amount", () => {
    expect(codeOf(() => parseAmount("1", "BTC"))).toBe("UNKNOWN_CURRENCY");
    expect(codeOf(() => parseAmount("1.5", "JPY"))).toBe("TOO_MANY_DECIMALS");
  });
});

describe("assertWithinMaxAmount", () => {
  it("allows the maximum and rejects anything above", () => {
    expect(assertWithinMaxAmount(MAX_AMOUNT_MINOR)).toBe(MAX_AMOUNT_MINOR);
    expect(codeOf(() => assertWithinMaxAmount(MAX_AMOUNT_MINOR + 1))).toBe("AMOUNT_TOO_LARGE");
  });
});

describe("unitsToDecimalString", () => {
  it.each([
    [33334, 2, "333.34"],
    [5, 2, "0.05"],
    [0, 2, "0.00"],
    [-33333, 2, "-333.33"],
    [-5, 2, "-0.05"],
    [1000, 0, "1000"],
    [-5, 0, "-5"],
    [1234, 3, "1.234"],
    [Number.MAX_SAFE_INTEGER, 2, "90071992547409.91"],
  ])("renders %i with %i decimals as %j", (units, decimals, expected) => {
    expect(unitsToDecimalString(units, decimals)).toBe(expected);
  });

  it("rejects unsafe input", () => {
    expect(codeOf(() => unitsToDecimalString(1.5, 2))).toBe("UNSAFE_INTEGER");
  });
});

describe("minorToDecimalString", () => {
  it("uses the currency's exponent", () => {
    expect(minorToDecimalString(100000, "INR")).toBe("1000.00");
    expect(minorToDecimalString(1234, "KWD")).toBe("1.234");
    expect(minorToDecimalString(1234, "JPY")).toBe("1234");
  });
});

describe("formatMinor", () => {
  it("formats with the currency's own number of decimals", () => {
    expect(formatMinor(100000, "INR", "en-IN")).toMatch(/1,000\.00$/);
    expect(formatMinor(123456789012, "USD", "en-US")).toBe("$1,234,567,890.12");
    expect(formatMinor(1000, "JPY", "en-US")).toBe("¥1,000");
    expect(formatMinor(1234, "KWD", "en-US")).toMatch(/1\.234$/);
    expect(formatMinor(-33333, "INR", "en-IN")).toMatch(/333\.33$/);
  });

  it("stays exact for the largest safe integer (no floating point)", () => {
    expect(formatMinor(Number.MAX_SAFE_INTEGER, "JPY", "en-US")).toBe("¥9,007,199,254,740,991");
  });

  it("works without a locale and with a locale list", () => {
    expect(formatMinor(100, "USD")).toMatch(/1[.,]00/);
    expect(formatMinor(100, "USD", ["en-US"])).toBe("$1.00");
  });

  it("rejects an unsupported currency", () => {
    expect(codeOf(() => formatMinor(1, "BTC"))).toBe("UNKNOWN_CURRENCY");
  });
});
