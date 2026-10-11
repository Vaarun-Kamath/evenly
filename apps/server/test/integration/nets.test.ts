import {
  allocate,
  computeNets,
  computeSplit,
  type ExpenseEntry,
  type SettlementEntry,
} from "@evenly/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { netsForGroup, netsForMembers } from "../../src/modules/balances/nets";
import { startHarness, type Harness } from "./harness";
import { createGroup, memberIdOf, seedMember } from "./groupHelpers";
import { seedExpense, seedSettlement } from "./seed";

/** A small deterministic random generator, so a failure can be reproduced. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The SQL balance query is a second implementation of the rule in @evenly/core (ARCHITECTURE.md section
 * 5.3). This keeps the two from drifting apart: same data in, same nets out.
 */
describe("net balances in SQL agree with @evenly/core", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  async function scenario(seed: number) {
    const random = mulberry32(seed);
    const pick = (n: number) => Math.floor(random() * n);
    const owner = await h.signUp();
    const group = await createGroup(h, owner, { name: `Scenario ${String(seed)}` });
    const ids: string[] = [await memberIdOf(h, owner, group.id)];
    const extra = 1 + pick(4);
    for (let i = 0; i < extra; i += 1) {
      ids.push(await seedMember(h, { groupId: group.id, name: `Person ${String(i)}` }));
    }

    const live: ExpenseEntry[] = [];
    const liveSettlements: SettlementEntry[] = [];
    for (let i = 0; i < 1 + pick(6); i += 1) {
      const total = 100 + pick(1_000_000);
      const payers = ids.filter(() => random() < 0.4);
      if (payers.length === 0) payers.push(ids[pick(ids.length)]!);
      const paid = allocate(
        total,
        payers.map(() => 1 + pick(5)),
      );
      const participants = ids.filter(() => random() < 0.7);
      if (participants.length === 0) participants.push(ids[0]!);
      const shares = computeSplit(
        total,
        { method: "equal", entries: participants.map((memberId) => ({ memberId })) },
        ids,
      );
      const deleted = random() < 0.25;
      const payerAmounts = Object.fromEntries(
        payers.map((id, index) => [id, paid[index] ?? 0]),
      ) as Record<string, number>;
      const shareAmounts = Object.fromEntries(
        shares.map((s) => [s.memberId, s.amountMinor]),
      ) as Record<string, number>;
      // A payer with 0 would violate the payer constraint; keep only positive payments.
      const positive = Object.fromEntries(
        Object.entries(payerAmounts).filter(([, amount]) => amount > 0),
      );
      const adjusted = total - Object.values(positive).reduce((sum, amount) => sum + amount, 0);
      if (adjusted !== 0) {
        const first = Object.keys(positive)[0] ?? ids[0]!;
        positive[first] = (positive[first] ?? 0) + adjusted;
      }
      await seedExpense(h, {
        groupId: group.id,
        createdBy: ids[0]!,
        amountMinor: total,
        payers: positive,
        shares: shareAmounts,
        deleted,
      });
      if (!deleted) {
        live.push({
          payers: Object.entries(positive).map(([memberId, amountMinor]) => ({
            memberId,
            amountMinor,
          })),
          shares: shares.map(({ memberId, amountMinor }) => ({ memberId, amountMinor })),
        });
      }
    }
    for (let i = 0; i < pick(4); i += 1) {
      const from = ids[pick(ids.length)]!;
      const to = ids[(ids.indexOf(from) + 1 + pick(ids.length - 1)) % ids.length]!;
      const amountMinor = 1 + pick(50_000);
      const deleted = random() < 0.25;
      await seedSettlement(h, {
        groupId: group.id,
        createdBy: ids[0]!,
        from,
        to,
        amountMinor,
        deleted,
      });
      if (!deleted) liveSettlements.push({ fromMemberId: from, toMemberId: to, amountMinor });
    }
    return { groupId: group.id, ids, live, liveSettlements };
  }

  it("for random groups of expenses and settlements, some soft-deleted", async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { groupId, ids, live, liveSettlements } = await scenario(seed);
      const expected = new Map(
        computeNets(ids, live, liveSettlements).map((n) => [n.memberId, n.netMinor]),
      );
      const actual = await netsForGroup(h.db.orm, groupId);
      expect([...actual.entries()].sort(), `seed ${String(seed)}`).toEqual(
        [...expected.entries()].sort(),
      );
      expect([...actual.values()].reduce((a, b) => a + b, 0)).toBe(0);

      const some = await netsForMembers(h.db.orm, [ids[0]!, ids.at(-1)!]);
      expect(some.get(ids[0]!)).toBe(expected.get(ids[0]!));
      expect(some.get(ids.at(-1)!)).toBe(expected.get(ids.at(-1)!));
    }
  });

  it("is empty for no members, and zero for a group with nothing in it", async () => {
    expect((await netsForMembers(h.db.orm, [])).size).toBe(0);
    const owner = await h.signUp();
    const group = await createGroup(h, owner);
    expect([...(await netsForGroup(h.db.orm, group.id)).values()]).toEqual([0]);
  });
});
