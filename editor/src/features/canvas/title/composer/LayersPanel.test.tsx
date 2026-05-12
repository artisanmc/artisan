import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { I18nKey, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { setStageGeometryProvider } from "@/features/canvas/stageGeometry";
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

/**
 * jsdom doesn't ship PointerEvent — synthesize one that fireEvent + window
 * dispatch understand. Same shape as the polyfill in
 * `AddLayerControls.test.tsx`.
 */
class PointerEventStub extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

function dispatchWindowPointer(type: "pointermove" | "pointerup", x: number, y: number) {
  const evt = new (globalThis as any).PointerEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    pointerId: 1,
  });
  act(() => {
    window.dispatchEvent(evt);
  });
}

const PACK_ID = "p1" as PackId;
const MENU_ID = "shop_menu" as MenuId;
const OTHER_MENU_ID = "other_menu" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(
  layers: MenuTitleLayer[],
  i18nKeys: Record<string, Record<string, string>> = {},
  canvasLayout: Record<string, { x: number; y: number }> = {},
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
          canvasLayout,
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
  // Reset the stage geometry registry so each test starts with no live Stage.
  setStageGeometryProvider(null);
  // PointerEvent + setPointerCapture polyfills (AddLayerControls relies on
  // both during drag gestures; jsdom doesn't implement them).
  if (typeof (globalThis as any).PointerEvent === "undefined") {
    (globalThis as any).PointerEvent = PointerEventStub;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function () {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function () {};
  }
  seedPack([]);
});

afterEach(() => {
  setStageGeometryProvider(null);
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

describe("LayersPanel — cursor-based new-layer attach (P1.11)", () => {
  it("drag-end near menu A's title bar attaches the new layer to menu A with cursor-derived coords", () => {
    // Place MENU_ID at (40, 40) and OTHER_MENU_ID far away so the nearest-
    // menu pick is unambiguous. Title-bar center for MENU_ID = (40+176, 40+17)
    // = (216, 57) in canvas coords. With identity viewport + origin wrapper,
    // screen coords == canvas coords.
    seedPack([], {}, { [MENU_ID]: { x: 40, y: 40 }, [OTHER_MENU_ID]: { x: 800, y: 800 } });
    // Pre-select OTHER_MENU_ID so we can prove the cursor branch overrides
    // the sticky menu when it picks a different target.
    useUiStore.setState({
      selectedMenuId: OTHER_MENU_ID,
      lastSelectedMenuId: OTHER_MENU_ID,
    } as any);

    setStageGeometryProvider(() => ({
      wrapperRect: { left: 0, top: 0, right: 2000, bottom: 1400 },
      viewport: { x: 0, y: 0, scale: 1 },
    }));

    render(<LayersPanel packId={PACK_ID} />);
    const btn = screen.getByTestId("add-layer-image");

    // Pointerdown on the button, then a window pointermove far enough to
    // cross the drag threshold, then a pointerup at canvas (220, 50). The
    // drag-end resolves to MENU_ID with local MC px (220-40)/2=90,
    // (50-40)/2=5.
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 220, 50);
    dispatchWindowPointer("pointerup", 220, 50);

    const pack = useAccountStore.getState().account.packs[0]!;
    const targetMenu = pack.menus.find((m) => m.id === MENU_ID)!;
    const otherMenu = pack.menus.find((m) => m.id === OTHER_MENU_ID)!;
    expect(targetMenu.title).toHaveLength(1);
    expect(otherMenu.title).toHaveLength(0);

    const layer = targetMenu.title[0]!;
    expect(layer.kind).toBe("glyph");
    expect((layer as any).x).toBe(90);
    expect((layer as any).y).toBe(5);

    // Selection should follow: setSelectedMenuId(MENU_ID) +
    // setSelectedLayerKey({ menuId: MENU_ID, index: 0 }).
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 0 });
  });

  it("drag-end far from any menu falls back to lastSelectedMenuId default placement", () => {
    // Both menus parked at small coords; cursor far away (9000, 9000) is
    // well beyond NEAREST_MENU_THRESHOLD_PX.
    seedPack([], {}, { [MENU_ID]: { x: 0, y: 0 }, [OTHER_MENU_ID]: { x: 200, y: 0 } });
    useUiStore.setState({
      selectedMenuId: MENU_ID,
      lastSelectedMenuId: MENU_ID,
    } as any);

    setStageGeometryProvider(() => ({
      wrapperRect: { left: 0, top: 0, right: 10000, bottom: 10000 },
      viewport: { x: 0, y: 0, scale: 1 },
    }));

    render(<LayersPanel packId={PACK_ID} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 9000, 9000);
    dispatchWindowPointer("pointerup", 9000, 9000);

    const pack = useAccountStore.getState().account.packs[0]!;
    const targetMenu = pack.menus.find((m) => m.id === MENU_ID)!;
    // Fallback path → MENU_ID gets the new layer at default (0, 0) coords
    // (image kind default).
    expect(targetMenu.title).toHaveLength(1);
    const layer = targetMenu.title[0]!;
    expect(layer.kind).toBe("glyph");
    expect((layer as any).x).toBe(0);
    expect((layer as any).y).toBe(0);
  });

  it("drag-end with no Stage geometry registered falls back to default placement", () => {
    // No setStageGeometryProvider call → getStageGeometry returns null.
    seedPack([], {}, { [MENU_ID]: { x: 40, y: 40 } });
    useUiStore.setState({
      selectedMenuId: MENU_ID,
      lastSelectedMenuId: MENU_ID,
    } as any);

    render(<LayersPanel packId={PACK_ID} />);
    const btn = screen.getByTestId("add-layer-text");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 220, 50);
    dispatchWindowPointer("pointerup", 220, 50);

    const pack = useAccountStore.getState().account.packs[0]!;
    const targetMenu = pack.menus.find((m) => m.id === MENU_ID)!;
    expect(targetMenu.title).toHaveLength(1);
    const layer = targetMenu.title[0]!;
    expect(layer.kind).toBe("text");
    // Default text placement is (8, 5), not the cursor-derived coords.
    expect((layer as any).x).toBe(8);
    expect((layer as any).y).toBe(5);
  });
});
