import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewProjectModal } from "./NewProjectModal";

describe("NewProjectModal", () => {
  it("invokes onCreate with name + description", async () => {
    const onCreate = vi.fn();
    render(<NewProjectModal open onOpenChange={() => {}} serverLabel="Survival" onCreate={onCreate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "Shop" } });
    fireEvent.change(inputs[1]!, { target: { value: "Main shop" } });
    // "Create" / "Créer"
    fireEvent.click(screen.getByRole("button", { name: /^(create|créer)$/i }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Shop", description: "Main shop" });
  });
});
