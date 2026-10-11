import { z } from "zod";
import { groupRoleSchema, moneySchema } from "./common";
import { currencyCodeSchema } from "./me";

export const GROUP_NAME_MAX_LENGTH = 100;
export const EMOJI_MAX_LENGTH = 16;

const groupNameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX_LENGTH);
const emojiSchema = z.string().trim().min(1).max(EMOJI_MAX_LENGTH);

export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: currencyCodeSchema,
  emoji: z.string().nullable(),
  simplifyDebts: z.boolean(),
  createdAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  /** The caller's role in the group. */
  myRole: groupRoleSchema,
  memberCount: z.number().int(),
  /** The caller's net balance in the group (positive: they are owed money). */
  myBalance: moneySchema,
});
export type Group = z.infer<typeof groupSchema>;

export const archivedFilterSchema = z.enum(["exclude", "only", "include"]);
export const listGroupsQuerySchema = z.object({
  archived: archivedFilterSchema.default("exclude"),
});

export const createGroupRequestSchema = z
  .object({
    name: groupNameSchema,
    currency: currencyCodeSchema,
    emoji: emojiSchema.nullable().optional(),
    simplifyDebts: z.boolean().optional(),
  })
  .strict();
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

/** The currency cannot change once a group exists: every expense in it uses that currency. */
export const updateGroupRequestSchema = z
  .object({
    name: groupNameSchema.optional(),
    emoji: emojiSchema.nullable().optional(),
    simplifyDebts: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field to update");
export type UpdateGroupRequest = z.infer<typeof updateGroupRequestSchema>;
