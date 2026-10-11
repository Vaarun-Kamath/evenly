import { MAX_AMOUNT_MINOR } from "@evenly/core";
import { z } from "zod";
import { moneySchema, pageQuerySchema } from "./common";
import { currencyCodeSchema } from "./me";

export const expenseCategorySchema = z.enum([
  "food",
  "groceries",
  "transport",
  "rent",
  "utilities",
  "entertainment",
  "travel",
  "shopping",
  "other",
]);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const splitMethodSchema = z.enum(["equal", "exact", "percent", "shares"]);

export const DESCRIPTION_MAX_LENGTH = 200;
export const NOTES_MAX_LENGTH = 2000;

const amountMinorSchema = z.number().int().min(1).max(MAX_AMOUNT_MINOR);
const idSchema = z.string().min(1).max(64);
/** A calendar date, `YYYY-MM-DD`. */
export const dateSchema = z.iso.date();

export const payerSchema = z.object({ memberId: idSchema, amountMinor: amountMinorSchema });

/**
 * Who shares the cost. `value` depends on the method: absent for `equal`; minor units for `exact`; a
 * percentage such as "33.33" for `percent`; a share weight such as "2" or "1.5" for `shares`.
 */
export const splitSchema = z.object({
  method: splitMethodSchema,
  entries: z
    .array(z.object({ memberId: idSchema, value: z.string().max(40).optional() }))
    .min(1)
    .max(500),
});
export type Split = z.infer<typeof splitSchema>;

const expenseFields = {
  description: z.string().trim().min(1).max(DESCRIPTION_MAX_LENGTH),
  amountMinor: amountMinorSchema,
  currency: currencyCodeSchema,
  category: expenseCategorySchema.default("other"),
  expenseDate: dateSchema,
  notes: z.string().trim().max(NOTES_MAX_LENGTH).nullable().optional(),
  payers: z.array(payerSchema).min(1).max(500),
  split: splitSchema,
};

/**
 * `POST /groups/:gid/expenses`. The id comes from the client (a UUID), so a retry cannot create the
 * expense twice: repeating the same id with the same body returns the existing expense.
 */
export const createExpenseRequestSchema = z.object({ id: z.uuid(), ...expenseFields }).strict();
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

/** `PATCH /groups/:gid/expenses/:eid`: the whole expense again, plus the version that was edited. */
export const updateExpenseRequestSchema = z
  .object({ version: z.number().int().min(1), ...expenseFields })
  .strict();
export type UpdateExpenseRequest = z.infer<typeof updateExpenseRequestSchema>;

export const expenseSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  description: z.string(),
  amount: moneySchema,
  category: expenseCategorySchema,
  expenseDate: dateSchema,
  notes: z.string().nullable(),
  splitMethod: splitMethodSchema,
  payers: z.array(z.object({ memberId: z.string(), amountMinor: z.number().int() })),
  shares: z.array(
    z.object({
      memberId: z.string(),
      amountMinor: z.number().int(),
      /** What was typed: a percentage, a share weight or an amount; null for an equal split. */
      inputValue: z.string().nullable(),
    }),
  ),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  /** Changes with every edit, delete and restore; an edit must name the version it started from. */
  version: z.number().int(),
});
export type Expense = z.infer<typeof expenseSchema>;

export const listExpensesQuerySchema = pageQuerySchema.extend({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  category: expenseCategorySchema.optional(),
  /** Only expenses this member paid for or shares in. */
  memberId: idSchema.optional(),
  /** Text search in the description. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const expenseParamsSchema = z.object({ gid: z.string(), eid: z.string() });
