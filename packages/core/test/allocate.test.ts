import { describe, expect, it } from "vitest";
import { allocate } from "../src";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("allocate", () => {
  it("gives the odd unit to the first member: 1000.00 among three is 333.34 / 333.33 / 333.33", () => {
    expect(allocate(100000, [1, 1, 1])).toEqual([33334, 33333, 33333]);
  });

  it("hands out several odd units one at a time, in order", () => {
    expect(allocate(5, [1, 1, 1, 1])).toEqual([2, 1, 1, 1]);
    expect(allocate(6, [1, 1, 1, 1])).toEqual([2, 2, 1, 1]);
    expect(allocate(7, [1, 1, 1, 1])).toEqual([2, 2, 2, 1]);
  });

  it("breaks ties by the canonical order, not by array position", () => {
    // Member 1 comes first canonically (key 0), so it gets the odd unit.
    expect(allocate(100, [1, 1, 1], [2, 0, 1])).toEqual([33, 34, 33]);
    expect(allocate(101, [1, 1, 1], [2, 0, 1])).toEqual([33, 34, 34]);
  });

  it("gives the extra unit to the largest remainder before the order matters", () => {
    // 10 * [1,2,3] / 6 = 1.67, 3.33, 5.00: the largest remainder (0.67) wins.
    expect(allocate(10, [1, 2, 3])).toEqual([2, 3, 5]);
  });

  it("never gives anything to a weight of zero", () => {
    expect(allocate(5, [0, 1, 1])).toEqual([0, 3, 2]);
    expect(allocate(5, [1, 0, 0])).toEqual([5, 0, 0]);
  });

  it("allocates nothing for a total of zero", () => {
    expect(allocate(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it("allocates everything to a single member", () => {
    expect(allocate(12345, [7])).toEqual([12345]);
  });

  it("is exact for totals whose products exceed the safe integer range", () => {
    const total = 1_000_000_000_000;
    const weights = [1_000_000, 999_999, 3];
    const parts = allocate(total, weights);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("does not modify its inputs", () => {
    const weights = [1, 2, 3];
    const order = [2, 1, 0];
    allocate(10, weights, order);
    expect(weights).toEqual([1, 2, 3]);
    expect(order).toEqual([2, 1, 0]);
  });

  describe("rejects bad input", () => {
    it("total", () => {
      expect(codeOf(() => allocate(-1, [1]))).toBe("INVALID_TOTAL");
      expect(codeOf(() => allocate(1.5, [1]))).toBe("UNSAFE_INTEGER");
    });

    it("weights", () => {
      expect(codeOf(() => allocate(10, []))).toBe("INVALID_WEIGHTS");
      expect(codeOf(() => allocate(10, [1, -1]))).toBe("INVALID_WEIGHTS");
      expect(codeOf(() => allocate(10, [0, 0]))).toBe("INVALID_WEIGHTS");
      expect(codeOf(() => allocate(10, [1, 0.5]))).toBe("UNSAFE_INTEGER");
    });

    it("order", () => {
      expect(codeOf(() => allocate(10, [1, 1], [0]))).toBe("INVALID_ORDER");
      expect(codeOf(() => allocate(10, [1, 1], [3, 3]))).toBe("INVALID_ORDER");
    });
  });
});
