import { describe, expect, it } from "vitest";
import { CURRENCY_EXPONENTS, CoreError, exponentOf, isSupportedCurrency } from "../src";

/**
 * ISO 4217 minor-unit exponents other than 2. The table must match these exactly: a wrong exponent
 * here would silently change what stored amounts mean.
 */
const ISO_ZERO_DECIMALS = [
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
];
const ISO_THREE_DECIMALS = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"];

/**
 * ICU (and so `Intl`) follows CLDR, which differs from ISO for some currencies and changes between
 * Node and ICU releases (for example it now uses 0 decimals for HUF, COP, IDR and PKR). That is why
 * the table is static (ADR-0004). Only the currencies that are not 2-decimal are cross-checked with
 * `Intl`, apart from the one known difference below.
 */
const KNOWN_ICU_DIFFERENCES = new Set(["IQD"]);

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

  it("matches ISO 4217 for every currency that is not 2-decimal", () => {
    const zero = entries.filter(([, exponent]) => exponent === 0).map(([code]) => code);
    const three = entries.filter(([, exponent]) => exponent === 3).map(([code]) => code);
    expect(zero.sort()).toEqual([...ISO_ZERO_DECIMALS].sort());
    expect(three.sort()).toEqual([...ISO_THREE_DECIMALS].sort());
  });

  it("agrees with Intl for the non-2-decimal currencies, apart from the known difference", () => {
    const unexplained = entries.filter(([code, exponent]) => {
      if (exponent === 2 || KNOWN_ICU_DIFFERENCES.has(code)) return false;
      const icu = new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      return icu !== exponent;
    });
    expect(unexplained).toEqual([]);
  });

  it("covers the currencies the project is built for", () => {
    for (const code of ["INR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "KWD"]) {
      expect(isSupportedCurrency(code)).toBe(true);
    }
  });
});
