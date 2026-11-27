import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TopBarKebabMenu } from "./TopBarKebabMenu";

describe("TopBarKebabMenu", () => {
  const baseProps = {
    onImport: vi.fn(),
    onExportZip: vi.fn(),
    onOpenPatterns: vi.fn(),
    onDelete: vi.fn(),
  };

  it("renders the kebab trigger button", () => {
    render(<TopBarKebabMenu {...baseProps} />);
    expect(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i)).toBeInTheDocument();
  });

  it("resumes the tour from the project menu", async () => {
    const user = userEvent.setup();
    const onTour = vi.fn();
    render(<TopBarKebabMenu {...baseProps} onTour={onTour} tourCanResume />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    await user.click(screen.getByRole("menuitem", { name: /Reprendre la visite|Resume the tour/ }));
    expect(onTour).toHaveBeenCalledOnce();
  });

  it("opens menu on click and shows all items", async () => {
    const user = userEvent.setup();
    render(<TopBarKebabMenu {...baseProps} />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    expect(
      screen.getByText(/Exporter le module|Export module|topbar\.exportZip/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Importer un module|Import a module|topbar\.import/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Patterns|Aide-mémoire|Cheat sheet|patterns\.title/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Supprimer|Delete|topbar\.deleteProject/i)).toBeInTheDocument();
  });

  /**
   * The edit panel only appears on selection: project settings, which match no
   * selection, need explicit entry points — the kebab is one.
   */
  it("leaves the project settings to the module's header", async () => {
    const user = userEvent.setup();
    render(<TopBarKebabMenu {...baseProps} />);
    await user.click(screen.getByLabelText(/More actions|Plus d'actions|topbar\.more/i));
    expect(screen.queryByText(/Paramètres du module|Module settings/i)).toBeNull();
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
