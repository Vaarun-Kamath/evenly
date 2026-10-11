import { z } from "zod";
import { moneySchema } from "./common";

const paymentSchema = z.object({
  fromMemberId: z.string(),
  toMemberId: z.string(),
  amount: moneySchema,
});
export type Payment = z.infer<typeof paymentSchema>;

/** `GET /groups/:gid/balances`. */
export const balancesSchema = z.object({
  /** Everyone's net balance, in canonical order; positive means they are owed money. They add up to zero. */
  nets: z.array(z.object({ memberId: z.string(), net: moneySchema })),
  /** The fewest practical payments that settle everyone (the "simplify debts" plan). */
  simplified: z.array(paymentSchema),
  /** Who actually owes whom, pair by pair, from the individual expenses and settlements. */
  pairwise: z.array(
    z.object({ debtorId: z.string(), creditorId: z.string(), amount: moneySchema }),
  ),
  /** Whether the group simplifies debts. */
  simplifyDebts: z.boolean(),
  /** The payments to suggest on the settle-up screen: `simplified` when the group simplifies, else `pairwise`. */
  suggested: z.array(paymentSchema),
});
export type Balances = z.infer<typeof balancesSchema>;

/** `GET /me/overview`: totals across all groups, and a net balance with each person. */
export const overviewSchema = z.object({
  /** Per currency: what you are owed and what you owe, summed over your groups. */
  totals: z.array(
    z.object({
      currency: z.string(),
      owedToYou: z.number().int(),
      youOwe: z.number().int(),
      net: z.number().int(),
    }),
  ),
  /** For each person you share a group with: positive means they owe you. */
  people: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      balances: z.array(moneySchema),
      groups: z.array(
        z.object({ groupId: z.string(), groupName: z.string(), balance: moneySchema }),
      ),
    }),
  ),
});
export type Overview = z.infer<typeof overviewSchema>;
