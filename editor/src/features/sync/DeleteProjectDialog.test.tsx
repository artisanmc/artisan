import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import i18n from "@/i18n";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

// Force French so test assertions match French locale strings.
beforeAll(async () => {
  await i18n.changeLanguage("fr");
});

describe("DeleteProjectDialog", () => {
  it("disables confirm button until project name is typed exactly", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteProjectDialog projectName="my_pack" onConfirm={onConfirm} onCancel={onCancel} />);

    const confirmBtn = screen.getByRole("button", { name: /supprimer/i });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "my_pack" } });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not enable confirm on near-miss (e.g., trailing space)", () => {
    render(<DeleteProjectDialog projectName="my_pack" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "my_pack " } });
    expect(screen.getByRole("button", { name: /supprimer/i })).toBeDisabled();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<DeleteProjectDialog projectName="my_pack" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /annuler/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
