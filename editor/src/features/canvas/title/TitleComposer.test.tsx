import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Menu,
  MenuId,
  MenuTitleLayer,
  Pack,
  PackId,
} from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

// Mock heavy children so the test stays focused on TitleComposer's
// orchestration: button wiring, picker open/close state, and the
// text-editor open/close handoff coming from TitleLayerList.
vi.mock("./TitleMockup", () => ({
  TitleMockup: () => <div data-testid="mockup" />,
}));
vi.mock("./TitleLayerList", () => ({
  TitleLayerList: ({ onEditText }: { onEditText?: (index: number) => void }) => (
    <button
      type="button"
      data-testid="trigger-edit-text"
      onClick={() => onEditText?.(0)}
    >
      edit
    </button>
  ),
}));
vi.mock("./TitleTextEditor", () => ({
  TitleTextEditor: ({ index, onClose }: { index: number; onClose: () => void }) => (
    <div data-testid="text-editor" data-index={index}>
      <button type="button" data-testid="close-text-editor" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: {
    open: boolean;
    typeFilter: string;
    onClose: () => void;
    onPick: (asset: { id: string; name: string; type: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="asset-picker"
      data-type-filter={props.typeFilter}
      onClick={() =>
        props.onPick({ id: "asset_x", name: "x", type: props.typeFilter })
      }
    >
      pick
    </button>
  ),
}));

// Import AFTER mocks so the component picks them up.
import { TitleComposer } from "./TitleComposer";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;

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
    i18nKeys: {},
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

function currentLayers(): MenuTitleLayer[] {
  return useAccountStore.getState().account.packs[0]?.menus[0]?.title ?? [];
}

beforeEach(() => {
  // Reset the account store between tests so layers from one test don't
  // bleed into the next.
  useAccountStore.setState((state) => ({
    account: { ...state.account, packs: [], packOrder: [] },
  }));
});

describe("TitleComposer", () => {
  it("renders the mockup and the three add buttons", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    expect(screen.getByTestId("mockup")).toBeTruthy();
    expect(screen.getByText("+ Background")).toBeTruthy();
    expect(screen.getByText("+ Glyph")).toBeTruthy();
    expect(screen.getByText("+ Text")).toBeTruthy();
  });

  it("clicking + Text adds a text layer with a fresh i18n key at (8, 5)", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    fireEvent.click(screen.getByText("+ Text"));
    const layers = currentLayers();
    expect(layers).toHaveLength(1);
    const layer = layers[0]!;
    expect(layer.kind).toBe("text");
    if (layer.kind === "text") {
      expect(layer.x).toBe(8);
      expect(layer.y).toBe(5);
      // newI18nKey() mints a fresh "lt_*" key — assert the shape, not the value.
      expect(layer.value.key).toMatch(/^lt_/);
    }
  });

  it("clicking + Background opens the AssetPicker with typeFilter=glyph", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    expect(screen.queryByTestId("asset-picker")).toBeNull();
    fireEvent.click(screen.getByText("+ Background"));
    const picker = screen.getByTestId("asset-picker");
    // Per plan: backgrounds are "a big glyph" until SP4 lands.
    expect(picker.getAttribute("data-type-filter")).toBe("glyph");
  });

  it("clicking + Glyph opens the AssetPicker with typeFilter=glyph", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    fireEvent.click(screen.getByText("+ Glyph"));
    const picker = screen.getByTestId("asset-picker");
    expect(picker.getAttribute("data-type-filter")).toBe("glyph");
  });

  it("picking an asset in the background picker adds a background layer", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    fireEvent.click(screen.getByText("+ Background"));
    fireEvent.click(screen.getByTestId("asset-picker"));
    const layers = currentLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual({ kind: "background", assetId: "asset_x" });
  });

  it("picking an asset in the glyph picker adds a glyph layer at (0, 0)", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    fireEvent.click(screen.getByText("+ Glyph"));
    fireEvent.click(screen.getByTestId("asset-picker"));
    const layers = currentLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual({
      kind: "glyph",
      assetId: "asset_x",
      x: 0,
      y: 0,
    });
  });

  it("picking an asset closes the picker", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    fireEvent.click(screen.getByText("+ Background"));
    expect(screen.queryByTestId("asset-picker")).not.toBeNull();
    fireEvent.click(screen.getByTestId("asset-picker"));
    expect(screen.queryByTestId("asset-picker")).toBeNull();
  });

  it("TitleLayerList calling onEditText opens TitleTextEditor with the given index", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    expect(screen.queryByTestId("text-editor")).toBeNull();
    fireEvent.click(screen.getByTestId("trigger-edit-text"));
    const editor = screen.getByTestId("text-editor");
    expect(editor.getAttribute("data-index")).toBe("0");
  });

  it("closing the TitleTextEditor hides it again", () => {
    const menu = seedPack([]);
    render(<TitleComposer packId={PACK_ID} menu={menu} />);
    fireEvent.click(screen.getByTestId("trigger-edit-text"));
    expect(screen.queryByTestId("text-editor")).not.toBeNull();
    fireEvent.click(screen.getByTestId("close-text-editor"));
    expect(screen.queryByTestId("text-editor")).toBeNull();
  });
});
