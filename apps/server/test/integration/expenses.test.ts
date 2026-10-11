import { expenseSchema, pageSchema, problemSchema, type Expense } from "@evenly/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";
import { activityKinds, createGroup, seedMember } from "./groupHelpers";
import { addExpense, expenseBody, netsOf, startTrip, type Trip } from "./trip";

describe("expenses", () => {
  let h: Harness;
  let trip: Trip;
  beforeAll(async () => {
    h = await startHarness();
    trip = await startTrip(h);
  });
  afterAll(async () => {
    await h.close();
  });

  const post = (body: object, who = trip.alice) =>
    h.as(who).post(`/groups/${trip.groupId}/expenses`, body);
  const type = (response: { json(): unknown }) => problemSchema.parse(response.json()).type;
  const names = (page: { items: Expense[] }) => page.items.map((e) => e.description);

  describe("creating", () => {
    it("splits equally and gives the odd paisa to whoever joined first (SPEC scenario 2)", async () => {
      const response = await post(expenseBody(trip, { description: "Dinner" }));
      expect(response.statusCode).toBe(201);
      const expense = expenseSchema.parse(response.json());
      expect(expense).toMatchObject({
        description: "Dinner",
        amount: { amountMinor: 100000, currency: "INR" },
        category: "food",
        expenseDate: "2026-10-10",
        notes: null,
        splitMethod: "equal",
        createdBy: trip.aId,
        deletedAt: null,
        version: 1,
        payers: [{ memberId: trip.aId, amountMinor: 100000 }],
      });
      expect(expense.shares.map((s) => [s.memberId, s.amountMinor, s.inputValue])).toEqual([
        [trip.aId, 33334, null],
        [trip.bId, 33333, null],
        [trip.cId, 33333, null],
      ]);
    });

    it("supports exact amounts, percentages and shares, storing what was typed", async () => {
      const exact = await addExpense(h, trip.alice, trip, {
        description: "Exact",
        amountMinor: 1000,
        split: {
          method: "exact",
          entries: [
            { memberId: trip.aId, value: "250" },
            { memberId: trip.bId, value: "750" },
          ],
        },
      });
      expect(exact.shares.map((s) => [s.amountMinor, s.inputValue])).toEqual([
        [250, "250.00"],
        [750, "750.00"],
      ]);

      const percent = await addExpense(h, trip.alice, trip, {
        description: "Percent",
        amountMinor: 1001,
        split: {
          method: "percent",
          entries: [
            { memberId: trip.aId, value: "50" },
            { memberId: trip.bId, value: "30" },
            { memberId: trip.cId, value: "20" },
          ],
        },
      });
      expect(percent.shares.map((s) => s.amountMinor)).toEqual([501, 300, 200]);
      expect(percent.shares.map((s) => s.inputValue)).toEqual(["50.00", "30.00", "20.00"]);

      const shares = await addExpense(h, trip.bob, trip, {
        description: "Cab",
        amountMinor: 60000,
        payers: [{ memberId: trip.bId, amountMinor: 60000 }],
        split: {
          method: "shares",
          entries: [
            { memberId: trip.aId, value: "1" },
            { memberId: trip.bId, value: "1" },
            { memberId: trip.cId, value: "2" },
          ],
        },
      });
      expect(shares.shares.map((s) => s.amountMinor)).toEqual([15000, 15000, 30000]);
      expect(shares.createdBy).toBe(trip.bId);
    });

    it("takes several payers, and members do not have to be in the split to pay", async () => {
      const expense = await addExpense(h, trip.alice, trip, {
        description: "Groceries",
        amountMinor: 900,
        payers: [
          { memberId: trip.cId, amountMinor: 400 },
          { memberId: trip.aId, amountMinor: 500 },
        ],
        split: { method: "equal", entries: [{ memberId: trip.bId }] },
      });
      expect(expense.payers).toEqual([
        { memberId: trip.aId, amountMinor: 500 },
        { memberId: trip.cId, amountMinor: 400 },
      ]);
      expect(expense.shares).toEqual([{ memberId: trip.bId, amountMinor: 900, inputValue: null }]);
    });

    it("trims the description and defaults the category and notes", async () => {
      const body = expenseBody(trip, { description: "  Taxi  " });
      delete body.category;
      delete body.notes;
      const response = await post(body);
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        description: "Taxi",
        category: "other",
        notes: null,
      });
    });

    it.each([
      ["an amount of zero", { amountMinor: 0 }, 400],
      ["an amount over the maximum", { amountMinor: 1_000_000_000_001 }, 400],
      ["a fractional amount", { amountMinor: 10.5 }, 400],
      ["a blank description", { description: "  " }, 400],
      ["a description over 200 characters", { description: "x".repeat(201) }, 400],
      ["an unknown category", { category: "gambling" }, 400],
      ["a date that is not a date", { expenseDate: "10/10/2026" }, 400],
      ["an id that is not a UUID", { id: "abc" }, 400],
      ["no payers", { payers: [] }, 400],
      ["an empty split", { split: { method: "equal", entries: [] } }, 400],
    ])("refuses %s", async (_label, overrides, status) => {
      const response = await post(expenseBody(trip, overrides as object));
      expect(response.statusCode).toBe(status);
    });

    it.each([
      [
        "payers that do not add up",
        { payers: [{ memberId: "A", amountMinor: 99999 }] },
        "payer-total-mismatch",
      ],
      [
        "exact amounts that do not add up",
        {
          split: {
            method: "exact",
            entries: [
              { memberId: "A", value: "1" },
              { memberId: "B", value: "1" },
            ],
          },
        },
        "exact-total-mismatch",
      ],
      [
        "percentages that do not total 100",
        {
          split: {
            method: "percent",
            entries: [
              { memberId: "A", value: "60" },
              { memberId: "B", value: "30" },
            ],
          },
        },
        "percent-total-mismatch",
      ],
      [
        "a share of zero",
        {
          split: {
            method: "shares",
            entries: [
              { memberId: "A", value: "0" },
              { memberId: "B", value: "1" },
            ],
          },
        },
        "non-positive-value",
      ],
      [
        "a value on an equal split",
        { split: { method: "equal", entries: [{ memberId: "A", value: "5" }] } },
        "unexpected-value",
      ],
      [
        "a duplicate payer",
        {
          payers: [
            { memberId: "A", amountMinor: 50000 },
            { memberId: "A", amountMinor: 50000 },
          ],
        },
        "duplicate-member",
      ],
    ])("refuses %s with a 422 that names the rule", async (_label, overrides, expected) => {
      // "A" and "B" stand for Alice's and Bob's member ids.
      const ids: Record<string, string> = { A: trip.aId, B: trip.bId };
      const fill = (value: unknown): unknown =>
        JSON.parse(JSON.stringify(value), (key, v: unknown) =>
          key === "memberId" && typeof v === "string" && v in ids ? ids[v] : v,
        );
      const response = await post(expenseBody(trip, fill(overrides) as object));
      expect(response.statusCode).toBe(422);
      expect(type(response)).toBe(`urn:evenly:problem:${expected}`);
    });

    it("refuses another currency, an unknown member and a stranger", async () => {
      const currency = await post(expenseBody(trip, { currency: "USD" }));
      expect(currency.statusCode).toBe(422);
      expect(type(currency)).toBe("urn:evenly:problem:currency-mismatch");

      const unknown = await post(
        expenseBody(trip, { payers: [{ memberId: randomUUID(), amountMinor: 100000 }] }),
      );
      expect(unknown.statusCode).toBe(422);
      expect(type(unknown)).toBe("urn:evenly:problem:unknown-member");

      const stranger = await h.signUp();
      expect((await post(expenseBody(trip), stranger)).statusCode).toBe(404);
    });

    it("refuses to involve someone who left, but not before they have", async () => {
      const g = await startTrip(h);
      const leaver = await h.signUp({ name: "Leaver" });
      const leaverId = await seedMember(h, {
        groupId: g.groupId,
        userId: leaver.userId,
        name: "Leaver",
      });
      await addExpense(h, g.alice, g, {
        split: { method: "equal", entries: [g.aId, leaverId].map((memberId) => ({ memberId })) },
      });
      expect(
        (await h.as(leaver).delete(`/groups/${g.groupId}/members/${leaverId}`)).statusCode,
      ).toBe(409);
      // Settle up, leave, then they cannot be put in a new expense.
      await h.as(leaver).post(`/groups/${g.groupId}/settlements`, {
        id: randomUUID(),
        fromMemberId: leaverId,
        toMemberId: g.aId,
        amountMinor: 50000,
        currency: "INR",
        settledOn: "2026-10-11",
      });
      expect(
        (await h.as(leaver).delete(`/groups/${g.groupId}/members/${leaverId}`)).statusCode,
      ).toBe(204);
      const response = await h.as(g.alice).post(
        `/groups/${g.groupId}/expenses`,
        expenseBody(g, {
          split: {
            method: "equal",
            entries: [g.aId, leaverId].map((memberId) => ({ memberId })),
          },
        }),
      );
      expect(response.statusCode).toBe(409);
      expect(type(response)).toBe("urn:evenly:problem:member-left");
    });

    it("is blocked in an archived group", async () => {
      const g = await startTrip(h);
      await h.as(g.alice).post(`/groups/${g.groupId}/archive`);
      const response = await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, expenseBody(g));
      expect(response.statusCode).toBe(409);
      expect(type(response)).toBe("urn:evenly:problem:group-archived");
    });

    it("keeps the database safety net quiet: payers and shares always add up in the rows", async () => {
      const expense = await addExpense(h, trip.alice, trip, {
        description: "Audit",
        amountMinor: 7777,
      });
      const [row] = await h.db.sql<{ paid: string; owed: string }[]>`
        select (select sum(amount_minor) from expense_payers where expense_id = ${expense.id})::text as paid,
               (select sum(amount_minor) from expense_shares where expense_id = ${expense.id})::text as owed`;
      expect(row).toEqual({ paid: "7777", owed: "7777" });
    });
  });

  describe("retrying a create (idempotency)", () => {
    it("returns the existing expense for the same id and content, without a second one", async () => {
      const g = await startTrip(h);
      const body = expenseBody(g, { description: "Once only" });
      const first = await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body);
      const again = await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body);
      expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
      expect(again.json()).toEqual(first.json());
      const rows = await h.db.sql`select 1 from expenses where id = ${body.id as string}`;
      expect(rows).toHaveLength(1);
      expect(await activityKinds(h, g.alice, g.groupId)).toEqual([
        "group.created",
        "member.added",
        "expense.created",
      ]);
    });

    it("also when another member retries, and when the members are listed in another order", async () => {
      const g = await startTrip(h);
      const body = expenseBody(g, {
        description: "Reordered",
        amountMinor: 3,
        split: {
          method: "equal",
          entries: [g.cId, g.aId, g.bId].map((memberId) => ({ memberId })),
        },
      });
      expect((await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body)).statusCode).toBe(
        201,
      );
      const reordered = {
        ...body,
        split: {
          method: "equal",
          entries: [g.aId, g.bId, g.cId].map((memberId) => ({ memberId })),
        },
      };
      expect((await h.as(g.bob).post(`/groups/${g.groupId}/expenses`, reordered)).statusCode).toBe(
        200,
      );
    });

    it("refuses the same id with different content", async () => {
      const g = await startTrip(h);
      const body = expenseBody(g);
      await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body);
      for (const change of [
        { description: "Changed" },
        { amountMinor: 5, payers: [{ memberId: g.aId, amountMinor: 5 }] },
        { expenseDate: "2026-01-01" },
        { category: "rent" },
      ]) {
        const response = await h
          .as(g.alice)
          .post(`/groups/${g.groupId}/expenses`, { ...body, ...change });
        expect(response.statusCode).toBe(409);
        expect(type(response)).toBe("urn:evenly:problem:idempotency-conflict");
      }
    });

    it("refuses an id used in another group, and an id whose expense was deleted", async () => {
      const g = await startTrip(h);
      const other = await startTrip(h);
      const body = expenseBody(g);
      await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body);
      // The same body in the other group fails whichever way (different members), but the id clash is what matters.
      const clash = await h
        .as(other.alice)
        .post(`/groups/${other.groupId}/expenses`, expenseBody(other, { id: body.id as string }));
      expect(clash.statusCode).toBe(409);
      expect(type(clash)).toBe("urn:evenly:problem:idempotency-conflict");

      await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${body.id as string}`);
      const resurrect = await h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body);
      expect(resurrect.statusCode).toBe(409);
      expect(type(resurrect)).toBe("urn:evenly:problem:idempotency-conflict");
    });

    it("creates exactly one expense when the same request arrives twice at once", async () => {
      const g = await startTrip(h);
      const body = expenseBody(g, { description: "Race" });
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => h.as(g.alice).post(`/groups/${g.groupId}/expenses`, body)),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201]);
      expect(await h.db.sql`select 1 from expenses where id = ${body.id as string}`).toHaveLength(
        1,
      );
    });
  });

  describe("reading", () => {
    it("shows one expense to any member, deleted ones too, and 404 for others", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g);
      expect(
        (await h.as(g.bob).get(`/groups/${g.groupId}/expenses/${expense.id}`)).json(),
      ).toMatchObject({ id: expense.id });
      await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${expense.id}`);
      expect(
        (await h.as(g.bob).get(`/groups/${g.groupId}/expenses/${expense.id}`)).json(),
      ).toMatchObject({ deletedAt: expect.any(String) as string });
      expect(
        (await h.as(g.bob).get(`/groups/${g.groupId}/expenses/${randomUUID()}`)).statusCode,
      ).toBe(404);
      expect((await h.as(g.bob).get(`/groups/${g.groupId}/expenses/nope`)).statusCode).toBe(404);
      const other = await startTrip(h);
      expect(
        (await h.as(other.alice).get(`/groups/${other.groupId}/expenses/${expense.id}`)).statusCode,
      ).toBe(404);
    });
  });

  describe("listing", () => {
    let g: Trip;
    beforeAll(async () => {
      g = await startTrip(h);
      const add = (description: string, expenseDate: string, extra: object = {}) =>
        addExpense(h, g.alice, g, { description, expenseDate, ...extra });
      await add("Breakfast", "2026-10-01", { category: "food" });
      await add("Taxi to airport", "2026-10-02", { category: "transport" });
      await add("Hotel 50% deposit", "2026-10-02", { category: "travel", amountMinor: 5000 });
      await add("Snorkelling_gear", "2026-10-03", {
        category: "entertainment",
        amountMinor: 3000,
        payers: [{ memberId: g.bId, amountMinor: 3000 }],
        split: { method: "equal", entries: [{ memberId: g.bId }, { memberId: g.cId }] },
      });
      const gone = await add("Deleted dinner", "2026-10-03");
      await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${gone.id}`);
    });

    const list = async (query = "", who = g.alice) =>
      pageSchema(expenseSchema).parse(
        (await h.as(who).get(`/groups/${g.groupId}/expenses${query}`)).json(),
      );

    it("is newest first and leaves out deleted expenses", async () => {
      expect(names(await list())).toEqual([
        "Snorkelling_gear",
        "Hotel 50% deposit",
        "Taxi to airport",
        "Breakfast",
      ]);
    });

    it("filters by date range, category, member and text", async () => {
      expect(names(await list("?from=2026-10-02&to=2026-10-02"))).toEqual([
        "Hotel 50% deposit",
        "Taxi to airport",
      ]);
      expect(names(await list("?from=2026-10-03"))).toEqual(["Snorkelling_gear"]);
      expect(names(await list("?category=transport"))).toEqual(["Taxi to airport"]);
      // Bob paid for and shares in the snorkelling gear, and shares in the others; Cara likewise.
      expect(names(await list(`?memberId=${g.bId}`))).toHaveLength(4);
      expect(names(await list(`?memberId=${g.aId}`))).toEqual([
        "Hotel 50% deposit",
        "Taxi to airport",
        "Breakfast",
      ]);
      expect(names(await list(`?q=taxi`))).toEqual(["Taxi to airport"]);
      expect(names(await list(`?q=TAXI&category=transport&from=2026-10-01`))).toEqual([
        "Taxi to airport",
      ]);
      expect(names(await list(`?memberId=${randomUUID()}`))).toEqual([]);
      expect(names(await list(`?memberId=nope`))).toEqual([]);
    });

    it("searches for % and _ literally", async () => {
      expect(names(await list("?q=50%25"))).toEqual(["Hotel 50% deposit"]);
      expect(names(await list("?q=_gear"))).toEqual(["Snorkelling_gear"]);
      expect(names(await list("?q=%25"))).toEqual(["Hotel 50% deposit"]);
    });

    it("pages with a cursor, in a stable order, without repeats or gaps", async () => {
      const first = await list("?limit=3");
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).not.toBeNull();
      const second = await list(`?limit=3&cursor=${first.nextCursor!}`);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(names({ items: [...first.items, ...second.items] })).toEqual(names(await list()));
    });

    it("refuses a bad cursor, limit or date, and non-members", async () => {
      for (const query of [
        "?cursor=nonsense",
        "?limit=0",
        "?limit=101",
        "?from=yesterday",
        "?category=nope",
      ]) {
        expect(
          (await h.as(g.alice).get(`/groups/${g.groupId}/expenses${query}`)).statusCode,
          query,
        ).toBe(400);
      }
      expect((await h.as(await h.signUp()).get(`/groups/${g.groupId}/expenses`)).statusCode).toBe(
        404,
      );
    });

    it("includes the payers' and sharers' member ids in canonical order", async () => {
      const [snorkel] = (await list("?q=snorkelling")).items;
      expect(snorkel?.payers).toEqual([{ memberId: g.bId, amountMinor: 3000 }]);
      expect(snorkel?.shares.map((s) => s.memberId)).toEqual([g.bId, g.cId]);
    });
  });

  describe("editing, with optimistic locking", () => {
    const edit = (g: Trip, expense: Expense, changes: object = {}, who = g.alice) =>
      h.as(who).patch(`/groups/${g.groupId}/expenses/${expense.id}`, {
        ...expenseBody(g),
        id: undefined,
        version: expense.version,
        description: expense.description,
        amountMinor: expense.amount.amountMinor,
        expenseDate: expense.expenseDate,
        payers: [{ memberId: g.aId, amountMinor: expense.amount.amountMinor }],
        ...changes,
      });

    it("changes an expense, bumps the version, and records what changed", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g, { description: "Dinner" });
      const response = await edit(g, expense, {
        description: "Dinner at the beach",
        amountMinor: 120000,
        payers: [{ memberId: g.aId, amountMinor: 120000 }],
        category: "entertainment",
      });
      expect(response.statusCode).toBe(200);
      const changed = expenseSchema.parse(response.json());
      expect(changed).toMatchObject({
        description: "Dinner at the beach",
        amount: { amountMinor: 120000 },
        category: "entertainment",
        version: 2,
      });
      expect(changed.shares.map((s) => s.amountMinor)).toEqual([40000, 40000, 40000]);
      expect(changed.updatedAt >= expense.updatedAt).toBe(true);

      const feed = (await h.as(g.alice).get(`/groups/${g.groupId}/activity`)).json<{
        items: { kind: string; diff: Record<string, [unknown, unknown]> }[];
      }>();
      const updated = feed.items.find((item) => item.kind === "expense.updated");
      expect(updated?.diff).toMatchObject({
        description: ["Dinner", "Dinner at the beach"],
        amountMinor: [100000, 120000],
        category: ["food", "entertainment"],
      });
    });

    it("leaves the version alone when nothing changed", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g);
      const response = await edit(g, expense);
      expect(response.json()).toMatchObject({ version: 1 });
      expect(await activityKinds(h, g.alice, g.groupId)).not.toContain("expense.updated");
    });

    it("tells the second editor about the conflict and shows them the current expense (SPEC scenario 7)", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g, { description: "Lunch" });
      expect((await edit(g, expense, { description: "Lunch (Alice's fix)" })).statusCode).toBe(200);

      const stale = await edit(g, expense, { description: "Lunch (Bob's fix)" }, g.bob);
      expect(stale.statusCode).toBe(409);
      const problem = stale.json<{ type: string; current: Expense }>();
      expect(problem.type).toBe("urn:evenly:problem:version-conflict");
      expect(problem.current).toMatchObject({
        id: expense.id,
        description: "Lunch (Alice's fix)",
        version: 2,
      });
      // Nothing of Bob's got in.
      expect(
        (await h.as(g.bob).get(`/groups/${g.groupId}/expenses/${expense.id}`)).json(),
      ).toMatchObject({ description: "Lunch (Alice's fix)" });
    });

    it("lets exactly one of two simultaneous edits through", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g, { description: "Same time" });
      const results = await Promise.all([
        edit(g, expense, { description: "From Alice" }, g.alice),
        edit(g, expense, { description: "From Bob" }, g.bob),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const winner = results.find((r) => r.statusCode === 200)?.json<Expense>();
      const final = (
        await h.as(g.alice).get(`/groups/${g.groupId}/expenses/${expense.id}`)
      ).json<Expense>();
      expect(final.description).toBe(winner?.description);
      expect(final.version).toBe(2);
    });

    it("checks the same rules as creating, and refuses deleted and unknown expenses", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g);
      expect((await edit(g, expense, { currency: "USD" })).statusCode).toBe(422);
      expect(
        (await edit(g, expense, { payers: [{ memberId: g.aId, amountMinor: 1 }] })).statusCode,
      ).toBe(422);
      expect((await edit(g, expense, { version: 0 })).statusCode).toBe(400);
      expect(
        (
          await h.as(g.alice).patch(`/groups/${g.groupId}/expenses/${randomUUID()}`, {
            ...expenseBody(g),
            id: undefined,
            version: 1,
          })
        ).statusCode,
      ).toBe(404);

      await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${expense.id}`);
      const afterDelete = await edit(g, { ...expense, version: 2 }, { description: "Too late" });
      expect(afterDelete.statusCode).toBe(409);
      expect(type(afterDelete)).toBe("urn:evenly:problem:expense-deleted");
    });

    it("moves the balances with it", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g, { amountMinor: 90000 });
      expect(await netsOf(h, g.alice, g.groupId)).toEqual({
        [g.aId]: 60000,
        [g.bId]: -30000,
        [g.cId]: -30000,
      });
      await edit(g, expense, {
        split: { method: "equal", entries: [g.aId, g.bId].map((memberId) => ({ memberId })) },
      });
      expect(await netsOf(h, g.alice, g.groupId)).toEqual({
        [g.aId]: 45000,
        [g.bId]: -45000,
        [g.cId]: 0,
      });
    });
  });

  describe("deleting and restoring", () => {
    it("deletes softly, bumps the version, drops the balance effect, and an admin can restore", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g, { amountMinor: 30000 });
      const del = () => h.as(g.bob).delete(`/groups/${g.groupId}/expenses/${expense.id}`);
      expect((await del()).statusCode).toBe(204);
      expect((await del()).statusCode).toBe(204); // twice is fine
      expect(await h.db.sql`select 1 from expenses where id = ${expense.id}`).toHaveLength(1);
      expect(await netsOf(h, g.alice, g.groupId)).toEqual({ [g.aId]: 0, [g.bId]: 0, [g.cId]: 0 });

      // A plain member cannot restore; an admin can.
      expect(
        (await h.as(g.bob).post(`/groups/${g.groupId}/expenses/${expense.id}/restore`)).statusCode,
      ).toBe(403);
      const restored = await h
        .as(g.alice)
        .post(`/groups/${g.groupId}/expenses/${expense.id}/restore`);
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toMatchObject({ deletedAt: null, version: 3 });
      expect(await netsOf(h, g.alice, g.groupId)).toEqual({
        [g.aId]: 20000,
        [g.bId]: -10000,
        [g.cId]: -10000,
      });
      // Restoring one that is not deleted changes nothing.
      expect(
        (await h.as(g.alice).post(`/groups/${g.groupId}/expenses/${expense.id}/restore`)).json(),
      ).toMatchObject({ version: 3 });

      const kinds = await activityKinds(h, g.alice, g.groupId);
      expect(kinds).toEqual(
        expect.arrayContaining(["expense.created", "expense.deleted", "expense.restored"]),
      );
      expect(kinds.filter((k) => k === "expense.deleted")).toHaveLength(1);
    });

    it("an edit that started before the delete is refused after the restore (the version moved on)", async () => {
      const g = await startTrip(h);
      const expense = await addExpense(h, g.alice, g);
      await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${expense.id}`);
      await h.as(g.alice).post(`/groups/${g.groupId}/expenses/${expense.id}/restore`);
      const stale = await h.as(g.bob).patch(`/groups/${g.groupId}/expenses/${expense.id}`, {
        ...expenseBody(g),
        id: undefined,
        version: expense.version,
      });
      expect(stale.statusCode).toBe(409);
      expect(type(stale)).toBe("urn:evenly:problem:version-conflict");
    });

    it("cannot be done to or for people who left, if it would give them a balance", async () => {
      const g = await startTrip(h);
      const leaver = await h.signUp({ name: "Leaver" });
      const leaverId = await seedMember(h, {
        groupId: g.groupId,
        userId: leaver.userId,
        name: "Leaver",
      });
      const withLeaver = await addExpense(h, g.alice, g, {
        amountMinor: 2000,
        split: { method: "equal", entries: [g.aId, leaverId].map((memberId) => ({ memberId })) },
      });
      // Delete it, then the leaver (at zero) leaves; restoring would give them a balance again.
      await h.as(g.alice).delete(`/groups/${g.groupId}/expenses/${withLeaver.id}`);
      expect(
        (await h.as(leaver).delete(`/groups/${g.groupId}/members/${leaverId}`)).statusCode,
      ).toBe(204);
      const restore = await h
        .as(g.alice)
        .post(`/groups/${g.groupId}/expenses/${withLeaver.id}/restore`);
      expect(restore.statusCode).toBe(409);
      expect(type(restore)).toBe("urn:evenly:problem:member-left");
    });

    it("lets an expense that a left member is in still be edited, if what they owe does not change", async () => {
      const g = await startTrip(h);
      const leaver = await h.signUp({ name: "Leaver" });
      const leaverId = await seedMember(h, {
        groupId: g.groupId,
        userId: leaver.userId,
        name: "Leaver",
      });
      const expense = await addExpense(h, g.alice, g, {
        amountMinor: 2000,
        split: { method: "equal", entries: [g.aId, leaverId].map((memberId) => ({ memberId })) },
      });
      await h.as(leaver).post(`/groups/${g.groupId}/settlements`, {
        id: randomUUID(),
        fromMemberId: leaverId,
        toMemberId: g.aId,
        amountMinor: 1000,
        currency: "INR",
        settledOn: "2026-10-11",
      });
      expect(
        (await h.as(leaver).delete(`/groups/${g.groupId}/members/${leaverId}`)).statusCode,
      ).toBe(204);

      const base = {
        ...expenseBody(g),
        id: undefined,
        version: 1,
        amountMinor: 2000,
        payers: [{ memberId: g.aId, amountMinor: 2000 }],
        split: { method: "equal", entries: [g.aId, leaverId].map((memberId) => ({ memberId })) },
      };
      const rename = await h.as(g.alice).patch(`/groups/${g.groupId}/expenses/${expense.id}`, {
        ...base,
        description: "Typo fixed",
      });
      expect(rename.statusCode).toBe(200);
      const changeShare = await h.as(g.alice).patch(`/groups/${g.groupId}/expenses/${expense.id}`, {
        ...base,
        version: 2,
        split: {
          method: "exact",
          entries: [
            { memberId: g.aId, value: "500" },
            { memberId: leaverId, value: "1500" },
          ],
        },
      });
      expect(changeShare.statusCode).toBe(409);
      expect(type(changeShare)).toBe("urn:evenly:problem:member-left");
    });
  });

  it("lists everything it did in the activity feed", async () => {
    const g = await startTrip(h);
    const expense = await addExpense(h, g.alice, g);
    expect(await activityKinds(h, g.bob, g.groupId)).toEqual([
      "group.created",
      "member.added",
      "expense.created",
    ]);
    expect(expense.id).toBeTruthy();
  });

  void createGroup;
});
