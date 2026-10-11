import { overviewSchema } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Session } from "./harness";
import { createGroup, memberIdOf, seedMember } from "./groupHelpers";
import { seedExpense, simpleExpense } from "./seed";

describe("GET /me/overview", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const overviewOf = async (who: Session) =>
    overviewSchema.parse((await h.as(who).get("/me/overview")).json());

  /** A group where `members` (all accounts) are in, with Alice as the owner. */
  async function groupWith(name: string, alice: Session, others: Session[], currency = "INR") {
    const group = await createGroup(h, alice, { name, currency });
    const ids = [await memberIdOf(h, alice, group.id)];
    for (const other of others) {
      ids.push(
        await seedMember(h, {
          groupId: group.id,
          userId: other.userId,
          name: (await h.as(other).get("/me")).json<{ name: string }>().name,
        }),
      );
    }
    return { groupId: group.id, ids };
  }

  it("is empty for someone with no groups", async () => {
    const user = await h.signUp();
    expect(await overviewOf(user)).toEqual({ totals: [], people: [] });
  });

  it("sums what you owe and are owed per currency, and nets each person across groups", async () => {
    const alice = await h.signUp({ name: "Alice" });
    const bob = await h.signUp({ name: "Bob" });
    const dana = await h.signUp({ name: "Dana" });
    const g1 = await groupWith("Flat", alice, [bob, dana]);
    const g2 = await groupWith("Trip", alice, [bob]);
    const g3 = await groupWith("US trip", alice, [dana], "USD");
    const [a1, b1, d1] = g1.ids as [string, string, string];
    const [a2, b2] = g2.ids as [string, string];
    const [a3, d3] = g3.ids as [string, string];

    await seedExpense(h, simpleExpense(g1.groupId, a1, { [b1]: 30000 })); // Bob owes Alice 300 in Flat
    await seedExpense(h, simpleExpense(g1.groupId, d1, { [a1]: 5000 })); // Alice owes Dana 50 in Flat
    await seedExpense(h, simpleExpense(g2.groupId, b2, { [a2]: 12000 })); // Alice owes Bob 120 in Trip
    await seedExpense(h, simpleExpense(g3.groupId, a3, { [d3]: 700 })); // Dana owes Alice 7.00 USD

    const overview = await overviewOf(alice);
    expect(overview.totals).toEqual([
      { currency: "INR", owedToYou: 18000, youOwe: 5000, net: 13000 },
      { currency: "USD", owedToYou: 700, youOwe: 0, net: 700 },
    ]);
    expect(overview.people.map((p) => p.name)).toEqual(["Bob", "Dana"]);
    const [bobEntry, danaEntry] = overview.people;
    // Bob owes Alice 300 in Flat and Alice owes Bob 120 in Trip: Bob owes 180 net.
    expect(bobEntry?.balances).toEqual([{ amountMinor: 18000, currency: "INR" }]);
    expect(bobEntry?.groups).toEqual([
      { groupId: g1.groupId, groupName: "Flat", balance: { amountMinor: 30000, currency: "INR" } },
      { groupId: g2.groupId, groupName: "Trip", balance: { amountMinor: -12000, currency: "INR" } },
    ]);
    // Dana: Alice owes her 50 INR, she owes Alice 7 USD: two currencies, kept apart.
    expect(danaEntry?.balances).toEqual([
      { amountMinor: -5000, currency: "INR" },
      { amountMinor: 700, currency: "USD" },
    ]);

    // Bob sees the mirror image.
    const asBob = await overviewOf(bob);
    expect(asBob.totals).toEqual([{ currency: "INR", owedToYou: 0, youOwe: 18000, net: -18000 }]);
    expect(asBob.people.find((p) => p.name === "Alice")?.balances).toEqual([
      { amountMinor: -18000, currency: "INR" },
    ]);
    expect(asBob.people.map((p) => p.name)).toEqual(["Alice", "Dana"]);
  });

  it("uses who owes whom, not the simplified plan, even when the group simplifies", async () => {
    const alice = await h.signUp({ name: "Alice" });
    const bob = await h.signUp({ name: "Bob" });
    const dana = await h.signUp({ name: "Dana" });
    const g = await groupWith("Chain", alice, [bob, dana]);
    const [a, b, d] = g.ids as [string, string, string];
    await seedExpense(h, simpleExpense(g.groupId, b, { [a]: 10000 })); // Alice owes Bob 100
    await seedExpense(h, simpleExpense(g.groupId, d, { [b]: 10000 })); // Bob owes Dana 100

    // The simplified plan has Alice pay Dana directly (Bob nets to zero)...
    const balances = (await h.as(alice).get(`/groups/${g.groupId}/balances`)).json<{
      simplified: { fromMemberId: string; toMemberId: string }[];
    }>();
    expect(balances.simplified).toEqual([
      expect.objectContaining({ fromMemberId: a, toMemberId: d }),
    ]);
    // ...but Alice's overview says what is true: she owes Bob, and Dana owes her nothing.
    const overview = await overviewOf(alice);
    expect(overview.people.find((p) => p.name === "Bob")?.balances).toEqual([
      { amountMinor: -10000, currency: "INR" },
    ]);
    expect(overview.people.find((p) => p.name === "Dana")?.balances).toEqual([]);
  });

  it("includes archived groups, drops deleted ones, and lists people you owe nothing", async () => {
    const alice = await h.signUp({ name: "Alice" });
    const bob = await h.signUp({ name: "Bob" });
    const dana = await h.signUp({ name: "Dana" });
    const archived = await groupWith("Old trip", alice, [bob]);
    const deleted = await groupWith("Gone", alice, [dana]);
    const [a1, b1] = archived.ids as [string, string];
    await seedExpense(h, simpleExpense(archived.groupId, a1, { [b1]: 4200 }));
    await h.as(alice).post(`/groups/${archived.groupId}/archive`);
    await h.as(alice).delete(`/groups/${deleted.groupId}`);

    const overview = await overviewOf(alice);
    expect(overview.totals).toEqual([{ currency: "INR", owedToYou: 4200, youOwe: 0, net: 4200 }]);
    expect(overview.people.map((p) => [p.name, p.balances])).toEqual([
      ["Bob", [{ amountMinor: 4200, currency: "INR" }]],
    ]);

    // A group where nobody owes anything still lists the people in it, with no balance.
    await groupWith("Fresh", alice, [dana]);
    const fresh = await overviewOf(alice);
    expect(fresh.people.map((p) => [p.name, p.balances.length])).toEqual([
      ["Bob", 1],
      ["Dana", 0],
    ]);
  });

  it("leaves out placeholders, people who left and deleted accounts, and your own entry", async () => {
    const alice = await h.signUp({ name: "Alice" });
    const bob = await h.signUp({ name: "Bob" });
    const g = await groupWith("Mixed", alice, [bob]);
    const [a, b] = g.ids as [string, string];
    const placeholder = await seedMember(h, { groupId: g.groupId, name: "Pat" });
    const left = await seedMember(h, {
      groupId: g.groupId,
      userId: (await h.signUp({ name: "Lee" })).userId,
      name: "Lee",
      leftAt: new Date(),
    });
    await seedExpense(h, simpleExpense(g.groupId, a, { [b]: 1000, [placeholder]: 2000 }));
    void left;

    const overview = await overviewOf(alice);
    expect(overview.people.map((p) => p.name)).toEqual(["Bob"]);
    // The placeholder's debt still counts toward your own totals.
    expect(overview.totals).toEqual([{ currency: "INR", owedToYou: 3000, youOwe: 0, net: 3000 }]);
  });

  it("requires a session", async () => {
    expect((await h.as(null).get("/me/overview")).statusCode).toBe(401);
  });
});
