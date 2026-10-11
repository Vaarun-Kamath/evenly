import { groupSchema, problemSchema, type Group } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Session } from "./harness";
import { createGroup, memberIdOf, seedMember } from "./groupHelpers";
import { seedExpense, seedSettlement, simpleExpense } from "./seed";

describe("groups", () => {
  let h: Harness;
  let alice: Session;
  let bob: Session;
  beforeAll(async () => {
    h = await startHarness();
    alice = await h.signUp({ name: "Alice" });
    bob = await h.signUp({ name: "Bob" });
  });
  afterAll(async () => {
    await h.close();
  });

  it("creates a group: the creator becomes the owner and the only member", async () => {
    const response = await h.as(alice).post("/groups", {
      name: "  Goa Trip ",
      currency: "INR",
      emoji: "🌴",
    });
    expect(response.statusCode).toBe(201);
    const group = groupSchema.parse(response.json());
    expect(group).toMatchObject({
      name: "Goa Trip",
      currency: "INR",
      emoji: "🌴",
      simplifyDebts: true,
      archivedAt: null,
      myRole: "owner",
      memberCount: 1,
      myBalance: { amountMinor: 0, currency: "INR" },
    });

    const members = (await h.as(alice).get(`/groups/${group.id}/members`)).json<
      { displayName: string; role: string; isYou: boolean; isPlaceholder: boolean }[]
    >();
    expect(members).toMatchObject([
      { displayName: "Alice", role: "owner", isYou: true, isPlaceholder: false },
    ]);
  });

  it.each([
    ["a blank name", { name: "  ", currency: "INR" }],
    ["a name over 100 characters", { name: "x".repeat(101), currency: "INR" }],
    ["an unsupported currency", { name: "Trip", currency: "BTC" }],
    ["a missing currency", { name: "Trip" }],
    ["an over-long emoji", { name: "Trip", currency: "INR", emoji: "x".repeat(17) }],
    ["an unknown field", { name: "Trip", currency: "INR", owner: "someone" }],
  ])("refuses %s", async (_label, body) => {
    const response = await h.as(alice).post("/groups", body);
    expect(response.statusCode).toBe(400);
    expect(problemSchema.parse(response.json()).status).toBe(400);
  });

  it("lists only my groups, with role, member count and balance", async () => {
    const owner = await h.signUp({ name: "Dana" });
    const other = await h.signUp({ name: "Eli" });
    const mine = await createGroup(h, owner, { name: "Mine" });
    const theirs = await createGroup(h, other, { name: "Theirs" });
    const ownerMember = await memberIdOf(h, owner, mine.id);
    const otherMember = await seedMember(h, {
      groupId: mine.id,
      userId: other.userId,
      name: "Eli",
    });
    await seedExpense(
      h,
      simpleExpense(mine.id, ownerMember, { [ownerMember]: 30000, [otherMember]: 70000 }),
    );

    const asOwner = (await h.as(owner).get("/groups")).json<Group[]>();
    expect(asOwner.map((g) => g.name)).toEqual(["Mine"]);
    expect(asOwner[0]).toMatchObject({
      myRole: "owner",
      memberCount: 2,
      myBalance: { amountMinor: 70000, currency: "INR" },
    });

    const asOther = (await h.as(other).get("/groups")).json<Group[]>();
    expect(asOther.map((g) => g.name).sort()).toEqual(["Mine", "Theirs"]);
    expect(asOther.find((g) => g.id === mine.id)).toMatchObject({
      myRole: "member",
      myBalance: { amountMinor: -70000 },
    });
    expect(asOther.find((g) => g.id === theirs.id)).toMatchObject({
      myBalance: { amountMinor: 0 },
    });
  });

  it("hides archived groups from the main list unless asked", async () => {
    const owner = await h.signUp();
    const active = await createGroup(h, owner, { name: "Active" });
    const archived = await createGroup(h, owner, { name: "Archived" });
    expect((await h.as(owner).post(`/groups/${archived.id}/archive`)).statusCode).toBe(200);

    const names = async (query: string) =>
      (await h.as(owner).get(`/groups${query}`)).json<Group[]>().map((g) => g.name);
    expect(await names("")).toEqual(["Active"]);
    expect(await names("?archived=only")).toEqual(["Archived"]);
    expect((await names("?archived=include")).sort()).toEqual(["Active", "Archived"]);
    expect((await h.as(owner).get("/groups?archived=sometimes")).statusCode).toBe(400);
    expect(active.id).toBeTruthy();
  });

  describe("changing a group", () => {
    it("lets an admin rename it, set an emoji and switch off simplify-debts; a member cannot", async () => {
      const group = await createGroup(h, alice, { name: "Flat" });
      await seedMember(h, { groupId: group.id, userId: bob.userId, name: "Bob", role: "member" });

      const patch = (who: Session, body: object) => h.as(who).patch(`/groups/${group.id}`, body);
      expect((await patch(bob, { name: "Mine now" })).statusCode).toBe(403);

      const changed = await patch(alice, { name: " The Flat ", emoji: "🏠", simplifyDebts: false });
      expect(changed.statusCode).toBe(200);
      expect(changed.json()).toMatchObject({ name: "The Flat", emoji: "🏠", simplifyDebts: false });
      expect((await patch(alice, { emoji: null })).json()).toMatchObject({ emoji: null });
    });

    it("never changes the currency", async () => {
      const group = await createGroup(h, alice, { name: "Euro trip", currency: "EUR" });
      expect((await h.as(alice).patch(`/groups/${group.id}`, { currency: "USD" })).statusCode).toBe(
        400,
      );
      expect((await h.as(alice).get(`/groups/${group.id}`)).json()).toMatchObject({
        currency: "EUR",
      });
    });

    it.each([
      ["nothing", {}],
      ["a blank name", { name: " " }],
      ["an unknown field", { colour: "red" }],
    ])("refuses %s", async (_label, body) => {
      const group = await createGroup(h, alice, { name: "Flat" });
      expect((await h.as(alice).patch(`/groups/${group.id}`, body)).statusCode).toBe(400);
    });

    it("is read-only once archived, until it is unarchived", async () => {
      const group = await createGroup(h, alice, { name: "Old trip" });
      const archived = await h.as(alice).post(`/groups/${group.id}/archive`);
      expect(archived.json()).toMatchObject({ archivedAt: expect.any(String) as string });
      // Doing it twice changes nothing.
      expect((await h.as(alice).post(`/groups/${group.id}/archive`)).statusCode).toBe(200);

      const rename = await h.as(alice).patch(`/groups/${group.id}`, { name: "Renamed" });
      expect(rename.statusCode).toBe(409);
      expect(problemSchema.parse(rename.json()).type).toBe("urn:evenly:problem:group-archived");
      const addMember = await h
        .as(alice)
        .post(`/groups/${group.id}/members`, { displayName: "Zed" });
      expect(addMember.statusCode).toBe(409);
      // Reading still works.
      expect((await h.as(alice).get(`/groups/${group.id}`)).statusCode).toBe(200);

      const back = await h.as(alice).post(`/groups/${group.id}/unarchive`);
      expect(back.json()).toMatchObject({ archivedAt: null });
      expect((await h.as(alice).patch(`/groups/${group.id}`, { name: "Renamed" })).statusCode).toBe(
        200,
      );
    });

    it("lets only an admin archive", async () => {
      const group = await createGroup(h, alice, { name: "Flat" });
      await seedMember(h, { groupId: group.id, userId: bob.userId, name: "Bob" });
      expect((await h.as(bob).post(`/groups/${group.id}/archive`)).statusCode).toBe(403);
      expect((await h.as(bob).post(`/groups/${group.id}/unarchive`)).statusCode).toBe(403);
    });
  });

  describe("deleting a group", () => {
    it("is for the owner only, and only when everyone is settled up", async () => {
      const owner = await h.signUp({ name: "Fay" });
      const friend = await h.signUp({ name: "Gus" });
      const group = await createGroup(h, owner, { name: "Dinner club" });
      const ownerMember = await memberIdOf(h, owner, group.id);
      const friendMember = await seedMember(h, {
        groupId: group.id,
        userId: friend.userId,
        name: "Gus",
        role: "admin",
      });

      // An admin is not enough.
      expect((await h.as(friend).delete(`/groups/${group.id}`)).statusCode).toBe(403);

      // Gus owes Fay 500: the group cannot be deleted.
      await seedExpense(h, simpleExpense(group.id, ownerMember, { [friendMember]: 50000 }));
      const blocked = await h.as(owner).delete(`/groups/${group.id}`);
      expect(blocked.statusCode).toBe(409);
      expect(problemSchema.parse(blocked.json()).type).toBe("urn:evenly:problem:non-zero-balance");

      // Settled up: now it goes, and nobody can see it any more.
      await seedSettlement(h, {
        groupId: group.id,
        createdBy: friendMember,
        from: friendMember,
        to: ownerMember,
        amountMinor: 50000,
      });
      expect((await h.as(owner).delete(`/groups/${group.id}`)).statusCode).toBe(204);
      expect((await h.as(owner).get(`/groups/${group.id}`)).statusCode).toBe(404);
      expect((await h.as(owner).get("/groups")).json<Group[]>().map((g) => g.id)).not.toContain(
        group.id,
      );
      expect((await h.as(friend).get(`/groups/${group.id}`)).statusCode).toBe(404);
    });

    it("counts only live expenses and settlements toward the balance", async () => {
      const owner = await h.signUp();
      const friend = await h.signUp();
      const group = await createGroup(h, owner, { name: "Soft deletes" });
      const ownerMember = await memberIdOf(h, owner, group.id);
      const friendMember = await seedMember(h, {
        groupId: group.id,
        userId: friend.userId,
        name: "F",
      });
      await seedExpense(h, {
        ...simpleExpense(group.id, ownerMember, { [friendMember]: 12345 }),
        deleted: true,
      });
      expect((await h.as(owner).get(`/groups/${group.id}`)).json()).toMatchObject({
        myBalance: { amountMinor: 0 },
      });
      expect((await h.as(owner).delete(`/groups/${group.id}`)).statusCode).toBe(204);
    });
  });

  describe("activity", () => {
    it("records every change, with who did it and what changed", async () => {
      const group = await createGroup(h, alice, { name: "Audit" });
      await h.as(alice).patch(`/groups/${group.id}`, { name: "Audited", simplifyDebts: false });
      await h.as(alice).patch(`/groups/${group.id}`, { name: "Audited" }); // no change: no row
      await h.as(alice).post(`/groups/${group.id}/archive`);
      await h.as(alice).post(`/groups/${group.id}/unarchive`);

      const feed = (await h.as(alice).get(`/groups/${group.id}/activity`)).json<{
        items: {
          kind: string;
          actor: { displayName: string } | null;
          diff: Record<string, unknown> | null;
        }[];
      }>();
      expect(feed.items.map((item) => item.kind)).toEqual([
        "group.unarchived",
        "group.archived",
        "group.updated",
        "group.created",
      ]);
      expect(feed.items[2]?.diff).toEqual({
        name: ["Audit", "Audited"],
        simplifyDebts: [true, false],
      });
      expect(feed.items.every((item) => item.actor?.displayName === "Alice")).toBe(true);
    });

    it("pages with an opaque cursor", async () => {
      const group = await createGroup(h, alice, { name: "Busy" });
      for (let i = 0; i < 5; i += 1) {
        await h
          .as(alice)
          .post(`/groups/${group.id}/members`, { displayName: `Person ${String(i)}` });
      }
      const page = async (query: string) =>
        (await h.as(alice).get(`/groups/${group.id}/activity${query}`)).json<{
          items: { id: string; kind: string }[];
          nextCursor: string | null;
        }>();

      const first = await page("?limit=4");
      expect(first.items).toHaveLength(4);
      expect(first.nextCursor).toBe(first.items.at(-1)?.id);
      const second = await page(`?limit=4&cursor=${first.nextCursor!}`);
      expect(second.items).toHaveLength(2); // 6 rows in all: 1 created + 5 added
      expect(second.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(6);
      expect([...ids].sort().reverse()).toEqual(ids);

      expect(
        (await h.as(alice).get(`/groups/${group.id}/activity?cursor=nonsense`)).statusCode,
      ).toBe(400);
      expect((await h.as(alice).get(`/groups/${group.id}/activity?limit=0`)).statusCode).toBe(400);
      expect((await h.as(alice).get(`/groups/${group.id}/activity?limit=101`)).statusCode).toBe(
        400,
      );
    });
  });
});
