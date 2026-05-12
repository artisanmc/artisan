import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { I18nKey, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

import { LayersPanel } from "./LayersPanel";

// Mock AssetPicker (used by LayerEditForm sub-form) so opening it doesn't
// drag in the real picker (which needs an auth token + fetch).
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? (
      <button
        data-testid="asset-picker"
        data-type-filter={props.typeFilter}
        onClick={() => props.onPick({ id: "g_new", name: "x", type: "glyph" })}
      >
        pick
      </button>
    ) : null,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "shop_menu" as MenuId;
const OTHER_MENU_ID = "other_menu" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(
  layers: MenuTitleLayer[],
  i18nKeys: Record<string, Record<string, string>> = {},
) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [
        {
          id: PACK_ID,
          name: "my_pack",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [
            { id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] },
            { id: OTHER_MENU_ID, packId: PACK_ID, title: [], rows: 3, layers: [] },
          ],
          commands: [],
          templates: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys,
          defaultLang: "en",
          dialogs: [],
          canvasLayout: {},
        },
      ],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useUiStore.setState({
    selectedMenuId: null,
    lastSelectedMenuId: null,
    selectedLayerKey: null,
    hiddenLayerKeys: new Set<string>(),
    draggingNewLayer: null,
    activeLang: "en",
  } as any);
  useAssetStore.setState({ assets: [], selectedId: null, loading: false, error: null } as any);
  seedPack([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayersPanel — empty state", () => {
  it("renders the 'select a menu' hint when no menu has been selected", () => {
    render(<LayersPanel packId={PACK_ID} />);
    expect(
      screen.getByText(/Select a menu on the canvas to start editing/i),
    ).toBeInTheDocument();
    // Header should NOT be present in empty state
    expect(screen.queryByTestId("layers-panel-header")).not.toBeInTheDocument();
    // AddLayerControls should NOT be present in empty state
    expect(screen.queryByTestId("add-layer-controls")).not.toBeInTheDocument();
  });
});

describe("LayersPanel — menu selected", () => {
  it("shows header, AddLayerControls, and LayerEditForm when a menu is selected", () => {
    useUiStore.setState({ selectedMenuId: MENU_ID, lastSelectedMenuId: MENU_ID } as any);
    render(<LayersPanel packId={PACK_ID} />);

    // Header shows pack name + menu id
    const header = screen.getByTestId("layers-panel-header");
    expect(header).toBeInTheDocument();
    expect(header.textContent).toMatch(/my_pack/);
    expect(header.textContent).toMatch(/shop_menu/);

    // AddLayerControls present
    expect(screen.getByTestId("add-layer-controls")).toBeInTheDocument();
    // LayerEditForm's "select a layer" empty state is shown (no layer selected)
    expect(screen.getByText(/Select a layer to edit its details/i)).toBeInTheDocument();
  });

  it("renders layers in the order they appear in menu.title", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("k1") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k2") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k3") }, x: 0, y: 0 },
    ];
    seedPack(layers, {
      k1: { en: "alpha" },
      k2: { en: "beta" },
      k3: { en: "gamma" },
    });
    useUiStore.setState({ selectedMenuId: MENU_ID, lastSelectedMenuId: MENU_ID } as any);
    render(<LayersPanel packId={PACK_ID} />);

    const rows = screen.getAllByTestId("layer-list-item-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toMatch(/alpha/);
    expect(rows[1]!.textContent).toMatch(/beta/);
    expect(rows[2]!.textContent).toMatch(/gamma/);
  });
});

describe("LayersPanel — sticky selection", () => {
  it("keeps showing the last menu's layers after selectedMenuId becomes null", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("k1") }, x: 0, y: 0 },
    ];
    seedPack(layers, { k1: { en: "alpha" } });
    // Simulate "user selected the menu, then clicked empty space"
    useUiStore.getState().setSelectedMenuId(MENU_ID);
    useUiStore.getState().setSelectedMenuId(null);
    // Sticky: lastSelectedMenuId still holds MENU_ID
    expect(useUiStore.getState().selectedMenuId).toBeNull();
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_ID);

    render(<LayersPanel packId={PACK_ID} />);
    // Panel should still show that menu's row + header
    expect(screen.getByTestId("layers-panel-header").textContent).toMatch(/shop_menu/);
    expect(screen.getAllByTestId("layer-list-item-row")).toHaveLength(1);
  });
});

describe("LayersPanel — AddLayerControls wiring", () => {
  it("clicking + Image appends a glyph layer to the current menu and selects it", () => {
    useUiStore.setState({ selectedMenuId: MENU_ID, lastSelectedMenuId: MENU_ID } as any);
    render(<LayersPanel packId={PACK_ID} />);

    // Real browsers synthesize a keyboard-activated click with detail=0 when
    // a focused <button> is hit via Enter/Space; AddLayerControls uses that
    // path to dispatch a "no cursor" placement. fireEvent.click defaults to
    // detail=0 which matches that path.
    fireEvent.click(screen.getByTestId("add-layer-image"));

    const title = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    expect(title).toHaveLength(1);
    expect(title[0]!.kind).toBe("glyph");
    // Selection moved to the new layer
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 0 });
  });

  it("clicking + Text appends a text layer with an empty value and selects it", () => {
    useUiStore.setState({ selectedMenuId: MENU_ID, lastSelectedMenuId: MENU_ID } as any);
    render(<LayersPanel packId={PACK_ID} />);

    fireEvent.click(screen.getByTestId("add-layer-text"));

    const pack = useAccountStore.getState().account.packs[0]!;
    const title = pack.menus[0]!.title;
    expect(title).toHaveLength(1);
    expect(title[0]!.kind).toBe("text");
    // Selection moved to the new layer
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 0 });
    // The text layer has an LText whose key is a fresh i18n key; no entry
    // exists yet in i18nKeys for that key (empty value).
    const lt = (title[0] as Extract<MenuTitleLayer, { kind: "text" }>).value;
    expect(typeof lt.key).toBe("string");
    expect(pack.i18nKeys[lt.key]).toBeUndefined();
  });

  it("falls back to lastSelectedMenuId when selectedMenuId is null", () => {
    // Menu was selected then deselected — should still add to the last menu.
    useUiStore.getState().setSelectedMenuId(MENU_ID);
    useUiStore.getState().setSelectedMenuId(null);

    render(<LayersPanel packId={PACK_ID} />);
    fireEvent.click(screen.getByTestId("add-layer-image"));

    const title = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    expect(title).toHaveLength(1);
  });
});

describe("LayersPanel — drag-to-reorder", () => {
  it("dragging a layer from index 0 to index 2 reorders the title array", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("k1") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k2") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k3") }, x: 0, y: 0 },
    ];
    seedPack(layers, {
      k1: { en: "alpha" },
      k2: { en: "beta" },
      k3: { en: "gamma" },
    });
    useUiStore.setState({ selectedMenuId: MENU_ID, lastSelectedMenuId: MENU_ID } as any);
    render(<LayersPanel packId={PACK_ID} />);

    const wrappers = screen.getAllByTestId("layer-row-wrapper");
    expect(wrappers).toHaveLength(3);

    // jsdom's DataTransfer is a stub; we provide our own via the
    // dataTransfer field on the event init. fireEvent threads it through.
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type] ?? "";
      },
      effectAllowed: "move",
      dropEffect: "move",
    };

    fireEvent.dragStart(wrappers[0]!, { dataTransfer });
    fireEvent.dragOver(wrappers[2]!, { dataTransfer });
    fireEvent.drop(wrappers[2]!, { dataTransfer });

    const title = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    // alpha moved from 0 → 2, beta and gamma shift left
    expect((title[0] as any).value.key).toBe("k2");
    expect((title[1] as any).value.key).toBe("k3");
    expect((title[2] as any).value.key).toBe("k1");
  });
});
