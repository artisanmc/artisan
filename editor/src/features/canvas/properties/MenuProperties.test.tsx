import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Menu, MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

import { MenuProperties } from "./MenuProperties";

// Mock AssetPicker so opening the LayerEditForm sub-form doesn't drag in
// the real picker (which needs an auth token + fetch). Matches the mock in
// LayersPanel.test.tsx so the title section can mount cleanly.
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? <div data-testid="asset-picker">picker {props.typeFilter}</div> : null,
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
