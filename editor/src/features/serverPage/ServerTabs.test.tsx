import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { ServerTabs } from "./ServerTabs";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    params: _params,
    ...rest
  }: { to: string; children: ReactNode; params?: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const ALL = ["artisan.editor.stats", "artisan.editor.config"];
const tabs = () => screen.getByRole("navigation", { name: "Sections du serveur" });

describe("ServerTabs", () => {
  it("keeps the row to the daily tabs, the others under More", async () => {
    render(<ServerTabs serverId="s" active="/servers/$serverId" permissions={ALL} />);
    expect(
      within(tabs())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Vue d'ensemble", "Ressources", "Jeu", "Assistant", "Statistiques"]);
    await userEvent.click(within(tabs()).getByRole("button", { name: "Plus" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Sources de données",
      "Mises à jour",
      "Imports",
      "Réglages",
    ]);
  });

  it("names the tab shown on the button when it is one of More, and leaves out what needs a permission", async () => {
    render(<ServerTabs serverId="s" active="/servers/$serverId/settings" permissions={[]} />);
    const button = within(tabs()).getByRole("button", { name: "Réglages" });
    expect(button.getAttribute("aria-current")).toBe("page");
    expect(within(tabs()).queryByRole("link", { name: "Statistiques" })).toBeNull();
    await userEvent.click(button);
    expect(screen.queryByRole("menuitem", { name: "Imports" })).toBeNull();
  });
});
