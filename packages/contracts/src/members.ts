import { z } from "zod";
import { groupRoleSchema, moneySchema } from "./common";

export const MEMBER_NAME_MAX_LENGTH = 100;

export const memberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: groupRoleSchema,
  /** A member with no account (yet): named by someone in the group, claimable by invite link. */
  isPlaceholder: z.boolean(),
  isYou: z.boolean(),
  /** Only set for placeholders, where it was typed in by a member; accounts' emails are not shared. */
  email: z.string().nullable(),
  joinedAt: z.iso.datetime(),
  /** Set once the member has left or been removed; they stay visible in history as "(left)". */
  leftAt: z.iso.datetime().nullable(),
  net: moneySchema,
});
export type Member = z.infer<typeof memberSchema>;

export const addPlaceholderRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(MEMBER_NAME_MAX_LENGTH),
    email: z.email().nullable().optional(),
  })
  .strict();
export type AddPlaceholderRequest = z.infer<typeof addPlaceholderRequestSchema>;

/**
 * `role`: the owner promotes or demotes admins, or hands the group over with `"owner"` (the former
 * owner becomes an admin). `displayName` and `email`: an admin renames a placeholder.
 */
export const updateMemberRequestSchema = z
  .object({
    role: groupRoleSchema.optional(),
    displayName: z.string().trim().min(1).max(MEMBER_NAME_MAX_LENGTH).optional(),
    email: z.email().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field to update");
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;
