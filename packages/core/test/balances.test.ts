import { describe, expect, it } from "vitest";
import { computeNets, validateSettlements, type ExpenseEntry, type SettlementEntry } from "../src";

const ORDER = ["A", "B", "C"];

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const dinner: ExpenseEntry = {
  payers: [{ memberId: "A", amountMinor: 100000 }],
  shares: [
    { memberId: "A", amountMinor: 33334 },
    { memberId: "B", amountMinor: 33333 },
    { memberId: "C", amountMinor: 33333 },
  ],
};

describe("computeNets", () => {
  it("returns a zero net for every member when there is nothing yet", () => {
    expect(computeNets(ORDER, [], [])).toEqual([
      { memberId: "A", netMinor: 0 },
      { memberId: "B", netMinor: 0 },
      { memberId: "C", netMinor: 0 },
    ]);
  });

  it("credits payers and debits sharers", () => {
    expect(computeNets(ORDER, [dinner], [])).toEqual([
      { memberId: "A", netMinor: 66666 },
      { memberId: "B", netMinor: -33333 },
      { memberId: "C", netMinor: -33333 },
    ]);
  });

  it("handles several payers in one expense", () => {
    const split: ExpenseEntry = {
      payers: [
        { memberId: "A", amountMinor: 600 },
        { memberId: "B", amountMinor: 400 },
      ],
      shares: [
        { memberId: "A", amountMinor: 334 },
        { memberId: "B", amountMinor: 333 },
        { memberId: "C", amountMinor: 333 },
      ],
    };
    expect(computeNets(ORDER, [split], []).map((n) => n.netMinor)).toEqual([266, 67, -333]);
  });

  it("applies a settlement: the payer's net rises, the receiver's falls", () => {
    expect(
      computeNets(ORDER, [dinner], [{ fromMemberId: "B", toMemberId: "A", amountMinor: 33333 }]),
    ).toEqual([
      { memberId: "A", netMinor: 33333 },
      { memberId: "B", netMinor: 0 },
      { memberId: "C", netMinor: -33333 },
    ]);
  });

  it("keeps the member order it was given", () => {
    expect(computeNets(["C", "A", "B"], [dinner], []).map((n) => n.memberId)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("adds up exactly even when the sums would exceed a safe integer", () => {
    const big: ExpenseEntry = {
      payers: [{ memberId: "A", amountMinor: 1_000_000_000_000 }],
      shares: [{ memberId: "B", amountMinor: 1_000_000_000_000 }],
    };
    const nets = computeNets(
      ORDER,
      Array.from({ length: 5000 }, () => big),
      [],
    );
    expect(nets.map((n) => n.netMinor)).toEqual([5_000_000_000_000_000, -5_000_000_000_000_000, 0]);
    expect(() =>
      computeNets(
        ORDER,
        Array.from({ length: 10000 }, () => big),
        [],
      ),
    ).toThrow(/safe integer/);
  });

  it("rejects unknown members anywhere", () => {
    const unknownPayer: ExpenseEntry = {
      ...dinner,
      payers: [{ memberId: "Z", amountMinor: 100000 }],
    };
    const unknownShare: ExpenseEntry = {
      payers: [{ memberId: "A", amountMinor: 1 }],
      shares: [{ memberId: "Z", amountMinor: 1 }],
    };
    expect(codeOf(() => computeNets(ORDER, [unknownPayer], []))).toBe("UNKNOWN_MEMBER");
    expect(codeOf(() => computeNets(ORDER, [unknownShare], []))).toBe("UNKNOWN_MEMBER");
    expect(
      codeOf(() =>
        computeNets(ORDER, [], [{ fromMemberId: "Z", toMemberId: "A", amountMinor: 1 }]),
      ),
    ).toBe("UNKNOWN_MEMBER");
  });

  it("rejects an expense whose payers and shares differ", () => {
    const off: ExpenseEntry = {
      payers: [{ memberId: "A", amountMinor: 100 }],
      shares: [{ memberId: "B", amountMinor: 99 }],
    };
    expect(codeOf(() => computeNets(ORDER, [off], []))).toBe("SHARES_TOTAL_MISMATCH");
  });

  it("rejects negative or fractional amounts", () => {
    const negative: ExpenseEntry = {
      payers: [{ memberId: "A", amountMinor: -1 }],
      shares: [{ memberId: "B", amountMinor: -1 }],
    };
    const fractional: ExpenseEntry = {
      payers: [{ memberId: "A", amountMinor: 1.5 }],
      shares: [{ memberId: "B", amountMinor: 1.5 }],
    };
    expect(codeOf(() => computeNets(ORDER, [negative], []))).toBe("NON_POSITIVE_AMOUNT");
    expect(codeOf(() => computeNets(ORDER, [fractional], []))).toBe("UNSAFE_INTEGER");
  });
});

describe("validateSettlements", () => {
  const check = (settlement: SettlementEntry) =>
    codeOf(() => validateSettlements(ORDER, [settlement]));

  it("accepts a valid settlement and an empty list", () => {
    expect(check({ fromMemberId: "A", toMemberId: "B", amountMinor: 1 })).toBeUndefined();
    expect(codeOf(() => validateSettlements(ORDER, []))).toBeUndefined();
  });

  it("rejects an unknown sender or receiver", () => {
    expect(check({ fromMemberId: "Z", toMemberId: "B", amountMinor: 1 })).toBe("UNKNOWN_MEMBER");
    expect(check({ fromMemberId: "A", toMemberId: "Z", amountMinor: 1 })).toBe("UNKNOWN_MEMBER");
  });

  it("rejects paying yourself", () => {
    expect(check({ fromMemberId: "A", toMemberId: "A", amountMinor: 1 })).toBe("SELF_SETTLEMENT");
  });

  it("rejects amounts that are zero, negative or fractional", () => {
    expect(check({ fromMemberId: "A", toMemberId: "B", amountMinor: 0 })).toBe(
      "NON_POSITIVE_AMOUNT",
    );
    expect(check({ fromMemberId: "A", toMemberId: "B", amountMinor: -1 })).toBe(
      "NON_POSITIVE_AMOUNT",
    );
    expect(check({ fromMemberId: "A", toMemberId: "B", amountMinor: 0.5 })).toBe("UNSAFE_INTEGER");
  });
});
