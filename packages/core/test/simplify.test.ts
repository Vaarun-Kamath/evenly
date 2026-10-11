import { describe, expect, it } from "vitest";
import { settleGreedily, simplify, type Net } from "../src";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const nets = (...values: number[]): Net[] =>
  values.map((netMinor, index) => ({ memberId: String.fromCharCode(65 + index), netMinor }));

const pay = (from: string, to: string, amountMinor: number) => ({
  fromMemberId: from,
  toMemberId: to,
  amountMinor,
});

describe("simplify", () => {
  it("returns no payments when everyone is settled", () => {
    expect(simplify([])).toEqual([]);
    expect(simplify(nets(0, 0, 0))).toEqual([]);
  });

  it("makes one payment between two people", () => {
    expect(simplify(nets(500, -500))).toEqual([pay("B", "A", 500)]);
  });

  it("matches exactly opposite amounts first", () => {
    // Creditors are visited in order: A (70) is matched with D (-70), then B (40) with C (-40).
    expect(simplify(nets(70, 40, -40, -70))).toEqual([pay("D", "A", 70), pay("C", "B", 40)]);
  });

  it("pairs an exact match even when greedy would pair the largest first", () => {
    // B (+60) and D (-60) are exactly opposite, so they are matched first. The rest is greedy:
    // E (-60) pays A, then C (-40) pays A.
    expect(simplify(nets(100, 60, -40, -60, -60))).toEqual([
      pay("D", "B", 60),
      pay("E", "A", 60),
      pay("C", "A", 40),
    ]);
  });

  it("pays the largest debtor to the largest creditor, then continues", () => {
    expect(simplify(nets(516, 117, -633))).toEqual([pay("C", "A", 516), pay("C", "B", 117)]);
  });

  it("breaks ties by canonical order (first in the list)", () => {
    // Two equal creditors and one debtor: the earlier creditor is paid first.
    expect(simplify(nets(50, 50, -100))).toEqual([pay("C", "A", 50), pay("C", "B", 50)]);
    // Two equal debtors: the earlier debtor pays first.
    expect(simplify(nets(100, -30, -30, -40))).toEqual([
      pay("D", "A", 40),
      pay("B", "A", 30),
      pay("C", "A", 30),
    ]);
  });

  it("is deterministic", () => {
    const input = nets(300, -120, 45, -45, -180);
    expect(simplify(input)).toEqual(simplify(input));
  });

  it("needs at most (people with a balance - 1) payments", () => {
    const input = nets(900, 100, -250, -250, -250, -250);
    expect(simplify(input).length).toBeLessThanOrEqual(5);
  });

  it("rejects nets that do not add up to zero", () => {
    expect(codeOf(() => simplify(nets(100, -99)))).toBe("UNBALANCED");
  });

  it("rejects amounts that are not safe integers", () => {
    expect(codeOf(() => simplify(nets(1.5, -1.5)))).toBe("UNSAFE_INTEGER");
  });
});

describe("settleGreedily without the exact-pair pass", () => {
  it("settles in pure greedy order", () => {
    // With the exact pass, B and D would be paired first (60 each).
    expect(settleGreedily(nets(100, 60, -40, -60, -60), { pairExactFirst: false })).toEqual([
      pay("D", "A", 60),
      pay("E", "B", 60),
      pay("C", "A", 40),
    ]);
  });

  it("still settles everyone to zero", () => {
    const input = nets(100, 60, -40, -60, -60);
    const balance = new Map(input.map((n) => [n.memberId, n.netMinor]));
    for (const t of settleGreedily(input, { pairExactFirst: false })) {
      balance.set(t.fromMemberId, (balance.get(t.fromMemberId) ?? 0) + t.amountMinor);
      balance.set(t.toMemberId, (balance.get(t.toMemberId) ?? 0) - t.amountMinor);
    }
    expect([...balance.values()]).toEqual([0, 0, 0, 0, 0]);
  });
});
