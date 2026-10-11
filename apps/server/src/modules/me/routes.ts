import {
  deleteAccountRequestSchema,
  meResponseSchema,
  updateMeRequestSchema,
} from "@evenly/contracts";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { toFetchHeaders } from "../../auth/http";
import type { Orm } from "../../db/client";
import { ProblemError } from "../../http/problem";
import { actorOf } from "../common/routes";
import { deleteAccount, toMe, updateProfile } from "./service";

/** `GET`, `PATCH` and `DELETE /api/v1/me`. Register inside a scope that has `requireSession`. */
export function registerMeRoutes(scope: FastifyInstance, orm: Orm, auth: Auth): void {
  const routes = scope.withTypeProvider<ZodTypeProvider>();

  routes.get("/me", { schema: { response: { 200: meResponseSchema } } }, (request) => {
    actorOf(request); // fails loudly if this route is ever mounted without requireSession
    return toMe(request.sessionUser!);
  });

  routes.patch(
    "/me",
    { schema: { body: updateMeRequestSchema, response: { 200: meResponseSchema } } },
    (request) => updateProfile(orm, actorOf(request).userId, request.body),
  );

  // Deleting an account is permanent, so it asks for the password again.
  routes.delete(
    "/me",
    { schema: { body: deleteAccountRequestSchema, response: { 204: z.null() } } },
    async (request, reply) => {
      const actor = actorOf(request);
      const headers = toFetchHeaders(request);
      try {
        await auth.api.verifyPassword({ body: { password: request.body.password }, headers });
      } catch {
        throw new ProblemError(403, "invalid-password", "That password is not correct.");
      }
      await deleteAccount(orm, actor);

      // The sessions are gone with the account; this tells the browser to drop its cookies too.
      const signOut = await auth.api.signOut({ headers, asResponse: true });
      const cookies = signOut.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.code(204).send(null);
    },
  );
}
