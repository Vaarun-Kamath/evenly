import { z } from "zod";

/**
 * `GET /api/v1/config`: what this instance allows, so the app can hide what would not work.
 * It is public, because the sign-up and login pages need it before anyone is signed in.
 */
export const instanceConfigSchema = z.object({
  /** True when the server can send email (password reset, email invitations). */
  emailEnabled: z.boolean(),
  /**
   * Who may create an account right now: `open` (anyone, which is also the case on a fresh instance with no
   * accounts yet), `invite-only` (only with an invitation link) or `closed`.
   */
  signups: z.enum(["open", "invite-only", "closed"]),
});
export type InstanceConfig = z.infer<typeof instanceConfigSchema>;
