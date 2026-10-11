import { problemSchema, type Member } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieHeaderOf, startHarness, TEST_PASSWORD, type Harness, type Session } from "./harness";
import { activityKinds, createGroup, memberIdOf, seedMember } from "./groupHelpers";
import { seedExpense, seedSettlement, simpleExpense } from "./seed";

describe("account deletion", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const remove = (who: Session, password: string | null = TEST_PASSWORD) =>
    h.request({
      method: "DELETE",
      url: "/api/v1/me",
      headers: { cookie: who.cookie },
      payload: password === null ? {} : { password },
    });
  const type = (response: { json(): unknown }) => problemSchema.parse(response.json()).type;

  it("asks for the password, and changes nothing without the right one", async () => {
    const user = await h.signUp();
    expect((await remove(user, "wrong password here")).statusCode).toBe(403);
    expect((await remove(user, null)).statusCode).toBe(400);
    expect((await h.as(user).get("/me")).statusCode).toBe(200);
  });

  it("is refused while the user owns a group, until they hand it over or delete it", async () => {
    const owner = await h.signUp({ name: "Owner" });
    const friend = await h.signUp({ name: "Friend" });
    const group = await createGroup(h, owner, { name: "Mine" });
    const friendMember = await seedMember(h, {
      groupId: group.id,
      userId: friend.userId,
      name: "Friend",
    });

    const blocked = await remove(owner);
    expect(blocked.statusCode).toBe(409);
    expect(type(blocked)).toBe("urn:evenly:problem:owns-groups");
    expect(problemSchema.parse(blocked.json()).detail).toContain("Mine");

    await h.as(owner).patch(`/groups/${group.id}/members/${friendMember}`, { role: "owner" });
    expect((await remove(owner)).statusCode).toBe(204);
  });

  it("is refused while there is an unsettled balance, even in an archived group", async () => {
    const owner = await h.signUp();
    const leaver = await h.signUp();
    const group = await createGroup(h, owner, { name: "Dinner club" });
    const ownerMember = await memberIdOf(h, owner, group.id);
    const leaverMember = await seedMember(h, {
      groupId: group.id,
      userId: leaver.userId,
      name: "Leaver",
    });
    await seedExpense(h, simpleExpense(group.id, ownerMember, { [leaverMember]: 5000 }));
    await h.as(owner).post(`/groups/${group.id}/archive`);

    const blocked = await remove(leaver);
    expect(blocked.statusCode).toBe(409);
    expect(type(blocked)).toBe("urn:evenly:problem:non-zero-balance");
    expect(problemSchema.parse(blocked.json()).detail).toContain("Dinner club");

    await seedSettlement(h, {
      groupId: group.id,
      createdBy: leaverMember,
      from: leaverMember,
      to: ownerMember,
      amountMinor: 5000,
    });
    expect((await remove(leaver)).statusCode).toBe(204);
  });

  it("anonymises the person in every group, signs them out, and frees the email", async () => {
    const owner = await h.signUp({ name: "Owner" });
    const leaving = await h.signUp({ name: "Leaving Lee" });
    const second = cookieHeaderOf(await h.signIn(leaving.email));
    const g1 = await createGroup(h, owner, { name: "First" });
    const g2 = await createGroup(h, owner, { name: "Second" });
    const lee1 = await seedMember(h, {
      groupId: g1.id,
      userId: leaving.userId,
      name: "Leaving Lee",
      role: "admin",
    });
    const lee2 = await seedMember(h, {
      groupId: g2.id,
      userId: leaving.userId,
      name: "Leaving Lee",
    });
    const gone = await seedMember(h, { groupId: g2.id, name: "Old", leftAt: new Date() });
    void gone;

    const response = await remove(leaving);
    expect(response.statusCode).toBe(204);
    // The browser is told to drop its session cookie.
    const cleared = response.cookies.filter((c) => c.name.endsWith("session_token"));
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((c) => c.value === "")).toBe(true);

    // Every session is gone and the account cannot sign in.
    expect(
      (await h.request({ url: "/api/v1/me", headers: { cookie: leaving.cookie } })).statusCode,
    ).toBe(401);
    expect((await h.request({ url: "/api/v1/me", headers: { cookie: second } })).statusCode).toBe(
      401,
    );
    expect((await h.signIn(leaving.email)).statusCode).toBe(401);
    expect(await h.db.sql`select 1 from "user" where id = ${leaving.userId}`).toHaveLength(0);

    // The groups keep the history, with a placeholder-looking "Deleted user" who has left.
    for (const [gid, memberId] of [
      [g1.id, lee1],
      [g2.id, lee2],
    ] as const) {
      const members = (await h.as(owner).get(`/groups/${gid}/members`)).json<Member[]>();
      expect(members.find((m) => m.id === memberId)).toMatchObject({
        displayName: "Deleted user",
        isPlaceholder: false,
        email: null,
        leftAt: expect.any(String) as string,
      });
    }
    const rows = await h.db.sql<
      { user_id: string | null; left_at: Date | null; email: string | null }[]
    >`
      select user_id, left_at, email from group_members where id in (${lee1}, ${lee2})`;
    expect(rows.every((r) => r.user_id === null && r.left_at !== null && r.email === null)).toBe(
      true,
    );
    expect(await activityKinds(h, owner, g1.id)).toContain("member.left");

    // A deleted member can never be claimed with an invite, and the email can be used again.
    const claim = await h.as(owner).post(`/groups/${g1.id}/invites`, { claimMemberId: lee1 });
    expect(claim.statusCode).toBe(409);
    const again = await h.signUp({ email: leaving.email, name: "Fresh Start" });
    expect(again.userId).not.toBe(leaving.userId);
    expect((await h.as(again).get("/groups")).json<unknown[]>()).toHaveLength(0);
  });
});

describe("renaming yourself", () => {
  it("is reflected in your memberships, not in placeholders", async () => {
    const h = await startHarness();
    try {
      const owner = await h.signUp({ name: "Old Name" });
      const group = await createGroup(h, owner, { name: "Names" });
      await h.as(owner).post(`/groups/${group.id}/members`, { displayName: "Old Name" });
      expect((await h.as(owner).patch("/me", { name: "New Name" })).statusCode).toBe(200);

      const members = (await h.as(owner).get(`/groups/${group.id}/members`)).json<Member[]>();
      expect(members.map((m) => [m.displayName, m.isPlaceholder])).toEqual([
        ["New Name", false],
        ["Old Name", true],
      ]);
    } finally {
      await h.close();
    }
  });
});
