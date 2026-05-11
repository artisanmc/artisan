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

describe("LayerSidePanel — image branch", () => {
  beforeEach(() => {
    useAssetStore.setState({
      assets: [{
        id: A("g1"), serverKeyId: "sk", type: "glyph", name: "coin",
        width: 32, height: 8, ascent: 7, codepoint: 57344, fontMeta: null,
        contentHash: "h", createdAt: "", updatedAt: "",
      }],
    } as any);
  });

  it("glyph layer: shows asset name + unchecked stretch toggle", () => {
    seedPack([{ kind: "glyph", assetId: A("g1"), x: 10, y: 4 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText("coin")).toBeTruthy();
    const toggle = screen.getByLabelText(/stretch to chest/i) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("background layer: stretch toggle checked, x/y inputs disabled", () => {
    seedPack([{ kind: "background", assetId: A("g1") }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const toggle = screen.getByLabelText(/stretch to chest/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    const x = screen.getByLabelText(/^x$/i) as HTMLInputElement;
    expect(x.disabled).toBe(true);
  });

  it("toggling stretch glyph→bg swaps the runtime kind", () => {
    seedPack([{ kind: "glyph", assetId: A("g1"), x: 10, y: 4 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByLabelText(/stretch to chest/i));
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect(updated.kind).toBe("background");
  });

  it("toggling stretch bg→glyph restores x=0, y=0", () => {
    seedPack([{ kind: "background", assetId: A("g1") }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByLabelText(/stretch to chest/i));
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect(updated.kind).toBe("glyph");
    if (updated.kind === "glyph") {
      expect(updated.x).toBe(0);
      expect(updated.y).toBe(0);
    }
  });

  it("renders narrow-image warning when asset.width < 176", () => {
    seedPack([{ kind: "glyph", assetId: A("g1"), x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/176 px/i)).toBeTruthy();
  });

  it("image Delete button removes the layer and clears selection", () => {
    seedPack([{ kind: "glyph", assetId: A("g1"), x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(0);
    expect(useTitleSelectionStore.getState().selectedIndex).toBeNull();
  });
});

describe("LayerSidePanel — external branch", () => {
  it("renders a read-only message for external_glyph layers", () => {
    seedPack([
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 0, y: 0 },
    ]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/external glyph/i)).toBeTruthy();
    expect(screen.getByText(/sp5/i)).toBeTruthy();
  });
});
