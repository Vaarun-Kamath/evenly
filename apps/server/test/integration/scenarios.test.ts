import type {
  AcceptInviteResponse,
  Balances,
  CreatedInvite,
  Expense,
  Member,
  Problem,
} from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Session } from "./harness";
import { activityKinds } from "./groupHelpers";
import { parseCsv, toMinor, stripBom } from "./csv";
import { expenseBody, settlementBody, type Trip } from "./trip";

/**
 * SPEC.md section 7: the acceptance scenarios, played through the HTTP API in order, as one story.
 * The browser side of scenarios 1 and 5 is covered by Playwright in M5; the rest is complete here.
 */
describe("SPEC scenarios, at the API level", () => {
  let h: Harness;
  let a: Session; // A, the creator
  let b: Session; // B, joins by invite link
  let groupId: string;
  let aId: string;
  let bId: string;
  let cId: string; // C, a placeholder added by A
  let trip: Trip;
  let dinner: Expense;

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const nets = async (who = a) => {
    const balances = (await h.as(who).get(`/groups/${groupId}/balances`)).json<Balances>();
    return {
      balances,
      byMember: Object.fromEntries(balances.nets.map((n) => [n.memberId, n.net.amountMinor])),
    };
  };

  it("1. A creates Goa Trip (INR), invites B with a link, and B signs up through it and lands in the group", async () => {
    a = await h.signUp({ name: "A" });
    const group = (await h.as(a).post("/groups", { name: "Goa Trip", currency: "INR" })).json<{
      id: string;
    }>();
    groupId = group.id;
    const invite = (await h.as(a).post(`/groups/${groupId}/invites`, {})).json<CreatedInvite>();

    // B's browser: preview the link, sign up, accept.
    const token = invite.url.split("/invite/")[1]!;
    expect(
      (await h.request({ url: `/api/v1/invites/${token}`, remoteAddress: "10.77.0.1" })).statusCode,
    ).toBe(200);
    b = await h.signUp({ name: "B" });
    const accepted = (await h.as(b).post(`/invites/${token}/accept`)).json<AcceptInviteResponse>();
    expect(accepted.groupId).toBe(groupId);

    const members = (await h.as(b).get(`/groups/${groupId}/members`)).json<Member[]>();
    expect(members.map((m) => m.displayName)).toEqual(["A", "B"]);
    aId = members[0]!.id;
    bId = members[1]!.id;
  });

  it("2. A adds placeholder C, then Dinner 1,000.00 paid by A and split equally: 333.34 / 333.33 / 333.33", async () => {
    const c = (
      await h.as(a).post(`/groups/${groupId}/members`, { displayName: "C" })
    ).json<Member>();
    cId = c.id;
    trip = { groupId, alice: a, bob: b, aId, bId, cId };

    const response = await h
      .as(a)
      .post(`/groups/${groupId}/expenses`, expenseBody(trip, { description: "Dinner" }));
    expect(response.statusCode).toBe(201);
    dinner = response.json<Expense>();
    expect(dinner.shares.map((s) => s.amountMinor)).toEqual([33334, 33333, 33333]);

    const { byMember } = await nets();
    expect(byMember).toEqual({ [aId]: 66666, [bId]: -33333, [cId]: -33333 });
  });

  it("3. B adds Cab 600.00 paid by B, split by shares A:1 B:1 C:2; the balances update and still sum to 0", async () => {
    const response = await h.as(b).post(
      `/groups/${groupId}/expenses`,
      expenseBody(trip, {
        description: "Cab",
        amountMinor: 60000,
        payers: [{ memberId: bId, amountMinor: 60000 }],
        split: {
          method: "shares",
          entries: [
            { memberId: aId, value: "1" },
            { memberId: bId, value: "1" },
            { memberId: cId, value: "2" },
          ],
        },
      }),
    );
    expect(response.statusCode).toBe(201);
    const { byMember } = await nets();
    expect(byMember).toEqual({ [aId]: 51666, [bId]: 11667, [cId]: -63333 });
    expect(Object.values(byMember).reduce((x, y) => x + y, 0)).toBe(0);
  });

  it("4. with simplify debts on, the settle-up plan has at most 2 payments and settles everyone to exactly 0", async () => {
    const { balances } = await nets();
    expect(balances.simplifyDebts).toBe(true);
    expect(balances.suggested.length).toBeLessThanOrEqual(2);
    // Applying the plan to the nets leaves every balance at exactly zero.
    const after = Object.fromEntries(balances.nets.map((n) => [n.memberId, n.net.amountMinor]));
    for (const p of balances.suggested) {
      after[p.fromMemberId] = (after[p.fromMemberId] ?? 0) + p.amount.amountMinor;
      after[p.toMemberId] = (after[p.toMemberId] ?? 0) - p.amount.amountMinor;
    }
    expect(Object.values(after)).toEqual([0, 0, 0]);
  });

  it("8. leaving the group with a non-zero balance is refused, with an explanation", async () => {
    const response = await h.as(b).delete(`/groups/${groupId}/members/${bId}`);
    expect(response.statusCode).toBe(409);
    const problem = response.json<Problem>();
    expect(problem.type).toBe("urn:evenly:problem:non-zero-balance");
    expect(problem.detail).toContain("116.67");
    expect(problem.detail).toContain("Settle up");
  });

  it("7. two users edit the same expense at once: the second save gets a conflict and sees the latest version", async () => {
    const edit = (who: Session, description: string) =>
      h.as(who).patch(`/groups/${groupId}/expenses/${dinner.id}`, {
        ...expenseBody(trip),
        id: undefined,
        version: dinner.version,
        description,
        amountMinor: 100000,
      });
    const results = await Promise.all([edit(a, "Dinner (A)"), edit(b, "Dinner (B)")]);
    const winner = results.find((r) => r.statusCode === 200);
    const loser = results.find((r) => r.statusCode === 409);
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    const conflict = loser!.json<Problem & { current: Expense }>();
    expect(conflict.type).toBe("urn:evenly:problem:version-conflict");
    expect(conflict.current.description).toBe(winner!.json<Expense>().description);
    expect(conflict.current.version).toBe(2);
    // Put the description back so the later checks read naturally.
    await h.as(a).patch(`/groups/${groupId}/expenses/${dinner.id}`, {
      ...expenseBody(trip),
      id: undefined,
      version: 2,
      description: "Dinner",
      amountMinor: 100000,
    });
  });

  it("6. B records the suggested settlement: B's balance becomes 0 and the activity feed shows it", async () => {
    const { balances } = await nets();
    const suggestion = balances.suggested.find((p) => p.toMemberId === bId);
    expect(suggestion).toMatchObject({
      fromMemberId: cId,
      toMemberId: bId,
      amount: { amountMinor: 11667 },
    });
    const response = await h
      .as(b)
      .post(
        `/groups/${groupId}/settlements`,
        settlementBody(
          suggestion!.fromMemberId,
          suggestion!.toMemberId,
          suggestion!.amount.amountMinor,
        ),
      );
    expect(response.statusCode).toBe(201);
    expect((await nets()).byMember[bId]).toBe(0);
    expect(await activityKinds(h, b, groupId)).toContain("settlement.created");
    const feed = (await h.as(b).get(`/groups/${groupId}/activity`)).json<{
      items: { kind: string; actor: { displayName: string } | null }[];
    }>();
    expect(feed.items[0]).toMatchObject({
      kind: "settlement.created",
      actor: { displayName: "B" },
    });
  });

  it("5. C accepts a claim invite: the placeholder becomes a real account with the same history", async () => {
    const before = (await nets()).byMember[cId];
    const claim = (
      await h.as(a).post(`/groups/${groupId}/invites`, { claimMemberId: cId })
    ).json<CreatedInvite>();
    const c = await h.signUp({ name: "C (real)" });
    const accepted = await h.as(c).post(`/invites/${claim.url.split("/invite/")[1]!}/accept`);
    expect(accepted.json<AcceptInviteResponse>()).toMatchObject({ memberId: cId, claimed: true });
    // Same member id, same balance, same expenses; and C can now see it all.
    expect((await nets(c)).byMember[cId]).toBe(before);
    const list = (await h.as(c).get(`/groups/${groupId}/expenses`)).json<{ items: Expense[] }>();
    expect(list.items.map((e) => e.description).sort()).toEqual(["Cab", "Dinner"]);
    expect(list.items.every((e) => e.shares.some((s) => s.memberId === cId))).toBe(true);
    expect((await h.as(c).get("/groups")).json<{ id: string }[]>().map((g) => g.id)).toEqual([
      groupId,
    ]);
  });

  it("9. the CSV export opens in a spreadsheet and its totals match the in-app balances", async () => {
    const response = await h.as(a).get(`/groups/${groupId}/export.csv`);
    expect(response.statusCode).toBe(200);
    const rows = parseCsv(stripBom(response.body));
    const blank = rows.findIndex((row) => row.length === 1 && row[0] === "");
    const table = rows.slice(1, blank);
    const header = rows[0]!;
    const netColumns = header.flatMap((name, index) =>
      name.startsWith("Net effect - ") ? [index] : [],
    );

    const columnTotals = netColumns.map((column) =>
      table.reduce((sum, row) => sum + toMinor(row[column]!, 2), 0),
    );
    const balancesAt = rows.findIndex((row) => row[0] === "Balances");
    const listed = rows
      .slice(balancesAt + 2)
      .filter((row) => row[0] !== "Total")
      .map((row) => toMinor(row[1]!, 2));
    expect(listed).toEqual(columnTotals);

    const { byMember } = await nets();
    expect(listed).toEqual([byMember[aId], byMember[bId], byMember[cId]]);
    // Every row is a whole table row: a spreadsheet gets the same number of columns in each.
    expect(new Set(table.map((row) => row.length)).size).toBe(1);
  });

  it("10. a user who is not a member gets 404 for the group, and nothing else", async () => {
    const outsider = await h.signUp({ name: "Outsider" });
    for (const path of [
      "",
      "/members",
      "/expenses",
      "/settlements",
      "/balances",
      "/activity",
      "/invites",
      "/export.csv",
    ]) {
      expect((await h.as(outsider).get(`/groups/${groupId}${path}`)).statusCode, path).toBe(404);
    }
  });
});
