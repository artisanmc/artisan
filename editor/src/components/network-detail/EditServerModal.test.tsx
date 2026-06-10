import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditServerModal } from "./EditServerModal";

const server = { id: "srv_1", label: "Survie", slug: "survie" };

describe("EditServerModal", () => {
  it("prefills name and slug from the server", () => {
    render(<EditServerModal open onOpenChange={vi.fn()} server={server} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue("Survie")).toBeInTheDocument();
    expect(screen.getByDisplayValue("survie")).toBeInTheDocument();
  });

  it("saves trimmed label and canonical slug, then closes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<EditServerModal open onOpenChange={onOpenChange} server={server} onSave={onSave} />);
    const labelInput = screen.getByDisplayValue("Survie");
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, "  Créatif  ");
    const slugInput = screen.getByDisplayValue("survie");
    await userEvent.clear(slugInput);
    await userEvent.type(slugInput, "Mon Créatif");
    await userEvent.click(screen.getByRole("button", { name: /enregistrer|save/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ label: "Créatif", slug: "mon-creatif" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the slug-taken error and stays open when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("slug_taken"));
    const onOpenChange = vi.fn();
    render(<EditServerModal open onOpenChange={onOpenChange} server={server} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: /enregistrer|save/i }));
    expect(await screen.findByText(/déjà utilisé|already used/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
