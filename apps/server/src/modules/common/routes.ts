import type { FastifyRequest } from "fastify";
import type { SessionUser } from "../../auth/http";
import type { Actor } from "./db";

/** The signed-in user as the services want them. Routes using this sit behind `requireSession`. */
export function actorOf(request: FastifyRequest): Actor {
  const user: SessionUser | null = request.sessionUser;
  if (user === null) throw new Error("actorOf was used on a route without requireSession");
  return { userId: user.id, name: user.name, email: user.email };
}
