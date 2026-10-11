import { CoreError } from "@evenly/core";
import { conflict } from "../../http/problem";
import type { MemberRow } from "../common/access";

/** What one expense or settlement does to each member's net balance: `paid - owed`, or `+/- amount`. */
export type Effects = Map<string, number>;

export function expenseEffects(
  payers: readonly { memberId: string; amountMinor: number }[],
  shares: readonly { memberId: string; amountMinor: number }[],
): Effects {
  const effects: Effects = new Map();
  for (const { memberId, amountMinor } of payers) {
    effects.set(memberId, (effects.get(memberId) ?? 0) + amountMinor);
  }
  for (const { memberId, amountMinor } of shares) {
    effects.set(memberId, (effects.get(memberId) ?? 0) - amountMinor);
  }
  return effects;
}

export function settlementEffects(from: string, to: string, amountMinor: number): Effects {
  return new Map([
    [from, amountMinor],
    [to, -amountMinor],
  ]);
}

/**
 * Someone who left the group did so with a zero balance, and must stay that way: nothing may be added,
 * changed or restored in a way that gives them a balance again. Anyone can still be in an expense they
 * left behind, as long as what it does to their balance does not change (`before` and `after` agree).
 * Pass an empty `before` when creating, and an empty `after` when removing the effect (a delete).
 */
export function assertLeftMembersUnaffected(
  members: readonly MemberRow[],
  before: Effects,
  after: Effects,
): void {
  for (const member of members) {
    if (member.leftAt === null) continue;
    if ((before.get(member.id) ?? 0) !== (after.get(member.id) ?? 0)) {
      throw conflict(
        "member-left",
        `${member.displayName} has left the group, so this cannot change what ${member.displayName} paid or owes.`,
      );
    }
  }
}

/** Members named by a request must exist in the group; new people must still be in it. */
export function assertKnownMembers(members: readonly MemberRow[], ids: Iterable<string>): void {
  const known = new Set(members.map((member) => member.id));
  for (const id of ids) {
    if (!known.has(id)) {
      throw new CoreError("UNKNOWN_MEMBER", `Member "${id}" is not in this group`, {
        memberId: id,
      });
    }
  }
}
