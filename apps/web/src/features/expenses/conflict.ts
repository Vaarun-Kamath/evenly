import type { Expense, Member, UpdateExpenseRequest } from "@evenly/contracts";
import { formatDate, money } from "../../lib/format";
import { nameOf } from "../../lib/hooks";

export interface Difference {
  label: string;
  theirs: string;
  mine: string;
}

const METHOD_LABEL: Record<string, string> = {
  equal: "Equally",
  exact: "Exact amounts",
  percent: "Percentages",
  shares: "Shares",
};

function paidBy(
  payers: readonly { memberId: string; amountMinor: number }[],
  members: readonly Member[],
  currency: string,
) {
  return payers
    .map((p) => `${nameOf(members, p.memberId)} ${money(p.amountMinor, currency)}`)
    .join(", ");
}

/**
 * What differs between the expense as it is now (changed by someone else) and what the person was about to
 * save, in words, for the conflict dialog. The shares themselves are not compared: the split method and the
 * amount say enough, and the person can open the latest version to see the rest.
 */
export function differences(
  current: Expense,
  mine: UpdateExpenseRequest,
  members: readonly Member[],
): Difference[] {
  const currency = current.amount.currency;
  const rows: Difference[] = [
    { label: "Description", theirs: current.description, mine: mine.description },
    {
      label: "Amount",
      theirs: money(current.amount.amountMinor, currency),
      mine: money(mine.amountMinor, currency),
    },
    { label: "Date", theirs: formatDate(current.expenseDate), mine: formatDate(mine.expenseDate) },
    { label: "Category", theirs: current.category, mine: mine.category },
    { label: "Notes", theirs: current.notes ?? "none", mine: mine.notes ?? "none" },
    {
      label: "Paid by",
      theirs: paidBy(current.payers, members, currency),
      mine: paidBy(mine.payers, members, currency),
    },
    {
      label: "Split",
      theirs: METHOD_LABEL[current.splitMethod] ?? current.splitMethod,
      mine: METHOD_LABEL[mine.split.method] ?? mine.split.method,
    },
  ];
  return rows.filter((row) => row.theirs !== row.mine);
}
