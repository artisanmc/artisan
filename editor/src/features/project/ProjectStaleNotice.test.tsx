import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectStaleNotice } from "./ProjectStaleNotice";

describe("ProjectStaleNotice", () => {
  it("collapses and expands the explanation while keeping the offline status visible", () => {
    render(<ProjectStaleNotice offline />);
    expect(screen.getByText(/affichage de ta dernière visite/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réduire le bandeau" }));
    expect(screen.getByText(/affichage de ta dernière visite/i)).not.toBeVisible();
    expect(screen.getByText("Serveur hors ligne")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Déplier le bandeau" }));
    expect(screen.getByText(/affichage de ta dernière visite/i)).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });
});
