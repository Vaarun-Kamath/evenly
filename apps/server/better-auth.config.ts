// Used only by the Better Auth CLI to generate src/db/auth-schema.ts:
//   pnpm --filter @evenly/server auth:generate
// It mirrors the options in src/auth/auth.ts that change the database schema (plugins, extra user
// fields, id format). Keep the two in sync; re-run the generator and then `pnpm db:generate`.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  // The generator only reads the options, so no real database is needed.
  database: drizzleAdapter({}, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      defaultCurrency: { type: "string", required: false, input: false },
    },
  },
  advanced: { database: { generateId: "uuid" } },
});
