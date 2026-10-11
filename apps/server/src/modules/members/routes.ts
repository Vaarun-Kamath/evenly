import {
  addPlaceholderRequestSchema,
  groupParamsSchema,
  memberParamsSchema,
  memberSchema,
  updateMemberRequestSchema,
} from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import { addPlaceholder, listMembers, removeMember, updateMember } from "./service";

/** `/groups/:gid/members`. Register inside a scope that has `requireSession`. */
export function registerMemberRoutes(scope: FastifyInstance, orm: Orm): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/groups/:gid/members",
    { schema: { params: groupParamsSchema, response: { 200: z.array(memberSchema) } } },
    (request) => listMembers(orm, actorOf(request), request.params.gid),
  );

  routes.post(
    "/groups/:gid/members",
    {
      schema: {
        params: groupParamsSchema,
        body: addPlaceholderRequestSchema,
        response: { 201: memberSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await addPlaceholder(orm, actorOf(request), request.params.gid, request.body)),
  );

  routes.patch(
    "/groups/:gid/members/:mid",
    {
      schema: {
        params: memberParamsSchema,
        body: updateMemberRequestSchema,
        response: { 200: memberSchema },
      },
    },
    (request) =>
      updateMember(orm, actorOf(request), request.params.gid, request.params.mid, request.body),
  );

  routes.delete(
    "/groups/:gid/members/:mid",
    { schema: { params: memberParamsSchema, response: { 204: z.null() } } },
    async (request, reply) => {
      await removeMember(orm, actorOf(request), request.params.gid, request.params.mid);
      return reply.code(204).send(null);
    },
  );
}
