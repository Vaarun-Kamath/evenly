import { buildApp } from "./app";
import { createDb } from "./db/client";
import { EnvError, loadEnv } from "./env";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof EnvError ? error.message : error);
    process.exit(1);
  }

  const db = createDb(env.DATABASE_URL);
  const app = await buildApp({ env, db });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    try {
      // Stop accepting requests and let in-flight ones finish, then close the database pool.
      await app.close();
      await db.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(
    { publicUrl: env.PUBLIC_URL, basePath: env.basePath || "/" },
    "evenly is ready to serve",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
