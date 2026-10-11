import type { Orm } from "../../db/client";

/** A database transaction: the same query API as the database itself. */
export type Tx = Parameters<Parameters<Orm["transaction"]>[0]>[0];

/** Either the database or an open transaction. */
export type DbOrTx = Orm | Tx;

/** The signed-in user a service acts for. */
export interface Actor {
  userId: string;
  name: string;
  email: string;
}

export function toIso(date: Date): string {
  return date.toISOString();
}

export function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}
