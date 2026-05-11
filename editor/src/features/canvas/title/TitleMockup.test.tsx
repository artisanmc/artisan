import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetId, I18nKey, Menu, MenuId, MenuTitleLayer, Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAssetStore } from "@/features/assets/assetStore";
import { MC_BOTTOM_H, MC_SLOT_STRIDE, MC_TITLE_H, TEX_SCALE } from "../menuLayout";
import { snapDragPosition, TitleMockup } from "./TitleMockup";
import { useTitleSelectionStore } from "./titleSelectionStore";

// Mock react-konva to render plain divs so jsdom-based tests can inspect
// the structure without needing a canvas. Each shape exposes its meaningful
// props as data-* attributes so tests can assert layout.
vi.mock("react-konva", () => ({
  Stage: ({ children, width, height }: { children: React.ReactNode; width: number; height: number }) => (
    <div data-testid="stage" data-width={width} data-height={height}>
      {children}
    </div>
  ),
  Layer: ({ children }: { children: React.ReactNode }) => <div data-testid="layer">{children}</div>,
  Rect: (props: { fill?: string; stroke?: string; width?: number; height?: number; x?: number; y?: number }) => (
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
    onClick?: (e: { evt: { shiftKey: boolean; altKey: boolean } }) => void;
    draggable?: boolean;
    x?: number;
    y?: number;
  }) => (
    <div
      data-testid="group"
      data-x={x}
      data-y={y}
      data-draggable={draggable ? "true" : "false"}
      onClick={() => onClick?.({ evt: { shiftKey: false, altKey: false } })}
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
  Image: (props: { x?: number; y?: number; width?: number; height?: number }) => (
    <div
      data-testid="konva-image"
      data-x={props.x}
      data-y={props.y}
      data-width={props.width}
      data-height={props.height}
    />
  ),
}));

vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const ASSET_BG = "asset_bg" as AssetId;
const ASSET_GLYPH = "asset_glyph" as AssetId;
const I18N_KEY = "lt_title" as I18nKey;

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
  useTitleSelectionStore.getState().reset();
  useAssetStore.getState().reset();
});

describe("snapDragPosition", () => {
  it("rounds to nearest integer pixel (in domain coords) by default", () => {
    expect(snapDragPosition(20, 30, 2, { shift: false, alt: false })).toEqual({ x: 10, y: 15 });
    expect(snapDragPosition(21, 29, 2, { shift: false, alt: false })).toEqual({ x: 11, y: 15 });
  });

  it("returns raw subpixel coords when shift is held", () => {
    const res = snapDragPosition(21, 29, 2, { shift: true, alt: false });
    expect(res.x).toBeCloseTo(10.5);
    expect(res.y).toBeCloseTo(14.5);
  });

  it("snaps to multiples of 18 (slot grid) when alt is held", () => {
    // 40 raw / 2 scale = 20 px → nearest 18 = 18
    expect(snapDragPosition(40, 80, 2, { shift: false, alt: true })).toEqual({ x: 18, y: 36 });
    // 18 raw / 2 = 9 → rounds to 18 (nearest)
    expect(snapDragPosition(18, 0, 2, { shift: false, alt: true })).toEqual({ x: 18, y: 0 });
    // 16 raw / 2 = 8 → rounds to 0
    expect(snapDragPosition(16, 0, 2, { shift: false, alt: true })).toEqual({ x: 0, y: 0 });
  });

  it("alt takes precedence over shift when both held", () => {
    // 18 raw / 2 = 9, shift would give 9, alt gives 18 → alt wins
    expect(snapDragPosition(18, 0, 2, { shift: true, alt: true })).toEqual({ x: 18, y: 0 });
  });
});

describe("TitleMockup render", () => {
  it("renders title-bar-only stage when no background layer", () => {
    const menu = seedPack([]);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const stage = screen.getByTestId("stage");
    // 176 × 17 (vanilla MC title bar) × TEX_SCALE (2) = 352 × 34.
    expect(stage.getAttribute("data-width")).toBe("352");
    expect(stage.getAttribute("data-height")).toBe(String(MC_TITLE_H * TEX_SCALE));
  });

  it("renders full-chest stage when a background layer is present", () => {
    const rows = 3;
    const layers: MenuTitleLayer[] = [{ kind: "background", assetId: ASSET_BG }];
    const pack = makePack(layers);
    // Override the seeded menu's rows count.
    pack.menus[0]!.rows = rows;
    useAccountStore.setState((state) => ({
      account: { ...state.account, packs: [pack], packOrder: [PACK_ID] },
    }));
    const menu = pack.menus[0]!;
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const stage = screen.getByTestId("stage");
    const expectedH = (MC_TITLE_H + rows * MC_SLOT_STRIDE + MC_BOTTOM_H) * TEX_SCALE;
    expect(stage.getAttribute("data-width")).toBe("352");
    expect(stage.getAttribute("data-height")).toBe(String(expectedH));
  });

  it("renders one node per layer", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "background", assetId: ASSET_BG },
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5, color: "#ff0000" },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 20, y: 4 },
    ];
    const menu = seedPack(layers);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    // Each layer becomes a Group; the outer Stage/Layer/background do not add
    // Groups, so we should see exactly 4.
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(4);
  });

  it("positions glyph and text layers at (x * SCALE, y * SCALE) in stage coords", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5 },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    const menu = seedPack(layers);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-x")).toBe("8"); // 4 * 2
    expect(groups[0]?.getAttribute("data-y")).toBe("10"); // 5 * 2
    expect(groups[1]?.getAttribute("data-x")).toBe("20"); // 10 * 2
    expect(groups[1]?.getAttribute("data-y")).toBe("6"); // 3 * 2
  });

  it("background group sits at y = MC_TITLE_H * TEX_SCALE in full-chest mode", () => {
    const layers: MenuTitleLayer[] = [{ kind: "background", assetId: ASSET_BG }];
    const menu = seedPack(layers);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const groups = screen.getAllByTestId("group");
    // Background is pinned at x=0 and offset down by MC_TITLE_H * TEX_SCALE
    // so it sits below the title bar (mirroring the plugin's runtime negative
    // ascent push).
    expect(groups[0]?.getAttribute("data-x")).toBe("0");
    expect(groups[0]?.getAttribute("data-y")).toBe(String(MC_TITLE_H * TEX_SCALE));
  });

  it("renders text layer with resolved string from i18n", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0, color: "#ff0000" },
    ];
    const menu = seedPack(layers);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const texts = screen.getAllByTestId("konva-text");
    // The bar may also render auxiliary text; just look for our expected text.
    expect(texts.some((t) => t.getAttribute("data-text") === "Hello")).toBe(true);
    expect(texts.some((t) => t.getAttribute("data-fill") === "#ff0000")).toBe(true);
  });

  it("clicking a layer Group sets selectedIndex in the title selection store", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    const menu = seedPack(layers);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(2);
    groups[1]!.click();
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(1);
    groups[0]!.click();
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(0);
  });

  it("layer Groups are draggable", () => {
    const layers: MenuTitleLayer[] = [{ kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 }];
    const menu = seedPack(layers);
    render(<TitleMockup packId={PACK_ID} menu={menu} />);
    const groups = screen.getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-draggable")).toBe("true");
  });
});
