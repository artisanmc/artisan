import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteServerDialog } from "./DeleteServerDialog";

describe("DeleteServerDialog", () => {
  it("disables confirm button until the user types the exact label", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteServerDialog
        server={{ id: "sk1", label: "Survival", projectCount: 2 }}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const btn = screen.getByRole("button", { name: /delete server|supprimer le serveur/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Survival" } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });
});
