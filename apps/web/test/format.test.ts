import { describe, expect, it } from "vitest";
import { safeNext } from "../src/lib/auth";
import {
  balanceSentence,
  currencyLabel,
  formatDate,
  money,
  signedMoney,
  todayIso,
} from "../src/lib/format";

describe("money", () => {
  it("always shows the currency's own decimals", () => {
    expect(money(100000, "INR")).toMatch(/1,00,000\.00|1,000\.00/);
    expect(money(500, "JPY")).toMatch(/500/);
    expect(money(500, "JPY")).not.toMatch(/\./);
    expect(money(1234, "KWD")).toMatch(/1\.234/);
  });
});

describe("signedMoney", () => {
  it("spells the sign out, so colour is never the only signal", () => {
    expect(signedMoney(1000, "USD")).toMatch(/^\+/);
    expect(signedMoney(-1000, "USD")).toMatch(/^−/);
    expect(signedMoney(0, "USD")).not.toMatch(/^[+−]/);
  });
});

describe("balanceSentence", () => {
  it("says who owes whom, or that you are settled up", () => {
    expect(balanceSentence(29141, "INR")).toMatch(/^you are owed .*291\.41/);
    expect(balanceSentence(-29141, "INR")).toMatch(/^you owe .*291\.41/);
    expect(balanceSentence(0, "INR")).toBe("settled up");
  });
});

describe("dates", () => {
  it("todayIso uses the calendar of the viewer", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("formatDate shows the same calendar day whatever the time zone", () => {
    expect(formatDate("2026-10-11")).toMatch(/11/);
    expect(formatDate("2026-10-11")).toMatch(/2026/);
  });
});

describe("currencyLabel", () => {
  it("adds the currency's name, and survives codes it does not know", () => {
    expect(currencyLabel("INR")).toMatch(/^INR – /);
    expect(currencyLabel("ZZZ")).toBe("ZZZ");
    expect(currencyLabel("not a code")).toBe("not a code");
  });
});

describe("safeNext", () => {
  it.each([
    ["/g/abc?tab=activity", "/g/abc?tab=activity"],
    ["/", "/"],
  ])("keeps %s, which is a place inside the app", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "javascript:alert(1)",
    "g/abc",
    "",
    undefined,
    42,
    null,
  ])("refuses %j, so a sign-in link cannot send anyone elsewhere", (input) => {
    expect(safeNext(input)).toBeUndefined();
  });
});
