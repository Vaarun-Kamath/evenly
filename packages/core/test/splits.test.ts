import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR, computeSplit, type SplitInput } from "../src";

const ORDER = ["A", "B", "C", "D"];

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function amounts(total: number, split: SplitInput, order = ORDER) {
  return computeSplit(total, split, order).map(({ memberId, amountMinor }) => [
    memberId,
    amountMinor,
  ]);
}

const entries = (...ids: string[]) => ids.map((memberId) => ({ memberId }));
const valued = (...pairs: [string, string][]) =>
  pairs.map(([memberId, value]) => ({ memberId, value }));

describe("computeSplit: equal", () => {
  it("splits evenly and gives the odd unit to the first member in canonical order", () => {
    expect(
      computeSplit(100000, { method: "equal", entries: entries("A", "B", "C") }, ORDER),
    ).toEqual([
      { memberId: "A", amountMinor: 33334, inputValue: null },
      { memberId: "B", amountMinor: 33333, inputValue: null },
      { memberId: "C", amountMinor: 33333, inputValue: null },
    ]);
  });

  it("lists members in canonical order whatever order they are given in", () => {
    expect(amounts(100000, { method: "equal", entries: entries("C", "A", "B") })).toEqual([
      ["A", 33334],
      ["B", 33333],
      ["C", 33333],
    ]);
  });

  it("splits between a subset of the group", () => {
    expect(amounts(101, { method: "equal", entries: entries("C", "A") })).toEqual([
      ["A", 51],
      ["C", 50],
    ]);
  });

  it("uses the canonical order of the group, so rejoining does not reshuffle rounding", () => {
    expect(
      amounts(100, { method: "equal", entries: entries("A", "B", "C") }, ["C", "B", "A"]),
    ).toEqual([
      ["C", 34],
      ["B", 33],
      ["A", 33],
    ]);
  });

  it("rejects a value", () => {
    const split: SplitInput = { method: "equal", entries: [{ memberId: "A", value: "1" }] };
    expect(codeOf(() => computeSplit(100, split, ORDER))).toBe("UNEXPECTED_VALUE");
  });
});

describe("computeSplit: exact", () => {
  it("accepts amounts that add up and echoes them as the input value", () => {
    expect(
      computeSplit(
        100000,
        { method: "exact", entries: valued(["B", "40000"], ["A", "60000"]) },
        ORDER,
      ),
    ).toEqual([
      { memberId: "A", amountMinor: 60000, inputValue: "60000" },
      { memberId: "B", amountMinor: 40000, inputValue: "40000" },
    ]);
  });

  it("allows a member with zero", () => {
    expect(amounts(100, { method: "exact", entries: valued(["A", "100"], ["B", "0"]) })).toEqual([
      ["A", 100],
      ["B", 0],
    ]);
  });

  it("rejects amounts that do not add up", () => {
    const split: SplitInput = { method: "exact", entries: valued(["A", "60000"], ["B", "39999"]) };
    expect(codeOf(() => computeSplit(100000, split, ORDER))).toBe("EXACT_TOTAL_MISMATCH");
  });

  it("rejects a missing, fractional, malformed or oversized value", () => {
    const run = (value: string | undefined) =>
      codeOf(() =>
        computeSplit(100, { method: "exact", entries: [{ memberId: "A", value }] }, ORDER),
      );
    expect(run(undefined)).toBe("MISSING_VALUE");
    expect(run("12.5")).toBe("TOO_MANY_DECIMALS");
    expect(run("abc")).toBe("INVALID_AMOUNT");
    expect(run(String(MAX_AMOUNT_MINOR + 1))).toBe("AMOUNT_TOO_LARGE");
  });
});

describe("computeSplit: percent", () => {
  it("allocates by percentage with the single rounding rule", () => {
    expect(
      computeSplit(
        1001,
        { method: "percent", entries: valued(["A", "50"], ["B", "30"], ["C", "20"]) },
        ORDER,
      ),
    ).toEqual([
      { memberId: "A", amountMinor: 501, inputValue: "50.00" },
      { memberId: "B", amountMinor: 300, inputValue: "30.00" },
      { memberId: "C", amountMinor: 200, inputValue: "20.00" },
    ]);
  });

  it("accepts two decimals that add up to exactly 100", () => {
    expect(
      amounts(100000, {
        method: "percent",
        entries: valued(["A", "33.33"], ["B", "33.33"], ["C", "33.34"]),
      }),
    ).toEqual([
      ["A", 33330],
      ["B", 33330],
      ["C", 33340],
    ]);
  });

  it("lets one member take 100 percent", () => {
    expect(amounts(77, { method: "percent", entries: valued(["B", "100"]) })).toEqual([["B", 77]]);
  });

  it("rejects percentages that do not total 100", () => {
    const run = (...pairs: [string, string][]) =>
      codeOf(() => computeSplit(100, { method: "percent", entries: valued(...pairs) }, ORDER));
    expect(run(["A", "50"], ["B", "40"])).toBe("PERCENT_TOTAL_MISMATCH");
    expect(run(["A", "60"], ["B", "50"])).toBe("PERCENT_TOTAL_MISMATCH");
    expect(run(["A", "33.33"], ["B", "33.33"], ["C", "33.33"])).toBe("PERCENT_TOTAL_MISMATCH");
  });

  it("rejects zero, over-precise, malformed and missing percentages", () => {
    const run = (value: string | undefined) =>
      codeOf(() =>
        computeSplit(100, { method: "percent", entries: [{ memberId: "A", value }] }, ORDER),
      );
    expect(run("0")).toBe("NON_POSITIVE_VALUE");
    expect(run("33.333")).toBe("TOO_MANY_DECIMALS");
    expect(run("fifty")).toBe("INVALID_AMOUNT");
    expect(run(undefined)).toBe("MISSING_VALUE");
  });
});

describe("computeSplit: shares", () => {
  it("allocates in proportion to the shares", () => {
    expect(
      computeSplit(
        100,
        { method: "shares", entries: valued(["A", "2"], ["B", "1"], ["C", "1"]) },
        ORDER,
      ),
    ).toEqual([
      { memberId: "A", amountMinor: 50, inputValue: "2.00" },
      { memberId: "B", amountMinor: 25, inputValue: "1.00" },
      { memberId: "C", amountMinor: 25, inputValue: "1.00" },
    ]);
  });

  it("accepts fractional shares with up to two decimals", () => {
    expect(amounts(100, { method: "shares", entries: valued(["A", "1.5"], ["B", "0.5"]) })).toEqual(
      [
        ["A", 75],
        ["B", 25],
      ],
    );
  });

  it("splits SPEC scenario 3: 600.00 by shares 1:1:2", () => {
    expect(
      amounts(60000, { method: "shares", entries: valued(["A", "1"], ["B", "1"], ["C", "2"]) }),
    ).toEqual([
      ["A", 15000],
      ["B", 15000],
      ["C", 30000],
    ]);
  });

  it("accepts the largest share and rejects anything above it", () => {
    const run = (value: string) =>
      codeOf(() =>
        computeSplit(100, { method: "shares", entries: [{ memberId: "A", value }] }, ORDER),
      );
    expect(run("1000000")).toBeUndefined();
    expect(run("1000000.01")).toBe("AMOUNT_TOO_LARGE");
  });

  it("rejects zero, over-precise, malformed and missing shares", () => {
    const run = (value: string | undefined) =>
      codeOf(() =>
        computeSplit(100, { method: "shares", entries: [{ memberId: "A", value }] }, ORDER),
      );
    expect(run("0")).toBe("NON_POSITIVE_VALUE");
    expect(run("0.001")).toBe("TOO_MANY_DECIMALS");
    expect(run("x")).toBe("INVALID_AMOUNT");
    expect(run(undefined)).toBe("MISSING_VALUE");
  });
});

describe("computeSplit: general validation", () => {
  const equal = (...ids: string[]): SplitInput => ({ method: "equal", entries: entries(...ids) });

  it("rejects a bad total", () => {
    expect(codeOf(() => computeSplit(0, equal("A"), ORDER))).toBe("INVALID_TOTAL");
    expect(codeOf(() => computeSplit(-5, equal("A"), ORDER))).toBe("INVALID_TOTAL");
    expect(codeOf(() => computeSplit(1.5, equal("A"), ORDER))).toBe("UNSAFE_INTEGER");
    expect(codeOf(() => computeSplit(MAX_AMOUNT_MINOR + 1, equal("A"), ORDER))).toBe(
      "AMOUNT_TOO_LARGE",
    );
  });

  it("accepts the largest total", () => {
    expect(
      computeSplit(MAX_AMOUNT_MINOR, equal("A", "B", "C"), ORDER).reduce(
        (sum, share) => sum + share.amountMinor,
        0,
      ),
    ).toBe(MAX_AMOUNT_MINOR);
  });

  it("rejects an empty member list, unknown members and duplicates", () => {
    expect(codeOf(() => computeSplit(100, equal(), ORDER))).toBe("NO_ENTRIES");
    expect(codeOf(() => computeSplit(100, equal("A", "Z"), ORDER))).toBe("UNKNOWN_MEMBER");
    expect(codeOf(() => computeSplit(100, equal("A", "B", "A"), ORDER))).toBe("DUPLICATE_MEMBER");
  });
});
