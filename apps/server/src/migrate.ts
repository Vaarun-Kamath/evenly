// `node dist/migrate.js`: applies pending migrations and exits. The server also does this at startup.
import { runMigrations } from "./db/migrate";
import { EnvError, loadEnv } from "./env";

try {
  const env = loadEnv();
  await runMigrations(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, {
    log: (message) => console.log(`migrate: ${message}`),
  });
  console.log("migrate: done");
} catch (error) {
  console.error(error instanceof EnvError ? error.message : error);
  process.exit(1);
}
