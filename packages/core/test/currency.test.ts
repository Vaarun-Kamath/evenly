import { describe, expect, it } from "vitest";
import { CURRENCY_EXPONENTS, CoreError, exponentOf, isSupportedCurrency } from "../src";

/**
 * Currencies for which ICU (and so `Intl`) disagrees with the ISO 4217 exponent in the table.
 * ICU follows CLDR, which uses 0 decimals for several currencies whose ISO exponent is 2 or 3.
 * Stored minor units follow ISO and never ICU (ADR-0004), so these are expected.
 */
const KNOWN_ICU_DIFFERENCES = new Set([
  "AFN",
  "ALL",
  "AMD",
  "IQD",
  "IRR",
  "KPW",
  "LAK",
  "LBP",
  "MGA",
  "MMK",
  "RSD",
  "SOS",
  "SYP",
  "YER",
]);

describe("exponentOf", () => {
  it.each([
    ["JPY", 0],
    ["INR", 2],
    ["USD", 2],
    ["KWD", 3],
    ["BHD", 3],
  ])("%s has %i decimals", (code, exponent) => {
    expect(exponentOf(code)).toBe(exponent);
  });

  it.each(["", "usd", "XXX", "BTC", "constructor", "__proto__", "toString"])(
    "rejects %j",
    (code) => {
      expect(() => exponentOf(code)).toThrow(CoreError);
      try {
        exponentOf(code);
      } catch (error) {
        expect((error as CoreError).code).toBe("UNKNOWN_CURRENCY");
      }
    },
  );
});

describe("isSupportedCurrency", () => {
  it("accepts table entries only", () => {
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("eur")).toBe(false);
    expect(isSupportedCurrency("constructor")).toBe(false);
  });
});

describe("CURRENCY_EXPONENTS", () => {
  const entries = Object.entries(CURRENCY_EXPONENTS);

  it("holds three-letter upper-case codes with an exponent of 0, 2 or 3", () => {
    expect(entries.length).toBeGreaterThan(100);
    for (const [code, exponent] of entries) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3]).toContain(exponent);
    }
  });

  it("agrees with Intl, except for the known ICU differences", () => {
    const unexplained = entries.filter(([code, exponent]) => {
      const icu = new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      return icu !== exponent && !KNOWN_ICU_DIFFERENCES.has(code);
    });
    expect(unexplained).toEqual([]);
  });

  it("covers the currencies the project is built for", () => {
    for (const code of ["INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "KWD"]) {
      expect(isSupportedCurrency(code)).toBe(true);
    }
  });
});
