import type { ActivityItem, Member } from "@evenly/contracts";
import { money } from "../../lib/format";
import { nameOf } from "../../lib/hooks";

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;
const pair = (value: unknown): [unknown, unknown] | undefined =>
  Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : undefined;

/** A sentence for an activity row ("added Dinner (₹1,000.00)"), without the actor's name. */
export function describeActivity(
  item: ActivityItem,
  members: readonly Member[],
  currency: string,
): string {
  const diff = item.diff ?? {};
  const who = (id: unknown) => (typeof id === "string" ? nameOf(members, id) : "someone");
  const amount = (value: unknown) => {
    const n = asNumber(value);
    return n === undefined ? "" : ` (${money(n, currency)})`;
  };

  switch (item.kind) {
    case "group.created":
      return "created the group";
    case "group.updated": {
      const parts = Object.entries(diff).flatMap(([field, change]) => {
        const values = pair(change);
        if (values === undefined) return [];
        if (field === "name") return [`renamed the group to “${String(values[1])}”`];
        if (field === "emoji") return ["changed the group emoji"];
        if (field === "simplifyDebts")
          return [values[1] === true ? "turned on simplify debts" : "turned off simplify debts"];
        return [`changed ${field}`];
      });
      return parts.length > 0 ? parts.join(" and ") : "changed the group";
    }
    case "group.archived":
      return "archived the group";
    case "group.unarchived":
      return "unarchived the group";
    case "group.deleted":
      return "deleted the group";
    case "member.added":
      return `added ${asString(diff.displayName) ?? "someone"} to the group`;
    case "member.joined":
      return diff.rejoined === true ? "rejoined the group" : "joined the group";
    case "member.claimed": {
      const names = pair(diff.displayName);
      return names === undefined ? "took over a placeholder" : `took over “${String(names[0])}”`;
    }
    case "member.left":
      return diff.reason === "account-deleted"
        ? "deleted their account and left"
        : "left the group";
    case "member.removed":
      return `removed ${asString(diff.displayName) ?? "someone"} from the group`;
    case "member.role_changed": {
      const roles = pair(diff.role);
      return `made ${who(item.entityId)} ${roles === undefined ? "a different role" : `${String(roles[1])}`}`;
    }
    case "member.updated":
      return `updated the details of ${who(item.entityId)}`;
    case "invite.created":
      return asString(diff.claim) === undefined
        ? "created an invitation link"
        : `created a link for ${asString(diff.claim) ?? "someone"} to claim`;
    case "invite.revoked":
      return "cancelled an invitation link";
    case "expense.created":
      return `added “${asString(diff.description) ?? "an expense"}”${amount(diff.amountMinor)}`;
    case "expense.updated": {
      const name = pair(diff.description);
      const fields = Object.keys(diff).join(", ");
      return name === undefined
        ? `changed an expense (${fields})`
        : `changed “${String(name[0])}” (${fields})`;
    }
    case "expense.deleted":
      return `deleted “${asString(diff.description) ?? "an expense"}”${amount(diff.amountMinor)}`;
    case "expense.restored":
      return `restored “${asString(diff.description) ?? "an expense"}”${amount(diff.amountMinor)}`;
    case "settlement.created":
    case "settlement.deleted":
    case "settlement.restored":
    case "settlement.updated": {
      const verb = item.kind.split(".")[1] ?? "changed";
      const past =
        { created: "recorded", deleted: "deleted", restored: "restored", updated: "changed" }[
          verb
        ] ?? verb;
      return `${past} a payment from ${who(diff.fromMemberId)} to ${who(diff.toMemberId)}${amount(diff.amountMinor)}`;
    }
    default:
      return item.kind;
  }
}
