import { defineConfig } from "drizzle-kit";

// Generates SQL migrations into ./drizzle from the two schema files. Run `pnpm db:generate` after
// changing either. Migrations that drizzle-kit cannot express (extensions, triggers) are written
// by hand with `pnpm db:generate --custom --name=<name>`.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
});
