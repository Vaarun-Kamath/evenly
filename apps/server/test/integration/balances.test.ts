import { balancesSchema } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { netsForGroup } from "../../src/modules/balances/nets";
import { startHarness, type Harness } from "./harness";
import { addExpense, addSettlement, balancesOf, expenseBody, startTrip, type Trip } from "./trip";

describe("GET /groups/:gid/balances", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  /** Dinner 1,000.00 paid by Alice for three, then Cab 600.00 paid by Bob, shares 1:1:2 (SPEC scenarios 2 and 3). */
  async function dinnerAndCab(g: Trip) {
    await addExpense(h, g.alice, g, { description: "Dinner" });
    await addExpense(h, g.bob, g, {
      description: "Cab",
      amountMinor: 60000,
      payers: [{ memberId: g.bId, amountMinor: 60000 }],
      split: {
        method: "shares",
        entries: [
          { memberId: g.aId, value: "1" },
          { memberId: g.bId, value: "1" },
          { memberId: g.cId, value: "2" },
        ],
      },
    });
  }

  it("is all zeros for a group with nothing in it", async () => {
    const g = await startTrip(h);
    const balances = balancesSchema.parse(await balancesOf(h, g.alice, g.groupId));
    expect(balances.nets.map((n) => n.net.amountMinor)).toEqual([0, 0, 0]);
    expect(balances.nets.map((n) => n.memberId)).toEqual([g.aId, g.bId, g.cId]);
    expect(balances).toMatchObject({
      simplified: [],
      pairwise: [],
      suggested: [],
      simplifyDebts: true,
    });
  });

  it("gives nets, a simplified plan of at most two payments, and pairwise debts", async () => {
    const g = await startTrip(h);
    await dinnerAndCab(g);
    const balances = balancesSchema.parse(await balancesOf(h, g.bob, g.groupId));

    expect(balances.nets.map((n) => n.net.amountMinor)).toEqual([51666, 11667, -63333]);
    expect(balances.nets.every((n) => n.net.currency === "INR")).toBe(true);
    expect(balances.nets.reduce((sum, n) => sum + n.net.amountMinor, 0)).toBe(0);

    expect(balances.simplified).toEqual([
      { fromMemberId: g.cId, toMemberId: g.aId, amount: { amountMinor: 51666, currency: "INR" } },
      { fromMemberId: g.cId, toMemberId: g.bId, amount: { amountMinor: 11667, currency: "INR" } },
    ]);
    expect(balances.pairwise).toEqual([
      { debtorId: g.bId, creditorId: g.aId, amount: { amountMinor: 18333, currency: "INR" } },
      { debtorId: g.cId, creditorId: g.aId, amount: { amountMinor: 33333, currency: "INR" } },
      { debtorId: g.cId, creditorId: g.bId, amount: { amountMinor: 30000, currency: "INR" } },
    ]);
    // The group simplifies debts, so the settle-up suggestions are the simplified plan.
    expect(balances.suggested).toEqual(balances.simplified);
  });

  it("suggests the pairwise debts when the group does not simplify", async () => {
    const g = await startTrip(h, { simplifyDebts: false });
    await dinnerAndCab(g);
    const balances = await balancesOf(h, g.alice, g.groupId);
    expect(balances.simplifyDebts).toBe(false);
    expect(balances.suggested).toEqual(
      balances.pairwise.map((d) => ({
        fromMemberId: d.debtorId,
        toMemberId: d.creditorId,
        amount: d.amount,
      })),
    );
    expect(balances.suggested).toHaveLength(3);

    // Switching the setting changes the suggestion, not the debts.
    await h.as(g.alice).patch(`/groups/${g.groupId}`, { simplifyDebts: true });
    const switched = await balancesOf(h, g.alice, g.groupId);
    expect(switched.suggested).toEqual(switched.simplified);
    expect(switched.pairwise).toEqual(balances.pairwise);
  });

  it("settles to exactly zero when the suggested payments are recorded", async () => {
    for (const simplifyDebts of [true, false]) {
      const g = await startTrip(h, { simplifyDebts });
      await dinnerAndCab(g);
      for (const payment of (await balancesOf(h, g.alice, g.groupId)).suggested) {
        await addSettlement(
          h,
          g.alice,
          g,
          payment.fromMemberId,
          payment.toMemberId,
          payment.amount.amountMinor,
        );
      }
      const after = await balancesOf(h, g.alice, g.groupId);
      expect(after.nets.every((n) => n.net.amountMinor === 0)).toBe(true);
      expect(after.suggested).toEqual([]);
      expect(after.simplified).toEqual([]);
      // The pairwise view is the real debt graph. Settling a plan that skips people (the simplified one)
      // leaves offsetting leftovers in it; settling the pairwise debts themselves clears it.
      if (!simplifyDebts) expect(after.pairwise).toEqual([]);
    }
  });

  it("ignores deleted expenses and settlements", async () => {
    const g = await startTrip(h);
    const dinner = await addExpense(h, g.alice, g, { amountMinor: 30000 });
    const payment = await addSettlement(h, g.bob, g, g.bId, g.aId, 10000);
    await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${dinner.id}`);
    expect((await balancesOf(h, g.alice, g.groupId)).nets.map((n) => n.net.amountMinor)).toEqual([
      -10000, 10000, 0,
    ]);
    await h.as(g.alice).delete(`/groups/${g.groupId}/settlements/${payment.id}`);
    expect((await balancesOf(h, g.alice, g.groupId)).nets.map((n) => n.net.amountMinor)).toEqual([
      0, 0, 0,
    ]);
  });

  it("agrees with the SQL balances for a busy group, whatever the split methods", async () => {
    const g = await startTrip(h);
    const members = [g.aId, g.bId, g.cId];
    const methods = [
      () => ({
        method: "equal" as const,
        entries: members.map((memberId) => ({ memberId })),
      }),
      () => ({
        method: "percent" as const,
        entries: [
          { memberId: g.aId, value: "33.33" },
          { memberId: g.bId, value: "33.33" },
          { memberId: g.cId, value: "33.34" },
        ],
      }),
      () => ({
        method: "shares" as const,
        entries: [
          { memberId: g.aId, value: "1.5" },
          { memberId: g.bId, value: "2.25" },
          { memberId: g.cId, value: "1" },
        ],
      }),
      (amount: number) => ({
        method: "exact" as const,
        entries: [
          { memberId: g.aId, value: String(amount - 2) },
          { memberId: g.bId, value: "1" },
          { memberId: g.cId, value: "1" },
        ],
      }),
    ];
    for (let i = 0; i < 24; i += 1) {
      const amountMinor = 1000 + i * 977;
      const payer = members[i % 3]!;
      const who = payer === g.bId ? g.bob : g.alice;
      await addExpense(h, who, g, {
        amountMinor,
        payers: [{ memberId: payer, amountMinor }],
        split: methods[i % 4]!(amountMinor),
      });
    }
    await addSettlement(h, g.alice, g, g.cId, g.aId, 1234);

    const api = await balancesOf(h, g.alice, g.groupId);
    const sql = await netsForGroup(h.db.orm, g.groupId);
    expect(Object.fromEntries(api.nets.map((n) => [n.memberId, n.net.amountMinor]))).toEqual(
      Object.fromEntries(sql),
    );
    expect(api.nets.reduce((sum, n) => sum + n.net.amountMinor, 0)).toBe(0);
    // Every payment of the plan goes from someone who owes to someone who is owed.
    const net = new Map(api.nets.map((n) => [n.memberId, n.net.amountMinor]));
    for (const p of api.simplified) {
      expect(net.get(p.fromMemberId)!).toBeLessThan(0);
      expect(net.get(p.toMemberId)!).toBeGreaterThan(0);
    }
    // Pairwise debts reproduce each member's net.
    for (const [memberId, value] of net) {
      const owed = api.pairwise
        .filter((d) => d.creditorId === memberId)
        .reduce((s, d) => s + d.amount.amountMinor, 0);
      const owes = api.pairwise
        .filter((d) => d.debtorId === memberId)
        .reduce((s, d) => s + d.amount.amountMinor, 0);
      expect(owed - owes).toBe(value);
    }
  });

  it("works in a currency with no minor unit, and one with three", async () => {
    for (const [currency, amountMinor] of [
      ["JPY", 1001],
      ["KWD", 1001],
    ] as const) {
      const g = await startTrip(h, { currency });
      await addExpense(h, g.alice, g, { currency, amountMinor });
      const nets = (await balancesOf(h, g.alice, g.groupId)).nets.map((n) => n.net.amountMinor);
      expect(nets).toEqual([667, -334, -333]); // 1001 / 3: the odd unit goes to Alice
      void expenseBody;
    }
  });
});
