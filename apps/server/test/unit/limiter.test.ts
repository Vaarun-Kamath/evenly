import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../../src/auth/limiter";

describe("SlidingWindowLimiter", () => {
  it("allows up to max attempts per window and then refuses", () => {
    const now = 0;
    const limiter = new SlidingWindowLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => limiter.allow("a"))).toEqual([true, true, true, false]);
    expect(limiter.allow("a")).toBe(false);
  });

  it("forgets attempts once they leave the window", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(2, 1000, () => now);
    limiter.allow("a");
    now = 400;
    limiter.allow("a");
    expect(limiter.allow("a")).toBe(false);
    now = 1001; // the first attempt (t=0) has expired, the second (t=400) has not
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    now = 1401;
    expect(limiter.allow("a")).toBe(true);
  });

  it("keeps keys independent", () => {
    const limiter = new SlidingWindowLimiter(1, 1000, () => 0);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("evicts the least recently used key when it holds too many", () => {
    const limiter = new SlidingWindowLimiter(1, 1000, () => 0, 2);
    limiter.allow("a");
    limiter.allow("b");
    limiter.allow("c"); // evicts "a"
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("c")).toBe(false);
  });
});
