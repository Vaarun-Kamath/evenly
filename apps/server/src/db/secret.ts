import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Orm } from "./client";
import { instanceSecrets } from "./schema";

const SESSION_SECRET_NAME = "session_secret";

/**
 * The secret that signs session cookies. Normally the SESSION_SECRET environment variable; when it
 * is not set the instance generates one on first start and keeps it in the database, so that
 * `docker compose up` works with no configuration (ADR-0007). Safe to call from several replicas
 * at once: the first insert wins and everyone reads the same value.
 */
export async function getOrCreateSessionSecret(orm: Orm): Promise<string> {
  const read = async () => {
    const [row] = await orm
      .select({ value: instanceSecrets.value })
      .from(instanceSecrets)
      .where(eq(instanceSecrets.name, SESSION_SECRET_NAME))
      .limit(1);
    return row?.value;
  };

  const existing = await read();
  if (existing !== undefined) return existing;

  await orm
    .insert(instanceSecrets)
    .values({ name: SESSION_SECRET_NAME, value: randomBytes(32).toString("base64url") })
    .onConflictDoNothing();
  const stored = await read();
  if (stored === undefined) throw new Error("Could not store the generated session secret");
  return stored;
}
