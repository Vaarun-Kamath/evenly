import { z } from "zod";

export const inviteExpirySchema = z.enum(["1d", "7d", "30d", "never"]);
export type InviteExpiry = z.infer<typeof inviteExpirySchema>;

export const MAX_INVITE_USES = 1000;

export const createInviteRequestSchema = z
  .object({
    /** Defaults to the instance setting (INVITE_DEFAULT_TTL_DAYS, 7 days unless changed). */
    expiresIn: inviteExpirySchema.optional(),
    /** Unlimited when omitted. Always 1 for an invite that claims a placeholder. */
    maxUses: z.number().int().min(1).max(MAX_INVITE_USES).optional(),
    /** Binds the invite to this address and emails it (only when the instance can send email). */
    email: z.email().optional(),
    /** The placeholder member this invite lets its holder become. */
    claimMemberId: z.string().optional(),
  })
  .strict();
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;

export const inviteStatusSchema = z.enum(["active", "expired", "revoked", "used-up"]);

export const inviteSchema = z.object({
  id: z.string(),
  createdBy: z.object({ memberId: z.string(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  maxUses: z.number().int().nullable(),
  useCount: z.number().int(),
  revokedAt: z.iso.datetime().nullable(),
  email: z.string().nullable(),
  claimMember: z.object({ memberId: z.string(), displayName: z.string() }).nullable(),
  status: inviteStatusSchema,
});
export type Invite = z.infer<typeof inviteSchema>;

/** The link itself is shown once, when the invite is created; only its hash is stored. */
export const createdInviteSchema = inviteSchema.extend({ url: z.string() });
export type CreatedInvite = z.infer<typeof createdInviteSchema>;

/** What anyone holding a link may see before signing up or logging in. */
export const invitePreviewSchema = z.object({
  group: z.object({
    name: z.string(),
    emoji: z.string().nullable(),
    memberCount: z.number().int(),
  }),
  invitedBy: z.string(),
  /** Set when the link lets its holder take over a placeholder member. */
  claim: z.object({ displayName: z.string() }).nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const acceptInviteResponseSchema = z.object({
  groupId: z.string(),
  memberId: z.string(),
  /** True when a placeholder became this account's membership. */
  claimed: z.boolean(),
  /** True when the account was already a member and nothing changed. */
  alreadyMember: z.boolean(),
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;
