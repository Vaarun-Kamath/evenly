// `node dist/cli.js <command>`: administration commands for whoever runs the instance.
import { createDatabase } from "./db/client";
import { getOrCreateSessionSecret } from "./db/secret";
import { EnvError, loadEnv } from "./env";
import { createResetLink } from "./cli/reset-password";

const USAGE = `Usage: node dist/cli.js <command>

Commands:
  reset-password <email>   Print a single-use password reset link (valid for one hour)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command !== "reset-password" || args.length !== 1) {
    console.error(USAGE);
    return 2;
  }

  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL);
  try {
    const secret = env.SESSION_SECRET ?? (await getOrCreateSessionSecret(db.orm));
    const link = await createResetLink({ env, orm: db.orm, secret }, args[0]!);
    if (link === undefined) {
      console.error(`No account has the email address ${args[0]!}.`);
      return 1;
    }
    console.log(`Single-use password reset link (valid for one hour):\n\n${link}\n`);
    return 0;
  } finally {
    await db.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof EnvError ? error.message : error);
    process.exit(1);
  },
);
