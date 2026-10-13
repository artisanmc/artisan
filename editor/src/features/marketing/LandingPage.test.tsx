import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "fr" } }) }));
vi.mock("./MarketingLayout", () => ({
  INSTALL_URL: "/wiki/getting-started/install-admin/",
  MarketingLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

describe("LandingPage", () => {
  it("routes visitors to the installation guide and the wiki", () => {
    render(<LandingPage />);
    const install = screen.getAllByRole("link", { name: "Installer Artisan" });
    expect(install).toHaveLength(2);
    for (const link of install)
      expect(link).toHaveAttribute("href", "/wiki/getting-started/install-admin/");
    expect(screen.getByRole("link", { name: "Lire le wiki" })).toHaveAttribute("href", "/wiki/");
    expect(screen.getByRole("link", { name: "Ouvrir le wiki" })).toHaveAttribute("href", "/wiki/");
    expect(
      screen.getByRole("link", { name: "Découvrir le compositeur de titres" }),
    ).toHaveAttribute("href", "/wiki/editor/composed-titles/");
    expect(screen.getByRole("link", { name: "Suivre le guide d’installation" })).toHaveAttribute(
      "href",
      "/wiki/getting-started/install-admin/",
    );
    for (const link of screen.getAllByRole("link"))
      expect(link.getAttribute("href")).not.toMatch(/demo|pricing|signup/);
  });
});
