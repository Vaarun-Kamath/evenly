import type { ActivityItem, PageQuery } from "@evenly/contracts";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Orm } from "../../db/client";
import { activity, groupMembers } from "../../db/schema";
import { ProblemError } from "../../http/problem";
import { isUuid, requireMember } from "../common/access";
import { toIso, type Actor } from "../common/db";

/**
 * A group's activity feed, newest first, for any member. Ids are UUIDv7, so they sort by time and an id
 * is a stable cursor: the next page is everything older than the last id of this one.
 */
export async function listActivity(
  orm: Orm,
  actor: Actor,
  groupId: string,
  query: PageQuery,
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  await requireMember(orm, groupId, actor.userId);
  if (query.cursor !== undefined && !isUuid(query.cursor)) {
    throw new ProblemError(400, "invalid-cursor", "That cursor is not valid.");
  }
  const rows = await orm
    .select({ row: activity, actorName: groupMembers.displayName })
    .from(activity)
    .leftJoin(groupMembers, eq(groupMembers.id, activity.actorId))
    .where(
      and(
        eq(activity.groupId, groupId),
        query.cursor === undefined ? undefined : lt(activity.id, query.cursor),
      ),
    )
    .orderBy(desc(activity.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const items = page.map(({ row, actorName }): ActivityItem => ({
    id: row.id,
    kind: row.kind,
    actor:
      row.actorId === null || actorName === null
        ? null
        : { memberId: row.actorId, displayName: actorName },
    entityId: row.entityId,
    diff: (row.diff as Record<string, unknown> | null) ?? null,
    createdAt: toIso(row.createdAt),
  }));
  return {
    items,
    nextCursor: rows.length > query.limit ? (page.at(-1)?.row.id ?? null) : null,
  };
}
