import { z } from "zod";

export const activityItemSchema = z.object({
  id: z.string(),
  /** For example `group.created`, `member.joined`, `member.role_changed`, `invite.revoked`. */
  kind: z.string(),
  actor: z.object({ memberId: z.string(), displayName: z.string() }).nullable(),
  entityId: z.string().nullable(),
  /** `{ field: [old, new] }` for changes; other details for other kinds. */
  diff: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
