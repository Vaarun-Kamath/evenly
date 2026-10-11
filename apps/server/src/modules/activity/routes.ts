import {
  activityItemSchema,
  groupParamsSchema,
  pageQuerySchema,
  pageSchema,
} from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import { listActivity } from "./service";

/** `GET /groups/:gid/activity`. Register inside a scope that has `requireSession`. */
export function registerActivityRoutes(scope: FastifyInstance, orm: Orm): void {
  scope.withTypeProvider<ZodTypeProvider>().get(
    "/groups/:gid/activity",
    {
      schema: {
        params: groupParamsSchema,
        querystring: pageQuerySchema,
        response: { 200: pageSchema(activityItemSchema) },
      },
    },
    (request) => listActivity(orm, actorOf(request), request.params.gid, request.query),
  );
}
