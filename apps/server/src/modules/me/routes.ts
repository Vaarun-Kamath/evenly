import { meResponseSchema, updateMeRequestSchema, type MeResponse } from "@evenly/contracts";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { SessionUser } from "../../auth/http";
import type { Orm } from "../../db/client";
import { user } from "../../db/auth-schema";

function toMe(row: {
  id: string;
  name: string;
  email: string;
  defaultCurrency?: string | null | undefined;
  createdAt: Date;
}): MeResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    defaultCurrency: row.defaultCurrency ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `GET` and `PATCH /api/v1/me`. Register inside a scope that has `requireSession`. */
export function registerMeRoutes(scope: FastifyInstance, orm: Orm): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();
  // requireSession ran before these handlers, so the user is set.
  const current = (request: { sessionUser: SessionUser | null }) => request.sessionUser!;

  routes.get("/me", { schema: { response: { 200: meResponseSchema } } }, (request) =>
    toMe(current(request)),
  );

  routes.patch(
    "/me",
    { schema: { body: updateMeRequestSchema, response: { 200: meResponseSchema } } },
    async (request) => {
      const { id } = current(request);
      const { name, defaultCurrency } = request.body;
      const [updated] = await orm
        .update(user)
        .set({
          ...(name !== undefined && { name }),
          ...(defaultCurrency !== undefined && { defaultCurrency }),
        })
        .where(eq(user.id, id))
        .returning();
      // The user exists: they just authenticated as them.
      return toMe(updated!);
    },
  );
}
