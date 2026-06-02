import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddActionButton } from "./AddActionButton";

describe("AddActionButton", () => {
  it("invokes onAdd with a fresh open_menu step when the user picks open_menu", () => {
    const onAdd = vi.fn();
    render(<AddActionButton onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /ajouter|add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /open_menu/i }));
    expect(onAdd).toHaveBeenCalledWith({ kind: "action", action: { type: "open_menu" } });
  });

  it("invokes onAdd with a fresh IF step when the user picks if", () => {
    const onAdd = vi.fn();
    render(<AddActionButton onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /ajouter|add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^if$/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: "if" }));
    const calledWith = onAdd.mock.calls[0][0];
    expect(calledWith.cases).toHaveLength(1);
    expect(calledWith.cases[0].steps).toEqual([]);
  });
});
