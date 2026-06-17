import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBarKebabMenu } from "./TopBarKebabMenu";

describe("TopBarKebabMenu", () => {
  const baseProps = {
    onImport: vi.fn(),
    onExport: vi.fn(),
    onExportZip: vi.fn(),
    onOpenPatterns: vi.fn(),
    onDelete: vi.fn(),
  };

  it("renders the kebab trigger button", () => {
    render(<TopBarKebabMenu {...baseProps} />);
    expect(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i)).toBeInTheDocument();
  });

  it("opens menu on click and shows all items", async () => {
    const user = userEvent.setup();
    render(<TopBarKebabMenu {...baseProps} />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    expect(screen.getByText(/Exporter vers le serveur|Export to server|topbar\.exportZip/i)).toBeInTheDocument();
    expect(screen.getByText(/Importer un workspace|Import a workspace|topbar\.import/i)).toBeInTheDocument();
    expect(screen.getByText(/Exporter le workspace|Export workspace|^topbar\.export$/i)).toBeInTheDocument();
    expect(screen.getByText(/Patterns|Aide-mémoire|Cheat sheet|patterns\.title/i)).toBeInTheDocument();
    expect(screen.getByText(/Supprimer|Delete|topbar\.deletePack/i)).toBeInTheDocument();
  });

  it("calls onDelete when Delete item is clicked", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<TopBarKebabMenu {...baseProps} onDelete={onDelete} />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    await user.click(screen.getByText(/Supprimer|Delete|topbar\.deletePack/i));
    expect(onDelete).toHaveBeenCalled();
  });
});
