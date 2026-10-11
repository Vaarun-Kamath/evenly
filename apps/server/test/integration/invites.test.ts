import {
  acceptInviteResponseSchema,
  createdInviteSchema,
  invitePreviewSchema,
  problemSchema,
  type CreatedInvite,
  type Invite,
  type Member,
} from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashInviteToken } from "../../src/modules/invites/token";
import { cookieHeaderOf, startHarness, uniqueEmail, type Harness, type Session } from "./harness";
import { activityKinds, createGroup, memberIdOf, seedMember } from "./groupHelpers";
import { seedExpense, simpleExpense } from "./seed";

const tokenOf = (invite: CreatedInvite): string => invite.url.split("/invite/")[1]!;

describe("invites", () => {
  let h: Harness;
  let owner: Session;
  let groupId: string;
  let ipCounter = 0;

  /** Preview and accept are public or per-IP limited; give each call its own address. */
  const preview = (token: string) =>
    h.request({
      url: `${h.base}/api/v1/invites/${token}`,
      remoteAddress: `10.20.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`,
    });
  const accept = (who: Session, token: string) => h.as(who).post(`/invites/${token}/accept`);
  const createInvite = (who: Session, body: object = {}, gid = groupId) =>
    h.as(who).post(`/groups/${gid}/invites`, body);
  const problemType = (response: { json(): unknown }) => problemSchema.parse(response.json()).type;

  beforeAll(async () => {
    h = await startHarness({ withMailer: true });
    owner = await h.signUp({ name: "Owner" });
    const group = await createGroup(h, owner, { name: "Goa Trip" });
    groupId = group.id;
  });
  afterAll(async () => {
    await h.close();
  });

  describe("creating", () => {
    it("returns the link once and stores only its hash", async () => {
      const response = await createInvite(owner);
      expect(response.statusCode).toBe(201);
      const invite = createdInviteSchema.parse(response.json());
      expect(invite.url).toMatch(/^http:\/\/localhost:3000\/invite\/[\w-]{43}$/);
      expect(invite).toMatchObject({ status: "active", useCount: 0, maxUses: null, email: null });
      // The default lifetime is 7 days.
      const days = (Date.parse(invite.expiresAt!) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);

      const [row] = await h.db.sql<
        { token_hash: Buffer }[]
      >`select token_hash from group_invites where id = ${invite.id}`;
      expect(Buffer.compare(row!.token_hash, hashInviteToken(tokenOf(invite)))).toBe(0);
      expect(row!.token_hash).toHaveLength(32);
      const dump = JSON.stringify(
        await h.db.sql`select * from group_invites where id = ${invite.id}`,
      );
      expect(dump).not.toContain(tokenOf(invite));
      // The link is not in the activity feed either.
      const feed = (await h.as(owner).get(`/groups/${groupId}/activity?limit=100`)).body;
      expect(feed).not.toContain(tokenOf(invite));
    });

    it("honours the expiry options and max uses", async () => {
      const days = async (body: object) => {
        const invite = (await createInvite(owner, body)).json<CreatedInvite>();
        return invite.expiresAt === null
          ? null
          : Math.round((Date.parse(invite.expiresAt) - Date.now()) / 86_400_000);
      };
      expect(await days({ expiresIn: "1d" })).toBe(1);
      expect(await days({ expiresIn: "30d" })).toBe(30);
      expect(await days({ expiresIn: "never" })).toBeNull();
      expect((await createInvite(owner, { maxUses: 3 })).json<CreatedInvite>().maxUses).toBe(3);
    });

    it.each([
      ["an unknown expiry", { expiresIn: "2d" }],
      ["zero uses", { maxUses: 0 }],
      ["too many uses", { maxUses: 100000 }],
      ["a bad email", { email: "nope" }],
      ["an unknown field", { role: "admin" }],
    ])("refuses %s", async (_label, body) => {
      expect((await createInvite(owner, body)).statusCode).toBe(400);
    });

    it("lets any member create one, but not someone outside the group", async () => {
      const member = await h.signUp();
      await seedMember(h, { groupId, userId: member.userId, name: "Member" });
      expect((await createInvite(member)).statusCode).toBe(201);
      const outsider = await h.signUp();
      expect((await createInvite(outsider)).statusCode).toBe(404);
    });

    it("cannot email an invitation when the instance has no SMTP", async () => {
      const plain = await startHarness();
      try {
        const o = await plain.signUp();
        const g = await createGroup(plain, o);
        const response = await plain
          .as(o)
          .post(`/groups/${g.id}/invites`, { email: "friend@example.com" });
        expect(response.statusCode).toBe(409);
        expect(problemType(response)).toBe("urn:evenly:problem:email-not-configured");
        expect((await plain.as(o).get(`/groups/${g.id}/invites`)).json<Invite[]>()).toHaveLength(0);
      } finally {
        await plain.close();
      }
    });

    it("emails an invitation bound to the address, with the link", async () => {
      h.mail.length = 0;
      const response = await createInvite(owner, { email: "Friend@Example.com" });
      expect(response.statusCode).toBe(201);
      const invite = createdInviteSchema.parse(response.json());
      expect(invite.email).toBe("Friend@Example.com");
      expect(h.mail).toHaveLength(1);
      expect(h.mail[0]).toMatchObject({ to: "Friend@Example.com" });
      expect(h.mail[0]?.subject).toContain("Owner invited you to Goa Trip");
      expect(h.mail[0]?.text).toContain(invite.url);
    });

    it("lists invites newest first with their status, and never the link", async () => {
      const g = await createGroup(h, owner, { name: "List test" });
      const first = (await createInvite(owner, { maxUses: 1 }, g.id)).json<CreatedInvite>();
      const second = (await createInvite(owner, {}, g.id)).json<CreatedInvite>();
      const third = (await createInvite(owner, {}, g.id)).json<CreatedInvite>();
      await h.as(owner).delete(`/groups/${g.id}/invites/${third.id}`);
      await h.db
        .sql`update group_invites set expires_at = now() - interval '1 minute' where id = ${second.id}`;
      await accept(await h.signUp(), tokenOf(first));

      const listed = (await h.as(owner).get(`/groups/${g.id}/invites`)).json<Invite[]>();
      expect(listed.map((i) => [i.id, i.status])).toEqual([
        [third.id, "revoked"],
        [second.id, "expired"],
        [first.id, "used-up"],
      ]);
      expect(JSON.stringify(listed)).not.toContain("invite/");
      expect(listed[0]?.createdBy).toMatchObject({ displayName: "Owner" });
    });
  });

  describe("revoking", () => {
    it("is for admins, and makes the link stop working", async () => {
      const g = await createGroup(h, owner, { name: "Revoke test" });
      const member = await h.signUp();
      await seedMember(h, { groupId: g.id, userId: member.userId, name: "Member" });
      const invite = (await createInvite(member, {}, g.id)).json<CreatedInvite>();

      expect((await h.as(member).delete(`/groups/${g.id}/invites/${invite.id}`)).statusCode).toBe(
        403,
      );
      expect((await h.as(owner).delete(`/groups/${g.id}/invites/${invite.id}`)).statusCode).toBe(
        204,
      );
      // Revoking twice is fine; an unknown invite is not found.
      expect((await h.as(owner).delete(`/groups/${g.id}/invites/${invite.id}`)).statusCode).toBe(
        204,
      );
      expect(
        (await h.as(owner).delete(`/groups/${g.id}/invites/${crypto.randomUUID()}`)).statusCode,
      ).toBe(404);
      expect((await h.as(owner).delete(`/groups/${g.id}/invites/nope`)).statusCode).toBe(404);
      // An invite of another group cannot be revoked through this one.
      expect((await h.as(owner).delete(`/groups/${groupId}/invites/${invite.id}`)).statusCode).toBe(
        404,
      );

      const response = await preview(tokenOf(invite));
      expect(response.statusCode).toBe(410);
      expect(problemType(response)).toBe("urn:evenly:problem:invite-revoked");
      const joiner = await h.signUp();
      expect((await accept(joiner, tokenOf(invite))).statusCode).toBe(410);
      expect(await activityKinds(h, owner, g.id)).toEqual(
        expect.arrayContaining(["invite.created", "invite.revoked"]),
      );
    });
  });

  describe("the preview anyone can open", () => {
    it("shows the group, the inviter and the claim target without signing in", async () => {
      const g = await createGroup(h, owner, { name: "Preview trip", emoji: "🌴" });
      await h.as(owner).post(`/groups/${g.id}/members`, { displayName: "Pat" });
      const pat = (await h.as(owner).get(`/groups/${g.id}/members`))
        .json<Member[]>()
        .find((m) => m.displayName === "Pat")!;

      const plain = (await createInvite(owner, { expiresIn: "never" }, g.id)).json<CreatedInvite>();
      const claim = (await createInvite(owner, {}, g.id)).json<CreatedInvite>().id;
      const claimInvite = (
        await createInvite(owner, { claimMemberId: pat.id }, g.id)
      ).json<CreatedInvite>();
      expect(claim).toBeTruthy();

      const seen = invitePreviewSchema.parse((await preview(tokenOf(plain))).json());
      expect(seen).toEqual({
        group: { name: "Preview trip", emoji: "🌴", memberCount: 2 },
        invitedBy: "Owner",
        claim: null,
        expiresAt: null,
      });
      const claimSeen = invitePreviewSchema.parse((await preview(tokenOf(claimInvite))).json());
      expect(claimSeen.claim).toEqual({ displayName: "Pat" });
    });

    it("says why a link does not work: unknown 404, expired / used up / archived / deleted", async () => {
      const g = await createGroup(h, owner, { name: "Statuses" });
      expect((await preview("x".repeat(43))).statusCode).toBe(404);
      expect((await preview("short")).statusCode).toBe(404);

      const expired = (await createInvite(owner, {}, g.id)).json<CreatedInvite>();
      await h.db
        .sql`update group_invites set expires_at = now() - interval '1 second' where id = ${expired.id}`;
      const expiredResponse = await preview(tokenOf(expired));
      expect(expiredResponse.statusCode).toBe(410);
      expect(problemType(expiredResponse)).toBe("urn:evenly:problem:invite-expired");

      const once = (await createInvite(owner, { maxUses: 1 }, g.id)).json<CreatedInvite>();
      await accept(await h.signUp(), tokenOf(once));
      expect(problemType(await preview(tokenOf(once)))).toBe("urn:evenly:problem:invite-used-up");

      const open = (await createInvite(owner, {}, g.id)).json<CreatedInvite>();
      await h.as(owner).post(`/groups/${g.id}/archive`);
      expect(problemType(await preview(tokenOf(open)))).toBe("urn:evenly:problem:group-archived");
      await h.as(owner).post(`/groups/${g.id}/unarchive`);
      expect((await preview(tokenOf(open))).statusCode).toBe(200);
      await h.as(owner).delete(`/groups/${g.id}`);
      expect((await preview(tokenOf(open))).statusCode).toBe(404);
    });

    it("is limited to 30 requests a minute per client IP", async () => {
      const invite = (await createInvite(owner)).json<CreatedInvite>();
      const statuses: number[] = [];
      for (let i = 0; i < 32; i += 1) {
        const response = await h.request({
          url: `${h.base}/api/v1/invites/${tokenOf(invite)}`,
          remoteAddress: "10.30.0.1",
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(statuses.slice(30)).toEqual([429, 429]);
    });
  });

  describe("accepting", () => {
    it("joins the group as a member, and counts the use", async () => {
      const invite = (await createInvite(owner, { maxUses: 2 })).json<CreatedInvite>();
      const joiner = await h.signUp({ name: "Joiner" });
      const response = await accept(joiner, tokenOf(invite));
      expect(response.statusCode).toBe(200);
      const result = acceptInviteResponseSchema.parse(response.json());
      expect(result).toMatchObject({ groupId, claimed: false, alreadyMember: false });

      expect((await h.as(joiner).get(`/groups/${groupId}`)).json()).toMatchObject({
        myRole: "member",
      });
      const members = (await h.as(joiner).get(`/groups/${groupId}/members`)).json<Member[]>();
      expect(members.find((m) => m.isYou)).toMatchObject({
        displayName: "Joiner",
        id: result.memberId,
      });
      expect(
        (await h.as(owner).get(`/groups/${groupId}/invites`))
          .json<Invite[]>()
          .find((i) => i.id === invite.id)?.useCount,
      ).toBe(1);
      expect(await activityKinds(h, owner, groupId)).toContain("member.joined");
    });

    it("needs a signed-in user, and a well-formed link", async () => {
      const invite = (await createInvite(owner)).json<CreatedInvite>();
      expect((await h.as(null).post(`/invites/${tokenOf(invite)}/accept`)).statusCode).toBe(401);
      expect((await accept(await h.signUp(), "not-a-token")).statusCode).toBe(404);
    });

    it("does nothing, and uses nothing up, for someone who is already a member", async () => {
      const invite = (await createInvite(owner, { maxUses: 1 })).json<CreatedInvite>();
      const joiner = await h.signUp();
      await accept(joiner, tokenOf(invite));
      // The link is now used up, so a second accept is refused...
      expect((await accept(joiner, tokenOf(invite))).statusCode).toBe(410);
      // ...but with a link that still has uses, an existing member just gets their membership back.
      const another = (await createInvite(owner)).json<CreatedInvite>();
      const again = acceptInviteResponseSchema.parse(
        (await accept(joiner, tokenOf(another))).json(),
      );
      expect(again.alreadyMember).toBe(true);
      expect(
        (await h.as(owner).get(`/groups/${groupId}/invites`))
          .json<Invite[]>()
          .find((i) => i.id === another.id)?.useCount,
      ).toBe(0);
    });

    it("stops at max uses, even when people accept at the same moment", async () => {
      const invite = (await createInvite(owner, { maxUses: 2 })).json<CreatedInvite>();
      const people = await Promise.all(Array.from({ length: 5 }, () => h.signUp()));
      const results = await Promise.all(people.map((p) => accept(p, tokenOf(invite))));
      const statuses = results.map((r) => r.statusCode).sort();
      expect(statuses).toEqual([200, 200, 410, 410, 410]);
      const [row] = await h.db.sql<
        { use_count: number }[]
      >`select use_count from group_invites where id = ${invite.id}`;
      expect(row?.use_count).toBe(2);
    });

    it("refuses an expired link", async () => {
      const invite = (await createInvite(owner)).json<CreatedInvite>();
      await h.db
        .sql`update group_invites set expires_at = now() - interval '1 second' where id = ${invite.id}`;
      const response = await accept(await h.signUp(), tokenOf(invite));
      expect(response.statusCode).toBe(410);
      expect(problemType(response)).toBe("urn:evenly:problem:invite-expired");
    });

    it("an email invitation works only for the address it was sent to", async () => {
      const invite = (
        await createInvite(owner, { email: "intended@example.com" })
      ).json<CreatedInvite>();
      const wrong = await h.signUp({ email: uniqueEmail() });
      const mismatch = await accept(wrong, tokenOf(invite));
      expect(mismatch.statusCode).toBe(403);
      expect(problemType(mismatch)).toBe("urn:evenly:problem:invite-email-mismatch");
      expect((await h.as(wrong).get(`/groups/${groupId}`)).statusCode).toBe(404);

      const right = await h.signUp({ email: "Intended@Example.com" });
      expect((await accept(right, tokenOf(invite))).statusCode).toBe(200);
    });

    it("someone who left comes back to their old place, as a plain member", async () => {
      const invite = (await createInvite(owner)).json<CreatedInvite>();
      const person = await h.signUp({ name: "Boomerang" });
      const first = acceptInviteResponseSchema.parse(
        (await accept(person, tokenOf(invite))).json(),
      );
      await h.db.sql`update group_members set role = 'admin' where id = ${first.memberId}`;
      await h.as(person).delete(`/groups/${groupId}/members/${first.memberId}`);
      expect((await h.as(person).get(`/groups/${groupId}`)).statusCode).toBe(404);

      const back = acceptInviteResponseSchema.parse((await accept(person, tokenOf(invite))).json());
      expect(back).toMatchObject({
        memberId: first.memberId,
        claimed: false,
        alreadyMember: false,
      });
      expect((await h.as(person).get(`/groups/${groupId}`)).json()).toMatchObject({
        myRole: "member",
      });
      const rows = await h.db
        .sql`select 1 from group_members where group_id = ${groupId} and user_id = ${person.userId}`;
      expect(rows).toHaveLength(1);
    });
  });

  describe("claiming a placeholder", () => {
    let claimGroup: string;
    let patId: string;
    let expenseId: string;
    let ownerMember: string;

    beforeAll(async () => {
      const g = await createGroup(h, owner, { name: "Claim trip" });
      claimGroup = g.id;
      ownerMember = await memberIdOf(h, owner, claimGroup);
      const pat = (
        await h.as(owner).post(`/groups/${claimGroup}/members`, { displayName: "Pat" })
      ).json<Member>();
      patId = pat.id;
      expenseId = await seedExpense(h, simpleExpense(claimGroup, ownerMember, { [patId]: 25000 }));
    });

    it("turns the placeholder into the account's own membership, keeping its history", async () => {
      const invite = (
        await createInvite(owner, { claimMemberId: patId, maxUses: 5 }, claimGroup)
      ).json<CreatedInvite>();
      expect(invite).toMatchObject({
        maxUses: 1,
        claimMember: { memberId: patId, displayName: "Pat" },
      });

      const claimer = await h.signUp({ name: "Patricia" });
      const response = await accept(claimer, tokenOf(invite));
      expect(acceptInviteResponseSchema.parse(response.json())).toEqual({
        groupId: claimGroup,
        memberId: patId,
        claimed: true,
        alreadyMember: false,
      });

      const members = (await h.as(claimer).get(`/groups/${claimGroup}/members`)).json<Member[]>();
      const me = members.find((m) => m.isYou)!;
      expect(me).toMatchObject({
        id: patId,
        displayName: "Patricia",
        isPlaceholder: false,
        email: null,
      });
      // The history comes with them: the same member id owes the same amount.
      expect(me.net.amountMinor).toBe(-25000);
      const [paid] = await h.db
        .sql`select 1 from expense_shares where expense_id = ${expenseId} and member_id = ${patId}`;
      expect(paid).toBeDefined();
      expect(await activityKinds(h, owner, claimGroup)).toContain("member.claimed");
      // Nobody ends up with two memberships.
      const rows = await h.db
        .sql`select 1 from group_members where group_id = ${claimGroup} and user_id = ${claimer.userId}`;
      expect(rows).toHaveLength(1);
    });

    it("works once only: the placeholder has an owner now", async () => {
      const g = await createGroup(h, owner, { name: "One shot" });
      const pat = (
        await h.as(owner).post(`/groups/${g.id}/members`, { displayName: "Pat" })
      ).json<Member>();
      const invite = (
        await createInvite(owner, { claimMemberId: pat.id }, g.id)
      ).json<CreatedInvite>();
      expect((await accept(await h.signUp(), tokenOf(invite))).statusCode).toBe(200);
      const second = await accept(await h.signUp(), tokenOf(invite));
      expect(second.statusCode).toBe(410);
      expect(problemType(second)).toBe("urn:evenly:problem:invite-used-up");
    });

    it("is refused for someone who already has a place in the group (no merging)", async () => {
      const g = await createGroup(h, owner, { name: "No merge" });
      const pat = (
        await h.as(owner).post(`/groups/${g.id}/members`, { displayName: "Pat" })
      ).json<Member>();
      const invite = (
        await createInvite(owner, { claimMemberId: pat.id }, g.id)
      ).json<CreatedInvite>();

      // Someone already in the group, and someone who was in it and left, both get 409.
      const member = await h.signUp();
      await seedMember(h, { groupId: g.id, userId: member.userId, name: "Member" });
      const refused = await accept(member, tokenOf(invite));
      expect(refused.statusCode).toBe(409);
      expect(problemType(refused)).toBe("urn:evenly:problem:already-member");

      const former = await h.signUp();
      await seedMember(h, {
        groupId: g.id,
        userId: former.userId,
        name: "Former",
        leftAt: new Date(),
      });
      expect((await accept(former, tokenOf(invite))).statusCode).toBe(409);

      // The invite is still good for a newcomer, and the owner is untouched.
      expect((await accept(await h.signUp(), tokenOf(invite))).statusCode).toBe(200);
    });

    it("must name a placeholder of this group", async () => {
      const g = await createGroup(h, owner, { name: "Bad claim" });
      const memberId = await seedMember(h, {
        groupId: g.id,
        userId: (await h.signUp()).userId,
        name: "Real",
      });
      const placeholderElsewhere = patId;
      for (const claimMemberId of [memberId, placeholderElsewhere, crypto.randomUUID(), "nope"]) {
        const response = await createInvite(owner, { claimMemberId }, g.id);
        expect(response.statusCode, claimMemberId).toBe(409);
        expect(problemType(response)).toBe("urn:evenly:problem:claim-unavailable");
      }
    });
  });

  describe("invite-only instances", () => {
    it("let a sign-up through only with a usable link, and the right address if it has one", async () => {
      const closed = await startHarness({
        env: { ALLOW_SIGNUPS: "invite-only" },
        withMailer: true,
      });
      try {
        const founder = await closed.signUp({ name: "Founder" });
        const g = await createGroup(closed, founder, { name: "Private" });
        const make = async (body: object) =>
          (await closed.as(founder).post(`/groups/${g.id}/invites`, body)).json<CreatedInvite>();
        const open = await make({});
        const bound = await make({ email: "only@example.com" });
        const revoked = await make({});
        const expired = await make({});
        await closed.as(founder).delete(`/groups/${g.id}/invites/${revoked.id}`);
        await closed.db
          .sql`update group_invites set expires_at = now() - interval '1 second' where id = ${expired.id}`;

        const signUp = (invite: CreatedInvite | null, email = uniqueEmail()) =>
          closed.request({
            method: "POST",
            url: "/api/auth/sign-up/email",
            headers: invite === null ? {} : { "x-evenly-invite": tokenOf(invite) },
            payload: { email, name: "Newcomer", password: "correct horse battery staple" },
          });

        expect((await signUp(null)).statusCode).toBe(403);
        expect((await signUp(revoked)).statusCode).toBe(403);
        expect((await signUp(expired)).statusCode).toBe(403);
        expect((await signUp(bound, uniqueEmail())).statusCode).toBe(403);

        const ok = await signUp(open);
        expect(ok.statusCode).toBe(200);
        expect((await signUp(bound, "ONLY@example.com")).statusCode).toBe(200);

        // Signing up does not use the link up; accepting it does.
        const [before] = await closed.db.sql<
          { use_count: number }[]
        >`select use_count from group_invites where id = ${open.id}`;
        expect(before?.use_count).toBe(0);
        const newcomer: Session = {
          cookie: cookieHeaderOf(ok),
          userId: ok.json<{ user: { id: string } }>().user.id,
          email: "",
        };
        expect(
          (await closed.as(newcomer).post(`/invites/${tokenOf(open)}/accept`)).statusCode,
        ).toBe(200);
        expect((await closed.as(newcomer).get(`/groups/${g.id}`)).statusCode).toBe(200);
      } finally {
        await closed.close();
      }
    });
  });
});
