import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { I18nKey, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { setStageGeometryProvider } from "@/features/canvas/stageGeometry";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

import { LayersPanel } from "./LayersPanel";
import { menusOf } from "@/domain/documents";

// Mock AssetPicker (used by LayerEditForm sub-form) so opening it doesn't
// drag in the real picker (which needs an auth token + fetch).
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? (
      <button
        type="button"
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

const PACK_ID = "p1" as ProjectId;
const MENU_ID = "shop_menu" as MenuId;
const OTHER_MENU_ID = "other_menu" as MenuId;
const K = (s: string) => s as I18nKey;

function seedProject(
  layers: MenuTitleLayer[],
  i18nKeys: Record<string, Record<string, string>> = {},
  canvasLayout: Record<string, { x: number; y: number }> = {},
) {
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
          documents: {
            menu: [
              { id: MENU_ID, projectId: PACK_ID, title: layers, rows: 3, layers: [] },
              { id: OTHER_MENU_ID, projectId: PACK_ID, title: [], rows: 3, layers: [] },
            ],
            command: [],
            dialog: [],
          },
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys,
          defaultLang: "en",
          canvasLayout,
        },
      ],
      projectOrder: [PACK_ID],
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
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
  seedProject([]);
});

afterEach(() => {
  setStageGeometryProvider(null);
  vi.restoreAllMocks();
});

it("keeps the appearance when clicking the already active composed mode", () => {
  const layers: MenuTitleLayer[] = [
    { kind: "background", assetId: "background" as import("@/domain/types").AssetId },
    { kind: "text", value: { key: K("title") }, x: 8, y: 5 },
  ];
  seedProject(layers, { title: { en: "Shop", fr: "Boutique" } });
  render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);
  fireEvent.click(screen.getByRole("button", { name: /composé/i }));
  const project = useAccountStore.getState().account.projects[0]!;
  expect(menusOf(project)[0]!.title).toEqual(layers);
  expect(project.i18nKeys[K("title")]).toEqual({ en: "Shop", fr: "Boutique" });
});

it("shows the default texture first and restores it when going back to a vanilla title", () => {
  seedProject([{ kind: "text", value: { key: K("title") }, x: 8, y: 5 }]);
  const project = () => useAccountStore.getState().account.projects[0]!;
  useAccountStore.setState((s) => {
    menusOf(s.account.projects[0]!)[0]!.vanillaTexture = false;
    return { account: { ...s.account } };
  });
  render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);
  const rows = screen.getAllByTestId(/vanilla-texture-layer|layer-row-wrapper/);
  expect(rows[0]).toHaveAttribute("data-testid", "vanilla-texture-layer");

  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: /^vanilla$/i }));
  expect(menusOf(project())[0]!.vanillaTexture).toBeUndefined();
});

describe("LayersPanel — body", () => {
  it("shows AddLayerControls + empty LayerEditForm hint for the provided menu", () => {
    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);

    // AddLayerControls present
    expect(screen.getByTestId("add-layer-controls")).toBeInTheDocument();
    // LayerEditForm's empty state is shown (no layer selected)
    expect(
      screen.getByText(/Sélectionne un élément pour modifier ses détails/i),
    ).toBeInTheDocument();
  });

  it("renders nothing when the menuId doesn't resolve in the project", () => {
    const { container } = render(
      <LayersPanel projectId={PACK_ID} menuId={"missing_menu" as MenuId} />,
    );
    // The component returns null — container should be empty.
    expect(container.firstChild).toBeNull();
  });

  it("renders layers in the order they appear in menu.title", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("k1") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k2") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k3") }, x: 0, y: 0 },
    ];
    seedProject(layers, {
      k1: { en: "alpha" },
      k2: { en: "beta" },
      k3: { en: "gamma" },
    });
    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);

    const rows = screen.getAllByTestId("layer-list-item-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toMatch(/alpha/);
    expect(rows[1]!.textContent).toMatch(/beta/);
    expect(rows[2]!.textContent).toMatch(/gamma/);
  });
});

describe("LayersPanel — AddLayerControls wiring", () => {
  it("clicking + Image appends a glyph layer to the provided menu and selects it", () => {
    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);

    // Real browsers synthesize a keyboard-activated click with detail=0 when
    // a focused <button> is hit via Enter/Space; AddLayerControls uses that
    // path to dispatch a "no cursor" placement. fireEvent.click defaults to
    // detail=0 which matches that path.
    fireEvent.click(screen.getByTestId("add-layer-image"));

    const title = menusOf(useAccountStore.getState().account.projects[0]!)[0]!.title;
    expect(title).toHaveLength(1);
    expect(title[0]!.kind).toBe("glyph");
    // Selection moved to the new layer
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 0 });
  });

  it("clicking + Text appends a text layer with an empty value and selects it", () => {
    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);

    fireEvent.click(screen.getByTestId("add-layer-text"));

    const project = useAccountStore.getState().account.projects[0]!;
    const title = menusOf(project)[0]!.title;
    expect(title).toHaveLength(1);
    expect(title[0]).toMatchObject({
      kind: "textarea",
      width: 168,
      alignment: "left",
      lineHeight: 10,
    });
    // Selection moved to the new layer
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 0 });
    // The text layer has an LText whose key is a fresh i18n key; no entry
    // exists yet in i18nKeys for that key (empty value).
    const lt = (title[0] as Extract<MenuTitleLayer, { kind: "text" }>).value;
    expect(typeof lt.key).toBe("string");
    expect(project.i18nKeys[lt.key]).toBeUndefined();
  });
});

describe("LayersPanel — drag-to-reorder", () => {
  it("dragging a layer from index 0 to index 2 reorders the title array", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("k1") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k2") }, x: 0, y: 0 },
      { kind: "text", value: { key: K("k3") }, x: 0, y: 0 },
    ];
    seedProject(layers, {
      k1: { en: "alpha" },
      k2: { en: "beta" },
      k3: { en: "gamma" },
    });
    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);

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

    const title = menusOf(useAccountStore.getState().account.projects[0]!)[0]!.title;
    // alpha moved from 0 → 2, beta and gamma shift left
    expect((title[0] as any).value.key).toBe("k2");
    expect((title[1] as any).value.key).toBe("k3");
    expect((title[2] as any).value.key).toBe("k1");
  });
});

describe("LayersPanel — cross-menu drag-to-attach", () => {
  it("drag-end near menu A's title bar attaches the new layer to menu A and switches selection", () => {
    // Place MENU_ID at (40, 40) and OTHER_MENU_ID far away so the nearest-
    // menu pick is unambiguous. Title-bar center for MENU_ID = (40+176, 40+17)
    // = (216, 57) in canvas coords. With identity viewport + origin wrapper,
    // screen coords == canvas coords.
    seedProject([], {}, { [MENU_ID]: { x: 40, y: 40 }, [OTHER_MENU_ID]: { x: 800, y: 800 } });

    setStageGeometryProvider(() => ({
      wrapperRect: { left: 0, top: 0, right: 2000, bottom: 1400 },
      viewport: { x: 0, y: 0, scale: 1 },
    }));

    // Render the panel scoped to OTHER_MENU_ID — the cursor-driven attach
    // should override and target MENU_ID instead.
    render(<LayersPanel projectId={PACK_ID} menuId={OTHER_MENU_ID} />);
    const btn = screen.getByTestId("add-layer-image");

    // Pointerdown on the button, then a window pointermove far enough to
    // cross the drag threshold, then a pointerup at canvas (220, 50). The
    // drag-end resolves to MENU_ID with local MC px (220-40)/2=90,
    // (50-40)/2=5.
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 220, 50);
    dispatchWindowPointer("pointerup", 220, 50);

    const project = useAccountStore.getState().account.projects[0]!;
    const targetMenu = menusOf(project).find((m) => m.id === MENU_ID)!;
    const otherMenu = menusOf(project).find((m) => m.id === OTHER_MENU_ID)!;
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

  it("drag-end far from any menu falls back to the panel's own menuId default placement", () => {
    // Both menus parked at small coords; cursor far away (9000, 9000) is
    // well beyond NEAREST_MENU_THRESHOLD_PX.
    seedProject([], {}, { [MENU_ID]: { x: 0, y: 0 }, [OTHER_MENU_ID]: { x: 200, y: 0 } });

    setStageGeometryProvider(() => ({
      wrapperRect: { left: 0, top: 0, right: 10000, bottom: 10000 },
      viewport: { x: 0, y: 0, scale: 1 },
    }));

    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 9000, 9000);
    dispatchWindowPointer("pointerup", 9000, 9000);

    const project = useAccountStore.getState().account.projects[0]!;
    const targetMenu = menusOf(project).find((m) => m.id === MENU_ID)!;
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
    seedProject([], {}, { [MENU_ID]: { x: 40, y: 40 } });

    render(<LayersPanel projectId={PACK_ID} menuId={MENU_ID} />);
    const btn = screen.getByTestId("add-layer-text");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 220, 50);
    dispatchWindowPointer("pointerup", 220, 50);

    const project = useAccountStore.getState().account.projects[0]!;
    const targetMenu = menusOf(project).find((m) => m.id === MENU_ID)!;
    expect(targetMenu.title).toHaveLength(1);
    const layer = targetMenu.title[0]!;
    expect(layer.kind).toBe("textarea");
    // Default text placement is (8, 5), not the cursor-derived coords.
    expect((layer as any).x).toBe(8);
    expect((layer as any).y).toBe(5);
  });
});
