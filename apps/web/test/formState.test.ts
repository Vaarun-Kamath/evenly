import type { Expense, Member } from "@evenly/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  compute,
  createRequest,
  evenPercents,
  initialState,
  isValid,
  loadDraft,
  saveDraft,
  stateFromExpense,
  updateRequest,
  visibleMembers,
  withMethod,
  type ExpenseFormState,
} from "../src/features/expenses/formState";

const member = (id: string, displayName: string, extra: Partial<Member> = {}): Member => ({
  id,
  displayName,
  role: "member",
  isPlaceholder: false,
  isYou: false,
  email: null,
  joinedAt: "2026-10-01T00:00:00.000Z",
  leftAt: null,
  net: { amountMinor: 0, currency: "INR" },
  ...extra,
});

const A = member("a", "Alice", { isYou: true, role: "owner" });
const B = member("b", "Bob");
const C = member("c", "Cara", { isPlaceholder: true });
const GONE = member("g", "Gus", { leftAt: "2026-10-05T00:00:00.000Z" });
const MEMBERS = [A, B, C, GONE];

function filled(overrides: Partial<ExpenseFormState> = {}): ExpenseFormState {
  return {
    ...initialState(MEMBERS, "id-1", new Date(2026, 9, 11)),
    description: "Dinner",
    amount: "1000",
    ...overrides,
  };
}

describe("initialState", () => {
  it("starts with today, you as the payer, and everyone still in the group included", () => {
    const state = initialState(MEMBERS, "id-1", new Date(2026, 9, 11));
    expect(state).toMatchObject({
      id: "id-1",
      date: "2026-10-11",
      payer: "a",
      payerMode: "one",
      method: "equal",
    });
    expect(state.included).toEqual({ a: true, b: true, c: true });
  });
});

describe("compute", () => {
  it("previews an equal split, giving the odd paisa to whoever joined first (SPEC scenario 2)", () => {
    const computed = compute(filled(), MEMBERS, "INR");
    expect(computed.errors).toEqual({});
    expect(computed.total).toBe(100000);
    expect(computed.shares.map((s) => [s.memberId, s.amountMinor])).toEqual([
      ["a", 33334],
      ["b", 33333],
      ["c", 33333],
    ]);
    expect(isValid(filled(), computed)).toBe(true);
  });

  it("previews shares, percentages and exact amounts", () => {
    const shares = compute(
      filled({ amount: "600", method: "shares", values: { a: "1", b: "1", c: "2" } }),
      MEMBERS,
      "INR",
    );
    expect(shares.shares.map((s) => s.amountMinor)).toEqual([15000, 15000, 30000]);

    const percent = compute(
      filled({ amount: "10.01", method: "percent", values: { a: "50", b: "30", c: "20" } }),
      MEMBERS,
      "INR",
    );
    expect(percent.shares.map((s) => s.amountMinor)).toEqual([501, 300, 200]);

    const exact = compute(
      filled({
        amount: "10",
        method: "exact",
        values: { a: "2.5", b: "7.5" },
        included: { a: true, b: true, c: false },
      }),
      MEMBERS,
      "INR",
    );
    expect(exact.errors).toEqual({});
    expect(exact.shares.map((s) => s.amountMinor)).toEqual([250, 750]);
    // The server gets whole minor units, whatever was typed.
    expect(exact.split.entries).toEqual([
      { memberId: "a", value: "250" },
      { memberId: "b", value: "750" },
    ]);
    // A blank exact amount means 0.
    const blank = compute(
      filled({ amount: "10", method: "exact", values: { a: "10" } }),
      MEMBERS,
      "INR",
    );
    expect(blank.errors).toEqual({});
    expect(blank.shares.map((s) => s.amountMinor)).toEqual([1000, 0, 0]);
  });

  it("splits only between the people ticked", () => {
    const computed = compute(
      filled({ amount: "10", included: { a: true, b: false, c: true } }),
      MEMBERS,
      "INR",
    );
    expect(computed.shares.map((s) => s.memberId)).toEqual(["a", "c"]);
  });

  it("explains an amount that is missing, malformed or too precise", () => {
    expect(compute(filled({ amount: "" }), MEMBERS, "INR").errors.amount).toBe("Enter the amount.");
    expect(compute(filled({ amount: "abc" }), MEMBERS, "INR").errors.amount).toMatch(
      /numbers only/,
    );
    expect(compute(filled({ amount: "0" }), MEMBERS, "INR").errors.amount).toMatch(/above zero/);
    expect(compute(filled({ amount: "1.234" }), MEMBERS, "INR").errors.amount).toMatch(
      /2 decimal places/,
    );
    expect(compute(filled({ amount: "1.5" }), MEMBERS, "JPY").errors.amount).toMatch(
      /0 decimal places/,
    );
    expect(compute(filled({ amount: "1.234" }), MEMBERS, "KWD").errors).toEqual({});
  });

  it("says what is wrong with an exact split and how much is left", () => {
    const computed = compute(
      filled({
        amount: "10",
        method: "exact",
        values: { a: "2", b: "3" },
        included: { a: true, b: true, c: false },
      }),
      MEMBERS,
      "INR",
    );
    expect(computed.errors.split).toMatch(/add up to .*5\.00, not .*10\.00/);
    expect(computed.remaining).toMatch(/5\.00 left/);
    expect(computed.shares).toEqual([]);
    expect(isValid(filled(), computed)).toBe(false);
  });

  it("says what is wrong with percentages, shares and an empty split", () => {
    const percent = compute(
      filled({
        method: "percent",
        values: { a: "50", b: "40" },
        included: { a: true, b: true, c: false },
      }),
      MEMBERS,
      "INR",
    );
    expect(percent.errors.split).toMatch(/Percentages add up to 90\.00, not 100/);
    expect(percent.remaining).toBe("10.00% left");
    const zero = compute(
      filled({ method: "shares", values: { a: "0", b: "1", c: "1" } }),
      MEMBERS,
      "INR",
    );
    expect(zero.errors.split).toMatch(/above zero/);
    const blank = compute(
      filled({ method: "shares", values: { a: "", b: "1", c: "1" } }),
      MEMBERS,
      "INR",
    );
    expect(blank.errors.split).toBeDefined();
    const nobody = compute(filled({ included: { a: false, b: false, c: false } }), MEMBERS, "INR");
    expect(nobody.errors.split).toBe("Choose at least one person to split with.");
  });

  it("handles several people paying", () => {
    const ok = compute(
      filled({ payerMode: "many", payerAmounts: { a: "600", b: "400" } }),
      MEMBERS,
      "INR",
    );
    expect(ok.errors).toEqual({});
    expect(ok.payers).toEqual([
      { memberId: "a", amountMinor: 60000 },
      { memberId: "b", amountMinor: 40000 },
    ]);
    const short = compute(
      filled({ payerMode: "many", payerAmounts: { a: "600", b: "300" } }),
      MEMBERS,
      "INR",
    );
    expect(short.errors.payers).toMatch(/add up to .*900\.00, not .*1,000\.00/);
    expect(
      compute(filled({ payerMode: "many", payerAmounts: {} }), MEMBERS, "INR").errors.payers,
    ).toBe("Say who paid.");
    expect(compute(filled({ payer: "" }), MEMBERS, "INR").errors.payers).toBe("Say who paid.");
  });
});

describe("requests", () => {
  it("builds the create request the server expects, with the client's id", () => {
    const state = filled({ notes: "  with tip  ", category: "food" });
    const request = createRequest(state, compute(state, MEMBERS, "INR"), "INR");
    expect(request).toEqual({
      id: "id-1",
      description: "Dinner",
      amountMinor: 100000,
      currency: "INR",
      category: "food",
      expenseDate: "2026-10-11",
      notes: "with tip",
      payers: [{ memberId: "a", amountMinor: 100000 }],
      split: {
        method: "equal",
        entries: [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }],
      },
    });
  });

  it("sends values for the methods that use them, and the version when editing", () => {
    const state = filled({
      amount: "600",
      method: "shares",
      values: { a: "1", b: "1", c: "2" },
      notes: "",
    });
    const computed = compute(state, MEMBERS, "INR");
    const request = updateRequest(state, computed, "INR", 3);
    expect(request.version).toBe(3);
    expect(request.notes).toBeNull();
    expect(request.split.entries).toEqual([
      { memberId: "a", value: "1" },
      { memberId: "b", value: "1" },
      { memberId: "c", value: "2" },
    ]);
  });
});

describe("methods", () => {
  it("fills in even percentages that add up to exactly 100, and one share each", () => {
    expect(evenPercents(3)).toEqual(["33.34", "33.33", "33.33"]);
    expect(evenPercents(4)).toEqual(["25.00", "25.00", "25.00", "25.00"]);
    expect(evenPercents(1)).toEqual(["100.00"]);
    expect(evenPercents(0)).toEqual([]);
    const toPercent = withMethod(filled(), "percent");
    expect(Object.values(toPercent.values)).toEqual(["33.34", "33.33", "33.33"]);
    expect(compute(toPercent, MEMBERS, "INR").errors).toEqual({});
    const toShares = withMethod(filled(), "shares");
    expect(Object.values(toShares.values)).toEqual(["1", "1", "1"]);
    expect(withMethod(toShares, "shares")).toBe(toShares);
    expect(withMethod(filled(), "exact").values).toEqual({ a: "", b: "", c: "" });
  });
});

describe("editing an existing expense", () => {
  const expense: Expense = {
    id: "e1",
    groupId: "g1",
    description: "Cab",
    amount: { amountMinor: 60000, currency: "INR" },
    category: "transport",
    expenseDate: "2026-10-03",
    notes: "to the airport",
    splitMethod: "shares",
    payers: [{ memberId: "b", amountMinor: 60000 }],
    shares: [
      { memberId: "a", amountMinor: 15000, inputValue: "1.00" },
      { memberId: "b", amountMinor: 15000, inputValue: "1.00" },
      { memberId: "c", amountMinor: 30000, inputValue: "2.00" },
    ],
    createdBy: "b",
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
    deletedAt: null,
    version: 4,
  };

  it("puts back what was typed, trimmed of padding zeros", () => {
    const state = stateFromExpense(expense, MEMBERS);
    expect(state).toMatchObject({
      description: "Cab",
      amount: "600.00",
      date: "2026-10-03",
      category: "transport",
      notes: "to the airport",
      payerMode: "one",
      payer: "b",
      method: "shares",
    });
    expect(state.values).toEqual({ a: "1", b: "1", c: "2" });
    expect(state.included).toEqual({ a: true, b: true, c: true, g: false });
    // Round trip: nothing changed, so the same shares come out.
    expect(compute(state, MEMBERS, "INR").shares.map((s) => s.amountMinor)).toEqual([
      15000, 15000, 30000,
    ]);
  });

  it("restores exact amounts, percentages and several payers", () => {
    const exact = stateFromExpense(
      {
        ...expense,
        splitMethod: "exact",
        shares: [
          { memberId: "a", amountMinor: 250, inputValue: "250.00" },
          { memberId: "b", amountMinor: 59750, inputValue: "59750.00" },
        ],
        amount: { amountMinor: 60000, currency: "INR" },
      },
      MEMBERS,
    );
    expect(exact.values).toEqual({ a: "2.50", b: "597.50" });
    const percent = stateFromExpense(
      {
        ...expense,
        splitMethod: "percent",
        shares: [
          { memberId: "a", amountMinor: 30000, inputValue: "50.00" },
          { memberId: "b", amountMinor: 18000, inputValue: "30.00" },
          { memberId: "c", amountMinor: 12000, inputValue: "20.00" },
        ],
      },
      MEMBERS,
    );
    expect(percent.values).toEqual({ a: "50", b: "30", c: "20" });
    const many = stateFromExpense(
      {
        ...expense,
        payers: [
          { memberId: "a", amountMinor: 40000 },
          { memberId: "b", amountMinor: 20000 },
        ],
      },
      MEMBERS,
    );
    expect(many).toMatchObject({ payerMode: "many", payerAmounts: { a: "400.00", b: "200.00" } });
  });

  it("offers people who left only if they are already in the expense", () => {
    expect(visibleMembers(MEMBERS).map((m) => m.id)).toEqual(["a", "b", "c"]);
    const withGus = {
      ...expense,
      shares: [...expense.shares, { memberId: "g", amountMinor: 0, inputValue: null }],
    };
    expect(visibleMembers(MEMBERS, withGus).map((m) => m.id)).toEqual(["a", "b", "c", "g"]);
  });
});

describe("the draft", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("saves, loads and clears an unsaved expense per group", () => {
    const state = filled({ description: "Half typed" });
    expect(loadDraft("g1")).toBeUndefined();
    saveDraft("g1", state);
    expect(loadDraft("g1")).toEqual(state);
    expect(loadDraft("g2")).toBeUndefined();
    clearDraft("g1");
    expect(loadDraft("g1")).toBeUndefined();
  });

  it("ignores a draft that is not valid JSON", () => {
    window.sessionStorage.setItem("evenly:draft:g1", "{not json");
    expect(loadDraft("g1")).toBeUndefined();
  });
});
