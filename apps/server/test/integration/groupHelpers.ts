import type { Group, Member } from "@evenly/contracts";
import { newId } from "../../src/db/ids";
import type { Harness, Session } from "./harness";

export async function createGroup(
  h: Harness,
  session: Session,
  overrides: { name?: string; currency?: string; emoji?: string; simplifyDebts?: boolean } = {},
): Promise<Group> {
  const response = await h.as(session).post("/groups", {
    name: "Test group",
    currency: "INR",
    ...overrides,
  });
  if (response.statusCode !== 201) {
    throw new Error(`creating a group failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<Group>();
}

/** The caller's own member id in a group. */
export async function memberIdOf(h: Harness, session: Session, groupId: string): Promise<string> {
  const members = (await h.as(session).get(`/groups/${groupId}/members`)).json<Member[]>();
  const me = members.find((member) => member.isYou);
  if (me === undefined) throw new Error("not a member");
  return me.id;
}

/** Puts an account (or, without `userId`, a placeholder) into a group directly in the database. */
export async function seedMember(
  h: Harness,
  options: {
    groupId: string;
    name: string;
    userId?: string;
    role?: "owner" | "admin" | "member";
    leftAt?: Date;
    joinedAt?: Date;
  },
): Promise<string> {
  const id = newId();
  await h.db
    .sql`insert into group_members (id, group_id, user_id, display_name, role, left_at, joined_at)
                 values (${id}, ${options.groupId}, ${options.userId ?? null}, ${options.name},
                         ${options.role ?? "member"}, ${options.leftAt?.toISOString() ?? null}::timestamptz, coalesce(${options.joinedAt?.toISOString() ?? null}::timestamptz, now()))`;
  return id;
}

export interface ActivityRow {
  kind: string;
  actor: { displayName: string } | null;
  entityId: string | null;
  diff: Record<string, unknown> | null;
}

/** The group's activity kinds, oldest first. */
export async function activityKinds(
  h: Harness,
  session: Session,
  groupId: string,
): Promise<string[]> {
  const feed = (await h.as(session).get(`/groups/${groupId}/activity?limit=100`)).json<{
    items: ActivityRow[];
  }>();
  return feed.items.map((item) => item.kind).reverse();
}
