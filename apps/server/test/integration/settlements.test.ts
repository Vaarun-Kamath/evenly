import { pageSchema, problemSchema, settlementSchema, type Settlement } from "@evenly/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";
import { seedMember } from "./groupHelpers";
import { activityKinds } from "./groupHelpers";
import { addExpense, addSettlement, netsOf, settlementBody, startTrip, type Trip } from "./trip";

describe("settlements", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const type = (response: { json(): unknown }) => problemSchema.parse(response.json()).type;
  const post = (g: Trip, body: object, who = g.bob) =>
    h.as(who).post(`/groups/${g.groupId}/settlements`, body);

  /** Alice paid 900.00 for the three of them: Bob and Cara each owe her 300.00. */
  async function owing() {
    const g = await startTrip(h);
    await addExpense(h, g.alice, g, { amountMinor: 90000 });
    return g;
  }

  it("records a payment, moves the balances and shows up in the feed", async () => {
    const g = await owing();
    const response = await post(g, settlementBody(g.bId, g.aId, 30000, { note: "UPI" }));
    expect(response.statusCode).toBe(201);
    expect(settlementSchema.parse(response.json())).toMatchObject({
      fromMemberId: g.bId,
      toMemberId: g.aId,
      amount: { amountMinor: 30000, currency: "INR" },
      settledOn: "2026-10-11",
      note: "UPI",
      createdBy: g.bId,
      deletedAt: null,
      version: 1,
    });
    expect(await netsOf(h, g.alice, g.groupId)).toEqual({
      [g.aId]: 30000,
      [g.bId]: 0,
      [g.cId]: -30000,
    });
    expect(await activityKinds(h, g.alice, g.groupId)).toContain("settlement.created");
  });

  it("can be recorded by someone other than the payer (a third member), as the app lets anyone enter it", async () => {
    const g = await owing();
    expect((await post(g, settlementBody(g.cId, g.aId, 30000), g.alice)).statusCode).toBe(201);
    expect((await netsOf(h, g.alice, g.groupId))[g.cId]).toBe(0);
  });

  it.each([
    ["an amount of zero", { amountMinor: 0 }, 400],
    ["a negative amount", { amountMinor: -5 }, 400],
    ["an amount over the maximum", { amountMinor: 1_000_000_000_001 }, 400],
    ["a bad date", { settledOn: "soon" }, 400],
    ["a note over 500 characters", { note: "x".repeat(501) }, 400],
    ["an id that is not a UUID", { id: "abc" }, 400],
  ])("refuses %s", async (_label, overrides, status) => {
    const g = await owing();
    expect((await post(g, settlementBody(g.bId, g.aId, 100, overrides))).statusCode).toBe(status);
  });

  it("refuses paying yourself, another currency and people outside the group", async () => {
    const g = await owing();
    const self = await post(g, settlementBody(g.bId, g.bId, 100));
    expect(self.statusCode).toBe(422);
    expect(type(self)).toBe("urn:evenly:problem:self-settlement");
    const currency = await post(g, settlementBody(g.bId, g.aId, 100, { currency: "USD" }));
    expect(currency.statusCode).toBe(422);
    expect(type(currency)).toBe("urn:evenly:problem:currency-mismatch");
    const unknown = await post(g, settlementBody(g.bId, randomUUID(), 100));
    expect(unknown.statusCode).toBe(422);
    expect(type(unknown)).toBe("urn:evenly:problem:unknown-member");
    expect((await post(g, settlementBody(g.bId, g.aId, 100), await h.signUp())).statusCode).toBe(
      404,
    );
  });

  it("is idempotent by id, like expenses", async () => {
    const g = await owing();
    const body = settlementBody(g.bId, g.aId, 12345);
    const first = await post(g, body);
    const again = await post(g, body, g.alice);
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.json()).toEqual(first.json());
    expect(await h.db.sql`select 1 from settlements where id = ${body.id as string}`).toHaveLength(
      1,
    );
    for (const change of [
      { amountMinor: 1 },
      { fromMemberId: g.cId },
      { note: "other" },
      { settledOn: "2026-01-01" },
    ]) {
      const clash = await post(g, { ...body, ...change });
      expect(clash.statusCode).toBe(409);
      expect(type(clash)).toBe("urn:evenly:problem:idempotency-conflict");
    }
    const results = await Promise.all(
      [1, 2, 3].map(() => post(g, settlementBody(g.bId, g.aId, 5, { id: body.id }))),
    );
    expect(results.every((r) => r.statusCode === 409)).toBe(true);
  });

  it("is edited with a version, and a stale edit gets a 409 with the current one", async () => {
    const g = await owing();
    const settlement = await addSettlement(h, g.bob, g, g.bId, g.aId, 10000);
    const edit = (changes: object, version = settlement.version, who = g.bob) =>
      h.as(who).patch(`/groups/${g.groupId}/settlements/${settlement.id}`, {
        ...settlementBody(g.bId, g.aId, 10000),
        id: undefined,
        version,
        ...changes,
      });

    const changed = await edit({ amountMinor: 20000, note: "corrected" });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      amount: { amountMinor: 20000 },
      note: "corrected",
      version: 2,
    });
    expect((await netsOf(h, g.alice, g.groupId))[g.bId]).toBe(-10000);

    const stale = await edit({ amountMinor: 1 }, 1, g.alice);
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ type: string; current: Settlement }>()).toMatchObject({
      type: "urn:evenly:problem:version-conflict",
      current: { id: settlement.id, version: 2, amount: { amountMinor: 20000 } },
    });
    // Unchanged content keeps the version.
    expect((await edit({ amountMinor: 20000, note: "corrected" }, 2)).json()).toMatchObject({
      version: 2,
    });
    expect((await edit({ fromMemberId: g.aId, toMemberId: g.aId }, 2)).statusCode).toBe(422);
    expect(await activityKinds(h, g.alice, g.groupId)).toContain("settlement.updated");
  });

  it("deletes softly and an admin restores it, which moves the balances back and forth", async () => {
    const g = await owing();
    const settlement = await addSettlement(h, g.bob, g, g.bId, g.aId, 30000);
    expect(
      (await h.as(g.bob).delete(`/groups/${g.groupId}/settlements/${settlement.id}`)).statusCode,
    ).toBe(204);
    expect(
      (await h.as(g.bob).delete(`/groups/${g.groupId}/settlements/${settlement.id}`)).statusCode,
    ).toBe(204);
    expect((await netsOf(h, g.alice, g.groupId))[g.bId]).toBe(-30000);

    expect(
      (await h.as(g.bob).post(`/groups/${g.groupId}/settlements/${settlement.id}/restore`))
        .statusCode,
    ).toBe(403);
    const restored = await h
      .as(g.alice)
      .post(`/groups/${g.groupId}/settlements/${settlement.id}/restore`);
    expect(restored.json()).toMatchObject({ deletedAt: null, version: 3 });
    expect((await netsOf(h, g.alice, g.groupId))[g.bId]).toBe(0);

    // A deleted settlement cannot be edited, and a deleted id cannot be re-created.
    await h.as(g.bob).delete(`/groups/${g.groupId}/settlements/${settlement.id}`);
    const edit = await h.as(g.bob).patch(`/groups/${g.groupId}/settlements/${settlement.id}`, {
      ...settlementBody(g.bId, g.aId, 1),
      id: undefined,
      version: 4,
    });
    expect(edit.statusCode).toBe(409);
    expect(type(edit)).toBe("urn:evenly:problem:settlement-deleted");
    expect(type(await post(g, { ...settlementBody(g.bId, g.aId, 30000), id: settlement.id }))).toBe(
      "urn:evenly:problem:idempotency-conflict",
    );
    expect(await activityKinds(h, g.alice, g.groupId)).toEqual(
      expect.arrayContaining(["settlement.deleted", "settlement.restored"]),
    );
  });

  it("lists live settlements newest first, with filters and a cursor", async () => {
    const g = await owing();
    const add = (from: string, to: string, amount: number, settledOn: string) =>
      post(g, settlementBody(from, to, amount, { settledOn }), g.alice);
    await add(g.bId, g.aId, 100, "2026-10-01");
    await add(g.cId, g.aId, 200, "2026-10-02");
    await add(g.bId, g.aId, 300, "2026-10-03");
    const gone = (await add(g.bId, g.aId, 400, "2026-10-04")).json<Settlement>();
    await h.as(g.alice).delete(`/groups/${g.groupId}/settlements/${gone.id}`);

    const list = async (query = "") =>
      pageSchema(settlementSchema).parse(
        (await h.as(g.bob).get(`/groups/${g.groupId}/settlements${query}`)).json(),
      );
    const amounts = (page: { items: Settlement[] }) => page.items.map((s) => s.amount.amountMinor);
    expect(amounts(await list())).toEqual([300, 200, 100]);
    expect(amounts(await list("?from=2026-10-02&to=2026-10-02"))).toEqual([200]);
    expect(amounts(await list(`?memberId=${g.cId}`))).toEqual([200]);
    expect(amounts(await list(`?memberId=${g.bId}`))).toEqual([300, 100]);
    expect(amounts(await list("?memberId=nope"))).toEqual([]);

    const first = await list("?limit=2");
    expect(first.nextCursor).not.toBeNull();
    const second = await list(`?limit=2&cursor=${first.nextCursor!}`);
    expect(amounts({ items: [...first.items, ...second.items] })).toEqual([300, 200, 100]);
    expect(second.nextCursor).toBeNull();
    expect((await h.as(g.bob).get(`/groups/${g.groupId}/settlements?cursor=bad`)).statusCode).toBe(
      400,
    );
    expect(
      (await h.as(g.bob).get(`/groups/${g.groupId}/settlements/${gone.id}`)).json(),
    ).toMatchObject({ id: gone.id });
    expect(
      (await h.as(g.bob).get(`/groups/${g.groupId}/settlements/${randomUUID()}`)).statusCode,
    ).toBe(404);
  });

  it("cannot be recorded for someone who left, or in an archived group", async () => {
    const g = await startTrip(h);
    const leaver = await h.signUp({ name: "Leaver" });
    const leaverId = await seedMember(h, {
      groupId: g.groupId,
      userId: leaver.userId,
      name: "Leaver",
    });
    expect((await h.as(leaver).delete(`/groups/${g.groupId}/members/${leaverId}`)).statusCode).toBe(
      204,
    );
    const withLeaver = await post(g, settlementBody(leaverId, g.aId, 100));
    expect(withLeaver.statusCode).toBe(409);
    expect(type(withLeaver)).toBe("urn:evenly:problem:member-left");

    await h.as(g.alice).post(`/groups/${g.groupId}/archive`);
    expect(type(await post(g, settlementBody(g.bId, g.aId, 100)))).toBe(
      "urn:evenly:problem:group-archived",
    );
  });
});
