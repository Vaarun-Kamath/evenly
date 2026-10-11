import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Dialog, TextField } from "../src/components/ui";

describe("Dialog", () => {
  it("is a modal <dialog> that shows its content only while open", () => {
    const { rerender } = render(
      <Dialog open={false} onClose={() => undefined} title="Rename Bob">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByText("Body")).not.toBeInTheDocument();

    rerender(
      <Dialog open onClose={() => undefined} title="Rename Bob">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Rename Bob" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("tells its owner when the browser closes it (Escape)", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        <p>Body</p>
      </Dialog>,
    );
    screen.getByRole("dialog").dispatchEvent(new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog", () => {
  it("asks before a destructive action, and cancelling does nothing", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete this expense?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        <p>It can be restored later.</p>
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("TextField", () => {
  it("ties the label, hint and error to the input for screen readers", () => {
    render(<TextField label="Email" hint="We never share it." error="Enter a valid email." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAccessibleDescription(/We never share it\./);
    expect(input).toHaveAccessibleDescription(/Enter a valid email\./);
    expect(input).toBeInvalid();
  });
});
