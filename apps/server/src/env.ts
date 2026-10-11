import { isIP } from "node:net";
import { z } from "zod";
import { deriveBasePath } from "./basePath";

export class EnvError extends Error {
  override name = "EnvError";
}

const NAMED_PROXY_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

/** `TRUST_PROXY`: false | true | hop count | comma-separated IPs/CIDRs (ADR-0002). */
function parseTrustProxy(value: string): boolean | number | string[] {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "false") return false;
  if (trimmed === "true") return true;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) throw new Error("must not be empty");
  for (const entry of entries) {
    if (NAMED_PROXY_RANGES.has(entry)) continue;
    const [address, prefix, ...rest] = entry.split("/");
    const family = isIP(address ?? "");
    const maxPrefix = family === 6 ? 128 : 32;
    const prefixOk =
      prefix === undefined ||
      (/^\d+$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= maxPrefix);
    if (family === 0 || rest.length > 0 || !prefixOk) {
      throw new Error(
        `"${entry}" is not valid. Use false, true, a number of proxy hops, or IPs/CIDRs.`,
      );
    }
  }
  return entries;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  BASE_PATH: z.string().optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((value, ctx) => {
      try {
        return parseTrustProxy(value);
      } catch (error) {
        ctx.issues.push({
          code: "custom",
          message: error instanceof Error ? error.message : "invalid value",
          input: value,
        });
        return z.NEVER;
      }
    }),
  STATIC_DIR: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type Env = z.output<typeof envSchema> & {
  /** `""` at the site root, otherwise `/evenly`-style: no trailing slash. */
  basePath: string;
  publicOrigin: string;
};

/**
 * Reads and validates the process environment. Empty values count as unset. Throws `EnvError`
 * with a readable message; server.ts prints it and exits.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvError(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const data = parsed.data;
  let basePath: string;
  try {
    basePath = deriveBasePath(data.PUBLIC_URL, data.BASE_PATH);
  } catch (error) {
    throw new EnvError(
      `Invalid environment:\n✖ ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { ...data, basePath, publicOrigin: new URL(data.PUBLIC_URL).origin };
}
