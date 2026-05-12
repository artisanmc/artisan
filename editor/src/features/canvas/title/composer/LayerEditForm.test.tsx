import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "@/domain/asset";
import type { AssetId, I18nKey, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { LayerEditForm } from "./LayerEditForm";

// Mock AssetPicker — same pattern as AddLayerBar.test. Renders a clickable
// stub when `open` so we can assert the picker is mounted and exercise the
// pick callback.
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? (
      <button
        data-testid="asset-picker"
        data-type-filter={props.typeFilter}
        onClick={() => props.onPick({ id: "g_new", name: "new", type: "glyph" })}
      >
        pick
      </button>
    ) : null,
}));

// Mock the backend API. Tests reach into the `duplicateAsset` spy.
vi.mock("@/lib/packApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/packApi")>("@/lib/packApi");
  return {
    ...actual,
    duplicateAsset: vi.fn(),
  };
});

import { duplicateAsset } from "@/lib/packApi";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;
const A = (s: string) => s as AssetId;

function makeAsset(id: string, name: string, overrides: Partial<Asset> = {}): Asset {
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
    ...overrides,
  };
}

function seedPack(
  layers: MenuTitleLayer[],
  i18nKeys: Record<string, Record<string, string>> = {},
) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [
        {
          id: PACK_ID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
          commands: [],
          templates: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys,
          defaultLang: "en",
          dialogs: [],
          canvasLayout: {},
        },
      ],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en", selectedLayerKey: null } as any);
}

function selectLayer(index: number) {
  useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index } } as any);
}

beforeEach(() => {
  useAssetStore.setState({
    assets: [],
    selectedId: null,
    loading: false,
    error: null,
  } as any);
  useSessionStore.setState({
    accessToken: "tok-123",
    serverKeyId: "sk1",
    trustCode: null,
    trusted: true,
  } as any);
  seedPack([]);
  vi.mocked(duplicateAsset).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayerEditForm — empty state", () => {
  it("renders an empty-state hint when no layer is selected", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByText(/select a layer/i)).toBeTruthy();
  });

  it("renders empty state when selectedLayerKey points to a missing index", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index: 99 } } as any);
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByText(/select a layer/i)).toBeTruthy();
  });

  it("renders empty state when the menu doesn't exist on the pack", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    useUiStore.setState(
      { selectedLayerKey: { menuId: "ghost" as MenuId, index: 0 } } as any,
    );
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByText(/select a layer/i)).toBeTruthy();
  });
});

describe("LayerEditForm — image layer (background)", () => {
  beforeEach(() => {
    useAssetStore.setState({
      assets: [makeAsset(A("g1"), "shop_bg", { width: 176, height: 64 })],
    } as any);
    seedPack([{ kind: "background", assetId: A("g1") }]);
    selectLayer(0);
  });

  it("shows the current asset name + Pick asset button + Duplicate glyph button", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByText("shop_bg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /pick asset/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /duplicate glyph/i })).toBeTruthy();
  });

  it("clicking Pick asset opens the AssetPicker (typeFilter=glyph)", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /pick asset/i }));
    const picker = screen.getByTestId("asset-picker");
    expect(picker.getAttribute("data-type-filter")).toBe("glyph");
  });

  it("picking a new asset updates the layer's asset_id", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /pick asset/i }));
    fireEvent.click(screen.getByTestId("asset-picker"));
    const layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((layer as any).assetId).toBe("g_new");
  });
});

describe("LayerEditForm — image layer (glyph)", () => {
  beforeEach(() => {
    useAssetStore.setState({
      assets: [makeAsset(A("g1"), "coin")],
    } as any);
    seedPack([{ kind: "glyph", assetId: A("g1"), x: 10, y: 4 }]);
    selectLayer(0);
  });

  it("shows asset picker + Duplicate glyph button", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByRole("button", { name: /pick asset/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /duplicate glyph/i })).toBeTruthy();
  });

  it("Duplicate glyph → confirms, calls API, upserts asset, points layer at new id", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dup = makeAsset(A("g2"), "coin (copy)");
    vi.mocked(duplicateAsset).mockResolvedValue(dup);

    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /duplicate glyph/i }));

    // Wait for the async chain to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(duplicateAsset).toHaveBeenCalledWith("tok-123", "g1");
    expect(useAssetStore.getState().assets.find((a) => a.id === "g2")).toBeTruthy();
    const layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((layer as any).assetId).toBe("g2");
  });

  it("Duplicate glyph cancelled (confirm=false) → no API call, no store change", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /duplicate glyph/i }));
    await new Promise((r) => setTimeout(r, 0));

    expect(duplicateAsset).not.toHaveBeenCalled();
    const layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((layer as any).assetId).toBe("g1");
  });
});

describe("LayerEditForm — text layer", () => {
  beforeEach(() => {
    seedPack(
      [{ kind: "text", value: { key: K("greet") }, x: 8, y: 5 }],
      { [K("greet")]: { en: "Hello" } },
    );
    selectLayer(0);
  });

  it("renders a textarea bound to the resolved text", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    const textarea = screen.getByLabelText(/text \(minimessage\)/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello");
  });

  it("typing in the textarea writes via setI18nValue", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    const textarea = screen.getByLabelText(/text \(minimessage\)/i);
    fireEvent.change(textarea, { target: { value: "<gold>Hi</gold>" } });
    expect(
      useAccountStore.getState().account.packs[0]!.i18nKeys[K("greet")]!.en,
    ).toBe("<gold>Hi</gold>");
  });

  it("renders a live preview area that contains the resolved value", () => {
    const { container } = render(<LayerEditForm packId={PACK_ID} />);
    expect(container.textContent).toContain("Hello");
  });
});

describe("LayerEditForm — external glyph layer", () => {
  beforeEach(() => {
    seedPack([
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 0, y: 0 },
    ]);
    selectLayer(0);
  });

  it("renders provider dropdown + name input bound to the layer", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    const provider = screen.getByLabelText(/provider/i) as HTMLSelectElement;
    const name = screen.getByLabelText(/glyph name/i) as HTMLInputElement;
    expect(provider.value).toBe("oraxen");
    expect(name.value).toBe("coin");
  });

  it("changing provider dispatches updateMenuTitleLayer", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: "nexo" } });
    const layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((layer as any).provider).toBe("nexo");
  });

  it("typing in the name input dispatches updateMenuTitleLayer", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.change(screen.getByLabelText(/glyph name/i), { target: { value: "diamond" } });
    const layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((layer as any).glyphName).toBe("diamond");
  });
});
