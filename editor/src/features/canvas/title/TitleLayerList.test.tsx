import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AssetId,
  I18nKey,
  Menu,
  MenuId,
  MenuTitleLayer,
  Pack,
  PackId,
} from "@/domain/types";
import type { Asset } from "@/domain/asset";
import { useAccountStore } from "@/state/accountStore";
import { useAssetStore } from "@/features/assets/assetStore";
import { TitleLayerList } from "./TitleLayerList";
import { useTitleSelectionStore } from "./titleSelectionStore";

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
    i18nKeys: { [I18N_KEY]: { en: "Hello world" } },
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };
}

function seedPack(layers: MenuTitleLayer[]): Menu {
  const pack = makePack(layers);
  useAccountStore.setState((state) => ({
    account: { ...state.account, packs: [pack], packOrder: [PACK_ID] },
  }));
  return pack.menus[0]!;
}

function seedAssets(): void {
  const assets: Asset[] = [
    {
      id: ASSET_BG,
      serverKeyId: "sk1",
      type: "texture",
      name: "bar_bg",
      width: 176,
      height: 17,
      ascent: null,
      codepoint: null,
      fontMeta: null,
      contentHash: "h1",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: ASSET_GLYPH,
      serverKeyId: "sk1",
      type: "glyph",
      name: "star",
      width: 8,
      height: 8,
      ascent: 7,
      codepoint: 0xe000,
      fontMeta: null,
      contentHash: "h2",
      createdAt: "",
      updatedAt: "",
    },
  ];
  useAssetStore.setState({ assets });
}

/**
 * Build a partial DragEvent for fireEvent with a stub `dataTransfer` that
 * persists `setData`/`getData` against a shared map. jsdom's DataTransfer is
 * incomplete; this stub is enough for our reorder flow.
 */
function makeDataTransfer(): {
  setData: (k: string, v: string) => void;
  getData: (k: string) => string;
  data: Record<string, string>;
} {
  const data: Record<string, string> = {};
  return {
    data,
    setData: (k, v) => {
      data[k] = v;
    },
    getData: (k) => data[k] ?? "",
  };
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  useAssetStore.getState().reset();
});

describe("TitleLayerList", () => {
  it("renders one row per layer", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "background", assetId: ASSET_BG },
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5 },
    ];
    const menu = seedPack(layers);
    seedAssets();
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    const rows = screen.getAllByTestId("title-layer-row");
    expect(rows).toHaveLength(3);
  });

  it("renders background preview as 'Bg: <asset name>'", () => {
    const layers: MenuTitleLayer[] = [{ kind: "background", assetId: ASSET_BG }];
    const menu = seedPack(layers);
    seedAssets();
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    expect(screen.getByText(/Bg: bar_bg/)).toBeInTheDocument();
  });

  it("renders glyph preview as 'Glyph: <name> (x,y)'", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 10, y: 3 },
    ];
    const menu = seedPack(layers);
    seedAssets();
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    expect(screen.getByText(/Glyph: star \(10,3\)/)).toBeInTheDocument();
  });

  it("renders text preview as 'Text: <resolved> (x,y)'", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5 },
    ];
    const menu = seedPack(layers);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    expect(screen.getByText(/Text: Hello world \(4,5\)/)).toBeInTheDocument();
  });

  it("renders external_glyph preview as 'External: <provider>:<glyphName>'", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 20, y: 4 },
    ];
    const menu = seedPack(layers);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    expect(screen.getByText(/External: oraxen:coin/)).toBeInTheDocument();
  });

  it("clicking a row updates titleSelectionStore.selectedIndex", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    const menu = seedPack(layers);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    const rows = screen.getAllByTestId("title-layer-row");
    fireEvent.click(rows[1]!);
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(1);
    fireEvent.click(rows[0]!);
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(0);
  });

  it("clicking delete on row N removes the layer at index N", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 20, y: 0 },
    ];
    const menu = seedPack(layers);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    const deletes = screen.getAllByTestId("title-layer-delete");
    fireEvent.click(deletes[1]!);
    const next = useAccountStore
      .getState()
      .account.packs[0]!.menus[0]!.title;
    expect(next).toHaveLength(2);
    // Index 1 ("x:10") should be gone — remaining are x:0 and x:20.
    const xs = next.map((l) =>
      l.kind === "text" || l.kind === "glyph" || l.kind === "external_glyph" ? l.x : -1,
    );
    expect(xs).toEqual([0, 20]);
  });

  it("dragging from idx 0 onto idx 2 calls reorderMenuTitleLayers", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 20, y: 0 },
    ];
    const menu = seedPack(layers);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    const rows = screen.getAllByTestId("title-layer-row");
    const dt = makeDataTransfer();
    fireEvent.dragStart(rows[0]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[2]!, { dataTransfer: dt });
    fireEvent.drop(rows[2]!, { dataTransfer: dt });
    const next = useAccountStore
      .getState()
      .account.packs[0]!.menus[0]!.title;
    // Original xs were [0,10,20]; moving idx 0 → idx 2 yields [10,20,0].
    const xs = next.map((l) =>
      l.kind === "text" || l.kind === "glyph" || l.kind === "external_glyph" ? l.x : -1,
    );
    expect(xs).toEqual([10, 20, 0]);
  });

  it("dropping on the same index does nothing", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    const menu = seedPack(layers);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    const rows = screen.getAllByTestId("title-layer-row");
    const dt = makeDataTransfer();
    fireEvent.dragStart(rows[1]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[1]!, { dataTransfer: dt });
    fireEvent.drop(rows[1]!, { dataTransfer: dt });
    const next = useAccountStore
      .getState()
      .account.packs[0]!.menus[0]!.title;
    const xs = next.map((l) =>
      l.kind === "text" || l.kind === "glyph" || l.kind === "external_glyph" ? l.x : -1,
    );
    expect(xs).toEqual([0, 10]);
  });

  it("double-clicking a text row calls onEditText with the row index", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    const menu = seedPack(layers);
    seedAssets();
    const onEditText = ((): { fn: (i: number) => void; calls: number[] } => {
      const calls: number[] = [];
      return { fn: (i: number) => calls.push(i), calls };
    })();
    render(<TitleLayerList packId={PACK_ID} menu={menu} onEditText={onEditText.fn} />);
    const rows = screen.getAllByTestId("title-layer-row");
    fireEvent.doubleClick(rows[1]!);
    expect(onEditText.calls).toEqual([1]);
  });

  it("double-clicking a non-text row does not call onEditText", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "glyph", assetId: ASSET_GLYPH, x: 0, y: 0 },
    ];
    const menu = seedPack(layers);
    seedAssets();
    const calls: number[] = [];
    render(
      <TitleLayerList
        packId={PACK_ID}
        menu={menu}
        onEditText={(i) => calls.push(i)}
      />,
    );
    const rows = screen.getAllByTestId("title-layer-row");
    fireEvent.doubleClick(rows[0]!);
    expect(calls).toEqual([]);
  });

  it("selected row carries the data-selected='true' attribute", () => {
    const layers: MenuTitleLayer[] = [
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
      { kind: "text", value: { key: I18N_KEY }, x: 10, y: 0 },
    ];
    const menu = seedPack(layers);
    useTitleSelectionStore.getState().setSelectedIndex(1);
    render(<TitleLayerList packId={PACK_ID} menu={menu} />);
    const rows = screen.getAllByTestId("title-layer-row");
    expect(rows[0]!.getAttribute("data-selected")).toBe("false");
    expect(rows[1]!.getAttribute("data-selected")).toBe("true");
  });
});
