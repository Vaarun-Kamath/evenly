import { runMigrations } from "../../src/db/migrate";
import { TEMPLATE_DB, recreateTemplateDatabase, urlForDatabase } from "./testDb";

/** Builds the migrated template database once per run; each test file copies it. */
export default async function setup(): Promise<void> {
  await recreateTemplateDatabase();
  await runMigrations(urlForDatabase(TEMPLATE_DB));
}
