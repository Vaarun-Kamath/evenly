import {
  acceptInviteResponseSchema,
  createInviteRequestSchema,
  createdInviteSchema,
  groupParamsSchema,
  inviteParamsSchema,
  invitePreviewSchema,
  inviteSchema,
  tokenParamsSchema,
} from "@evenly/contracts";
import rateLimit from "@fastify/rate-limit";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorOf } from "../common/routes";
import {
  acceptInvite,
  createInvite,
  listInvites,
  previewInvite,
  revokeInvite,
  type InviteContext,
} from "./service";

/** `/groups/:gid/invites` and `POST /invites/:token/accept`. Register behind `requireSession`. */
export function registerInviteRoutes(scope: FastifyInstance, ctx: InviteContext): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/groups/:gid/invites",
    { schema: { params: groupParamsSchema, response: { 200: z.array(inviteSchema) } } },
    (request) => listInvites(ctx.orm, actorOf(request), request.params.gid),
  );

  routes.post(
    "/groups/:gid/invites",
    {
      schema: {
        params: groupParamsSchema,
        body: createInviteRequestSchema,
        response: { 201: createdInviteSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await createInvite(ctx, actorOf(request), request.params.gid, request.body)),
  );

  routes.delete(
    "/groups/:gid/invites/:iid",
    { schema: { params: inviteParamsSchema, response: { 204: z.null() } } },
    async (request, reply) => {
      await revokeInvite(ctx.orm, actorOf(request), request.params.gid, request.params.iid);
      return reply.code(204).send(null);
    },
  );

  routes.post(
    "/invites/:token/accept",
    { schema: { params: tokenParamsSchema, response: { 200: acceptInviteResponseSchema } } },
    (request) => acceptInvite(ctx.orm, actorOf(request), request.params.token),
  );
}

/** `GET /invites/:token`: public, so rate-limited per client IP (30 a minute). */
export async function registerPublicInviteRoutes(
  scope: FastifyInstance,
  ctx: InviteContext,
): Promise<void> {
  await scope.register(rateLimit, { global: false });
  scope.withTypeProvider<ZodTypeProvider>().get(
    "/invites/:token",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { params: tokenParamsSchema, response: { 200: invitePreviewSchema } },
    },
    (request) => previewInvite(ctx.orm, request.params.token),
  );
}
