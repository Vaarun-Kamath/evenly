import { newId } from "../../src/db/ids";
import type { Harness } from "./harness";

/**
 * Expenses and settlements are created through the API from M4 on; until then the tests write them
 * straight to the database, which is also how the balance queries are checked against @evenly/core.
 */
export async function seedExpense(
  h: Harness,
  options: {
    groupId: string;
    createdBy: string;
    amountMinor: number;
    payers: Record<string, number>;
    shares: Record<string, number>;
    deleted?: boolean;
  },
): Promise<string> {
  const id = newId();
  await h.db.sql.begin(async (tx) => {
    await tx`insert into expenses (id, group_id, description, amount_minor, currency, expense_date, split_method, created_by, deleted_at)
             values (${id}, ${options.groupId}, 'Seeded expense', ${options.amountMinor}, 'INR', '2026-10-10', 'exact', ${options.createdBy},
                     ${options.deleted === true ? new Date().toISOString() : null}::timestamptz)`;
    for (const [memberId, amount] of Object.entries(options.payers)) {
      await tx`insert into expense_payers (expense_id, member_id, amount_minor) values (${id}, ${memberId}, ${amount})`;
    }
    for (const [memberId, amount] of Object.entries(options.shares)) {
      await tx`insert into expense_shares (expense_id, member_id, amount_minor) values (${id}, ${memberId}, ${amount})`;
    }
  });
  return id;
}

export async function seedSettlement(
  h: Harness,
  options: {
    groupId: string;
    createdBy: string;
    from: string;
    to: string;
    amountMinor: number;
    deleted?: boolean;
  },
): Promise<string> {
  const id = newId();
  await h.db
    .sql`insert into settlements (id, group_id, from_member_id, to_member_id, amount_minor, currency, settled_on, created_by, deleted_at)
                 values (${id}, ${options.groupId}, ${options.from}, ${options.to}, ${options.amountMinor}, 'INR', '2026-10-10', ${options.createdBy},
                         ${options.deleted === true ? new Date().toISOString() : null}::timestamptz)`;
  return id;
}

/** An expense paid by `payer` and split exactly as `shares` says: leaves `payer` owed the rest. */
export function simpleExpense(
  groupId: string,
  payer: string,
  shares: Record<string, number>,
): Parameters<typeof seedExpense>[1] {
  const amountMinor = Object.values(shares).reduce((sum, amount) => sum + amount, 0);
  return { groupId, createdBy: payer, amountMinor, payers: { [payer]: amountMinor }, shares };
}
