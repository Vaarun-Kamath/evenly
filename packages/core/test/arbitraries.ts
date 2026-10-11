import fc from "fast-check";
import {
  allocate,
  computeSplit,
  unitsToDecimalString,
  type ExpenseEntry,
  type SettlementEntry,
  type SplitInput,
} from "../src";

/** Property tests run 10,000 cases each (BUILD_PLAN M1); set FAST_CHECK_RUNS to go faster locally. */
export const RUNS = Number(process.env.FAST_CHECK_RUNS ?? 10_000);
export const assertProperty = <T>(property: fc.IPropertyWithHooks<T>) =>
  fc.assert(property, { numRuns: RUNS });

/** Canonical member order for a group of `count` people: m0 joined first. */
export const membersOf = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `m${index}`);

const MAX_TOTAL = 1_000_000_000_000;

/** A split total in minor units, from one unit up to the project maximum. */
export const arbTotal = fc.oneof(
  fc.integer({ min: 1, max: 1_000 }),
  fc.integer({ min: 1, max: 1_000_000_000 }),
  fc.integer({ min: 1, max: MAX_TOTAL }),
);

/** Splits `total` into `count` parts of at least zero that add up to it, using cut points. */
function partition(total: number, cuts: readonly number[]): number[] {
  const points = [0, ...[...cuts].sort((a, b) => a - b), total];
  return points.slice(1).map((point, index) => point - points[index]!);
}

/** A valid split of `total` between a random, randomly ordered subset of `members`. */
export function arbSplit(members: readonly string[], total: number): fc.Arbitrary<SplitInput> {
  const subset = fc.shuffledSubarray([...members], { minLength: 1 });
  const equal = subset.map((ids): SplitInput => ({
    method: "equal",
    entries: ids.map((memberId) => ({ memberId })),
  }));
  const exact = subset.chain((ids) =>
    fc
      .array(fc.integer({ min: 0, max: total }), {
        minLength: ids.length - 1,
        maxLength: ids.length - 1,
      })
      .map((cuts): SplitInput => ({
        method: "exact",
        entries: partition(total, cuts).map((amount, index) => ({
          memberId: ids[index]!,
          value: String(amount),
        })),
      })),
  );
  const percent = subset.chain((ids) =>
    fc
      .array(fc.integer({ min: 1, max: 1000 }), { minLength: ids.length, maxLength: ids.length })
      .map((weights): SplitInput => {
        // With 1 to `members.length` members and weights of 1 to 1000, every part is at least 1.
        const basisPoints = allocate(10_000, weights);
        return {
          method: "percent",
          entries: ids.map((memberId, index) => ({
            memberId,
            value: unitsToDecimalString(basisPoints[index]!, 2),
          })),
        };
      }),
  );
  const shares = subset.chain((ids) =>
    fc
      .array(fc.integer({ min: 1, max: 100_000 }), {
        minLength: ids.length,
        maxLength: ids.length,
      })
      .map((weights): SplitInput => ({
        method: "shares",
        entries: ids.map((memberId, index) => ({
          memberId,
          value: unitsToDecimalString(weights[index]!, 2),
        })),
      })),
  );
  return fc.oneof(equal, exact, percent, shares);
}

/** A valid expense: one to four payers, and shares computed by a random split method. */
export function arbExpense(members: readonly string[]): fc.Arbitrary<ExpenseEntry> {
  return fc
    .tuple(
      fc.integer({ min: 1_000, max: 1_000_000_000_000 }),
      fc.shuffledSubarray([...members], { minLength: 1, maxLength: Math.min(4, members.length) }),
    )
    .chain(([total, payers]) =>
      fc
        .tuple(
          fc.array(fc.integer({ min: 1, max: 100 }), {
            minLength: payers.length,
            maxLength: payers.length,
          }),
          arbSplit(members, total),
        )
        .map(([weights, split]): ExpenseEntry => {
          // total >= 1000 and at most 4 payers with weights of 1 to 100: every payment is above zero.
          const paid = allocate(total, weights);
          return {
            payers: payers.map((memberId, index) => ({ memberId, amountMinor: paid[index]! })),
            shares: computeSplit(total, split, members).map(({ memberId, amountMinor }) => ({
              memberId,
              amountMinor,
            })),
          };
        }),
    );
}

export function arbSettlement(members: readonly string[]): fc.Arbitrary<SettlementEntry> {
  return fc
    .tuple(
      fc.shuffledSubarray([...members], { minLength: 2, maxLength: 2 }),
      fc.integer({ min: 1, max: 1_000_000_000 }),
    )
    .map(([pair, amountMinor]) => ({
      fromMemberId: pair[0]!,
      toMemberId: pair[1]!,
      amountMinor,
    }));
}

export interface Scenario {
  members: string[];
  expenses: ExpenseEntry[];
  settlements: SettlementEntry[];
}

/** A group of two to six people with a random history of expenses and settlements. */
export const arbScenario: fc.Arbitrary<Scenario> = fc.integer({ min: 2, max: 6 }).chain((count) => {
  const members = membersOf(count);
  return fc.record({
    members: fc.constant(members),
    expenses: fc.array(arbExpense(members), { maxLength: 8 }),
    settlements: fc.array(arbSettlement(members), { maxLength: 6 }),
  });
});
