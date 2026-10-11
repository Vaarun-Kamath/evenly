import { describe, expect, it } from "vitest";
import {
  computeNets,
  computeSplit,
  pairwise,
  simplify,
  validatePayers,
  type ExpenseEntry,
} from "../src";

/**
 * SPEC.md section 7, scenarios 2 to 4, as unit tests on the core logic. Members are in the order
 * they joined: A (creator), B, then C (a placeholder added later).
 */
const ORDER = ["A", "B", "C"];

function expense(
  totalMinor: number,
  payers: { memberId: string; amountMinor: number }[],
  split: Parameters<typeof computeSplit>[1],
): ExpenseEntry {
  validatePayers(totalMinor, payers, ORDER);
  return { payers, shares: computeSplit(totalMinor, split, ORDER) };
}

// Scenario 2: "Dinner 1,000.00" paid by A, split equally between A, B and C.
const dinner = () =>
  expense(100000, [{ memberId: "A", amountMinor: 100000 }], {
    method: "equal",
    entries: [{ memberId: "A" }, { memberId: "B" }, { memberId: "C" }],
  });

// Scenario 3: "Cab 600.00" paid by B, split by shares A:1, B:1, C:2.
const cab = () =>
  expense(60000, [{ memberId: "B", amountMinor: 60000 }], {
    method: "shares",
    entries: [
      { memberId: "A", value: "1" },
      { memberId: "B", value: "1" },
      { memberId: "C", value: "2" },
    ],
  });

describe("SPEC scenario 2: dinner of 1,000.00 split equally", () => {
  it("gives the extra paisa to A, who joined first: 333.34 / 333.33 / 333.33", () => {
    expect(dinner().shares.map((s) => s.amountMinor)).toEqual([33334, 33333, 33333]);
  });

  it("leaves A +666.66, B -333.33 and C -333.33", () => {
    expect(computeNets(ORDER, [dinner()], []).map((n) => n.netMinor)).toEqual([
      66666, -33333, -33333,
    ]);
  });
});

describe("SPEC scenario 3: cab of 600.00 by shares 1:1:2, paid by B", () => {
  it("splits 150.00 / 150.00 / 300.00", () => {
    expect(cab().shares.map((s) => s.amountMinor)).toEqual([15000, 15000, 30000]);
  });

  it("updates the balances, which still add up to zero", () => {
    const nets = computeNets(ORDER, [dinner(), cab()], []);
    expect(nets.map((n) => n.netMinor)).toEqual([51666, 11667, -63333]);
    expect(nets.reduce((sum, n) => sum + n.netMinor, 0)).toBe(0);
  });
});

describe("SPEC scenario 4: simplify debts", () => {
  const nets = computeNets(ORDER, [dinner(), cab()], []);

  it("needs at most two payments for three people", () => {
    expect(simplify(nets).length).toBeLessThanOrEqual(2);
  });

  it("settles everyone to exactly zero", () => {
    const plan = simplify(nets);
    expect(plan).toEqual([
      { fromMemberId: "C", toMemberId: "A", amountMinor: 51666 },
      { fromMemberId: "C", toMemberId: "B", amountMinor: 11667 },
    ]);
    const after = computeNets(
      ORDER,
      [dinner(), cab()],
      plan.map((t) => ({ ...t })),
    );
    expect(after.map((n) => n.netMinor)).toEqual([0, 0, 0]);
  });

  it("agrees with the pairwise view when simplify is off", () => {
    expect(pairwise(ORDER, [dinner(), cab()], [])).toEqual([
      { debtorId: "B", creditorId: "A", amountMinor: 18333 },
      { debtorId: "C", creditorId: "A", amountMinor: 33333 },
      { debtorId: "C", creditorId: "B", amountMinor: 30000 },
    ]);
  });
});

describe("SPEC scenario 6 (core part): B records the suggested settlement", () => {
  it("brings B's balance to zero", () => {
    const plan = simplify(computeNets(ORDER, [dinner(), cab()], []));
    // B is owed 116.67 and is not a debtor, so the suggestion that involves B is C paying B.
    const toB = plan.find((t) => t.toMemberId === "B");
    expect(toB).toEqual({ fromMemberId: "C", toMemberId: "B", amountMinor: 11667 });
    const after = computeNets(ORDER, [dinner(), cab()], [toB!]);
    expect(after.find((n) => n.memberId === "B")?.netMinor).toBe(0);
  });
});
