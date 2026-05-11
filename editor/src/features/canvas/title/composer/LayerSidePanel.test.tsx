import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId, AssetId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAssetStore } from "@/features/assets/assetStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { LayerSidePanel } from "./LayerSidePanel";

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

describe("LayerSidePanel — empty state", () => {
  it("renders no-selection hint when no layer is selected", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/no layer selected/i)).toBeTruthy();
  });

  it("renders no-selection hint when selectedIndex is out of range", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(99);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/no layer selected/i)).toBeTruthy();
  });
});

describe("LayerSidePanel — text branch", () => {
  beforeEach(() => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 8, y: 5 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
  });

  it("renders textarea with current LText value", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const textarea = screen.getByLabelText(/text \(minimessage\)/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello");
  });

  it("typing into textarea writes via setI18nValue", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const textarea = screen.getByLabelText(/text \(minimessage\)/i);
    fireEvent.change(textarea, { target: { value: "<gold>Hi</gold>" } });
    expect(
      useAccountStore.getState().account.packs[0]!.i18nKeys[K("g")]!.en,
    ).toBe("<gold>Hi</gold>");
  });

  it("renders MiniMessageInline preview area containing the value", () => {
    const { container } = render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(container.textContent).toContain("Hello");
  });

  it("x input reflects layer.x and dispatches on change", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const x = screen.getByLabelText(/^x$/i) as HTMLInputElement;
    expect(x.value).toBe("8");
    fireEvent.change(x, { target: { value: "12" } });
    expect(
      (useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]! as any).x,
    ).toBe(12);
  });

  it("Delete button removes the layer and clears selection", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(0);
    expect(useTitleSelectionStore.getState().selectedIndex).toBeNull();
  });

  it("Font dropdown lists 'vanilla' + font assets, switches fontAssetId", () => {
    useAssetStore.setState({
      assets: [{
        id: A("f1"), serverKeyId: "sk", type: "font", name: "myfont",
        width: 0, height: 0, ascent: null, codepoint: null,
        fontMeta: { namespace: "interfaze:myfont", glyphMap: [] },
        contentHash: "h", createdAt: "", updatedAt: "",
      }],
    } as any);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const select = screen.getByLabelText(/^font$/i) as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(select, { target: { value: A("f1") } });
    expect(
      (useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]! as any).fontAssetId,
    ).toBe(A("f1"));
  });
});
