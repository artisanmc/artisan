import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "fr" } }) }));
vi.mock("./MarketingLayout", () => ({
  MarketingLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

describe("LandingPage", () => {
  it("routes visitors to the demo, live offers, account creation and existing wiki guides", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("button", { name: "Essayer ici" })).not.toBeInTheDocument();
    expect(screen.queryByText("Démo en direct")).not.toBeInTheDocument();

    for (const demoLink of screen.getAllByRole("link", { name: "Essayer la démo" })) {
      expect(demoLink).toHaveAttribute("href", "/demo");
      expect(demoLink).toHaveAttribute("target", "_blank");
      expect(demoLink).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByRole("link", { name: "Découvrir les offres" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("link", { name: "Créer mon compte" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Ouvrir le wiki" })).toHaveAttribute("href", "/wiki/");
    expect(
      screen.getByRole("link", { name: "Découvrir le compositeur de titres" }),
    ).toHaveAttribute("href", "/wiki/editor/composed-titles/");
    expect(screen.getByRole("link", { name: "Suivre le guide d’installation" })).toHaveAttribute(
      "href",
      "/wiki/getting-started/install-admin/",
    );
  });
});
