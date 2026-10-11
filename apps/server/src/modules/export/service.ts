import { once } from "node:events";
import { PassThrough, type Readable } from "node:stream";
import { exponentOf, unitsToDecimalString } from "@evenly/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { expenses, settlements } from "../../db/schema";
import { netsForGroup } from "../balances/nets";
import { requireMember } from "../common/access";
import type { Actor, DbOrTx } from "../common/db";
import { toExpenses } from "../expenses/service";
import { loadMembers } from "../ledger/loader";
import { BOM, csvNumber, csvRow, csvText } from "./csv";

const PAGE_SIZE = 500;

export interface CsvExport {
  filename: string;
  stream: Readable;
}

function filenameFor(groupName: string): string {
  const slug = groupName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug === "" ? "group" : slug}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Any member: every live expense and settlement of the group as CSV, with each member's share and net
 * effect on their balance, followed by the balances (SPEC section 4.8). The net-effect columns add up
 * to exactly the balances below them, so totals can be checked in a spreadsheet.
 *
 * Streamed: rows are read in pages of 500 inside one read-only snapshot transaction, so memory stays
 * flat for big groups and the rows and the balances always agree, even if someone edits meanwhile.
 */
export async function exportGroupCsv(orm: Orm, actor: Actor, groupId: string): Promise<CsvExport> {
  const { group } = await requireMember(orm, groupId, actor.userId);
  const out = new PassThrough();
  let closed = false;
  out.once("close", () => {
    closed = true;
  });

  const write = async (chunk: string) => {
    if (closed) throw new Error("The client went away");
    if (!out.write(chunk)) {
      await Promise.race([once(out, "drain"), once(out, "close")]);
    }
  };

  void orm
    .transaction(
      async (tx) => {
        await generate(tx, group.id, group.currency, write);
        out.end();
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    )
    .catch((error: unknown) =>
      out.destroy(error instanceof Error ? error : new Error(String(error))),
    );

  return { filename: filenameFor(group.name), stream: out };
}

async function generate(
  tx: DbOrTx,
  groupId: string,
  currency: string,
  write: (chunk: string) => Promise<void>,
): Promise<void> {
  const exponent = exponentOf(currency);
  const decimal = (amountMinor: number) => csvNumber(unitsToDecimalString(amountMinor, exponent));
  const members = await loadMembers(tx, groupId);
  const nameOf = new Map(
    members.map((m) => [m.id, m.leftAt === null ? m.displayName : `${m.displayName} (left)`]),
  );
  const name = (id: string) => nameOf.get(id) ?? "Unknown";

  await write(
    BOM +
      csvRow([
        csvText("Type"),
        csvText("Date"),
        csvText("Description"),
        csvText("Category"),
        csvText("Amount"),
        csvText("Currency"),
        csvText("Paid by"),
        csvText("Split"),
        csvText("Notes"),
        ...members.map((m) => csvText(`Share - ${name(m.id)}`)),
        ...members.map((m) => csvText(`Net effect - ${name(m.id)}`)),
      ]),
  );

  // Expenses, oldest first, a page at a time.
  let after: { date: string; id: string } | undefined;
  for (;;) {
    const rows = await tx
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          isNull(expenses.deletedAt),
          after === undefined
            ? undefined
            : sql`(${expenses.expenseDate}, ${expenses.id}) > (${after.date}::date, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(expenses.expenseDate), asc(expenses.id))
      .limit(PAGE_SIZE);
    for (const expense of await toExpenses(tx, rows)) {
      const paid = new Map(expense.payers.map((p) => [p.memberId, p.amountMinor]));
      const owed = new Map(expense.shares.map((s) => [s.memberId, s.amountMinor]));
      await write(
        csvRow([
          csvText("Expense"),
          csvText(expense.expenseDate),
          csvText(expense.description),
          csvText(expense.category),
          decimal(expense.amount.amountMinor),
          csvText(currency),
          csvText(
            expense.payers
              .map((p) => `${name(p.memberId)}: ${unitsToDecimalString(p.amountMinor, exponent)}`)
              .join("; "),
          ),
          csvText(expense.splitMethod),
          csvText(expense.notes ?? ""),
          ...members.map((m) => (owed.has(m.id) ? decimal(owed.get(m.id) ?? 0) : "")),
          ...members.map((m) => {
            const net = (paid.get(m.id) ?? 0) - (owed.get(m.id) ?? 0);
            return net === 0 ? "" : decimal(net);
          }),
        ]),
      );
    }
    const last = rows.at(-1);
    if (last === undefined || rows.length < PAGE_SIZE) break;
    after = { date: last.expenseDate, id: last.id };
  }

  // Settlements, oldest first, a page at a time.
  let afterSettlement: { date: string; id: string } | undefined;
  for (;;) {
    const rows = await tx
      .select()
      .from(settlements)
      .where(
        and(
          eq(settlements.groupId, groupId),
          isNull(settlements.deletedAt),
          afterSettlement === undefined
            ? undefined
            : sql`(${settlements.settledOn}, ${settlements.id}) > (${afterSettlement.date}::date, ${afterSettlement.id}::uuid)`,
        ),
      )
      .orderBy(asc(settlements.settledOn), asc(settlements.id))
      .limit(PAGE_SIZE);
    for (const s of rows) {
      await write(
        csvRow([
          csvText("Settlement"),
          csvText(s.settledOn),
          csvText(`${name(s.fromMemberId)} paid ${name(s.toMemberId)}`),
          "",
          decimal(s.amountMinor),
          csvText(currency),
          csvText(name(s.fromMemberId)),
          "",
          csvText(s.note ?? ""),
          ...members.map(() => ""),
          ...members.map((m) =>
            m.id === s.fromMemberId
              ? decimal(s.amountMinor)
              : m.id === s.toMemberId
                ? decimal(-s.amountMinor)
                : "",
          ),
        ]),
      );
    }
    const last = rows.at(-1);
    if (last === undefined || rows.length < PAGE_SIZE) break;
    afterSettlement = { date: last.settledOn, id: last.id };
  }

  // Balances, from the same snapshot.
  const nets = await netsForGroup(tx, groupId);
  await write(csvRow([]));
  await write(csvRow([csvText("Balances")]));
  await write(csvRow([csvText("Member"), csvText("Net balance"), csvText("Currency")]));
  let total = 0;
  for (const m of members) {
    const net = nets.get(m.id) ?? 0;
    if (m.leftAt !== null && net === 0) continue;
    total += net;
    await write(csvRow([csvText(name(m.id)), decimal(net), csvText(currency)]));
  }
  await write(csvRow([csvText("Total"), decimal(total), csvText(currency)]));
}
