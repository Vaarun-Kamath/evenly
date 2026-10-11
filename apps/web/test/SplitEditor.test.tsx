import type { Member } from "@evenly/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SplitEditor } from "../src/features/expenses/SplitEditor";
import { compute, initialState, type ExpenseFormState } from "../src/features/expenses/formState";

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

const MEMBERS = [
  member("a", "Asha", { isYou: true, role: "owner" }),
  member("b", "Bob"),
  member("c", "Cara"),
];

/** The editor as the expense form uses it: the state lives above, the preview is computed from it. */
function Harness({ amount = "1000" }: { amount?: string }) {
  const [state, setState] = useState<ExpenseFormState>(() => ({
    ...initialState(MEMBERS, "id-1", new Date(2026, 9, 11)),
    description: "Dinner",
    amount,
  }));
  return (
    <SplitEditor
      state={state}
      onChange={setState}
      members={MEMBERS}
      allMembers={MEMBERS}
      computed={compute(state, MEMBERS, "INR")}
      currency="INR"
    />
  );
}

const shareOf = (name: string) => screen.getByLabelText(`${name}'s share`).textContent;

describe("SplitEditor", () => {
  it("shows each person's equal share as soon as there is an amount, odd paisa to the first joiner", () => {
    render(<Harness />);
    expect(shareOf("Asha")).toMatch(/333\.34/);
    expect(shareOf("Bob")).toMatch(/333\.33/);
    expect(shareOf("Cara")).toMatch(/333\.33/);
  });

  it("re-divides when someone is unticked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Cara" }));
    expect(shareOf("Asha")).toMatch(/500\.00/);
    expect(shareOf("Bob")).toMatch(/500\.00/);
    expect(shareOf("Cara")).toBe("–");
  });

  it("has Everyone and No one shortcuts", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "No one" }));
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Everyone" }));
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeChecked();
  });

  it("splits by percentage and says what is wrong until the percentages total 100", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: "Percent" }));

    const asha = screen.getByRole("textbox", { name: /Asha/ });
    await user.clear(asha);
    await user.type(asha, "50");
    expect(document.querySelector("p.text-danger")).not.toBeNull();

    const bob = screen.getByRole("textbox", { name: /Bob/ });
    const cara = screen.getByRole("textbox", { name: /Cara/ });
    await user.clear(bob);
    await user.type(bob, "30");
    await user.clear(cara);
    await user.type(cara, "20");
    expect(document.querySelector("p.text-danger")).toBeNull();
    expect(shareOf("Asha")).toMatch(/500\.00/);
    expect(shareOf("Bob")).toMatch(/300\.00/);
    expect(shareOf("Cara")).toMatch(/200\.00/);
  });

  it("splits by exact amounts typed in major units", async () => {
    const user = userEvent.setup();
    render(<Harness amount="600" />);
    await user.click(screen.getByRole("radio", { name: "Exact" }));
    const row = (name: string) => screen.getByRole("textbox", { name: new RegExp(name) });
    await user.type(row("Asha"), "100.50");
    await user.type(row("Bob"), "200");
    await user.type(row("Cara"), "299.50");
    expect(shareOf("Asha")).toMatch(/100\.50/);
    expect(shareOf("Cara")).toMatch(/299\.50/);
    expect(document.querySelector("p.text-danger")).toBeNull();
  });

  it("splits by shares", async () => {
    const user = userEvent.setup();
    render(<Harness amount="400" />);
    await user.click(screen.getByRole("radio", { name: "Shares" }));
    const cara = screen.getByRole("textbox", { name: /Cara/ });
    await user.clear(cara);
    await user.type(cara, "2");
    expect(shareOf("Asha")).toMatch(/100\.00/);
    expect(shareOf("Cara")).toMatch(/200\.00/);
  });

  it("marks the viewer, and the method radios work from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("(you)")).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "How to split" });
    within(group).getByRole("radio", { name: "Equally" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "Exact" })).toBeChecked();
  });
});
