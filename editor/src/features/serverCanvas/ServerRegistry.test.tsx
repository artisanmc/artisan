import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ServerRegistry } from "./ServerRegistry";
import type { RegistryGroup, RegistryItem } from "./registryTree";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#screen" className={className}>
      {children}
    </a>
  ),
}));

const item = (projectId: string, docId: string, linked = true): RegistryItem => ({
  key: `${projectId}/${docId}`,
  projectId,
  docId,
  kind: "menu",
  label: docId,
  linked,
});

const core: RegistryGroup = {
  id: "core",
  label: "Core",
  moduleId: null,
  projectIds: ["core"],
  hidden: false,
  sections: [
    { kind: "menu", items: [item("core", "menu_accueil"), item("core", "menu_vide", false)] },
  ],
  screens: [],
};
const boutique: RegistryGroup = {
  id: "module:boutique",
  label: "Boutique",
  moduleId: "boutique",
  projectIds: ["boutique_shop"],
  hidden: true,
  sections: [{ kind: "menu", items: [item("boutique_shop", "menu_catalogue")] }],
  screens: [
    { id: "catalogue", moduleId: "boutique", label: "Catalogue", table: "t", projectId: "p" },
  ],
};

function setup(groups: RegistryGroup[], selected?: string) {
  const onToggleGroup = vi.fn();
  const onSelect = vi.fn();
  render(
    <ServerRegistry
      networkId="n"
      serverId="s"
      groups={groups}
      unlinked={[item("core", "menu_vide", false)]}
      selected={selected}
      query=""
      onQueryChange={vi.fn()}
      onToggleGroup={onToggleGroup}
      onSelect={onSelect}
    />,
  );
  return { onToggleGroup, onSelect };
}

describe("ServerRegistry", () => {
  it("opens the group holding the selection, and leaves the others folded", () => {
    setup([core, boutique], "core/menu_accueil");
    expect(screen.getByRole("button", { name: /menu_accueil/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByText("Catalogue")).toBeNull();
  });

  it("the checkbox filters the board; the chevron only folds", () => {
    const { onToggleGroup } = setup([core, boutique]);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false]);
    fireEvent.click(boxes[1]!);
    expect(onToggleGroup).toHaveBeenCalledWith(boutique);

    fireEvent.click(screen.getByRole("button", { name: /Boutique/ }));
    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Catalogue")).toBeInTheDocument();
  });

  it("selects a Document from the unlinked list", () => {
    const { onSelect } = setup([core, boutique]);
    const rows = screen.getAllByRole("button", { name: /menu_vide/ });
    fireEvent.click(rows[rows.length - 1]!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "core/menu_vide" }));
  });

  it("shows a lone ordinary project without a group header", () => {
    setup([core]);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /menu_accueil/ })).toBeInTheDocument();
  });
});
