import { eq } from "drizzle-orm";
import { createAuth, resetLink } from "../auth/auth";
import type { Orm } from "../db/client";
import { user } from "../db/auth-schema";
import type { Env } from "../env";

/**
 * Creates a single-use password reset link for `email` without sending any email, for instances
 * with no SMTP (SPEC section 4.1). Returns undefined when no user has that address.
 */
export async function createResetLink(
  deps: { env: Env; orm: Orm; secret: string },
  email: string,
): Promise<string | undefined> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await deps.orm
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalized))
    .limit(1);
  if (existing === undefined) return undefined;

  let deliver: (token: string) => void = () => undefined;
  const delivered = new Promise<string>((resolve) => {
    deliver = resolve;
  });
  const auth = createAuth({
    ...deps,
    deliverResetToken: (_email, token) => {
      deliver(token);
      return Promise.resolve();
    },
  });
  await auth.api.requestPasswordReset({
    body: { email: normalized, redirectTo: `${deps.env.PUBLIC_URL.replace(/\/+$/, "")}/reset` },
  });

  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000));
  const token = await Promise.race([delivered, timeout]);
  if (token === undefined) throw new Error("The auth library did not produce a reset token");
  return resetLink(deps.env, token);
}
