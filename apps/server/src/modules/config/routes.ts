import { instanceConfigSchema, type InstanceConfig } from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { user } from "../../db/auth-schema";
import type { Orm } from "../../db/client";
import type { Env } from "../../env";

/** `GET /api/v1/config`: public, so the sign-up and login pages know what to offer. */
export function registerConfigRoutes(
  scope: FastifyInstance,
  options: { orm: Orm; env: Pick<Env, "ALLOW_SIGNUPS">; emailEnabled: boolean },
): void {
  scope
    .withTypeProvider<ZodTypeProvider>()
    .get(
      "/config",
      { schema: { response: { 200: instanceConfigSchema } } },
      async (): Promise<InstanceConfig> => {
        // The first account on a fresh instance is always allowed (ADR-0008).
        const [existing] = await options.orm.select({ id: user.id }).from(user).limit(1);
        const policy = options.env.ALLOW_SIGNUPS;
        return {
          emailEnabled: options.emailEnabled,
          signups:
            policy === "true" || existing === undefined
              ? "open"
              : policy === "invite-only"
                ? "invite-only"
                : "closed",
        };
      },
    );
}
