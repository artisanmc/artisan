import type { ElementId, I18nKey, MenuId, Project } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { useUiStore } from "@/state/uiStore";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ItemTooltip } from "./ItemTooltip";

const project = {
  id: "p1",
  defaultLang: "fr",
  i18nKeys: {
    first_title: { fr: "%player_name%" },
    first_lore: { fr: "Ancien lore" },
    second_title: { fr: "Steve" },
    second_lore: { fr: "test" },
  },
  menus: ["first", "second"].map((id) => ({
    id,
    projectId: "p1",
    title: [],
    rows: 6,
    layers: [
      {
        id: `${id}_layer`,
        elements: [
          {
            id: "player",
            positions: "4",
            display: {
              material: "PLAYER_HEAD",
              title: { key: `${id}_title` },
              lore: { key: `${id}_lore` },
            },
            states: [],
          },
        ],
      },
    ],
  })),
  commands: [],
  assets: [],
  dataSources: [],
  importedConnectors: [],
  dialogs: [],
  canvasLayout: {},
} as unknown as Project;

describe("ItemTooltip menu scope", () => {
  beforeEach(() => {
    useAccountStore.setState({
      account: { ...useAccountStore.getState().account, projects: [structuredClone(project)] },
    });
    useUiStore.setState({ activeLang: "fr" });
    useHoverStore.getState().setElement("player" as ElementId, 4, "second" as MenuId);
  });

  it("renders the hovered menu's item and updates its title and lore live", () => {
    render(<ItemTooltip projectId={project.id} />);
    expect(screen.getByText("Steve")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.queryByText("Ancien lore")).not.toBeInTheDocument();

    act(() => {
      for (const [key, value] of [
        ["second_title", "Alex"],
        ["second_lore", "Nouveau lore"],
      ]) {
        useAccountStore.getState().setI18nValue({
          projectId: project.id,
          lt: { key: key as I18nKey },
          lang: "fr",
          value,
        });
      }
    });
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Nouveau lore")).toBeInTheDocument();
    expect(screen.queryByText("Steve")).not.toBeInTheDocument();

    act(() => useHoverStore.getState().setElement("player" as ElementId, 4, "first" as MenuId));
    expect(screen.getByText("Ancien lore")).toBeInTheDocument();
    expect(screen.queryByText("Nouveau lore")).not.toBeInTheDocument();
  });

  it("does not fall back to another menu when the hovered menu disappears", () => {
    render(<ItemTooltip projectId={project.id} />);
    act(() =>
      useAccountStore.setState({
        account: {
          ...useAccountStore.getState().account,
          projects: [{ ...project, menus: [project.menus[0]] }],
        },
      }),
    );
    expect(screen.queryByText("Ancien lore")).not.toBeInTheDocument();
    expect(screen.queryByText("Steve")).not.toBeInTheDocument();
  });

  it("clears the menu scope when hover ends", () => {
    act(() => useHoverStore.getState().setElement(null));
    expect(useHoverStore.getState().menuId).toBeNull();
    render(<ItemTooltip projectId={project.id} />);
    expect(screen.queryByText("Steve")).not.toBeInTheDocument();
  });
});

/**
 * Ce que le serveur rend, l'aperçu doit le rendre : un item capturé porte son
 * propre lore, les lignes du template s'ajoutent dessous.
 */
describe("ItemTooltip over a captured item", () => {
  const captured = {
    id: "p1",
    defaultLang: "fr",
    i18nKeys: { shop_lore: { fr: "Prix : 100" } },
    capturedItems: [
      {
        id: "ci_sword",
        name: "Épée du VIP",
        stackYaml: `item:
  id: minecraft:diamond_sword
  components:
    minecraft:custom_name: '{"text":"Épée du VIP"}'
    minecraft:lore:
      - '{"text":"Tranchante"}'
`,
        display: {},
      },
    ],
    menus: [
      {
        id: "shop",
        projectId: "p1",
        title: [],
        rows: 6,
        layers: [
          {
            id: "shop_layer",
            elements: [
              {
                id: "product",
                positions: "0",
                display: { material: "item:ci_sword", lore: { key: "shop_lore" } },
                states: [],
              },
            ],
          },
        ],
      },
    ],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    dialogs: [],
    canvasLayout: {},
  } as unknown as Project;

  it("shows the captured lore above the element's own lines", () => {
    useAccountStore.setState({
      account: { ...useAccountStore.getState().account, projects: [structuredClone(captured)] },
    });
    useUiStore.setState({ activeLang: "fr" });
    useHoverStore.getState().setElement("product" as ElementId, 0, "shop" as MenuId);
    render(<ItemTooltip projectId={captured.id} />);
    expect(screen.getByText("Tranchante")).toBeInTheDocument();
    expect(screen.getByText("Prix : 100")).toBeInTheDocument();
  });
});
