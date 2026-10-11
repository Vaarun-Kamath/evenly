import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_MINOR,
  allocate,
  computeNets,
  computeSplit,
  pairwise,
  parseDecimalToUnits,
  simplify,
  unitsToDecimalString,
  type SplitInput,
} from "../src";
import { arbScenario, arbSplit, arbTotal, assertProperty, membersOf } from "./arbitraries";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** BUILD_PLAN M1 / ARCHITECTURE.md section 5.6: the required property tests. */

describe("property: allocate", () => {
  const arbCase = fc.integer({ min: 1, max: 8 }).chain((count) =>
    fc.record({
      total: fc.oneof(arbTotal, fc.constant(0)),
      weights: fc
        .array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: count, maxLength: count })
        .filter((weights) => sum(weights) > 0),
      order: fc.shuffledSubarray(
        Array.from({ length: count }, (_, index) => index),
        { minLength: count, maxLength: count },
      ),
    }),
  );

  it("the parts add up to the total and are never negative", () => {
    assertProperty(
      fc.property(arbCase, ({ total, weights, order }) => {
        const parts = allocate(total, weights, order);
        expect(sum(parts)).toBe(total);
        expect(parts.every((part) => Number.isSafeInteger(part) && part >= 0)).toBe(true);
      }),
    );
  });

  it("each part differs from the exact proportional value by less than one unit", () => {
    assertProperty(
      fc.property(arbCase, ({ total, weights, order }) => {
        const weightSum = BigInt(sum(weights));
        const parts = allocate(total, weights, order);
        parts.forEach((part, index) => {
          const diff = BigInt(part) * weightSum - BigInt(total) * BigInt(weights[index]!);
          expect(diff > -weightSum && diff < weightSum).toBe(true);
        });
      }),
    );
  });

  it("is deterministic and gives nothing to a weight of zero", () => {
    assertProperty(
      fc.property(arbCase, ({ total, weights, order }) => {
        const first = allocate(total, weights, order);
        expect(allocate(total, weights, order)).toEqual(first);
        weights.forEach((weight, index) => {
          if (weight === 0) expect(first[index]).toBe(0);
        });
      }),
    );
  });

  it("does not depend on array position: the canonical order alone breaks ties", () => {
    assertProperty(
      fc.property(arbCase, fc.nat(), ({ total, weights, order }, rotation) => {
        const shift = rotation % weights.length;
        const rotate = <T>(values: readonly T[]) => [
          ...values.slice(shift),
          ...values.slice(0, shift),
        ];
        const direct = allocate(total, weights, order);
        const rotated = allocate(total, rotate(weights), rotate(order));
        expect(rotated).toEqual(rotate(direct));
      }),
    );
  });
});

describe("property: splits", () => {
  const arbValid = arbTotal.chain((total) =>
    fc
      .integer({ min: 1, max: 6 })
      .chain((count) =>
        arbSplit(membersOf(count), total).map((split) => ({ total, count, split })),
      ),
  );

  it("every method adds up to the expense amount, in canonical order, never negative", () => {
    assertProperty(
      fc.property(arbValid, ({ total, count, split }) => {
        const members = membersOf(count);
        const shares = computeSplit(total, split, members);
        expect(sum(shares.map((share) => share.amountMinor))).toBe(total);
        expect(shares.every((share) => share.amountMinor >= 0)).toBe(true);
        const positions = shares.map((share) => members.indexOf(share.memberId));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(computeSplit(total, split, members)).toEqual(shares);
      }),
    );
  });

  it("rejects percentages that do not total 100", () => {
    assertProperty(
      fc.property(
        arbTotal,
        fc.array(fc.integer({ min: 1, max: 9_999 }), { minLength: 1, maxLength: 6 }),
        (total, basisPoints) => {
          fc.pre(sum(basisPoints) !== 10_000);
          const split: SplitInput = {
            method: "percent",
            entries: basisPoints.map((units, index) => ({
              memberId: `m${index}`,
              value: unitsToDecimalString(units, 2),
            })),
          };
          expect(codeOf(() => computeSplit(total, split, membersOf(6)))).toBe(
            "PERCENT_TOTAL_MISMATCH",
          );
        },
      ),
    );
  });

  it("rejects a share (or percentage) of zero", () => {
    assertProperty(
      fc.property(
        arbTotal,
        fc.constantFrom<"shares" | "percent">("shares", "percent"),
        fc.integer({ min: 0, max: 3 }),
        (total, method, zeroAt) => {
          const split: SplitInput = {
            method,
            entries: [0, 1, 2, 3].map((index) => ({
              memberId: `m${index}`,
              value: index === zeroAt ? "0" : "25",
            })),
          };
          expect(codeOf(() => computeSplit(total, split, membersOf(4)))).toBe("NON_POSITIVE_VALUE");
        },
      ),
    );
  });

  it("rejects exact amounts that do not add up to the total", () => {
    assertProperty(
      fc.property(
        arbTotal,
        fc.integer({ min: 1, max: 1_000 }),
        fc.boolean(),
        (total, delta, over) => {
          const first = over ? total + delta : Math.max(0, total - delta);
          fc.pre(first !== total && first <= MAX_AMOUNT_MINOR);
          const split: SplitInput = {
            method: "exact",
            entries: [
              { memberId: "m0", value: String(first) },
              { memberId: "m1", value: "0" },
            ],
          };
          expect(codeOf(() => computeSplit(total, split, membersOf(2)))).toBe(
            "EXACT_TOTAL_MISMATCH",
          );
        },
      ),
    );
  });
});

describe("property: money parsing", () => {
  it("parsing the exact decimal text of an amount gives the amount back", () => {
    assertProperty(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: 3 }),
        (units, decimals) => {
          const text = unitsToDecimalString(units, decimals);
          expect(parseDecimalToUnits(text, decimals)).toBe(units);
        },
      ),
    );
  });
});

describe("property: balances", () => {
  it("the net balances of a group add up to exactly zero", () => {
    assertProperty(
      fc.property(arbScenario, ({ members, expenses, settlements }) => {
        const nets = computeNets(members, expenses, settlements);
        expect(sum(nets.map((net) => net.netMinor))).toBe(0);
        expect(nets.map((net) => net.memberId)).toEqual(members);
      }),
    );
  });
});

describe("property: simplify", () => {
  it("the payments settle every balance to exactly zero, in at most n - 1 payments", () => {
    assertProperty(
      fc.property(arbScenario, ({ members, expenses, settlements }) => {
        const nets = computeNets(members, expenses, settlements);
        const plan = simplify(nets);
        const withBalance = nets.filter((net) => net.netMinor !== 0).length;
        expect(plan.length).toBeLessThanOrEqual(Math.max(0, withBalance - 1));
        expect(plan.every((transfer) => transfer.amountMinor > 0)).toBe(true);

        const after = computeNets(members, expenses, [...settlements, ...plan]);
        expect(after.every((net) => net.netMinor === 0)).toBe(true);
      }),
    );
  });

  it("only debtors pay and only creditors receive, and the same input gives the same plan", () => {
    assertProperty(
      fc.property(arbScenario, ({ members, expenses, settlements }) => {
        const nets = computeNets(members, expenses, settlements);
        const net = new Map(nets.map((entry) => [entry.memberId, entry.netMinor]));
        const plan = simplify(nets);
        for (const transfer of plan) {
          expect(net.get(transfer.fromMemberId)!).toBeLessThan(0);
          expect(net.get(transfer.toMemberId)!).toBeGreaterThan(0);
        }
        expect(simplify(nets)).toEqual(plan);
      }),
    );
  });
});

describe("property: pairwise", () => {
  it("for every member, what they are owed minus what they owe equals their net balance", () => {
    assertProperty(
      fc.property(arbScenario, ({ members, expenses, settlements }) => {
        const nets = computeNets(members, expenses, settlements);
        const debts = pairwise(members, expenses, settlements);
        for (const { memberId, netMinor } of nets) {
          const owed = sum(
            debts.filter((debt) => debt.creditorId === memberId).map((debt) => debt.amountMinor),
          );
          const owes = sum(
            debts.filter((debt) => debt.debtorId === memberId).map((debt) => debt.amountMinor),
          );
          expect(owed - owes).toBe(netMinor);
        }
      }),
    );
  });

  it("reports each pair at most once, with a positive amount, between two different members", () => {
    assertProperty(
      fc.property(arbScenario, ({ members, expenses, settlements }) => {
        const debts = pairwise(members, expenses, settlements);
        const pairs = debts.map((debt) => [debt.debtorId, debt.creditorId].sort().join("|"));
        expect(new Set(pairs).size).toBe(pairs.length);
        expect(
          debts.every((debt) => debt.amountMinor > 0 && debt.debtorId !== debt.creditorId),
        ).toBe(true);
        expect(pairwise(members, expenses, settlements)).toEqual(debts);
      }),
    );
  });
});

it("a quick sanity check that the generators produce what they claim", () => {
  const sample = fc.sample(arbScenario, { numRuns: 50, seed: 42 });
  expect(sample.some((scenario) => scenario.expenses.length > 0)).toBe(true);
  expect(sample.some((scenario) => scenario.settlements.length > 0)).toBe(true);
});
