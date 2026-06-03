import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerKebabMenu } from "./ServerKebabMenu";

describe("ServerKebabMenu", () => {
  it("renders all menu items on open and dispatches on click", () => {
    const onAction = vi.fn();
    render(<ServerKebabMenu serverId="sk1" onAction={onAction} />);
    // trigger open — aria-label is translated, match both locales
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    // 5 menu items must be present
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    // "Rotate key…" / "Renouveler la clé…"
    expect(screen.getByRole("menuitem", { name: /rotate|renouveler/i })).toBeInTheDocument();
    // "Connection history" / "Historique de connexion"
    expect(screen.getByRole("menuitem", { name: /history|historique/i })).toBeInTheDocument();
    // "IP allowlist" / "Allowlist d'IP"
    expect(screen.getByRole("menuitem", { name: /allowlist/i })).toBeInTheDocument();
    // "Delete server…" / "Supprimer le serveur…"
    expect(screen.getByRole("menuitem", { name: /delete|supprimer/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /rotate|renouveler/i }));
    expect(onAction).toHaveBeenCalledWith("rotate", "sk1");
  });
});
