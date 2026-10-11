import {
  createSettlementRequestSchema,
  groupParamsSchema,
  listSettlementsQuerySchema,
  pageSchema,
  settlementParamsSchema,
  settlementSchema,
  updateSettlementRequestSchema,
} from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import {
  createSettlement,
  deleteSettlement,
  getSettlement,
  listSettlements,
  restoreSettlement,
  updateSettlement,
} from "./service";

/** `/groups/:gid/settlements`. Register inside a scope that has `requireSession`. */
export function registerSettlementRoutes(scope: FastifyInstance, orm: Orm): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();
  const params = settlementParamsSchema;

  routes.get(
    "/groups/:gid/settlements",
    {
      schema: {
        params: groupParamsSchema,
        querystring: listSettlementsQuerySchema,
        response: { 200: pageSchema(settlementSchema) },
      },
    },
    (request) => listSettlements(orm, actorOf(request), request.params.gid, request.query),
  );

  routes.post(
    "/groups/:gid/settlements",
    {
      schema: {
        params: groupParamsSchema,
        body: createSettlementRequestSchema,
        response: { 200: settlementSchema, 201: settlementSchema },
      },
    },
    async (request, reply) => {
      const { settlement, created } = await createSettlement(
        orm,
        actorOf(request),
        request.params.gid,
        request.body,
      );
      return reply.code(created ? 201 : 200).send(settlement);
    },
  );

  routes.get(
    "/groups/:gid/settlements/:sid",
    { schema: { params, response: { 200: settlementSchema } } },
    (request) => getSettlement(orm, actorOf(request), request.params.gid, request.params.sid),
  );

  routes.patch(
    "/groups/:gid/settlements/:sid",
    {
      schema: { params, body: updateSettlementRequestSchema, response: { 200: settlementSchema } },
    },
    (request) =>
      updateSettlement(orm, actorOf(request), request.params.gid, request.params.sid, request.body),
  );

  routes.delete(
    "/groups/:gid/settlements/:sid",
    { schema: { params, response: { 204: z.null() } } },
    async (request, reply) => {
      await deleteSettlement(orm, actorOf(request), request.params.gid, request.params.sid);
      return reply.code(204).send(null);
    },
  );

  routes.post(
    "/groups/:gid/settlements/:sid/restore",
    { schema: { params, response: { 200: settlementSchema } } },
    (request) => restoreSettlement(orm, actorOf(request), request.params.gid, request.params.sid),
  );
}
