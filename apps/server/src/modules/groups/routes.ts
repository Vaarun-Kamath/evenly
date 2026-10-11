import {
  createGroupRequestSchema,
  groupParamsSchema,
  groupSchema,
  listGroupsQuerySchema,
  updateGroupRequestSchema,
} from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import {
  createGroup,
  deleteGroup,
  listGroups,
  loadGroup,
  setArchived,
  updateGroup,
} from "./service";

/** `/groups` and `/groups/:gid`. Register inside a scope that has `requireSession`. */
export function registerGroupRoutes(scope: FastifyInstance, orm: Orm): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();
  const params = groupParamsSchema;

  routes.get(
    "/groups",
    { schema: { querystring: listGroupsQuerySchema, response: { 200: z.array(groupSchema) } } },
    (request) => listGroups(orm, actorOf(request), request.query.archived),
  );

  routes.post(
    "/groups",
    { schema: { body: createGroupRequestSchema, response: { 201: groupSchema } } },
    async (request, reply) =>
      reply.code(201).send(await createGroup(orm, actorOf(request), request.body)),
  );

  routes.get("/groups/:gid", { schema: { params, response: { 200: groupSchema } } }, (request) =>
    loadGroup(orm, request.params.gid, actorOf(request)),
  );

  routes.patch(
    "/groups/:gid",
    { schema: { params, body: updateGroupRequestSchema, response: { 200: groupSchema } } },
    (request) => updateGroup(orm, actorOf(request), request.params.gid, request.body),
  );

  routes.delete(
    "/groups/:gid",
    { schema: { params, response: { 204: z.null() } } },
    async (request, reply) => {
      await deleteGroup(orm, actorOf(request), request.params.gid);
      return reply.code(204).send(null);
    },
  );

  routes.post(
    "/groups/:gid/archive",
    { schema: { params, response: { 200: groupSchema } } },
    (request) => setArchived(orm, actorOf(request), request.params.gid, true),
  );

  routes.post(
    "/groups/:gid/unarchive",
    { schema: { params, response: { 200: groupSchema } } },
    (request) => setArchived(orm, actorOf(request), request.params.gid, false),
  );
}
