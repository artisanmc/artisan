import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBarKebabMenu } from "./TopBarKebabMenu";

describe("TopBarKebabMenu", () => {
  const baseProps = {
    onOpenProjectSettings: vi.fn(),
    onImport: vi.fn(),
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
    expect(screen.getByText(/Exporter le projet|Export project|topbar\.exportZip/i)).toBeInTheDocument();
    expect(screen.getByText(/Importer un projet|Import a project|topbar\.import/i)).toBeInTheDocument();
    expect(screen.getByText(/Patterns|Aide-mémoire|Cheat sheet|patterns\.title/i)).toBeInTheDocument();
    expect(screen.getByText(/Supprimer|Delete|topbar\.deleteProject/i)).toBeInTheDocument();
  });

  /**
   * Le panneau d'édition n'apparaît plus qu'à la sélection : les paramètres du
   * projet, qui ne correspondent à aucune sélection, ont besoin de portes
   * d'entrée explicites — le kebab en est une.
   */
  it("expose les paramètres du projet", async () => {
    const user = userEvent.setup();
    const onOpenProjectSettings = vi.fn();
    render(<TopBarKebabMenu {...baseProps} onOpenProjectSettings={onOpenProjectSettings} />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    await user.click(screen.getByText(/Paramètres du projet|Project settings/i));
    expect(onOpenProjectSettings).toHaveBeenCalled();
  });

  it("calls onDelete when Delete item is clicked", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<TopBarKebabMenu {...baseProps} onDelete={onDelete} />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    await user.click(screen.getByText(/Supprimer|Delete|topbar\.deleteProject/i));
    expect(onDelete).toHaveBeenCalled();
  });
});
