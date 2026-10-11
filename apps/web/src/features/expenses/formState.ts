import type {
  CreateExpenseRequest,
  Expense,
  ExpenseCategory,
  Member,
  UpdateExpenseRequest,
} from "@evenly/contracts";
import {
  CoreError,
  computeSplit,
  exponentOf,
  parseAmount,
  parseDecimalToUnits,
  unitsToDecimalString,
  validatePayers,
  type ComputedShare,
} from "@evenly/core";
import { money, todayIso } from "../../lib/format";

export type Method = "equal" | "exact" | "percent" | "shares";

/** Everything the expense form holds, as the person typed it (strings), so nothing is lost while editing. */
export interface ExpenseFormState {
  /** The expense's id, made once (UUIDv7) so that a retry cannot create it twice. Empty when editing. */
  id: string;
  description: string;
  amount: string;
  date: string;
  category: ExpenseCategory;
  notes: string;
  payerMode: "one" | "many";
  payer: string;
  /** Per member: what they paid, when several people paid. */
  payerAmounts: Record<string, string>;
  method: Method;
  /** Per member: shares in this expense. */
  included: Record<string, boolean>;
  /** Per member: the exact amount, percentage or share weight (not used for an equal split). */
  values: Record<string, string>;
}

/** The members the form offers: everyone still in the group, plus anyone already in the expense. */
export function visibleMembers(members: readonly Member[], expense?: Expense): Member[] {
  const involved = new Set([
    ...(expense?.payers.map((p) => p.memberId) ?? []),
    ...(expense?.shares.map((s) => s.memberId) ?? []),
  ]);
  return members.filter((m) => m.leftAt === null || involved.has(m.id));
}

export function initialState(
  members: readonly Member[],
  id: string,
  now = new Date(),
): ExpenseFormState {
  const active = members.filter((m) => m.leftAt === null);
  const me = active.find((m) => m.isYou) ?? active[0];
  return {
    id,
    description: "",
    amount: "",
    date: todayIso(now),
    category: "other",
    notes: "",
    payerMode: "one",
    payer: me?.id ?? "",
    payerAmounts: {},
    method: "equal",
    included: Object.fromEntries(active.map((m) => [m.id, true])),
    values: {},
  };
}

/** The form for an existing expense, with what was typed (percent, shares, exact amounts) put back. */
export function stateFromExpense(expense: Expense, members: readonly Member[]): ExpenseFormState {
  const exponent = exponentOf(expense.amount.currency);
  const included: Record<string, boolean> = Object.fromEntries(members.map((m) => [m.id, false]));
  const values: Record<string, string> = {};
  for (const share of expense.shares) {
    included[share.memberId] = true;
    if (expense.splitMethod === "exact") {
      values[share.memberId] = unitsToDecimalString(share.amountMinor, exponent);
    } else if (share.inputValue !== null) {
      values[share.memberId] = trimZeros(share.inputValue);
    }
  }
  const single = expense.payers.length === 1 ? expense.payers[0] : undefined;
  return {
    id: "",
    description: expense.description,
    amount: unitsToDecimalString(expense.amount.amountMinor, exponent),
    date: expense.expenseDate,
    category: expense.category,
    notes: expense.notes ?? "",
    payerMode: single === undefined ? "many" : "one",
    payer: single?.memberId ?? expense.payers[0]?.memberId ?? "",
    payerAmounts: Object.fromEntries(
      expense.payers.map((p) => [p.memberId, unitsToDecimalString(p.amountMinor, exponent)]),
    ),
    method: expense.splitMethod,
    included,
    values,
  };
}

/** "33.30" becomes "33.3" and "2.00" becomes "2", for putting a stored value back into an input. */
function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** n percentages with two decimals that add up to exactly 100: 3 gives 33.34, 33.33, 33.33. */
export function evenPercents(count: number): string[] {
  if (count <= 0) return [];
  const basis = Math.floor(10_000 / count);
  const extra = 10_000 - basis * count;
  return Array.from({ length: count }, (_, i) =>
    unitsToDecimalString(basis + (i < extra ? 1 : 0), 2),
  );
}

/** Switching the method fills in sensible starting values, keeping what the person already typed. */
export function withMethod(state: ExpenseFormState, method: Method): ExpenseFormState {
  if (method === state.method) return state;
  const people = Object.entries(state.included)
    .filter(([, on]) => on)
    .map(([id]) => id);
  const values = { ...state.values };
  if (method === "shares") {
    for (const id of people) if (!isNumber(values[id])) values[id] = "1";
  } else if (method === "percent") {
    const percents = evenPercents(people.length);
    people.forEach((id, index) => {
      values[id] = percents[index] ?? "";
    });
  } else if (method === "exact") {
    for (const id of people) values[id] = "";
  }
  return { ...state, method, values };
}

const isNumber = (value: string | undefined): boolean =>
  value !== undefined && /^\d+(\.\d+)?$/.test(value.trim());

/** What the form works out from what was typed: the request to send, or what is wrong, plus a live preview. */
export interface Computed {
  /** What the person owes for this expense, in canonical order; empty until the amount and split are valid. */
  shares: ComputedShare[];
  /** A problem with the amount, with who paid, or with the split, each in plain words. */
  errors: { amount?: string; payers?: string; split?: string };
  /** The total in minor units, when the amount is valid. */
  total: number | null;
  /** How much of the total the entered exact amounts, or percentages, still leave to hand out. */
  remaining: string | null;
  payers: { memberId: string; amountMinor: number }[];
  split: { method: Method; entries: { memberId: string; value?: string }[] };
}

/**
 * The entries of the split request. People type exact amounts in the currency's own units ("2.50"); the
 * server wants whole minor units, so they are converted here (a blank exact amount means 0). A blank
 * percentage or share is left out, so the money rules ask for it.
 */
function entriesOf(
  state: ExpenseFormState,
  order: readonly string[],
  currency: string,
): { memberId: string; value?: string }[] {
  return order
    .filter((id) => state.included[id] === true)
    .map((memberId) => {
      if (state.method === "equal") return { memberId };
      const typed = (state.values[memberId] ?? "").trim();
      if (state.method === "exact") {
        return { memberId, value: typed === "" ? "0" : String(parseAmount(typed, currency)) };
      }
      return typed === "" ? { memberId } : { memberId, value: typed };
    });
}

/** Plain-language text for a rule from @evenly/core. */
export function describeCoreError(error: unknown, currency: string): string {
  if (!(error instanceof CoreError)) return "Something is not right with these numbers.";
  const details = error.details ?? {};
  const asMoney = (value: unknown) => (typeof value === "number" ? money(value, currency) : "?");
  switch (error.code) {
    case "INVALID_AMOUNT":
    case "UNSAFE_INTEGER":
      return "Enter numbers only, like 12.50.";
    case "TOO_MANY_DECIMALS":
      return `${currency} has ${String(exponentOf(currency))} decimal places at most.`;
    case "AMOUNT_TOO_LARGE":
      return "That number is too large.";
    case "NO_ENTRIES":
      return "Choose at least one person to split with.";
    case "MISSING_VALUE":
      return "Fill in a value for everyone included.";
    case "NON_POSITIVE_VALUE":
      return "Everyone included needs a value above zero. Untick people who are not sharing.";
    case "EXACT_TOTAL_MISMATCH":
      return `These add up to ${asMoney(details.actual)}, not ${asMoney(details.expected)}.`;
    case "PERCENT_TOTAL_MISMATCH": {
      const basisPoints = details.actualBasisPoints;
      return `Percentages add up to ${typeof basisPoints === "number" ? unitsToDecimalString(basisPoints, 2) : "?"}, not 100.`;
    }
    case "NO_PAYERS":
      return "Say who paid.";
    case "PAYER_TOTAL_MISMATCH":
      return `The amounts paid add up to ${asMoney(details.actual)}, not ${asMoney(details.expected)}.`;
    case "NON_POSITIVE_AMOUNT":
      return "Everyone who paid needs an amount above zero.";
    case "DUPLICATE_MEMBER":
      return "Someone is listed twice.";
    default:
      return error.message;
  }
}

/**
 * Applies the same money rules the server uses (they are the same code, @evenly/core), as the person types,
 * so the preview and the validation messages match what saving will do.
 */
export function compute(
  state: ExpenseFormState,
  members: readonly Member[],
  currency: string,
): Computed {
  const order = members.map((m) => m.id);
  const result: Computed = {
    shares: [],
    errors: {},
    total: null,
    remaining: null,
    payers: [],
    split: { method: state.method, entries: [] },
  };

  if (state.amount.trim() === "") {
    result.errors.amount = "Enter the amount.";
    return result;
  }
  try {
    const total = parseAmount(state.amount, currency);
    if (total < 1) throw new CoreError("INVALID_TOTAL", "The amount must be above zero");
    result.total = total;
  } catch (error) {
    result.errors.amount =
      error instanceof CoreError && error.code === "INVALID_TOTAL"
        ? "The amount must be above zero."
        : describeCoreError(error, currency);
    return result;
  }
  const total = result.total;

  // Who paid.
  try {
    result.payers =
      state.payerMode === "one"
        ? state.payer === ""
          ? []
          : [{ memberId: state.payer, amountMinor: total }]
        : order.flatMap((memberId) => {
            const typed = (state.payerAmounts[memberId] ?? "").trim();
            return typed === "" ? [] : [{ memberId, amountMinor: parseAmount(typed, currency) }];
          });
    validatePayers(total, result.payers, order);
  } catch (error) {
    result.errors.payers = describeCoreError(error, currency);
  }

  // How it is split, and what is left to hand out.
  try {
    result.split = { method: state.method, entries: entriesOf(state, order, currency) };
    result.shares = computeSplit(total, result.split, order);
  } catch (error) {
    result.errors.split = describeCoreError(error, currency);
    result.remaining = remainingOf(state, order, total, currency);
  }
  return result;
}

function remainingOf(
  state: ExpenseFormState,
  order: readonly string[],
  total: number,
  currency: string,
): string | null {
  if (state.method !== "exact" && state.method !== "percent") return null;
  try {
    const entered = order
      .filter((id) => state.included[id] === true)
      .reduce((sum, id) => {
        const typed = (state.values[id] ?? "").trim();
        if (typed === "") return sum;
        return (
          sum +
          (state.method === "exact" ? parseAmount(typed, currency) : parseDecimalToUnits(typed, 2))
        );
      }, 0);
    return state.method === "exact"
      ? `${money(total - entered, currency)} left`
      : `${unitsToDecimalString(10_000 - entered, 2)}% left`;
  } catch {
    return null;
  }
}

/** Whether the form can be saved as it stands. */
export function isValid(state: ExpenseFormState, computed: Computed): boolean {
  return (
    state.description.trim() !== "" &&
    state.date !== "" &&
    Object.keys(computed.errors).length === 0 &&
    computed.shares.length > 0
  );
}

function body(state: ExpenseFormState, computed: Computed, currency: string) {
  return {
    description: state.description.trim(),
    amountMinor: computed.total ?? 0,
    currency,
    category: state.category,
    expenseDate: state.date,
    notes: state.notes.trim() === "" ? null : state.notes.trim(),
    payers: computed.payers,
    split: computed.split,
  };
}

export const createRequest = (
  state: ExpenseFormState,
  computed: Computed,
  currency: string,
): CreateExpenseRequest => ({ id: state.id, ...body(state, computed, currency) });

export const updateRequest = (
  state: ExpenseFormState,
  computed: Computed,
  currency: string,
  version: number,
): UpdateExpenseRequest => ({ version, ...body(state, computed, currency) });

/* ---------------------------------------------------------------- the draft */

const DRAFT_PREFIX = "evenly:draft:";

/** An unsaved new expense survives a reload (sessionStorage, so it goes away with the tab). */
export function loadDraft(gid: string): ExpenseFormState | undefined {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_PREFIX + gid);
    return raw === null ? undefined : (JSON.parse(raw) as ExpenseFormState);
  } catch {
    return undefined;
  }
}

export function saveDraft(gid: string, state: ExpenseFormState): void {
  try {
    window.sessionStorage.setItem(DRAFT_PREFIX + gid, JSON.stringify(state));
  } catch {
    // Storage may be full or blocked; the draft is a convenience.
  }
}

export function clearDraft(gid: string): void {
  try {
    window.sessionStorage.removeItem(DRAFT_PREFIX + gid);
  } catch {
    // Nothing to clear.
  }
}
