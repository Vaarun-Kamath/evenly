import { isSupportedCurrency } from "@evenly/core";
import { z } from "zod";

/** An ISO 4217 code that Evenly supports (see CURRENCY_EXPONENTS in @evenly/core). */
export const currencyCodeSchema = z.string().refine(isSupportedCurrency, "Unsupported currency");

export const NAME_MAX_LENGTH = 100;

/** Response of `GET /api/v1/me` and `PATCH /api/v1/me`. */
export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  /** ISO 4217 code, or null when the user has not chosen one. */
  defaultCurrency: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Body of `PATCH /api/v1/me`: edit the display name and/or the default currency. */
export const updateMeRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX_LENGTH).optional(),
    defaultCurrency: currencyCodeSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Send at least one field to update");
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
