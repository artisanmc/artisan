import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssetId,
  ElementId,
  I18nKey,
  LayerId,
  Menu,
  MenuId,
  MenuTitleLayer,
  ProjectId,
} from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

import { MenuProperties } from "./MenuProperties";

// Mock AssetPicker so opening the LayerEditForm sub-form doesn't drag in
// the real picker (which needs an auth token + fetch). Matches the mock in
// LayersPanel.test.tsx so the title section can mount cleanly.
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? (
      <button
        type="button"
        data-testid="asset-picker"
        data-usage={props.usage}
        data-project={props.projectId}
        onClick={() => props.onPick({ id: "chosen-image", name: "Chosen image", type: "glyph" })}
      >
        pick
      </button>
    ) : null,
}));

const PACK_ID = "p1" as ProjectId;
const MENU_ID = "shop_menu" as MenuId;

function seedProject() {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      projects: [
        {
          id: PACK_ID,
          name: "my_pack",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [
            {
              id: MENU_ID,
              projectId: PACK_ID,
              title: [],
              rows: 3,
              layers: [],
            },
          ],
          commands: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys: {},
          defaultLang: "en",
          dialogs: [],
          canvasLayout: {},
        },
      ],
      projectOrder: [PACK_ID],
    },
  } as any);
}

beforeEach(() => {
  seedProject();
  useUiStore.setState({
    selectedMenuId: null,
    lastSelectedMenuId: null,
    selectedLayerKey: null,
    hiddenLayerKeys: new Set<string>(),
    draggingNewLayer: null,
    activeLang: "en",
  } as any);
});

describe("MenuProperties — embedded title section", () => {
  it("renders the title section with the LayersPanel for the provided menu", () => {
    const menu = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);

    // Section wrapper present (i18n-agnostic — keyed by data-testid).
    expect(screen.getByTestId("menu-properties-title-section")).toBeInTheDocument();
    // LayersPanel itself mounted (its outer wrapper has data-testid="layers-panel").
    expect(screen.getByTestId("layers-panel")).toBeInTheDocument();
    // The AddLayerControls (the section's primary affordance) is visible.
    expect(screen.getByTestId("add-layer-controls")).toBeInTheDocument();
  });

  it("offers adding an image next to adding text, in composed mode", () => {
    const menu = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);
    const controls = screen.getByTestId("add-layer-controls");
    expect(within(controls).getByTestId("menu-add-image")).toBeInTheDocument();
    expect(within(controls).queryByTestId("add-layer-image")).toBeNull();
  });
});

describe("MenuProperties — background and decorations", () => {
  function show(title: MenuTitleLayer[]) {
    useAccountStore
      .getState()
      .setMenuTitleLayers({ projectId: PACK_ID, menuId: MENU_ID, layers: title });
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: state.account.projects.map((project) => ({
          ...project,
          i18nKeys: { "original-title": { fr: "Boutique", en: "Shop" } },
          menus: project.menus.map((menu) => ({
            ...menu,
            layers: [
              {
                id: "buttons" as LayerId,
                name: "Buttons",
                elements: [
                  {
                    id: "buy" as ElementId,
                    positions: "3",
                    display: { material: "DIAMOND" },
                    states: [],
                  },
                ],
              },
            ],
          })),
        })),
      },
    }));
    const project = useAccountStore.getState().account.projects[0]!;
    const menu = project.menus[0]!;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);
    return menu;
  }
  function choose(label: RegExp, usage: string) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    const picker = screen.getByTestId("asset-picker");
    expect(picker).toHaveAttribute("data-usage", usage);
    expect(picker).toHaveAttribute("data-project", PACK_ID);
    fireEvent.click(picker);
  }
  const current = () => useAccountStore.getState().account.projects[0]!.menus[0]!;

  it("adds a menu image while preserving the plain title and menu elements", () => {
    const value = { key: "original-title" as I18nKey };
    const before = show([{ kind: "plain", value, color: "red" }]);
    fireEvent.click(screen.getByRole("button", { name: /Composé/ }));
    choose(/ajouter une image|add an image/i, "menu");
    expect(current().title).toEqual([
      { kind: "text", value, color: "red", x: 8, y: 5 },
      { kind: "glyph", assetId: "chosen-image", x: 0, y: 0 },
    ]);
    expect(current().layers).toEqual(before.layers);
    expect(useAccountStore.getState().account.projects[0]!.i18nKeys["original-title"]).toEqual({
      fr: "Boutique",
      en: "Shop",
    });
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 1 });
  });

  it("appends an image without changing legacy layers, their positions or visibility", () => {
    const title: MenuTitleLayer[] = [
      { kind: "background", assetId: "old-background" as AssetId },
      { kind: "glyph", assetId: "logo" as AssetId, x: 42, y: 9 },
      { kind: "text", value: { key: "title" as I18nKey }, x: 8, y: 5 },
    ];
    show(title);
    useUiStore.getState().toggleHiddenLayer(MENU_ID, 1);
    choose(/ajouter une image|add an image/i, "menu");
    expect(current().title).toEqual([
      ...title,
      { kind: "glyph", assetId: "chosen-image", x: 0, y: 0 },
    ]);
    expect(useUiStore.getState().hiddenLayerKeys.has(`${MENU_ID}:1`)).toBe(true);
  });

  it("offers one image action without separate background or decoration controls", () => {
    const background: MenuTitleLayer = { kind: "background", assetId: "background" as AssetId };
    show([background]);
    expect(
      screen.queryByRole("button", {
        name: /choisir le fond|retirer le fond|ajouter une décoration/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+ Image$/ })).not.toBeInTheDocument();
    choose(/ajouter une image|add an image/i, "menu");
    expect(current().title).toEqual([
      background,
      { kind: "glyph", assetId: "chosen-image", x: 0, y: 0 },
    ]);
  });
});

// Tests run pinned to French (tests/setup.ts), so labels use French copy.
describe("MenuProperties — inventory type", () => {
  it("renders the three inventory-type options", () => {
    const menu = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);

    expect(screen.getByRole("button", { name: "Coffre" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entonnoir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distributeur" })).toBeInTheDocument();
  });

  it("explains that a hidden bottom frees the player slots for the menu", () => {
    const menu = {
      ...(useAccountStore.getState().account.projects[0]!.menus[0]! as Menu),
      playerInventory: "hidden" as const,
    };
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);
    expect(screen.getByText(/deviennent utilisables pour les boutons du menu/)).toBeInTheDocument();
  });

  it("toggles the player inventory between visible and hidden", () => {
    const menu = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);

    expect(screen.getByRole("button", { name: "Visible" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/voit son propre inventaire/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Masqué" }));
    expect(useAccountStore.getState().account.projects[0]!.menus[0]!.playerInventory).toBe(
      "hidden",
    );
  });

  it("shows the rows selector for a chest menu", () => {
    const menu = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);

    // chest rows 1..6 buttons present
    expect(screen.getByRole("button", { name: "6" })).toBeInTheDocument();
  });

  it("hides the rows selector for a hopper menu", () => {
    const menu = {
      ...(useAccountStore.getState().account.projects[0]!.menus[0]! as Menu),
      inventoryType: "hopper" as const,
    };
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);

    expect(screen.queryByRole("button", { name: "6" })).not.toBeInTheDocument();
    // type selector still visible
    expect(screen.getByRole("button", { name: "Entonnoir" })).toBeInTheDocument();
  });

  it("calls setMenuField with field inventoryType when clicking Hopper", () => {
    const spy = vi.fn();
    const prev = useAccountStore.getState().setMenuField;
    useAccountStore.setState({ setMenuField: spy } as any);

    const menu = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);
    screen.getByRole("button", { name: "Entonnoir" }).click();

    expect(spy).toHaveBeenCalledWith({
      projectId: PACK_ID,
      menuId: MENU_ID,
      field: "inventoryType",
      value: "hopper",
    });

    useAccountStore.setState({ setMenuField: prev } as any);
  });

  it("shows the out-of-range warning when an element exceeds capacity", () => {
    // hopper capacity = 5 slots (indices 0..4); slot 10 is out of range.
    const base = useAccountStore.getState().account.projects[0]!.menus[0]! as Menu;
    const menu: Menu = {
      ...base,
      inventoryType: "hopper",
      layers: [
        {
          ...(base.layers[0] ?? { key: "base", elements: [] }),
          key: "base",
          elements: [{ id: "e1", positions: "10", states: [] } as any],
        } as any,
      ],
    };
    render(<MenuProperties projectId={PACK_ID} menu={menu} />);

    expect(screen.getByText(/hors de l'inventaire/i)).toBeInTheDocument();
  });
});
