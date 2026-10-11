import { z } from "zod";
import { moneySchema, pageQuerySchema } from "./common";
import { MAX_AMOUNT_MINOR } from "@evenly/core";
import { dateSchema } from "./expenses";
import { currencyCodeSchema } from "./me";

const amountMinorSchema = z.number().int().min(1).max(MAX_AMOUNT_MINOR);
const idSchema = z.string().min(1).max(64);
export const NOTE_MAX_LENGTH = 500;

const settlementFields = {
  /** The member who paid. */
  fromMemberId: idSchema,
  /** The member who received the money. */
  toMemberId: idSchema,
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  settledOn: dateSchema,
  note: z.string().trim().max(NOTE_MAX_LENGTH).nullable().optional(),
};

/** `POST /groups/:gid/settlements`: client-generated id, idempotent like expenses. */
export const createSettlementRequestSchema = z
  .object({ id: z.uuid(), ...settlementFields })
  .strict();
export type CreateSettlementRequest = z.infer<typeof createSettlementRequestSchema>;

export const updateSettlementRequestSchema = z
  .object({ version: z.number().int().min(1), ...settlementFields })
  .strict();
export type UpdateSettlementRequest = z.infer<typeof updateSettlementRequestSchema>;

export const settlementSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  fromMemberId: z.string(),
  toMemberId: z.string(),
  amount: moneySchema,
  settledOn: dateSchema,
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type Settlement = z.infer<typeof settlementSchema>;

export const listSettlementsQuerySchema = pageQuerySchema.extend({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  /** Only settlements this member paid or received. */
  memberId: idSchema.optional(),
});
export type ListSettlementsQuery = z.infer<typeof listSettlementsQuerySchema>;

export const settlementParamsSchema = z.object({ gid: z.string(), sid: z.string() });
