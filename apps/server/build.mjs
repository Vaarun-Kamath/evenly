// Bundles the server into dist/. Production dependencies stay external (they are installed by
// `pnpm deploy --prod`); workspace packages (@evenly/core, @evenly/contracts) are bundled in.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).flatMap((name) => [name, `${name}/*`]);

await build({
  entryPoints: {
    server: "src/server.ts",
    healthcheck: "src/healthcheck.ts",
    migrate: "src/migrate.ts",
    cli: "src/cli.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
});
