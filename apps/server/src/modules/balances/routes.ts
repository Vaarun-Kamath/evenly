import { balancesSchema, groupParamsSchema, overviewSchema } from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import { getBalances, getOverview } from "./service";

/** `GET /groups/:gid/balances` and `GET /me/overview`. Register behind `requireSession`. */
export function registerBalanceRoutes(scope: FastifyInstance, orm: Orm): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/groups/:gid/balances",
    { schema: { params: groupParamsSchema, response: { 200: balancesSchema } } },
    (request) => getBalances(orm, actorOf(request), request.params.gid),
  );

  routes.get("/me/overview", { schema: { response: { 200: overviewSchema } } }, (request) =>
    getOverview(orm, actorOf(request)),
  );
}
