import type { CreatedInvite } from "@evenly/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type RouteInfo, type Session } from "./harness";
import { createGroup, memberIdOf, seedMember } from "./groupHelpers";

/**
 * Every route that works on a group, with a body that passes validation, so that the only thing
 * that can make it answer 404 is "you are not in this group". Add new group routes here: the
 * completeness test below fails if one is missing.
 */
// Valid in shape (a real member id is filled in for MEMBER), so that only "not in this group" can fail.
const MEMBER = "00000000-0000-4000-8000-000000000001";
const EXPENSE_BODY = {
  id: "0192f0c4-0000-7000-8000-000000000001",
  description: "Dinner",
  amountMinor: 1000,
  currency: "INR",
  category: "food",
  expenseDate: "2026-10-10",
  payers: [{ memberId: MEMBER, amountMinor: 1000 }],
  split: { method: "equal", entries: [{ memberId: MEMBER }] },
};
const SETTLEMENT_BODY = {
  id: "0192f0c4-0000-7000-8000-000000000002",
  fromMemberId: MEMBER,
  toMemberId: "00000000-0000-4000-8000-000000000002",
  amountMinor: 100,
  currency: "INR",
  settledOn: "2026-10-11",
};

const GROUP_ROUTES: { method: string; url: string; body?: object }[] = [
  { method: "GET", url: "/groups/:gid" },
  { method: "PATCH", url: "/groups/:gid", body: { name: "Hijacked" } },
  { method: "DELETE", url: "/groups/:gid" },
  { method: "POST", url: "/groups/:gid/archive" },
  { method: "POST", url: "/groups/:gid/unarchive" },
  { method: "GET", url: "/groups/:gid/members" },
  { method: "POST", url: "/groups/:gid/members", body: { displayName: "Intruder" } },
  { method: "PATCH", url: "/groups/:gid/members/:mid", body: { role: "admin" } },
  { method: "DELETE", url: "/groups/:gid/members/:mid" },
  { method: "GET", url: "/groups/:gid/invites" },
  { method: "POST", url: "/groups/:gid/invites", body: {} },
  { method: "DELETE", url: "/groups/:gid/invites/:iid" },
  { method: "GET", url: "/groups/:gid/activity" },
  { method: "GET", url: "/groups/:gid/balances" },
  { method: "GET", url: "/groups/:gid/export.csv" },
  { method: "GET", url: "/groups/:gid/expenses" },
  { method: "POST", url: "/groups/:gid/expenses", body: EXPENSE_BODY },
  { method: "GET", url: "/groups/:gid/expenses/:eid" },
  {
    method: "PATCH",
    url: "/groups/:gid/expenses/:eid",
    body: { ...EXPENSE_BODY, id: undefined, version: 1 },
  },
  { method: "DELETE", url: "/groups/:gid/expenses/:eid" },
  { method: "POST", url: "/groups/:gid/expenses/:eid/restore" },
  { method: "GET", url: "/groups/:gid/settlements" },
  { method: "POST", url: "/groups/:gid/settlements", body: SETTLEMENT_BODY },
  { method: "GET", url: "/groups/:gid/settlements/:sid" },
  {
    method: "PATCH",
    url: "/groups/:gid/settlements/:sid",
    body: { ...SETTLEMENT_BODY, id: undefined, version: 1 },
  },
  { method: "DELETE", url: "/groups/:gid/settlements/:sid" },
  { method: "POST", url: "/groups/:gid/settlements/:sid/restore" },
];

describe("a user who is not in a group", () => {
  const routes: RouteInfo[] = [];
  let h: Harness;
  let owner: Session;
  let outsider: Session;
  let groupId: string;
  let memberId: string;
  let inviteId: string;

  beforeAll(async () => {
    h = await startHarness({ routes });
    owner = await h.signUp({ name: "Owner" });
    outsider = await h.signUp({ name: "Outsider" });
    groupId = (await createGroup(h, owner, { name: "Secret plans" })).id;
    memberId = await memberIdOf(h, owner, groupId);
    inviteId = (await h.as(owner).post(`/groups/${groupId}/invites`, {})).json<CreatedInvite>().id;
  });
  afterAll(async () => {
    await h.close();
  });

  const fill = (url: string, gid = groupId) =>
    `/api/v1${url.replace(":gid", gid).replace(":mid", memberId).replace(":iid", inviteId).replace(":eid", inviteId).replace(":sid", inviteId)}`;
  const call = (who: Session | null, route: (typeof GROUP_ROUTES)[number], gid = groupId) =>
    h.request({
      method: route.method as "GET",
      url: `${h.base}${fill(route.url, gid)}`,
      headers: who === null ? {} : { cookie: who.cookie },
      ...(route.body !== undefined && { payload: route.body }),
    });

  it("is covered for every group route the app registers", () => {
    const registered = routes
      .filter((route) => route.url.includes("/groups/:gid"))
      .flatMap((route) => (Array.isArray(route.method) ? route.method : [route.method])).length;
    expect(registered).toBeGreaterThan(0);

    const keys = routes
      .filter((route) => route.url.includes("/groups/:gid"))
      .flatMap((route) =>
        (Array.isArray(route.method) ? route.method : [route.method])
          .filter((method) => method !== "HEAD" && method !== "OPTIONS")
          .map((method) => `${method} ${route.url.replace("/api/v1", "")}`),
      )
      .sort();
    expect(keys).toEqual(GROUP_ROUTES.map((route) => `${route.method} ${route.url}`).sort());
  });

  it.each(GROUP_ROUTES)("gets 404 from $method $url", async (route) => {
    const response = await call(outsider, route);
    expect(response.statusCode).toBe(404);
  });

  it.each(GROUP_ROUTES)("and 401 without signing in, from $method $url", async (route) => {
    expect((await call(null, route)).statusCode).toBe(401);
  });

  it("cannot tell a group they are not in from one that does not exist", async () => {
    const strip = (body: string) => JSON.parse(body) as object;
    for (const route of GROUP_ROUTES) {
      const real = await call(outsider, route);
      const missing = await call(outsider, route, crypto.randomUUID());
      const malformed = await call(outsider, route, "not-a-uuid");
      expect(missing.statusCode, route.url).toBe(real.statusCode);
      expect(malformed.statusCode, route.url).toBe(real.statusCode);
      expect(strip(missing.body), route.url).toEqual(strip(real.body));
      expect(strip(malformed.body), route.url).toEqual(strip(real.body));
    }
  });

  it("changed nothing, even with the right ids", async () => {
    const group = (await h.as(owner).get(`/groups/${groupId}`)).json<{
      name: string;
      archivedAt: string | null;
    }>();
    expect(group).toMatchObject({ name: "Secret plans", archivedAt: null });
    const members = (await h.as(owner).get(`/groups/${groupId}/members`)).json<unknown[]>();
    expect(members).toHaveLength(1);
  });

  it("includes a member who has left, and someone whose group was deleted", async () => {
    const former = await h.signUp();
    const formerId = await seedMember(h, { groupId, userId: former.userId, name: "Former" });
    expect((await call(former, GROUP_ROUTES[0]!)).statusCode).toBe(200);
    await h.as(former).delete(`/groups/${groupId}/members/${formerId}`);
    for (const route of GROUP_ROUTES) {
      expect((await call(former, route)).statusCode, `${route.method} ${route.url}`).toBe(404);
    }

    const doomed = (await createGroup(h, owner, { name: "Doomed" })).id;
    await h.as(owner).delete(`/groups/${doomed}`);
    for (const route of GROUP_ROUTES) {
      expect((await call(owner, route, doomed)).statusCode, `${route.method} ${route.url}`).toBe(
        404,
      );
    }
  });
});
