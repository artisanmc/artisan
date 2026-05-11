import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId, AssetId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAssetStore } from "@/features/assets/assetStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { AddLayerBar } from "./AddLayerBar";

vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? (
      <button
        data-testid="asset-picker"
        data-type-filter={props.typeFilter}
        onClick={() => props.onPick({ id: "g_new", name: "x", type: "glyph" })}
      >pick</button>
    ) : null,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;
const A = (s: string) => s as AssetId;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [{
        id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
        menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
        commands: [], templates: [], assets: [], dataSources: [],
        importedConnectors: [], i18nKeys: { [K("g")]: { en: "Hello" } },
        defaultLang: "en", dialogs: [], canvasLayout: {},
      }],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  useAssetStore.setState({ assets: [], selectedId: null, loading: false, error: null } as any);
  seedPack([]);
});

describe("AddLayerBar", () => {
  it("renders + Image and + Text buttons", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/\+ Image/)).toBeTruthy();
    expect(screen.getByText(/\+ Text/)).toBeTruthy();
  });

  it("+ Image opens AssetPicker filtered to glyph", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByText(/\+ Image/));
    const picker = screen.getByTestId("asset-picker");
    expect(picker.getAttribute("data-type-filter")).toBe("glyph");
  });

  it("picking an asset adds a glyph layer at (0,0)", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByText(/\+ Image/));
    fireEvent.click(screen.getByTestId("asset-picker"));
    const layers = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ kind: "glyph", assetId: "g_new", x: 0, y: 0 });
  });

  it("+ Text adds a text layer with a fresh i18n key", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByText(/\+ Text/));
    const layers = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    expect(layers).toHaveLength(1);
    expect(layers[0]?.kind).toBe("text");
    if (layers[0]?.kind === "text") expect(layers[0].value.key).toMatch(/^lt_/);
  });

  it("renders one chip per layer", () => {
    seedPack([
      { kind: "glyph", assetId: A("a"), x: 0, y: 0 },
      { kind: "text", value: { key: K("g") }, x: 0, y: 0 },
    ]);
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getAllByTestId("layer-chip")).toHaveLength(2);
  });

  it("clicking a chip selects that layer", () => {
    seedPack([
      { kind: "glyph", assetId: A("a"), x: 0, y: 0 },
      { kind: "text", value: { key: K("g") }, x: 0, y: 0 },
    ]);
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getAllByTestId("layer-chip")[1]!);
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(1);
  });
});
