import { activity } from "../../db/schema";
import { newId } from "../../db/ids";
import type { Tx } from "./db";

export interface ActivityInput {
  groupId: string;
  /** The member who did it; null for the system. */
  actorId: string | null;
  /** For example `group.created`, `member.joined`. */
  kind: string;
  entityId?: string;
  /** `{ field: [old, new] }` for changes, or other details. */
  diff?: Record<string, unknown>;
}

/**
 * Records one activity row. Every write goes through a service inside a single transaction that also
 * calls this (ARCHITECTURE.md section 3), so the feed never misses a change.
 */
export async function recordActivity(tx: Tx, input: ActivityInput): Promise<void> {
  await tx.insert(activity).values({
    id: newId(),
    groupId: input.groupId,
    actorId: input.actorId,
    kind: input.kind,
    entityId: input.entityId ?? null,
    diff: input.diff ?? null,
  });
}

/** `{ field: [old, new] }` for the fields that differ. */
export function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const [field, value] of Object.entries(after)) {
    if (value !== undefined && before[field] !== value) diff[field] = [before[field], value];
  }
  return diff;
}
