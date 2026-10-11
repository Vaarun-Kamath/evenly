import { memberSchema, problemSchema, type Member } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Session } from "./harness";
import { activityKinds, createGroup, memberIdOf, seedMember } from "./groupHelpers";
import { seedExpense, seedSettlement, simpleExpense } from "./seed";

describe("members", () => {
  let h: Harness;
  let olivia: Session; // owner
  let adam: Session; // admin
  let mia: Session; // member
  let groupId: string;
  let oliviaId: string;
  let adamId: string;
  let miaId: string;

  /** A fresh group with Olivia (owner), Adam (admin) and Mia (member), joined in that order. */
  async function freshGroup() {
    const group = await createGroup(h, olivia, { name: "Flat" });
    const ids = {
      groupId: group.id,
      oliviaId: await memberIdOf(h, olivia, group.id),
      adamId: await seedMember(h, {
        groupId: group.id,
        userId: adam.userId,
        name: "Adam",
        role: "admin",
      }),
      miaId: await seedMember(h, {
        groupId: group.id,
        userId: mia.userId,
        name: "Mia",
        role: "member",
      }),
    };
    ({ groupId, oliviaId, adamId, miaId } = ids);
    return ids;
  }

  beforeAll(async () => {
    h = await startHarness();
    olivia = await h.signUp({ name: "Olivia" });
    adam = await h.signUp({ name: "Adam" });
    mia = await h.signUp({ name: "Mia" });
  });
  afterAll(async () => {
    await h.close();
  });

  const members = async (who: Session, gid = groupId) =>
    (await h.as(who).get(`/groups/${gid}/members`)).json<Member[]>();
  const owners = async () => {
    const rows = await h.db.sql<{ n: string }[]>`
      select count(*)::text as n from group_members where group_id = ${groupId} and role = 'owner' and left_at is null`;
    return Number(rows[0]?.n);
  };

  describe("listing", () => {
    it("lists everyone in canonical order with role, flags and balance", async () => {
      await freshGroup();
      await seedExpense(h, simpleExpense(groupId, oliviaId, { [adamId]: 40000, [miaId]: 60000 }));
      const placeholder = (
        await h
          .as(olivia)
          .post(`/groups/${groupId}/members`, { displayName: "Pat", email: "Pat@Example.com" })
      ).json<Member>();

      const list = await members(adam);
      expect(list.map((m) => m.displayName)).toEqual(["Olivia", "Adam", "Mia", "Pat"]);
      list.forEach((m) => memberSchema.parse(m));
      expect(list.map((m) => m.role)).toEqual(["owner", "admin", "member", "member"]);
      expect(list.map((m) => m.isYou)).toEqual([false, true, false, false]);
      expect(list.map((m) => m.isPlaceholder)).toEqual([false, false, false, true]);
      expect(list.map((m) => m.net.amountMinor)).toEqual([100000, -40000, -60000, 0]);
      // Accounts' emails are not shared; a placeholder's is, as a member typed it.
      expect(list.map((m) => m.email)).toEqual([null, null, null, "Pat@Example.com"]);
      expect(placeholder.isPlaceholder).toBe(true);
    });

    it("still lists people who left, marked as left", async () => {
      await freshGroup();
      expect((await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`)).statusCode).toBe(204);
      const list = await members(olivia);
      expect(list.map((m) => m.displayName)).toContain("Mia");
      expect(list.find((m) => m.id === miaId)?.leftAt).toEqual(expect.any(String));
      expect(list.find((m) => m.id === oliviaId)?.leftAt).toBeNull();
    });
  });

  describe("placeholders", () => {
    it("any member can add one, who can then be renamed by an admin", async () => {
      await freshGroup();
      const added = await h.as(mia).post(`/groups/${groupId}/members`, { displayName: "  Cleo " });
      expect(added.statusCode).toBe(201);
      const cleo = memberSchema.parse(added.json());
      expect(cleo).toMatchObject({
        displayName: "Cleo",
        role: "member",
        isPlaceholder: true,
        email: null,
      });

      const rename = (who: Session, body: object) =>
        h.as(who).patch(`/groups/${groupId}/members/${cleo.id}`, body);
      expect((await rename(mia, { displayName: "Cleopatra" })).statusCode).toBe(403);
      const renamed = await rename(adam, { displayName: "Cleopatra", email: "cleo@example.com" });
      expect(renamed.json()).toMatchObject({ displayName: "Cleopatra", email: "cleo@example.com" });
      expect((await rename(adam, { email: null })).json()).toMatchObject({ email: null });
      expect(await activityKinds(h, olivia, groupId)).toEqual(
        expect.arrayContaining(["member.added", "member.updated"]),
      );
    });

    it("an account cannot be renamed by hand", async () => {
      await freshGroup();
      const response = await h
        .as(olivia)
        .patch(`/groups/${groupId}/members/${miaId}`, { displayName: "Mimi" });
      expect(response.statusCode).toBe(409);
      expect(problemSchema.parse(response.json()).type).toBe(
        "urn:evenly:problem:not-a-placeholder",
      );
    });

    it.each([
      ["a blank name", { displayName: "  " }],
      ["a bad email", { displayName: "Zed", email: "not-an-email" }],
      ["an unknown field", { displayName: "Zed", role: "owner" }],
    ])("refuses %s", async (_label, body) => {
      await freshGroup();
      expect((await h.as(olivia).post(`/groups/${groupId}/members`, body)).statusCode).toBe(400);
    });
  });

  describe("roles", () => {
    it("only the owner changes roles, and never their own or a placeholder's", async () => {
      await freshGroup();
      const role = (who: Session, id: string, value: string) =>
        h.as(who).patch(`/groups/${groupId}/members/${id}`, { role: value });
      const placeholder = (
        await h.as(olivia).post(`/groups/${groupId}/members`, { displayName: "Pat" })
      ).json<Member>();

      expect((await role(adam, miaId, "admin")).statusCode).toBe(403);
      expect((await role(mia, miaId, "admin")).statusCode).toBe(403);

      const promoted = await role(olivia, miaId, "admin");
      expect(promoted.json()).toMatchObject({ role: "admin" });
      expect((await role(olivia, miaId, "member")).json()).toMatchObject({ role: "member" });

      expect((await role(olivia, oliviaId, "admin")).statusCode).toBe(409);
      const onPlaceholder = await role(olivia, placeholder.id, "admin");
      expect(onPlaceholder.statusCode).toBe(409);
      expect(problemSchema.parse(onPlaceholder.json()).type).toBe(
        "urn:evenly:problem:placeholder-role",
      );
      expect(await owners()).toBe(1);
    });

    it("handing the group over makes the old owner an admin, and there is always one owner", async () => {
      await freshGroup();
      const handOver = await h
        .as(olivia)
        .patch(`/groups/${groupId}/members/${adamId}`, { role: "owner" });
      expect(handOver.statusCode).toBe(200);
      expect(handOver.json()).toMatchObject({ role: "owner" });
      expect((await members(adam)).map((m) => m.role)).toEqual(["admin", "owner", "member"]);
      expect(await owners()).toBe(1);

      // The old owner can no longer delete the group or change roles; the new one can.
      expect((await h.as(olivia).delete(`/groups/${groupId}`)).statusCode).toBe(403);
      expect(
        (await h.as(olivia).patch(`/groups/${groupId}/members/${miaId}`, { role: "admin" }))
          .statusCode,
      ).toBe(403);
      expect(
        (await h.as(adam).patch(`/groups/${groupId}/members/${miaId}`, { role: "admin" }))
          .statusCode,
      ).toBe(200);
      // The old owner may now leave.
      expect((await h.as(olivia).delete(`/groups/${groupId}/members/${oliviaId}`)).statusCode).toBe(
        204,
      );
    });

    it("cannot hand the group to a placeholder or to someone who left", async () => {
      await freshGroup();
      const placeholder = (
        await h.as(olivia).post(`/groups/${groupId}/members`, { displayName: "Pat" })
      ).json<Member>();
      expect(
        (
          await h
            .as(olivia)
            .patch(`/groups/${groupId}/members/${placeholder.id}`, { role: "owner" })
        ).statusCode,
      ).toBe(409);
      await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`);
      const toLeft = await h
        .as(olivia)
        .patch(`/groups/${groupId}/members/${miaId}`, { role: "owner" });
      expect(toLeft.statusCode).toBe(409);
      expect(problemSchema.parse(toLeft.json()).type).toBe("urn:evenly:problem:member-left");
      expect(await owners()).toBe(1);
    });

    it("refuses an unknown member and a bad role", async () => {
      await freshGroup();
      expect(
        (
          await h
            .as(olivia)
            .patch(`/groups/${groupId}/members/${crypto.randomUUID()}`, { role: "admin" })
        ).statusCode,
      ).toBe(404);
      expect(
        (await h.as(olivia).patch(`/groups/${groupId}/members/not-a-uuid`, { role: "admin" }))
          .statusCode,
      ).toBe(404);
      expect(
        (await h.as(olivia).patch(`/groups/${groupId}/members/${miaId}`, { role: "god" }))
          .statusCode,
      ).toBe(400);
      expect(await activityKinds(h, olivia, groupId)).not.toContain("member.role_changed");
    });
  });

  describe("leaving and being removed", () => {
    it("a member can leave, and then the group is gone for them", async () => {
      await freshGroup();
      expect((await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`)).statusCode).toBe(204);
      expect((await h.as(mia).get(`/groups/${groupId}`)).statusCode).toBe(404);
      expect(
        (await h.as(mia).get("/groups")).json<{ id: string }[]>().map((g) => g.id),
      ).not.toContain(groupId);
      expect(await activityKinds(h, olivia, groupId)).toContain("member.left");
      // Leaving twice: they are not in the group any more.
      expect((await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`)).statusCode).toBe(404);
    });

    it("the owner cannot leave or be removed", async () => {
      await freshGroup();
      for (const [who, label] of [
        [olivia, "leaving"],
        [adam, "an admin removing"],
      ] as const) {
        const response = await h.as(who).delete(`/groups/${groupId}/members/${oliviaId}`);
        expect(response.statusCode, label).toBe(409);
        expect(problemSchema.parse(response.json()).type).toBe(
          "urn:evenly:problem:owner-cannot-leave",
        );
      }
      expect(await owners()).toBe(1);
    });

    it("an admin removes members and placeholders; only the owner removes an admin", async () => {
      await freshGroup();
      const placeholder = (
        await h.as(mia).post(`/groups/${groupId}/members`, { displayName: "Pat" })
      ).json<Member>();
      const remove = (who: Session, id: string) =>
        h.as(who).delete(`/groups/${groupId}/members/${id}`);

      expect((await remove(mia, placeholder.id)).statusCode).toBe(403); // a plain member
      expect((await remove(adam, placeholder.id)).statusCode).toBe(204);
      expect((await remove(adam, miaId)).statusCode).toBe(204);

      const second = await freshGroup();
      expect(second.adamId).not.toBe(adamId + "x");
      const byAdmin = await remove(adam, second.oliviaId);
      expect(byAdmin.statusCode).toBe(409); // the owner
      // Make Mia an admin, then an admin tries to remove an admin: forbidden; the owner may.
      await h.as(olivia).patch(`/groups/${groupId}/members/${miaId}`, { role: "admin" });
      expect((await remove(adam, miaId)).statusCode).toBe(403);
      expect((await remove(olivia, miaId)).statusCode).toBe(204);
      expect(await activityKinds(h, olivia, groupId)).toContain("member.removed");
    });

    it("refuses an unknown member and someone who already left", async () => {
      await freshGroup();
      expect(
        (await h.as(olivia).delete(`/groups/${groupId}/members/${crypto.randomUUID()}`)).statusCode,
      ).toBe(404);
      await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`);
      expect((await h.as(olivia).delete(`/groups/${groupId}/members/${miaId}`)).statusCode).toBe(
        404,
      );
    });

    it("is refused while the person has an unsettled balance, and allowed once settled", async () => {
      await freshGroup();
      await seedExpense(h, simpleExpense(groupId, oliviaId, { [miaId]: 12345 }));

      const leave = await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`);
      expect(leave.statusCode).toBe(409);
      const problem = problemSchema.parse(leave.json());
      expect(problem.type).toBe("urn:evenly:problem:non-zero-balance");
      expect(problem.detail).toContain("123.45");
      // An admin removing them is refused for the same reason, and names them.
      const removal = await h.as(olivia).delete(`/groups/${groupId}/members/${miaId}`);
      expect(removal.statusCode).toBe(409);
      expect(problemSchema.parse(removal.json()).detail).toContain("Mia");

      await seedSettlement(h, {
        groupId,
        createdBy: miaId,
        from: miaId,
        to: oliviaId,
        amountMinor: 12345,
      });
      expect((await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`)).statusCode).toBe(204);
    });

    it("removing a placeholder cancels the links that would claim them", async () => {
      await freshGroup();
      const placeholder = (
        await h.as(olivia).post(`/groups/${groupId}/members`, { displayName: "Pat" })
      ).json<Member>();
      const invite = (
        await h.as(olivia).post(`/groups/${groupId}/invites`, { claimMemberId: placeholder.id })
      ).json<{ id: string }>();
      expect(
        (await h.as(olivia).delete(`/groups/${groupId}/members/${placeholder.id}`)).statusCode,
      ).toBe(204);
      const listed = (await h.as(olivia).get(`/groups/${groupId}/invites`)).json<
        { id: string; status: string }[]
      >();
      expect(listed.find((i) => i.id === invite.id)?.status).toBe("revoked");
    });

    it("is not possible in an archived group", async () => {
      await freshGroup();
      await h.as(olivia).post(`/groups/${groupId}/archive`);
      const leave = await h.as(mia).delete(`/groups/${groupId}/members/${miaId}`);
      expect(leave.statusCode).toBe(409);
      expect(problemSchema.parse(leave.json()).type).toBe("urn:evenly:problem:group-archived");
    });
  });
});
