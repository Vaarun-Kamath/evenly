import type { Member } from "@evenly/contracts";
import { useId } from "react";
import { money } from "../../lib/format";
import { nameOf } from "../../lib/hooks";
import { withMethod, type Computed, type ExpenseFormState, type Method } from "./formState";

const METHODS: { id: Method; label: string; unit: string; help: string }[] = [
  { id: "equal", label: "Equally", unit: "", help: "Everyone ticked pays the same, to the cent." },
  { id: "exact", label: "Exact", unit: "amount", help: "Type what each person owes." },
  {
    id: "percent",
    label: "Percent",
    unit: "%",
    help: "Type each person's percentage; they must total 100.",
  },
  {
    id: "shares",
    label: "Shares",
    unit: "shares",
    help: "Type each person's shares, like 2 : 1 : 1.",
  },
];

interface Props {
  state: ExpenseFormState;
  onChange: (state: ExpenseFormState) => void;
  members: readonly Member[];
  /** Everyone, for the money rules (canonical order); `members` is who the form offers. */
  allMembers: readonly Member[];
  computed: Computed;
  currency: string;
}

/** Who shares the expense, and how, with each person's share shown as you type. */
export function SplitEditor({ state, onChange, members, allMembers, computed, currency }: Props) {
  const groupId = useId();
  const share = new Map(computed.shares.map((s) => [s.memberId, s.amountMinor]));
  const method = METHODS.find((m) => m.id === state.method) ?? METHODS[0]!;
  const set = (patch: Partial<ExpenseFormState>) => onChange({ ...state, ...patch });

  const setAll = (value: boolean) =>
    set({
      included: {
        ...state.included,
        ...Object.fromEntries(members.filter((m) => m.leftAt === null).map((m) => [m.id, value])),
      },
    });

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Split between</legend>

      <div
        role="radiogroup"
        aria-label="How to split"
        className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1"
      >
        {METHODS.map((option) => (
          <label
            key={option.id}
            className="relative flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-1 text-center text-xs font-medium has-[:checked]:bg-surface has-[:checked]:shadow-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 sm:text-sm"
          >
            <input
              type="radio"
              name={`${groupId}-method`}
              value={option.id}
              checked={state.method === option.id}
              onChange={() => onChange(withMethod(state, option.id))}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">{method.help}</p>

      <div className="flex gap-3 text-xs">
        <button type="button" className="underline underline-offset-4" onClick={() => setAll(true)}>
          Everyone
        </button>
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => setAll(false)}
        >
          No one
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const left = m.leftAt !== null;
          const on = state.included[m.id] === true;
          const inputId = `${groupId}-${m.id}`;
          return (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2"
            >
              <input
                id={`${inputId}-on`}
                type="checkbox"
                className="size-5 shrink-0 accent-[var(--accent)]"
                checked={on}
                disabled={left}
                onChange={(e) => set({ included: { ...state.included, [m.id]: e.target.checked } })}
              />
              <label htmlFor={`${inputId}-on`} className="min-w-0 flex-1 truncate text-sm">
                {nameOf(allMembers, m.id)}
                {m.isYou && <span className="text-muted"> (you)</span>}
              </label>
              {on && state.method !== "equal" && (
                <>
                  <label htmlFor={inputId} className="sr-only">
                    {`${m.displayName}: ${method.unit}`}
                  </label>
                  <input
                    id={inputId}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={left}
                    value={state.values[m.id] ?? ""}
                    onChange={(e) => set({ values: { ...state.values, [m.id]: e.target.value } })}
                    className="min-h-10 w-24 rounded-lg border border-line bg-surface px-2 text-right text-sm"
                    placeholder={
                      state.method === "exact" ? "0.00" : state.method === "percent" ? "%" : "1"
                    }
                  />
                </>
              )}
              <span
                className="w-24 shrink-0 text-right text-sm tabular-nums text-muted"
                aria-label={`${m.displayName}'s share`}
              >
                {share.has(m.id) ? money(share.get(m.id) ?? 0, currency) : "–"}
              </span>
            </li>
          );
        })}
      </ul>

      <div aria-live="polite" className="min-h-5 text-sm">
        {computed.errors.split !== undefined && computed.total !== null && (
          <p className="text-danger">
            {computed.errors.split}
            {computed.remaining !== null && (
              <span className="text-muted"> ({computed.remaining})</span>
            )}
          </p>
        )}
      </div>
    </fieldset>
  );
}
