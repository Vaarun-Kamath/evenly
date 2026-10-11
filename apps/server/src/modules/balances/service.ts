import type { Balances, Overview } from "@evenly/contracts";
import { computeNets, pairwise, simplify } from "@evenly/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { groupMembers, groups } from "../../db/schema";
import { requireMember } from "../common/access";
import type { Actor } from "../common/db";
import { loadLedger } from "../ledger/loader";

/**
 * Net balances, the simplified plan and the pairwise debts of a group (ARCHITECTURE.md sections 5.3 to
 * 5.5), all computed by @evenly/core from the live expenses and settlements. `suggested` is what the
 * settle-up screen offers: the simplified plan when the group simplifies debts, otherwise the pairwise
 * list (ADR-0004).
 */
export async function getBalances(orm: Orm, actor: Actor, groupId: string): Promise<Balances> {
  const { group } = await requireMember(orm, groupId, actor.userId);
  const ledger = await loadLedger(orm, groupId);
  const money = (amountMinor: number) => ({ amountMinor, currency: group.currency });

  const nets = computeNets(ledger.memberOrder, ledger.expenses, ledger.settlements);
  const simplified = simplify(nets).map((transfer) => ({
    fromMemberId: transfer.fromMemberId,
    toMemberId: transfer.toMemberId,
    amount: money(transfer.amountMinor),
  }));
  const debts = pairwise(ledger.memberOrder, ledger.expenses, ledger.settlements).map((debt) => ({
    debtorId: debt.debtorId,
    creditorId: debt.creditorId,
    amount: money(debt.amountMinor),
  }));
  return {
    nets: nets.map((net) => ({ memberId: net.memberId, net: money(net.netMinor) })),
    simplified,
    pairwise: debts,
    simplifyDebts: group.simplifyDebts,
    suggested: group.simplifyDebts
      ? simplified
      : debts.map((debt) => ({
          fromMemberId: debt.debtorId,
          toMemberId: debt.creditorId,
          amount: debt.amount,
        })),
  };
}

/**
 * Totals across all of the caller's groups, and a combined balance with each person they share a group
 * with (SPEC section 4.6). Per-person balances always use the pairwise method (ADR-0004): a simplified plan
 * can route a debt through a third person, which would hide who actually owes whom. Only people with an
 * account count; placeholders and deleted users are not the same person in two groups.
 */
export async function getOverview(orm: Orm, actor: Actor): Promise<Overview> {
  const mine = await orm
    .select({ group: groups, member: groupMembers })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, actor.userId),
        isNull(groupMembers.leftAt),
        isNull(groups.deletedAt),
      ),
    )
    .orderBy(asc(groups.name), asc(groups.id));

  // What each counterparty owes you (negative: you owe them), per currency. A real person is one
  // counterparty across all groups; a placeholder or deleted user is one per group.
  const counterparties = new Map<string, { currency: string; amountMinor: number }>();
  const currencies = new Set<string>();
  interface Person {
    name: string;
    balances: Map<string, number>;
    groups: { groupId: string; groupName: string; currency: string; amountMinor: number }[];
  }
  const people = new Map<string, Person>();
  const newPerson = (name: string): Person => ({ name, balances: new Map(), groups: [] });

  for (const { group, member } of mine) {
    const ledger = await loadLedger(orm, group.id);
    currencies.add(group.currency);

    // Everyone with an account who is still in the group, even at a zero balance.
    for (const other of ledger.members) {
      if (other.userId === null || other.userId === actor.userId || other.leftAt !== null) continue;
      if (!people.has(other.userId)) {
        people.set(other.userId, newPerson(other.displayName));
      }
    }
    const byMember = new Map(ledger.members.map((m) => [m.id, m]));
    for (const debt of pairwise(ledger.memberOrder, ledger.expenses, ledger.settlements)) {
      const theyOweMe = debt.creditorId === member.id;
      if (!theyOweMe && debt.debtorId !== member.id) continue;
      const other = byMember.get(theyOweMe ? debt.debtorId : debt.creditorId);
      if (other === undefined) continue;
      const amountMinor = theyOweMe ? debt.amountMinor : -debt.amountMinor;
      const key = `${group.currency}|${other.userId ?? `member:${other.id}`}`;
      const counterparty = counterparties.get(key) ?? { currency: group.currency, amountMinor: 0 };
      counterparties.set(key, {
        ...counterparty,
        amountMinor: counterparty.amountMinor + amountMinor,
      });
      if (other.userId === null) continue;
      const person = people.get(other.userId) ?? newPerson(other.displayName);
      people.set(other.userId, person);
      person.balances.set(group.currency, (person.balances.get(group.currency) ?? 0) + amountMinor);
      person.groups.push({
        groupId: group.id,
        groupName: group.name,
        currency: group.currency,
        amountMinor,
      });
    }
  }

  const totals = [...currencies].sort().map((currency) => {
    const amounts = [...counterparties.values()]
      .filter((entry) => entry.currency === currency)
      .map((entry) => entry.amountMinor);
    const owedToYou = amounts.filter((a) => a > 0).reduce((sum, a) => sum + a, 0);
    const youOwe = amounts.filter((a) => a < 0).reduce((sum, a) => sum - a, 0);
    return { currency, owedToYou, youOwe, net: owedToYou - youOwe };
  });

  return {
    totals,
    people: [...people.entries()]
      .sort(([idA, a], [idB, b]) => a.name.localeCompare(b.name) || idA.localeCompare(idB))
      .map(([userId, person]) => ({
        userId,
        name: person.name,
        balances: [...person.balances.entries()]
          .filter(([, amountMinor]) => amountMinor !== 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, amountMinor]) => ({ amountMinor, currency })),
        groups: person.groups
          .filter((entry) => entry.amountMinor !== 0)
          .map((entry) => ({
            groupId: entry.groupId,
            groupName: entry.groupName,
            balance: { amountMinor: entry.amountMinor, currency: entry.currency },
          })),
      })),
  };
}
