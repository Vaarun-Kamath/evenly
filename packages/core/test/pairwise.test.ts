import { describe, expect, it } from "vitest";
import { pairwise, type ExpenseEntry } from "../src";

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

const cab: ExpenseEntry = {
  payers: [{ memberId: "B", amountMinor: 60000 }],
  shares: [
    { memberId: "A", amountMinor: 15000 },
    { memberId: "B", amountMinor: 15000 },
    { memberId: "C", amountMinor: 30000 },
  ],
};

describe("pairwise", () => {
  it("is empty with no expenses", () => {
    expect(pairwise(ORDER, [], [])).toEqual([]);
  });

  it("with a single payer, each sharer owes the payer their share", () => {
    expect(pairwise(ORDER, [dinner], [])).toEqual([
      { debtorId: "B", creditorId: "A", amountMinor: 33333 },
      { debtorId: "C", creditorId: "A", amountMinor: 33333 },
    ]);
  });

  it("combines expenses per pair and reports each pair once, as the difference", () => {
    // dinner: B owes A 33333. cab: A owes B 15000. Net: B owes A 18333.
    expect(pairwise(ORDER, [dinner, cab], [])).toEqual([
      { debtorId: "B", creditorId: "A", amountMinor: 18333 },
      { debtorId: "C", creditorId: "A", amountMinor: 33333 },
      { debtorId: "C", creditorId: "B", amountMinor: 30000 },
    ]);
  });

  it("flips the direction when the other way is larger", () => {
    const bigCab: ExpenseEntry = {
      payers: [{ memberId: "B", amountMinor: 90000 }],
      shares: [
        { memberId: "A", amountMinor: 45000 },
        { memberId: "B", amountMinor: 45000 },
      ],
    };
    expect(pairwise(ORDER, [dinner, bigCab], [])).toEqual([
      { debtorId: "A", creditorId: "B", amountMinor: 11667 },
      { debtorId: "C", creditorId: "A", amountMinor: 33333 },
    ]);
  });

  it("reduces a debt by a settlement and removes it when it reaches zero", () => {
    expect(
      pairwise(ORDER, [dinner], [{ fromMemberId: "B", toMemberId: "A", amountMinor: 10000 }]),
    ).toEqual([
      { debtorId: "B", creditorId: "A", amountMinor: 23333 },
      { debtorId: "C", creditorId: "A", amountMinor: 33333 },
    ]);
    expect(
      pairwise(ORDER, [dinner], [{ fromMemberId: "B", toMemberId: "A", amountMinor: 33333 }]),
    ).toEqual([{ debtorId: "C", creditorId: "A", amountMinor: 33333 }]);
  });

  it("creates a debt in the other direction when a settlement overpays", () => {
    expect(
      pairwise(["A", "B"], [], [{ fromMemberId: "A", toMemberId: "B", amountMinor: 500 }]),
    ).toEqual([{ debtorId: "B", creditorId: "A", amountMinor: 500 }]);
  });

  it("settles each expense on its own when several people paid", () => {
    const shared: ExpenseEntry = {
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
    // Nets 266 / 67 / -333: C pays A 266 and B 67 (largest creditor first).
    expect(pairwise(ORDER, [shared], [])).toEqual([
      { debtorId: "C", creditorId: "A", amountMinor: 266 },
      { debtorId: "C", creditorId: "B", amountMinor: 67 },
    ]);
  });

  it("rejects unknown members, mismatched expenses and bad settlements", () => {
    const unknown: ExpenseEntry = { ...dinner, payers: [{ memberId: "Z", amountMinor: 100000 }] };
    const off: ExpenseEntry = { ...dinner, payers: [{ memberId: "A", amountMinor: 1 }] };
    expect(codeOf(() => pairwise(ORDER, [unknown], []))).toBe("UNKNOWN_MEMBER");
    expect(codeOf(() => pairwise(ORDER, [off], []))).toBe("SHARES_TOTAL_MISMATCH");
    expect(
      codeOf(() => pairwise(ORDER, [], [{ fromMemberId: "A", toMemberId: "A", amountMinor: 5 }])),
    ).toBe("SELF_SETTLEMENT");
  });
});
