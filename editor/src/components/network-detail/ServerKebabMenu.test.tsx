import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServerKebabMenu } from "./ServerKebabMenu";

describe("ServerKebabMenu", () => {
  it("renders all menu items on open and dispatches on click", () => {
    const onAction = vi.fn();
    render(<ServerKebabMenu serverId="sk1" onAction={onAction} />);
    // trigger open — aria-label is translated, match both locales
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    // 5 menu items must be present
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    // "Edit server…" / "Modifier le serveur…"
    expect(screen.getByRole("menuitem", { name: /edit|modifier/i })).toBeInTheDocument();
    // "Re-link / new code…" / "Re-lier / nouveau code…"
    expect(screen.getByRole("menuitem", { name: /re-link|re-lier/i })).toBeInTheDocument();
    // "Connection history" / "Historique de connexion"
    expect(screen.getByRole("menuitem", { name: /history|historique/i })).toBeInTheDocument();
    // "IP allowlist" / "Allowlist d'IP"
    expect(screen.getByRole("menuitem", { name: /allowlist/i })).toBeInTheDocument();
    // "Delete server…" / "Supprimer le serveur…"
    expect(screen.getByRole("menuitem", { name: /delete|supprimer/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /re-link|re-lier/i }));
    expect(onAction).toHaveBeenCalledWith("relink", "sk1");
  });
});
