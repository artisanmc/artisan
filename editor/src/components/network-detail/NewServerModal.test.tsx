import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewServerModal } from "./NewServerModal";

describe("NewServerModal", () => {
  it("calls onCreate with trimmed label when submit clicked", async () => {
    const onCreate = vi.fn();
    render(<NewServerModal open onOpenChange={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Survival  " } });
    // "Create server" / "Créer le serveur"
    fireEvent.click(screen.getByRole("button", { name: /create|créer/i }));
    expect(onCreate).toHaveBeenCalledWith("Survival");
  });

  it("disables submit when label is empty", () => {
    render(<NewServerModal open onOpenChange={() => {}} onCreate={() => {}} />);
    // "Create server" / "Créer le serveur"
    expect(screen.getByRole("button", { name: /create|créer/i })).toBeDisabled();
  });
});
