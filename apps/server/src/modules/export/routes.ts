import { groupParamsSchema } from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import type { Orm } from "../../db/client";
import { actorOf } from "../common/routes";
import { exportGroupCsv } from "./service";

/** `GET /groups/:gid/export.csv`. Register inside a scope that has `requireSession`. */
export function registerExportRoutes(scope: FastifyInstance, orm: Orm): void {
  scope
    .withTypeProvider<ZodTypeProvider>()
    .get(
      "/groups/:gid/export.csv",
      { schema: { params: groupParamsSchema } },
      async (request, reply) => {
        const { filename, stream } = await exportGroupCsv(
          orm,
          actorOf(request),
          request.params.gid,
        );
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${filename}"`)
          .header("cache-control", "no-store")
          .send(stream);
      },
    );
}
