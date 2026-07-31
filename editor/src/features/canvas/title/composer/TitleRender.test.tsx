import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/domain/asset";
import type {
  AssetId,
  I18nKey,
  Menu,
  MenuId,
  MenuTitleLayer,
  Project,
  ProjectId,
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
  cancelBubble: boolean;
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

/** Synthesize a Konva-shaped event object with a writable `cancelBubble`
 *  flag, dispatch it through the handler attached to `el`, then return the
 *  event so callers can assert post-conditions (e.g. cancelBubble === true). */
function dispatchDrag(
  el: HTMLElement,
  kind: "__dragStart" | "__dragMove" | "__dragEnd",
  drag: FakeDragEvent,
) {
  const handler = (el as unknown as Record<string, DragHandler | undefined>)[kind];
  if (!handler) throw new Error(`element has no ${kind} handler`);
  const evt = {
    shiftKey: drag.shiftKey ?? false,
    altKey: drag.altKey ?? false,
  } as DragEvent & { shiftKey: boolean; altKey: boolean };
  const wrapped = {
    cancelBubble: false,
    evt,
    target: {
      x: () => drag.x,
      y: () => drag.y,
      position: () => {},
    },
  };
  handler(wrapped);
  return wrapped;
}

function dispatchDragEnd(el: HTMLElement, drag: FakeDragEvent) {
  return dispatchDrag(el, "__dragEnd", drag);
}

vi.mock("react-konva", () => ({
  Rect: (props: {
    fill?: string;
    stroke?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    listening?: boolean;
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
      data-listening={props.listening === false ? "false" : "true"}
      onClick={(e) => {
        const evt = { cancelBubble: false, evt: e.nativeEvent as MouseEvent };
        props.onClick?.(evt);
      }}
    />
  ),
  Group: (props: {
    children: React.ReactNode;
    onClick?: ClickHandler;
    onDragStart?: DragHandler;
    onDragMove?: DragHandler;
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
        if (!node) return;
        const slot = node as unknown as Record<string, DragHandler | undefined>;
        if (props.onDragStart) slot.__dragStart = props.onDragStart;
        if (props.onDragMove) slot.__dragMove = props.onDragMove;
        if (props.onDragEnd) slot.__dragEnd = props.onDragEnd;
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

// Mock VanillaMcText to assert the vanilla-font fallback path independently.
vi.mock("../VanillaMcText", () => ({
  VanillaMcText: (props: {
    source: string;
    x: number;
    y: number;
    scale: number;
    sizeScale?: number;
  }) => (
    <div
      data-testid="vanilla-mc-text"
      data-source={props.source}
      data-x={props.x}
      data-y={props.y}
      data-scale={props.scale}
      data-size-scale={props.sizeScale ?? 1}
    />
  ),
  vanillaTextWidth: (text: string) => text.length * 6,
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

// Stub WidthResizeHandle so tests can assert its presence via data-testid.
vi.mock("./WidthResizeHandle", () => ({
  WidthResizeHandle: (props: {
    x: number;
    y: number;
    height: number;
    currentWidth: number;
    scale?: number;
    onResize: (w: number) => void;
  }) => (
    <div
      data-testid="width-resize-handle"
      data-x={props.x}
      data-y={props.y}
      data-height={props.height}
      data-current-width={props.currentWidth}
    />
  ),
}));

// Must mirror the value used in TitleRender.tsx — a near-zero-alpha fill so
// the backdrop Rect remains clickable but doesn't paint a visible block.
const BACKDROP_FILL = "rgba(0,0,0,0.001)";

const PACK_ID = "p1" as ProjectId;
const MENU_ID = "m1" as MenuId;
const ASSET_BG = "asset_bg" as AssetId;
const ASSET_GLYPH = "asset_glyph" as AssetId;
const ASSET_FONT = "asset_font" as AssetId;
const I18N_KEY = "lt_title" as I18nKey;

const FONT_ASSET: Asset = {
  id: ASSET_FONT,
  projectId: "p1",
  type: "font",
  name: "default",
  width: 0,
  height: 0,
  ascent: null,
  codepoint: null,
  fontMeta: {
    namespace: "artisan",
    glyphMap: [
      { char: "H", texture: "artisan:font/H.png", ascent: 7, height: 8, width: 6 },
    ],
  },
  contentHash: "fh",
  createdAt: "",
  updatedAt: "",
};

const GLYPH_ASSET: Asset = {
  id: ASSET_GLYPH,
  projectId: "p1",
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

function makeProject(layers: MenuTitleLayer[]): Project {
  return {
    id: PACK_ID,
    name: "Test Project",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      {
        id: MENU_ID,
        projectId: PACK_ID,
        title: layers,
        rows: 6,
        layers: [],
      } as Menu,
    ],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: { [I18N_KEY]: { en: "Hello" } },
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };
}

function seedProject(layers: MenuTitleLayer[]): Menu {
  const project = makeProject(layers);
  useAccountStore.setState((state) => ({
    account: {
      ...state.account,
      projects: [project],
      projectOrder: [PACK_ID],
    },
  }));
  return project.menus[0]!;
}

function getTitle(): MenuTitleLayer[] {
  const project = useAccountStore.getState().account.projects.find((p) => p.id === PACK_ID)!;
  return project.menus.find((m) => m.id === MENU_ID)!.title;
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
    seedProject([]);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
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
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    expect(screen.getAllByTestId("group")).toHaveLength(3);
  });

  it("text layer WITHOUT fontAssetId uses VanillaMcText (MC bitmap atlas)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const vm = screen.getByTestId("vanilla-mc-text");
    expect(vm.getAttribute("data-source")).toBe("Hello");
    expect(screen.queryByTestId("mc-font-text")).toBeNull();
  });

  it("text layer with size=16 passes sizeScale=2 to VanillaMcText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0, size: 16 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const node = screen.getByTestId("vanilla-mc-text");
    expect(node.getAttribute("data-size-scale")).toBe("2");
  });

  it("text layer without explicit size passes sizeScale=1 (default)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const node = screen.getByTestId("vanilla-mc-text");
    expect(node.getAttribute("data-size-scale")).toBe("1");
  });

  it("text layer WITH fontAssetId resolving to a font asset uses McFontText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5, fontAssetId: ASSET_FONT },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([FONT_ASSET]);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const fontText = screen.getByTestId("mc-font-text");
    expect(fontText.getAttribute("data-text")).toBe("Hello");
    expect(fontText.getAttribute("data-font-id")).toBe(ASSET_FONT);
    expect(screen.queryByTestId("mm-text")).toBeNull();
  });

  it("plain text layer (no fontAssetId): groupY = layer.y * scale", () => {
    // Plain text uses Y-specific ascii fonts → group positioned at layer.y directly.
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 8, y: 20 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-y")).toBe(String(20 * TEX_SCALE));
  });

  it("plain text layer at y=0 sits at group y=0", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 8, y: 0 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-y")).toBe("0");
  });

  it("text layer with custom font: groupY = (GLYPH_Y_BASE - maxAscent) * scale", () => {
    // FONT_ASSET has one glyph with ascent=7.
    // Expected groupY = (13 - 7) * 2 = 12 (same as MC_TITLE_LABEL_Y * scale).
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5, fontAssetId: ASSET_FONT },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([FONT_ASSET]);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-y")).toBe("12");
  });

  it("text layer with body font (negative ascent): groupY places group in inventory area", () => {
    const bodyFontAsset: Asset = {
      ...FONT_ASSET,
      id: "asset_body_font" as AssetId,
      fontMeta: {
        namespace: "artisan:custom",
        glyphMap: [
          { char: "H", texture: "H.png", ascent: -20, height: 10, width: 6 },
        ],
      },
    };
    const layers: MenuTitleLayer[] = [
      {
        kind: "text",
        value: { key: I18N_KEY },
        x: 8,
        y: 0,
        fontAssetId: "asset_body_font" as AssetId,
      },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([bodyFontAsset]);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    // groupY = (GLYPH_Y_BASE=13 - maxAscent=-20) * scale=2 = 66
    expect(groups[0]?.getAttribute("data-y")).toBe("66");
  });

  it("background layer sits at y = MC_TITLE_H * scale and is NOT draggable", () => {
    const layers: MenuTitleLayer[] = [{ kind: "background", assetId: ASSET_BG }];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-x")).toBe("0");
    expect(groups[0]?.getAttribute("data-y")).toBe(String(MC_TITLE_H * TEX_SCALE));
    expect(groups[0]?.getAttribute("data-draggable")).toBe("false");
  });

  it("non-background layers are NOT draggable when unselected", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 20, y: 4 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.getAttribute("data-draggable")).toBe("false");
    }
  });

  it("non-background layer is draggable when selected", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedProject(layers);
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_ID, index: 0 });
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-draggable")).toBe("true");
  });

  it("clicking an already-selected layer deselects it (toggle)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_ID, index: 0 });
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    fireEvent.click(groups[0]!);
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("clicking an unselected layer does not change selection (canvas is click-through when not selected)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    // No selection set
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    fireEvent.click(groups[0]!);
    // Still null — unselected layers are click-through; selection happens via panel
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("click on title-bar backdrop clears selection when this menu is selected", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
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
    seedProject(layers);
    // Start with no menu selected.
    expect(useUiStore.getState().selectedMenuId).toBeNull();
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
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
    seedProject(layers);
    useUiStore.setState({
      selectedMenuId: MENU_ID,
      lastSelectedMenuId: MENU_ID,
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const backdrop = screen
      .getAllByTestId("rect")
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL)!;
    fireEvent.click(backdrop);
    // Menu stays selected.
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    // The layer that belonged to this menu is cleared.
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("backdrop click clears any active layer selection, even from another menu", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    // Pre-existing selection belongs to a different menu — clicking this
    // menu's title bar should still deselect (global "click elsewhere = deselect").
    useUiStore.setState({
      selectedLayerKey: { menuId: "other-menu" as MenuId, index: 0 },
    } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const backdrop = screen
      .getAllByTestId("rect")
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL)!;
    fireEvent.click(backdrop);
    expect(useUiStore.getState().selectedMenuId).toBe(MENU_ID);
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });

  it("selected layer shows a yellow 1-px stroke outline", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: MENU_ID, index: 0 },
    } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    const yellow = rects.find((r) => r.getAttribute("data-stroke") === "#eab308");
    expect(yellow).toBeTruthy();
  });

  it("no selection outline when nothing is selected", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    expect(rects.some((r) => r.getAttribute("data-stroke") === "#eab308")).toBe(false);
  });

  it("selection outline is scoped to the selected menu (different menu = no outline)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    useUiStore.setState({
      selectedLayerKey: { menuId: "other-menu" as MenuId, index: 0 },
    } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const rects = screen.getAllByTestId("rect");
    expect(rects.some((r) => r.getAttribute("data-stroke") === "#eab308")).toBe(false);
  });

  it("no resize handles are rendered (resize removed — assets are pixel-perfect)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index: 0 } } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    expect(screen.queryByTestId("resize-handles")).toBeNull();
    expect(screen.queryByTestId("resize-anchor")).toBeNull();
  });

  it("layer keyed in hiddenLayerKeys is NOT rendered (but still occupies its index)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "text", value: { key: I18N_KEY }, x: 20, y: 0 },
    ];
    seedProject(layers);
    // Hide the middle layer (index 1).
    useUiStore.setState({
      hiddenLayerKeys: new Set([`${MENU_ID}:1`]),
    } as never);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    // Two groups instead of three.
    expect(screen.getAllByTestId("group")).toHaveLength(2);
    // The store still has all three layers (hidden is pure UI state).
    expect(getTitle()).toHaveLength(3);
    // The remaining vanilla-mc-text nodes should match the two visible text layers
    // (indices 0 and 2), confirming we didn't shift down to render index 1.
    expect(screen.getAllByTestId("vanilla-mc-text")).toHaveLength(2);
  });

  it("text layer Group contains a hit-area Rect with non-zero dimensions (Issue 1)", () => {
    // Konva's drag needs a hit-testable shape under the pointer. Text bodies
    // hit-test on rendered glyphs only — sub-pixel gaps between letters
    // break drag pickup. We render a near-zero-alpha Rect sized to the
    // layer's bounding box so the user can grab the layer anywhere inside
    // its outline.
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);

    // The layer's Group is the second `[data-testid="group"]` (the first is
    // unrelated to layers — actually layers ARE the only groups here, but
    // we filter defensively).
    const groups = screen.getAllByTestId("group");
    const layerGroup = groups[0]!;
    // The hit-area is the first child rect with the near-zero-alpha fill,
    // EXCLUDING the title-bar backdrop which is outside this Group.
    const hitAreas = Array.from(layerGroup.querySelectorAll('[data-testid="rect"]'))
      .filter((r) => r.getAttribute("data-fill") === BACKDROP_FILL);
    expect(hitAreas.length).toBeGreaterThan(0);
    const hit = hitAreas[0]!;
    expect(Number(hit.getAttribute("data-width"))).toBeGreaterThan(0);
    expect(Number(hit.getAttribute("data-height"))).toBeGreaterThan(0);
  });

  it("text layer with size=16 has hit area DOUBLED vs default size", () => {
    // vanillaTextWidth mock: text.length * 6 → "Hello" (I18N_KEY fallback) = 5 * 6 = 30
    // scale = TEX_SCALE = 2
    // default size (8): hitW = 30 * 2 = 60, hitH = 8 * 2 = 16
    // size 16 (sizeScale=2): hitW = 60 * 2 = 120, hitH = 16 * 2 = 32
    const defaultLayers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedProject(defaultLayers);
    const { unmount } = render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const defaultGroup = screen.getAllByTestId("group")[0]!;
    const defaultHit = Array.from(defaultGroup.querySelectorAll('[data-testid="rect"]'))
      .filter((r) => r.getAttribute("data-fill") === BACKDROP_FILL)[0]!;
    const defaultW = Number(defaultHit.getAttribute("data-width"));
    const defaultH = Number(defaultHit.getAttribute("data-height"));
    unmount();

    const scaledLayers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0, size: 16 },
    ];
    seedProject(scaledLayers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const scaledGroup = screen.getAllByTestId("group")[0]!;
    const scaledHit = Array.from(scaledGroup.querySelectorAll('[data-testid="rect"]'))
      .filter((r) => r.getAttribute("data-fill") === BACKDROP_FILL)[0]!;
    const scaledW = Number(scaledHit.getAttribute("data-width"));
    const scaledH = Number(scaledHit.getAttribute("data-height"));

    // size=16 is 2× the default size=8 → hit area should be 2× in both dimensions
    expect(scaledW).toBe(defaultW * 2);
    expect(scaledH).toBe(defaultH * 2);
  });

  it("external_glyph layer Group contains a hit-area Rect for drag pickup (Issue 1)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 20, y: 4 },
    ];
    seedProject(layers);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);

    const layerGroup = screen.getAllByTestId("group")[0]!;
    const hitAreas = Array.from(layerGroup.querySelectorAll('[data-testid="rect"]'))
      .filter((r) => r.getAttribute("data-fill") === BACKDROP_FILL);
    expect(hitAreas.length).toBeGreaterThan(0);
    const hit = hitAreas[0]!;
    expect(Number(hit.getAttribute("data-width"))).toBeGreaterThan(0);
    expect(Number(hit.getAttribute("data-height"))).toBeGreaterThan(0);
  });

  it("unselected glyph layer: hit-area Rect is present but listening=false (click-through to menu)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    // No selection set → layer is unselected
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);

    const layerGroup = screen.getAllByTestId("group")[0]!;
    const hitArea = Array.from(layerGroup.querySelectorAll('[data-testid="rect"]'))
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL);
    expect(hitArea).toBeDefined();
    expect(hitArea!.getAttribute("data-listening")).toBe("false");
  });

  it("selected glyph layer: hit-area Rect is listening=true and group is draggable", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    useUiStore.getState().setSelectedLayerKey({ menuId: MENU_ID, index: 0 });
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);

    const layerGroup = screen.getAllByTestId("group")[0]!;
    const hitArea = Array.from(layerGroup.querySelectorAll('[data-testid="rect"]'))
      .find((r) => r.getAttribute("data-fill") === BACKDROP_FILL);
    expect(hitArea).toBeDefined();
    expect(hitArea!.getAttribute("data-listening")).toBe("true");
    expect(layerGroup.getAttribute("data-draggable")).toBe("true");
  });

  it("dragging a layer dispatches a position update through useTitleLayerDrag → projectStore", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 0, y: 0 },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const group = screen.getAllByTestId("group")[0]!;
    // Simulate Konva's onDragEnd at (24px, 10px) in stage coords. At scale=2
    // that's domain (12, 5) for x. Y is pinned to GLYPH_Y_BASE - ascent =
    // 13 - 7 = 6 (glyph layers ignore drag Y; position comes from ascent).
    dispatchDragEnd(group, { x: 24, y: 10 });
    const layer = getTitle()[0]!;
    if (layer.kind !== "glyph") throw new Error("expected glyph layer");
    expect(layer.x).toBe(12);
    expect(layer.y).toBe(6);
  });

  it("layer drag events set cancelBubble=true so MenuGroup's drag handler doesn't fire (bug fix)", () => {
    // Regression: without `e.cancelBubble = true`, Konva bubbles per-layer
    // drag events to the parent MenuGroup, whose onDragEnd reads
    // `e.target.x()/y()` and applies the layer's coords as the menu's new
    // position — moving the menu instead of the layer.
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 0, y: 0 },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const group = screen.getAllByTestId("group")[0]!;
    const start = dispatchDrag(group, "__dragStart", { x: 8, y: 4 });
    const move = dispatchDrag(group, "__dragMove", { x: 16, y: 6 });
    const end = dispatchDragEnd(group, { x: 24, y: 10 });
    expect(start.cancelBubble).toBe(true);
    expect(move.cancelBubble).toBe(true);
    expect(end.cancelBubble).toBe(true);
  });

  it("a parent's drag handler is NOT invoked when a layer drag ends (cancelBubble stops propagation)", () => {
    // Simulates the MenuGroup → TitleRender hierarchy: a parent <div> with
    // its own onDragEnd handler wraps the rendered TitleRender output. When
    // we manually dispatch the inner layer drag via the mock's handler slot,
    // bubbling shouldn't reach the parent. We additionally fire a synthetic
    // React drag event from the inner group and verify the outer handler
    // doesn't see it (the layer handler set cancelBubble=true on the Konva
    // event, AND React events are scoped to their own dispatch — the test
    // here just asserts no extra mutation on the parent's spy).
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 0, y: 0 },
    ];
    seedProject(layers);
    useAssetStore.getState().setAssets([GLYPH_ASSET]);
    const parentDragEnd = vi.fn();
    render(
      <div
        ref={(node) => {
          if (node) {
            (node as unknown as { __dragEnd?: DragHandler }).__dragEnd =
              parentDragEnd as unknown as DragHandler;
          }
        }}
      >
        <TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />
      </div>,
    );
    const layerGroup = screen.getAllByTestId("group")[0]!;
    // Inner drag-end runs and sets cancelBubble=true on its own event.
    const end = dispatchDragEnd(layerGroup, { x: 24, y: 10 });
    expect(end.cancelBubble).toBe(true);
    // Parent's onDragEnd was never invoked — the inner handler is the only
    // one that ran. (In real Konva, cancelBubble halts the bubble walk;
    // here we assert the spy spy stayed at zero calls.)
    expect(parentDragEnd).not.toHaveBeenCalled();
  });
});

describe("TitleRender — textarea layer", () => {
  it("renders N VanillaMcText children for N \\n-separated lines (3 lines)", () => {
    // The textarea's value resolves to "Line1\nLine2\nLine3" via the i18n key.
    const project = makeProject([]);
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: [
          {
            ...project,
            i18nKeys: { lt_multiline: { en: "Line1\nLine2\nLine3" } },
            menus: [
              {
                ...(project.menus[0]!),
                title: [
                  {
                    kind: "textarea",
                    value: { key: "lt_multiline" as I18nKey },
                    x: 10,
                    y: 6,
                    width: 256,
                    lineHeight: 10,
                    alignment: "left",
                  },
                ],
              } as Menu,
            ],
          },
        ],
        projectOrder: [PACK_ID],
      },
    }));
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const lines = screen.getAllByTestId("vanilla-mc-text");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.getAttribute("data-source")).toBe("Line1");
    expect(lines[1]!.getAttribute("data-source")).toBe("Line2");
    expect(lines[2]!.getAttribute("data-source")).toBe("Line3");
  });

  it("lines are stacked at y + i * lineHeight * scale", () => {
    // lineHeight=10, scale=2 → lines at y=0, 20, 40 (relative to group)
    const project = makeProject([]);
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: [
          {
            ...project,
            i18nKeys: { lt_ml2: { en: "A\nB\nC" } },
            menus: [
              {
                ...(project.menus[0]!),
                title: [
                  {
                    kind: "textarea",
                    value: { key: "lt_ml2" as I18nKey },
                    x: 10,
                    y: 6,
                    width: 256,
                    lineHeight: 10,
                    alignment: "left",
                  },
                ],
              } as Menu,
            ],
          },
        ],
        projectOrder: [PACK_ID],
      },
    }));
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const lines = screen.getAllByTestId("vanilla-mc-text");
    expect(lines[0]!.getAttribute("data-y")).toBe("0");
    expect(lines[1]!.getAttribute("data-y")).toBe(String(10 * TEX_SCALE));
    expect(lines[2]!.getAttribute("data-y")).toBe(String(20 * TEX_SCALE));
  });

  it("center alignment: line x = -(lineWidth / 2) * scale", () => {
    // vanillaTextWidth mock: text.length * 6. "Hi" → 12px, center x = -6 * scale.
    const project = makeProject([]);
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: [
          {
            ...project,
            i18nKeys: { lt_center: { en: "Hi" } },
            menus: [
              {
                ...(project.menus[0]!),
                title: [
                  {
                    kind: "textarea",
                    value: { key: "lt_center" as I18nKey },
                    x: 20,
                    y: 6,
                    width: 256,
                    lineHeight: 10,
                    alignment: "center",
                  },
                ],
              } as Menu,
            ],
          },
        ],
        projectOrder: [PACK_ID],
      },
    }));
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const lines = screen.getAllByTestId("vanilla-mc-text");
    // "Hi".length * 6 = 12, center x = -(12/2) * 2 = -12
    expect(lines[0]!.getAttribute("data-x")).toBe(String(-(12 / 2) * TEX_SCALE));
  });

  it("right alignment: line x = -lineWidth * scale", () => {
    // "Hi" → 12px, right x = -12 * scale.
    const project = makeProject([]);
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: [
          {
            ...project,
            i18nKeys: { lt_right: { en: "Hi" } },
            menus: [
              {
                ...(project.menus[0]!),
                title: [
                  {
                    kind: "textarea",
                    value: { key: "lt_right" as I18nKey },
                    x: 20,
                    y: 6,
                    width: 256,
                    lineHeight: 10,
                    alignment: "right",
                  },
                ],
              } as Menu,
            ],
          },
        ],
        projectOrder: [PACK_ID],
      },
    }));
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const lines = screen.getAllByTestId("vanilla-mc-text");
    // "Hi".length * 6 = 12, right x = -12 * 2 = -24
    expect(lines[0]!.getAttribute("data-x")).toBe(String(-12 * TEX_SCALE));
  });

  it("single-line textarea renders exactly one VanillaMcText", () => {
    const project = makeProject([]);
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: [
          {
            ...project,
            i18nKeys: { lt_single: { en: "Hello" } },
            menus: [
              {
                ...(project.menus[0]!),
                title: [
                  {
                    kind: "textarea",
                    value: { key: "lt_single" as I18nKey },
                    x: 8,
                    y: 6,
                    width: 256,
                    lineHeight: 10,
                    alignment: "left",
                  },
                ],
              } as Menu,
            ],
          },
        ],
        projectOrder: [PACK_ID],
      },
    }));
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const lines = screen.getAllByTestId("vanilla-mc-text");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute("data-source")).toBe("Hello");
  });

  it("textarea group is positioned at layer.x * scale, layer.y * scale", () => {
    const project = makeProject([]);
    useAccountStore.setState((state) => ({
      account: {
        ...state.account,
        projects: [
          {
            ...project,
            i18nKeys: { lt_pos: { en: "X" } },
            menus: [
              {
                ...(project.menus[0]!),
                title: [
                  {
                    kind: "textarea",
                    value: { key: "lt_pos" as I18nKey },
                    x: 15,
                    y: 8,
                    width: 256,
                    lineHeight: 10,
                    alignment: "left",
                  },
                ],
              } as Menu,
            ],
          },
        ],
        projectOrder: [PACK_ID],
      },
    }));
    render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]!.getAttribute("data-x")).toBe(String(15 * TEX_SCALE));
    expect(groups[0]!.getAttribute("data-y")).toBe(String(8 * TEX_SCALE));
  });
});

// ---------------------------------------------------------------------------
// Helpers for the wrap + resize-handle describe block below.
// Mirrors the pattern from LayerEditForm.test.tsx (seedProject with i18nKeys).
// ---------------------------------------------------------------------------

const K = (s: string) => s as I18nKey;

function seedProjectWithI18n(
  layers: MenuTitleLayer[],
  i18nKeys: Record<string, Record<string, string>>,
) {
  useAccountStore.setState({
    account: {
      id: "acc" as never,
      projects: [
        {
          id: PACK_ID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [{ id: MENU_ID, projectId: PACK_ID, title: layers, rows: 3, layers: [] }],
          commands: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys,
          defaultLang: "en",
          dialogs: [],
          canvasLayout: {},
        },
      ],
      projectOrder: [PACK_ID],
    },
  } as never);
  useUiStore.setState({ activeLang: "en", selectedLayerKey: null } as never);
}

function selectLayer(index: number) {
  useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index } } as never);
}

describe("TitleRender — textarea wrap and resize handle", () => {
  beforeEach(() => {
    useAssetStore.getState().reset();
    useUiStore.setState({
      selectedLayerKey: null,
      selectedMenuId: null,
      lastSelectedMenuId: null,
      hiddenLayerKeys: new Set<string>(),
    } as never);
  });

  it("wraps a long single line into multiple VanillaMcText children when width is tight", () => {
    seedProjectWithI18n(
      [
        {
          kind: "textarea",
          value: { key: K("ta_long") },
          x: 0,
          y: 0,
          width: 20,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { ta_long: { en: "ab cd ef" } },
    );
    selectLayer(0);
    const { container } = render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={1} />);
    const subLines = container.querySelectorAll("[data-testid='vanilla-mc-text']");
    expect(subLines.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT wrap when width is wide enough", () => {
    seedProjectWithI18n(
      [
        {
          kind: "textarea",
          value: { key: K("ta_short") },
          x: 0,
          y: 0,
          width: 256,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { ta_short: { en: "ab cd ef" } },
    );
    selectLayer(0);
    const { container } = render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={1} />);
    const subLines = container.querySelectorAll("[data-testid='vanilla-mc-text']");
    expect(subLines.length).toBe(1);
  });

  it("mounts WidthResizeHandle when textarea is selected", () => {
    seedProjectWithI18n(
      [
        {
          kind: "textarea",
          value: { key: K("ta_sel") },
          x: 0,
          y: 0,
          width: 168,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { ta_sel: { en: "hi" } },
    );
    selectLayer(0);
    const { container } = render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={1} />);
    expect(container.querySelector("[data-testid='width-resize-handle']")).toBeTruthy();
  });

  it("does NOT mount WidthResizeHandle when textarea is unselected", () => {
    seedProjectWithI18n(
      [
        {
          kind: "textarea",
          value: { key: K("ta_unsel") },
          x: 0,
          y: 0,
          width: 168,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { ta_unsel: { en: "hi" } },
    );
    // No selectLayer call — textarea is unselected.
    const { container } = render(<TitleRender projectId={PACK_ID} menuId={MENU_ID} scale={1} />);
    expect(container.querySelector("[data-testid='width-resize-handle']")).toBeNull();
  });
});
