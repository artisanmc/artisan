import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "@/domain/asset";
import type { AssetId, I18nKey, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { LayerListItem } from "./LayerListItem";

const PACK_ID = "p1" as ProjectId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;
const A = (s: string) => s as AssetId;

function asset(id: string, name: string): Asset {
  return {
    id,
    serverKeyId: "sk1",
    type: "glyph",
    name,
    width: 16,
    height: 16,
    ascent: 8,
    codepoint: 0xe000,
    fontMeta: null,
    contentHash: "h",
    createdAt: "",
    updatedAt: "",
  };
}

function seedProject(layers: MenuTitleLayer[], i18nKeys: Record<string, Record<string, string>> = {}) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
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
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useUiStore.setState({
    selectedLayerKey: null,
    hiddenLayerKeys: new Set<string>(),
  } as any);
  useAssetStore.setState({ assets: [], selectedId: null, loading: false, error: null } as any);
  seedProject([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayerListItem — auto-name", () => {
  it("renders 'Image • {asset name}' for a background layer (background vocabulary hidden)", () => {
    useAssetStore.setState({ assets: [asset("asset_bg1", "shop_bg")] } as any);
    const layer: MenuTitleLayer = { kind: "background", assetId: A("asset_bg1") };
    seedProject([layer]);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByText(/Image.*shop_bg/)).toBeInTheDocument();
    // The word "Background" should NOT appear — UX renaming hides the
    // technical vocabulary so users only see "Image".
    expect(screen.queryByText(/Background/)).toBeNull();
  });

  it("renders 'Image • {asset name}' for a glyph layer", () => {
    useAssetStore.setState({ assets: [asset("asset_g1", "sword_icon")] } as any);
    const layer: MenuTitleLayer = { kind: "glyph", assetId: A("asset_g1"), x: 0, y: 0 };
    seedProject([layer]);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByText(/Image.*sword_icon/)).toBeInTheDocument();
  });

  it("renders 'Texte • {text}' using the resolved i18n value for a text layer", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "Welcome to the shop" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByText(/Texte.*Welcome to the shop/)).toBeInTheDocument();
  });

  it("renders 'Image (Oraxen) • {name}' for an external_glyph layer (no 'glyph' jargon)", () => {
    const layer: MenuTitleLayer = {
      kind: "external_glyph",
      provider: "oraxen",
      glyphName: "my_glyph",
      x: 0,
      y: 0,
    };
    seedProject([layer]);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByText(/Image \(Oraxen\).*my_glyph/)).toBeInTheDocument();
  });

  it("falls back to truncated asset id when asset not loaded", () => {
    // No asset loaded
    const layer: MenuTitleLayer = {
      kind: "glyph",
      assetId: A("asset_abc12345xyz"),
      x: 0,
      y: 0,
    };
    seedProject([layer]);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    // We expect a truncated form of the id (not the full one)
    const label = screen.getByText(/Image/);
    expect(label.textContent).toMatch(/asset_abc/);
    expect(label.textContent).not.toContain("asset_abc12345xyz");
  });

  it("renders 'Texte • <first-line>' for a textarea layer with single-line text", () => {
    const layer: MenuTitleLayer = { kind: "textarea", value: { key: K("k_single") }, x: 0, y: 0, width: 168, lineHeight: 10, alignment: "left" };
    seedProject([layer], { k_single: { en: "Single line content" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByText(/Texte • Single line co/)).toBeInTheDocument();
  });

  it("renders 'Texte • <first-line>…' for a textarea layer with multiple lines", () => {
    const layer: MenuTitleLayer = { kind: "textarea", value: { key: K("k_multi") }, x: 0, y: 0, width: 168, lineHeight: 10, alignment: "left" };
    seedProject([layer], { k_multi: { en: "First line\nSecond line" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    // Should show first line + ellipsis
    expect(screen.getByText(/Texte • First line…/)).toBeInTheDocument();
  });

  it("renders 'Texte • <key>' for a textarea layer when no i18n value found", () => {
    const layer: MenuTitleLayer = { kind: "textarea", value: { key: K("k_missing") }, x: 0, y: 0, width: 168, lineHeight: 10, alignment: "left" };
    seedProject([layer]); // no i18n keys defined
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    // Should fallback to key name
    expect(screen.getByText(/Texte • k_missing/)).toBeInTheDocument();
  });
});

describe("LayerListItem — eye toggle", () => {
  it("toggling adds key to hiddenLayerKeys, toggling again removes it", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={2} layer={layer} />);
    const eye = screen.getByTestId("layer-list-item-eye");
    fireEvent.click(eye);
    expect(useUiStore.getState().hiddenLayerKeys.has(`${MENU_ID}:2`)).toBe(true);
    fireEvent.click(eye);
    expect(useUiStore.getState().hiddenLayerKeys.has(`${MENU_ID}:2`)).toBe(false);
  });

  it("renders Eye icon when visible, EyeOff when hidden", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    const { rerender } = render(
      <LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />,
    );
    expect(screen.getByTestId("layer-list-item-eye").getAttribute("data-hidden")).toBe("false");
    useUiStore.getState().toggleHiddenLayer(MENU_ID, 0);
    rerender(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByTestId("layer-list-item-eye").getAttribute("data-hidden")).toBe("true");
  });

  it("clicking the eye does NOT also select the row (propagation stopped)", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    fireEvent.click(screen.getByTestId("layer-list-item-eye"));
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });
});

describe("LayerListItem — selection", () => {
  it("clicking the row sets selectedLayerKey", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={3} layer={layer} />);
    fireEvent.click(screen.getByTestId("layer-list-item-row"));
    expect(useUiStore.getState().selectedLayerKey).toEqual({ menuId: MENU_ID, index: 3 });
  });

  it("selected row carries the highlight data attribute", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index: 0 } } as any);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByTestId("layer-list-item-row").getAttribute("data-selected")).toBe("true");
  });

  it("non-selected row has data-selected=false", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index: 1 } } as any);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    expect(screen.getByTestId("layer-list-item-row").getAttribute("data-selected")).toBe("false");
  });
});

describe("LayerListItem — delete", () => {
  it("clicking delete asks confirm + removes the layer when confirmed", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    fireEvent.click(screen.getByTestId("layer-list-item-delete"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const layers = useAccountStore.getState().account.projects[0]!.menus[0]!.title;
    expect(layers).toHaveLength(0);
  });

  it("clicking delete does NOT remove the layer when confirm is cancelled", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    fireEvent.click(screen.getByTestId("layer-list-item-delete"));
    const layers = useAccountStore.getState().account.projects[0]!.menus[0]!.title;
    expect(layers).toHaveLength(1);
  });

  it("clicking delete does NOT also select the row (propagation stopped)", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    fireEvent.click(screen.getByTestId("layer-list-item-delete"));
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });
});

describe("LayerListItem — drag handle", () => {
  it("renders a drag handle with the expected data attribute", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    const handle = screen.getByTestId("layer-list-item-drag");
    expect(handle.getAttribute("data-drag-handle")).toBe("true");
  });

  it("clicking the drag handle does NOT select the row", () => {
    const layer: MenuTitleLayer = { kind: "text", value: { key: K("k1") }, x: 0, y: 0 };
    seedProject([layer], { k1: { en: "x" } });
    render(<LayerListItem projectId={PACK_ID} menuId={MENU_ID} index={0} layer={layer} />);
    fireEvent.click(screen.getByTestId("layer-list-item-drag"));
    expect(useUiStore.getState().selectedLayerKey).toBeNull();
  });
});
