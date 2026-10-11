import { z } from "zod";
import { currencyCodeSchema } from "./me";

/** Money in the API is always an integer count of minor units plus the currency (ARCHITECTURE.md section 6). */
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: currencyCodeSchema,
});
export type Money = z.infer<typeof moneySchema>;

export const groupRoleSchema = z.enum(["owner", "admin", "member"]);
export type GroupRole = z.infer<typeof groupRoleSchema>;

/** Cursor pagination: `?limit=50&cursor=<opaque>` returns `{ items, nextCursor }`. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const groupParamsSchema = z.object({ gid: z.string() });
export const memberParamsSchema = z.object({ gid: z.string(), mid: z.string() });
export const inviteParamsSchema = z.object({ gid: z.string(), iid: z.string() });
export const tokenParamsSchema = z.object({ token: z.string() });
