import type { Balances, Expense, Member, Settlement } from "@evenly/contracts";
import { newId } from "../../src/db/ids";
import type { Harness, Session } from "./harness";
import { createGroup, memberIdOf, seedMember } from "./groupHelpers";

/** Alice (owner), Bob (member) and Cara (placeholder), in that join order, in an INR group. */
export interface Trip {
  groupId: string;
  alice: Session;
  bob: Session;
  aId: string;
  bId: string;
  cId: string;
}

export async function startTrip(
  h: Harness,
  options: { simplifyDebts?: boolean; currency?: string } = {},
): Promise<Trip> {
  const alice = await h.signUp({ name: "Alice" });
  const bob = await h.signUp({ name: "Bob" });
  const group = await createGroup(h, alice, {
    name: "Goa Trip",
    currency: options.currency ?? "INR",
    ...(options.simplifyDebts !== undefined && { simplifyDebts: options.simplifyDebts }),
  });
  const aId = await memberIdOf(h, alice, group.id);
  const bId = await seedMember(h, { groupId: group.id, userId: bob.userId, name: "Bob" });
  const cara = (
    await h.as(alice).post(`/groups/${group.id}/members`, { displayName: "Cara" })
  ).json<Member>();
  return { groupId: group.id, alice, bob, aId, bId, cId: cara.id };
}

type Method = "equal" | "exact" | "percent" | "shares";

export interface ExpenseOverrides {
  id?: string;
  description?: string;
  amountMinor?: number;
  currency?: string;
  category?: string;
  expenseDate?: string;
  notes?: string | null;
  payers?: { memberId: string; amountMinor: number }[];
  split?: { method: Method; entries: { memberId: string; value?: string }[] };
  version?: number;
}

/** A valid expense body (Dinner, 1,000.00, paid by `payer`, split equally): override what a test cares about. */
export function expenseBody(trip: Trip, overrides: ExpenseOverrides = {}): Record<string, unknown> {
  const amountMinor = overrides.amountMinor ?? 100000;
  return {
    id: newId(),
    description: "Dinner",
    amountMinor,
    currency: "INR",
    category: "food",
    expenseDate: "2026-10-10",
    notes: null,
    payers: [{ memberId: trip.aId, amountMinor }],
    split: {
      method: "equal",
      entries: [trip.aId, trip.bId, trip.cId].map((memberId) => ({ memberId })),
    },
    ...overrides,
  };
}

export async function addExpense(
  h: Harness,
  who: Session,
  trip: Trip,
  overrides: ExpenseOverrides = {},
): Promise<Expense> {
  const response = await h
    .as(who)
    .post(`/groups/${trip.groupId}/expenses`, expenseBody(trip, overrides));
  if (response.statusCode !== 201) {
    throw new Error(`adding an expense failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<Expense>();
}

export function settlementBody(
  fromMemberId: string,
  toMemberId: string,
  amountMinor: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: newId(),
    fromMemberId,
    toMemberId,
    amountMinor,
    currency: "INR",
    settledOn: "2026-10-11",
    note: null,
    ...overrides,
  };
}

export async function addSettlement(
  h: Harness,
  who: Session,
  trip: Trip,
  from: string,
  to: string,
  amountMinor: number,
): Promise<Settlement> {
  const response = await h
    .as(who)
    .post(`/groups/${trip.groupId}/settlements`, settlementBody(from, to, amountMinor));
  if (response.statusCode !== 201) {
    throw new Error(`adding a settlement failed: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<Settlement>();
}

export async function balancesOf(h: Harness, who: Session, groupId: string): Promise<Balances> {
  return (await h.as(who).get(`/groups/${groupId}/balances`)).json<Balances>();
}

/** Net balances by member id. */
export async function netsOf(
  h: Harness,
  who: Session,
  groupId: string,
): Promise<Record<string, number>> {
  const balances = await balancesOf(h, who, groupId);
  return Object.fromEntries(balances.nets.map((n) => [n.memberId, n.net.amountMinor]));
}
