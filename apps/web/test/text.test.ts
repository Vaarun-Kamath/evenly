import type { ActivityItem, Expense, Member, UpdateExpenseRequest } from "@evenly/contracts";
import { describe, expect, it } from "vitest";
import { differences } from "../src/features/expenses/conflict";
import { describeActivity } from "../src/features/groups/activityText";

const member = (id: string, displayName: string, extra: Partial<Member> = {}): Member => ({
  id,
  displayName,
  role: "member",
  isPlaceholder: false,
  isYou: false,
  email: null,
  joinedAt: "2026-10-01T00:00:00.000Z",
  leftAt: null,
  net: { amountMinor: 0, currency: "INR" },
  ...extra,
});

const MEMBERS = [member("a", "Asha", { isYou: true }), member("b", "Bob")];

const item = (kind: string, diff: Record<string, unknown> | null = null): ActivityItem => ({
  id: "1",
  kind,
  actor: { memberId: "a", displayName: "Asha" },
  entityId: "b",
  diff,
  createdAt: "2026-10-11T10:00:00.000Z",
});

describe("describeActivity", () => {
  it("describes expense changes with the amount in the group's currency", () => {
    expect(
      describeActivity(
        item("expense.created", { description: "Dinner", amountMinor: 100000 }),
        MEMBERS,
        "INR",
      ),
    ).toMatch(/^added “Dinner” \(.*1,?000\.00\)$/);
    expect(
      describeActivity(item("expense.deleted", { description: "Dinner" }), MEMBERS, "INR"),
    ).toBe("deleted “Dinner”");
  });

  it("names the people in a payment", () => {
    const text = describeActivity(
      item("settlement.created", { fromMemberId: "b", toMemberId: "a", amountMinor: 5000 }),
      MEMBERS,
      "INR",
    );
    expect(text).toMatch(/^recorded a payment from Bob to Asha \(.*50\.00\)$/);
  });

  it("describes group and membership changes", () => {
    expect(
      describeActivity(item("group.updated", { name: ["Trip", "Goa Trip"] }), MEMBERS, "INR"),
    ).toBe("renamed the group to “Goa Trip”");
    expect(
      describeActivity(item("group.updated", { simplifyDebts: [true, false] }), MEMBERS, "INR"),
    ).toBe("turned off simplify debts");
    expect(describeActivity(item("member.added", { displayName: "Cara" }), MEMBERS, "INR")).toBe(
      "added Cara to the group",
    );
    expect(describeActivity(item("member.joined", { rejoined: true }), MEMBERS, "INR")).toBe(
      "rejoined the group",
    );
    expect(
      describeActivity(item("member.role_changed", { role: ["member", "admin"] }), MEMBERS, "INR"),
    ).toBe("made Bob admin");
    expect(describeActivity(item("invite.created", { claim: "Cara" }), MEMBERS, "INR")).toBe(
      "created a link for Cara to claim",
    );
  });

  it("copes with details it does not expect, and kinds it does not know", () => {
    expect(describeActivity(item("expense.created"), MEMBERS, "INR")).toBe("added “an expense”");
    expect(describeActivity(item("member.claimed", { displayName: 5 }), MEMBERS, "INR")).toBe(
      "took over a placeholder",
    );
    expect(describeActivity(item("something.new"), MEMBERS, "INR")).toBe("something.new");
  });
});

describe("differences", () => {
  const current: Expense = {
    id: "e1",
    groupId: "g1",
    description: "Dinner",
    amount: { amountMinor: 100000, currency: "INR" },
    category: "food",
    expenseDate: "2026-10-09",
    notes: null,
    splitMethod: "equal",
    payers: [{ memberId: "a", amountMinor: 100000 }],
    shares: [],
    createdBy: "a",
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    deletedAt: null,
    version: 2,
  };
  const mine: UpdateExpenseRequest = {
    version: 1,
    description: "Dinner",
    amountMinor: 100000,
    currency: "INR",
    category: "food",
    expenseDate: "2026-10-09",
    notes: null,
    payers: [{ memberId: "a", amountMinor: 100000 }],
    split: { method: "equal", entries: [{ memberId: "a" }, { memberId: "b" }] },
  };

  it("is empty when the other edit changed nothing that matters here", () => {
    expect(differences(current, mine, MEMBERS)).toEqual([]);
  });

  it("lists only what differs, in words", () => {
    const rows = differences(
      { ...current, description: "Dinner at the shack", splitMethod: "shares", notes: "UPI" },
      { ...mine, amountMinor: 120000, payers: [{ memberId: "b", amountMinor: 120000 }] },
      MEMBERS,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Description",
      "Amount",
      "Notes",
      "Paid by",
      "Split",
    ]);
    expect(rows.find((r) => r.label === "Notes")).toMatchObject({ theirs: "UPI", mine: "none" });
    expect(rows.find((r) => r.label === "Paid by")?.theirs).toMatch(/^Asha /);
    expect(rows.find((r) => r.label === "Split")).toMatchObject({
      theirs: "Shares",
      mine: "Equally",
    });
  });
});
