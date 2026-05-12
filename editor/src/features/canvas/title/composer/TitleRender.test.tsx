import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/domain/asset";
import type {
  AssetId,
  I18nKey,
  Menu,
  MenuId,
  MenuTitleLayer,
  Pack,
  PackId,
} from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { MC_TITLE_H, TEX_SCALE } from "../../menuLayout";
import { TitleRender } from "./TitleRender";

// Mock react-konva to render plain divs (no canvas in jsdom). Each shape
// exposes its load-bearing props as data-* attrs so tests can assert layout.
// Click handlers receive a synthetic event with a writable `cancelBubble`
// (matching Konva's KonvaEventObject contract) so the component code path
// that sets `e.cancelBubble = true` still works in jsdom.
type ClickHandler = (e: { cancelBubble: boolean; evt: MouseEvent }) => void;
type DragHandler = (e: {
  evt: DragEvent & { shiftKey: boolean; altKey: boolean };
  target: {
    x: () => number;
    y: () => number;
    position: (p: { x: number; y: number }) => void;
  };
}) => void;

interface FakeDragEvent {
  x: number;
  y: number;
  shiftKey?: boolean;
  altKey?: boolean;
}

function dispatchDragEnd(el: HTMLElement, drag: FakeDragEvent) {
  // The mock attaches the drag handler on the element via a custom event
  // listener registered through `onDragEnd` below.
  const handler = (el as unknown as { __dragEnd?: DragHandler }).__dragEnd;
  if (!handler) throw new Error("element has no drag-end handler");
  const evt = {
    shiftKey: drag.shiftKey ?? false,
    altKey: drag.altKey ?? false,
  } as DragEvent & { shiftKey: boolean; altKey: boolean };
  handler({
    evt,
    target: {
      x: () => drag.x,
      y: () => drag.y,
      position: () => {},
    },
  });
}

vi.mock("react-konva", () => ({
  Rect: (props: {
    fill?: string;
    stroke?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    onClick?: ClickHandler;
  }) => (
    <div
      data-testid="rect"
      data-fill={props.fill}
      data-stroke={props.stroke}
      data-width={props.width}
      data-height={props.height}
      data-x={props.x}
      data-y={props.y}
      onClick={(e) => {
        const evt = { cancelBubble: false, evt: e.nativeEvent as MouseEvent };
        props.onClick?.(evt);
      }}
    />
  ),
  Group: (props: {
    children: React.ReactNode;
    onClick?: ClickHandler;
    onDragEnd?: DragHandler;
    draggable?: boolean;
    x?: number;
    y?: number;
  }) => (
    <div
      data-testid="group"
      data-x={props.x}
      data-y={props.y}
      data-draggable={props.draggable ? "true" : "false"}
      ref={(node) => {
        if (node && props.onDragEnd) {
          (node as unknown as { __dragEnd?: DragHandler }).__dragEnd = props.onDragEnd;
        }
      }}
      onClick={(e) => {
        const evt = { cancelBubble: false, evt: e.nativeEvent as MouseEvent };
        props.onClick?.(evt);
      }}
    >
      {props.children}
    </div>
  ),
  Text: (props: { text?: string; fill?: string; x?: number; y?: number }) => (
    <div
      data-testid="konva-text"
      data-text={props.text}
      data-fill={props.fill}
      data-x={props.x}
      data-y={props.y}
    />
  ),
  Image: (props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) => (
    <div
      data-testid="konva-image"
      data-x={props.x}
      data-y={props.y}
      data-width={props.width}
      data-height={props.height}
    />
  ),
}));

vi.mock("use-image", () => ({ default: () => [{ src: "fake://img" }, "loaded"] }));

// Mock McFontText so the bitmap-font path is observable without seeding glyph PNGs.
vi.mock("../McFontText", () => ({
  McFontText: (props: {
    text: string;
    font: { id: string };
    x: number;
    y: number;
    scale: number;
  }) => (
    <div
      data-testid="mc-font-text"
      data-text={props.text}
      data-font-id={props.font.id}
      data-x={props.x}
      data-y={props.y}
      data-scale={props.scale}
    />
  ),
}));

// Mock MiniMessageKonvaText to assert the vector fallback path independently.
vi.mock("../../MiniMessageKonvaText", () => ({
  MiniMessageKonvaText: (props: {
    source: string;
    x: number;
    y: number;
    fontSize: number;
  }) => (
    <div
      data-testid="mm-text"
      data-source={props.source}
      data-x={props.x}
      data-y={props.y}
      data-font-size={props.fontSize}
    />
  ),
}));

// Stub ResizeHandles so we can detect when it's mounted (4 anchors per the
// real component). We render 4 placeholder rects each tagged with
// data-corner so test assertions match the real visual.
vi.mock("./ResizeHandles", () => ({
  ResizeHandles: (props: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => (
    <div
      data-testid="resize-handles"
      data-x={props.x}
      data-y={props.y}
      data-width={props.width}
      data-height={props.height}
    >
      <div data-testid="resize-anchor" data-corner="nw" />
      <div data-testid="resize-anchor" data-corner="ne" />
      <div data-testid="resize-anchor" data-corner="sw" />
      <div data-testid="resize-anchor" data-corner="se" />
    </div>
  ),
}));

// Must mirror the value used in TitleRender.tsx — a near-zero-alpha fill so
// the backdrop Rect remains clickable but doesn't paint a visible block.
const BACKDROP_FILL = "rgba(0,0,0,0.001)";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const ASSET_BG = "asset_bg" as AssetId;
const ASSET_GLYPH = "asset_glyph" as AssetId;
const ASSET_FONT = "asset_font" as AssetId;
const I18N_KEY = "lt_title" as I18nKey;

const FONT_ASSET: Asset = {
  id: ASSET_FONT,
  serverKeyId: "sk",
  type: "font",
  name: "default",
  width: 0,
  height: 0,
  ascent: null,
  codepoint: null,
  fontMeta: {
    namespace: "interfaze",
    glyphMap: [
      { char: "H", texture: "interfaze:font/H.png", ascent: 7, height: 8, width: 6 },
    ],
  },
  contentHash: "fh",
  createdAt: "",
  updatedAt: "",
};

const GLYPH_ASSET: Asset = {
  id: ASSET_GLYPH,
  serverKeyId: "sk",
  type: "glyph",
  name: "ico",
  width: 12,
  height: 9,
  ascent: 7,
  codepoint: 0xe000,
  fontMeta: null,
  contentHash: "gh",
  createdAt: "",
  updatedAt: "",
};

function makePack(layers: MenuTitleLayer[]): Pack {
  return {
    id: PACK_ID,
    name: "Test Pack",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      {
        id: MENU_ID,
        packId: PACK_ID,
        title: layers,
        rows: 6,
        layers: [],
      } as Menu,
    ],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { [I18N_KEY]: { en: "Hello" } },
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };
}

function seedPack(layers: MenuTitleLayer[]): Menu {
  const pack = makePack(layers);
  useAccountStore.setState((state) => ({
    account: {
      ...state.account,
      packs: [pack],
      packOrder: [PACK_ID],
    },
  }));
  return pack.menus[0]!;
}

function getTitle(): MenuTitleLayer[] {
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PACK_ID)!;
  return pack.menus.find((m) => m.id === MENU_ID)!.title;
}

beforeEach(() => {
  useAssetStore.getState().reset();
  useUiStore.setState({
    selectedLayerKey: null,
    selectedMenuId: null,
    lastSelectedMenuId: null,
    hiddenLayerKeys: new Set<string>(),
  } as never);
});

describe("TitleRender", () => {
  it("renders an invisible title-bar backdrop (transparent fill, still hit-testable)", () => {
    seedPack([]);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    // The backdrop uses a near-zero-alpha fill so it stays clickable but
    // doesn't paint a grey block over the chest's title row (vanilla MC
    // chests have no such block — title text floats over the wood texture).
    expect(rects.some((r) => r.getAttribute("data-fill") === BACKDROP_FILL)).toBe(true);
  });

  it("renders one Group per layer in declared order (3 layers → 3 groups)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "background", assetId: ASSET_BG },
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    expect(screen.getAllByTestId("group")).toHaveLength(3);
  });

  it("text layer WITHOUT fontAssetId uses MiniMessageKonvaText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const mm = screen.getByTestId("mm-text");
    expect(mm.getAttribute("data-source")).toBe("Hello");
    expect(screen.queryByTestId("mc-font-text")).toBeNull();
  });

  it("text layer WITH fontAssetId resolving to a font asset uses McFontText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5, fontAssetId: ASSET_FONT },
    ];
    seedPack(layers);
    useAssetStore.getState().setAssets([FONT_ASSET]);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const fontText = screen.getByTestId("mc-font-text");
    expect(fontText.getAttribute("data-text")).toBe("Hello");
    expect(fontText.getAttribute("data-font-id")).toBe(ASSET_FONT);
    expect(screen.queryByTestId("mm-text")).toBeNull();
  });

  it("background layer sits at y = MC_TITLE_H * scale and is NOT draggable", () => {
    const layers: MenuTitleLayer[] = [{ kind: "background", assetId: ASSET_BG }];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-x")).toBe("0");
    expect(groups[0]?.getAttribute("data-y")).toBe(String(MC_TITLE_H * TEX_SCALE));
    expect(groups[0]?.getAttribute("data-draggable")).toBe("false");
  });

  it("non-background layers are draggable", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 20, y: 4 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.getAttribute("data-draggable")).toBe("true");
    }
  });

  it("click on a layer Group sets uiStore.selectedLayerKey to that menuId/index", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    fireEvent.click(groups[1]!);
    expect(useUiStore.getState().selectedLayerKey).toEqual({
      menuId: MENU_ID,
      index: 1,
    });
    fireEvent.click(groups[0]!);
    expect(useUiStore.getState().selectedLayerKey).toEqual({
      menuId: MENU_ID,
      index: 0,
    });
  });

  it("click on title-bar backdrop clears selection when this menu is selected", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const backdrop = screen
      .getAllByTestId("rect")
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL)!;
    fireEvent.click(backdrop);
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("click on title-bar backdrop sets uiStore.selectedMenuId to this menu's id (P1.10)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    // Start with no menu selected.
    expect(useUiStore.getState().selectedMenuId).toBeNull();
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const backdrop = screen
      .getAllByTestId("rect")
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL)!;
    fireEvent.click(backdrop);
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    // setSelectedMenuId also bumps the sticky lastSelectedMenuId mirror.
    expect(useUiStore.getState().lastSelectedMenuId).toBe(MENU_ID);
  });

  it("click on title-bar backdrop when already selected keeps menu selected and clears matching layer (P1.10)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    useUiStore.setState({
      selectedMenuId: MENU_ID,
      lastSelectedMenuId: MENU_ID,
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const backdrop = screen
      .getAllByTestId("rect")
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL)!;
    fireEvent.click(backdrop);
    // Menu stays selected.
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    // The layer that belonged to this menu is cleared.
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("backdrop click does NOT clear another menu's layer selection (scoped to this menu)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    // Pre-existing layer selection belongs to a DIFFERENT menu — we shouldn't
    // touch it when clicking THIS menu's title bar.
    useUiStore.setState({
      selectedLayerKey: { menuId: "other-menu" as MenuId, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const backdrop = screen
      .getAllByTestId("rect")
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL)!;
    fireEvent.click(backdrop);
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    expect(useUiStore.getState().selectedLayerKey).toEqual({
      menuId: "other-menu",
      index: 0,
    });
  });

  it("selected layer shows a yellow 1-px stroke outline", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    const yellow = rects.find((r) => r.getAttribute("data-stroke") === "#eab308");
    expect(yellow).toBeTruthy();
  });

  it("no selection outline when nothing is selected", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    expect(rects.some((r) => r.getAttribute("data-stroke") === "#eab308")).toBe(false);
  });

  it("selection outline is scoped to the selected menu (different menu = no outline)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: "other-menu" as MenuId, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    expect(rects.some((r) => r.getAttribute("data-stroke") === "#eab308")).toBe(false);
  });

  it("selected image layer ALSO shows ResizeHandles (4 anchors)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedPack(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    useUiStore.setState({
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    expect(screen.getByTestId("resize-handles")).toBeTruthy();
    expect(screen.getAllByTestId("resize-anchor")).toHaveLength(4);
  });

  it("selected text layer does NOT show ResizeHandles (text isn't resizable)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    expect(screen.queryByTestId("resize-handles")).toBeNull();
  });

  it("unselected image layer does NOT show ResizeHandles", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedPack(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    expect(screen.queryByTestId("resize-handles")).toBeNull();
  });

  it("layer keyed in hiddenLayerKeys is NOT rendered (but still occupies its index)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "text", value: { key: I18N_KEY }, x: 20, y: 0 },
    ];
    seedPack(layers);
    // Hide the middle layer (index 1).
    useUiStore.setState({
      hiddenLayerKeys: new Set([`${MENU_ID}:1`]),
    } as never);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    // Two groups instead of three.
    expect(screen.getAllByTestId("group")).toHaveLength(2);
    // The store still has all three layers (hidden is pure UI state).
    expect(getTitle()).toHaveLength(3);
    // The remaining mm-text nodes should match the two visible text layers
    // (indices 0 and 2), confirming we didn't shift down to render index 1.
    expect(screen.getAllByTestId("mm-text")).toHaveLength(2);
  });

  it("dragging a layer dispatches a position update through useTitleLayerDrag → packStore", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 0, y: 0 },
    ];
    seedPack(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const group = screen.getAllByTestId("group")[0]!;
    // Simulate Konva's onDragEnd at (24px, 10px) in stage coords. At scale=2
    // that's domain (12, 5) before snapping. snapDragPosition rounds to
    // integer MC pixels, so the committed value should be (12, 5).
    dispatchDragEnd(group, { x: 24, y: 10 });
    const layer = getTitle()[0]!;
    if (layer.kind !== "glyph") throw new Error("expected glyph layer");
    expect(layer.x).toBe(12);
    expect(layer.y).toBe(5);
  });
});
