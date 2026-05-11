import { render, screen } from "@testing-library/react";
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
import { MC_TITLE_H, TEX_SCALE } from "../../menuLayout";
import { TitleRender } from "./TitleRender";

// Mock react-konva to render plain divs (no canvas in jsdom). Each shape
// exposes its load-bearing props as data-* attrs so tests can assert layout.
vi.mock("react-konva", () => ({
  Rect: (props: {
    fill?: string;
    stroke?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }) => (
    <div
      data-testid="rect"
      data-fill={props.fill}
      data-stroke={props.stroke}
      data-width={props.width}
      data-height={props.height}
      data-x={props.x}
      data-y={props.y}
    />
  ),
  Group: ({
    children,
    onClick,
    draggable,
    x,
    y,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    draggable?: boolean;
    x?: number;
    y?: number;
  }) => (
    <div
      data-testid="group"
      data-x={x}
      data-y={y}
      data-draggable={draggable ? "true" : "false"}
      onClick={() => onClick?.()}
    >
      {children}
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

beforeEach(() => {
  useAssetStore.getState().reset();
});

describe("TitleRender", () => {
  it("renders the title-bar grey backdrop (#3f3f3f)", () => {
    seedPack([]);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="compact" />);
    const rects = screen.getAllByTestId("rect");
    expect(rects.some((r) => r.getAttribute("data-fill") === "#3f3f3f")).toBe(true);
  });

  it("renders one Group per layer (3 layers → 3 groups)", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "background", assetId: ASSET_BG },
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="compact" />);
    expect(screen.getAllByTestId("group")).toHaveLength(3);
  });

  it("text layer WITHOUT fontAssetId uses MiniMessageKonvaText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="compact" />);
    const mm = screen.getByTestId("mm-text");
    expect(mm.getAttribute("data-source")).toBe("Hello");
    // No McFontText for this layer.
    expect(screen.queryByTestId("mc-font-text")).toBeNull();
  });

  it("text layer WITH fontAssetId resolving to a font asset uses McFontText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5, fontAssetId: ASSET_FONT },
    ];
    seedPack(layers);
    useAssetStore.getState().setAssets([FONT_ASSET]);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="compact" />);
    const fontText = screen.getByTestId("mc-font-text");
    expect(fontText.getAttribute("data-text")).toBe("Hello");
    expect(fontText.getAttribute("data-font-id")).toBe(ASSET_FONT);
    // The vector fallback should NOT render for this layer.
    expect(screen.queryByTestId("mm-text")).toBeNull();
  });

  it("compact mode: layer Groups are NOT draggable", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="compact" />);
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.getAttribute("data-draggable")).toBe("false");
    }
  });

  it("edit mode: background NOT draggable, other layers draggable", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "background", assetId: ASSET_BG },
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 20, y: 4 },
    ];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="edit" />);
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(4);
    // First group (background) is not draggable.
    expect(groups[0]?.getAttribute("data-draggable")).toBe("false");
    // Remaining layers are draggable.
    expect(groups[1]?.getAttribute("data-draggable")).toBe("true");
    expect(groups[2]?.getAttribute("data-draggable")).toBe("true");
    expect(groups[3]?.getAttribute("data-draggable")).toBe("true");
  });

  it("edit mode click fires onLayerClick with the layer index", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    seedPack(layers);
    const onLayerClick = vi.fn();
    render(
      <TitleRender
        packId={PACK_ID}
        menuId={MENU_ID}
        scale={TEX_SCALE}
        mode="edit"
        onLayerClick={onLayerClick}
      />,
    );
    const groups = screen.getAllByTestId("group");
    groups[1]!.click();
    expect(onLayerClick).toHaveBeenCalledWith(1);
    groups[0]!.click();
    expect(onLayerClick).toHaveBeenCalledWith(0);
  });

  it("background layer sits at y = MC_TITLE_H * scale", () => {
    const layers: MenuTitleLayer[] = [{ kind: "background", assetId: ASSET_BG }];
    seedPack(layers);
    render(<TitleRender packId={PACK_ID} menuId={MENU_ID} scale={TEX_SCALE} mode="compact" />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-x")).toBe("0");
    expect(groups[0]?.getAttribute("data-y")).toBe(String(MC_TITLE_H * TEX_SCALE));
  });
});
