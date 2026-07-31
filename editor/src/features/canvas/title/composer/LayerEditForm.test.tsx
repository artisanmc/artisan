import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "@/domain/asset";
import type { AssetId, I18nKey, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
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
vi.mock("@/lib/api/userAssets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/userAssets")>("@/lib/api/userAssets");
  return {
    ...actual,
    duplicateAsset: vi.fn(),
  };
});

import { duplicateAsset } from "@/lib/api/userAssets";
import { useAuthStore } from "@/state/authStore";

const PACK_ID = "p1" as ProjectId;
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

function seedProject(
  layers: MenuTitleLayer[],
  i18nKeys: Record<string, Record<string, string>> = {},
) {
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
  useAuthStore.setState({ currentUser: { id: "u1" } } as any);
  seedProject([]);
  vi.mocked(duplicateAsset).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayerEditForm — empty state", () => {
  it("renders an empty-state hint when no layer is selected", () => {
    seedProject([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByText(/sélectionne un élément/i)).toBeTruthy();
  });

  it("renders empty state when selectedLayerKey points to a missing index", () => {
    seedProject([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    useUiStore.setState({ selectedLayerKey: { menuId: MENU_ID, index: 99 } } as any);
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByText(/sélectionne un élément/i)).toBeTruthy();
  });

  it("renders empty state when the menu doesn't exist on the pack", () => {
    seedProject([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    useUiStore.setState(
      { selectedLayerKey: { menuId: "ghost" as MenuId, index: 0 } } as any,
    );
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByText(/sélectionne un élément/i)).toBeTruthy();
  });
});

describe("LayerEditForm — image layer (background)", () => {
  beforeEach(() => {
    useAssetStore.setState({
      assets: [makeAsset(A("g1"), "shop_bg", { width: 176, height: 64 })],
    } as any);
    seedProject([{ kind: "background", assetId: A("g1") }]);
    selectLayer(0);
  });

  it("shows the current asset name + Pick asset button + Duplicate glyph button", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByText("shop_bg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /choisir une image/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dupliquer l'image/i })).toBeTruthy();
  });

  it("clicking Pick asset opens the AssetPicker without a typeFilter (shows all image assets)", () => {
    // The upload UX no longer distinguishes texture/glyph — the picker
    // shouldn't either. AssetPicker without `typeFilter` falls back to
    // every image asset (texture + glyph).
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /choisir une image/i }));
    const picker = screen.getByTestId("asset-picker");
    // `data-type-filter` is rendered from `props.typeFilter` — undefined
    // becomes the string "undefined" in DOM attribute land, OR the attribute
    // is absent. Either way it must NOT be "glyph" anymore.
    const attr = picker.getAttribute("data-type-filter");
    expect(attr === null || attr === "undefined").toBe(true);
  });

  it("picking a new asset updates the layer's asset_id", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /choisir une image/i }));
    fireEvent.click(screen.getByTestId("asset-picker"));
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).assetId).toBe("g_new");
  });
});

describe("LayerEditForm — image layer (glyph)", () => {
  beforeEach(() => {
    useAssetStore.setState({
      assets: [makeAsset(A("g1"), "coin")],
    } as any);
    seedProject([{ kind: "glyph", assetId: A("g1"), x: 10, y: 4 }]);
    selectLayer(0);
  });

  it("shows asset picker + Duplicate glyph button", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByRole("button", { name: /choisir une image/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dupliquer l'image/i })).toBeTruthy();
  });

  it("Duplicate glyph → confirms, calls API, upserts asset, points layer at new id", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dup = makeAsset(A("g2"), "coin (copy)");
    vi.mocked(duplicateAsset).mockResolvedValue(dup);

    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /dupliquer l'image/i }));

    // Wait for the async chain to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(duplicateAsset).toHaveBeenCalledWith("p1", "g1");
    expect(useAssetStore.getState().assets.find((a) => a.id === "g2")).toBeTruthy();
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).assetId).toBe("g2");
  });

  it("Duplicate glyph cancelled (confirm=false) → no API call, no store change", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /dupliquer l'image/i }));
    await new Promise((r) => setTimeout(r, 0));

    expect(duplicateAsset).not.toHaveBeenCalled();
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).assetId).toBe("g1");
  });
});

describe("LayerEditForm — text layer — X/Y position inputs", () => {
  beforeEach(() => {
    seedProject(
      [{ kind: "text", value: { key: K("greet") }, x: 8, y: 5 }],
      { [K("greet")]: { en: "Hello" } },
    );
    selectLayer(0);
  });

  it("shows X and Y number inputs bound to layer.x and layer.y", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const xInput = inputs.find((i) => Number(i.value) === 8);
    const yInput = inputs.find((i) => Number(i.value) === 5);
    expect(xInput).toBeTruthy();
    expect(yInput).toBeTruthy();
  });

  it("changing Y input updates layer.y in the store", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const yInput = inputs.find((i) => Number(i.value) === 5)!;
    fireEvent.change(yInput, { target: { value: "20" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).y).toBe(20);
  });

  it("changing X input updates layer.x in the store", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const xInput = inputs.find((i) => Number(i.value) === 8)!;
    fireEvent.change(xInput, { target: { value: "16" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).x).toBe(16);
  });
});

describe("LayerEditForm — text layer", () => {
  beforeEach(() => {
    seedProject(
      [{ kind: "text", value: { key: K("greet") }, x: 8, y: 5 }],
      { [K("greet")]: { en: "Hello" } },
    );
    selectLayer(0);
  });

  it("reveals an editor bound to the resolved text after clicking the facade", () => {
    const { container } = render(<LayerEditForm projectId={PACK_ID} />);
    // The field shows a rendered facade until clicked (like the item inputs).
    fireEvent.click(screen.getByText("Hello"));
    const input = container.querySelector("input, textarea") as HTMLInputElement;
    expect(input.value).toBe("Hello");
  });

  it("typing in the revealed editor writes via setI18nValue", () => {
    const { container } = render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByText("Hello"));
    const input = container.querySelector("input, textarea")!;
    fireEvent.change(input, { target: { value: "<gold>Hi</gold>" } });
    expect(
      useAccountStore.getState().account.projects[0]!.i18nKeys[K("greet")]!.en,
    ).toBe("<gold>Hi</gold>");
  });

  it("renders a live preview area that contains the resolved value", () => {
    const { container } = render(<LayerEditForm projectId={PACK_ID} />);
    expect(container.textContent).toContain("Hello");
  });
});

describe("LayerEditForm — text layer — font picker", () => {
  function makeFont(id: string, name: string): Asset {
    return makeAsset(id, name, { type: "font", ascent: null, codepoint: null, fontMeta: null });
  }

  beforeEach(() => {
    seedProject(
      [{ kind: "text", value: { key: K("greet") }, x: 8, y: 5 }],
      { [K("greet")]: { en: "Hello" } },
    );
    selectLayer(0);
  });

  it("shows a font select defaulting to Aucune when no font is assigned", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const select = screen.getByLabelText(/police personnalisée/i) as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("lists available font assets in the select dropdown", () => {
    useAssetStore.setState({ assets: [makeFont(A("f1"), "my_font")] } as any);
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByRole("option", { name: "my_font" })).toBeTruthy();
  });

  it("selecting a font updates fontAssetId on the layer", () => {
    useAssetStore.setState({ assets: [makeFont(A("f1"), "my_font")] } as any);
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.change(screen.getByLabelText(/police personnalisée/i), { target: { value: "f1" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).fontAssetId).toBe("f1");
  });

  it("selecting the empty option clears fontAssetId", () => {
    useAssetStore.setState({ assets: [makeFont(A("f1"), "my_font")] } as any);
    seedProject(
      [{ kind: "text", value: { key: K("greet") }, x: 8, y: 5, fontAssetId: A("f1") }],
      { [K("greet")]: { en: "Hello" } },
    );
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    const select = screen.getByLabelText(/police personnalisée/i) as HTMLSelectElement;
    expect(select.value).toBe("f1");
    fireEvent.change(select, { target: { value: "" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).fontAssetId).toBeUndefined();
  });

  it("shows a hint about importing fonts when none exist", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByText(/importe une police/i)).toBeTruthy();
  });
});

describe("LayerEditForm — external glyph layer", () => {
  beforeEach(() => {
    seedProject([
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 0, y: 0 },
    ]);
    selectLayer(0);
  });

  it("renders provider dropdown + name input bound to the layer", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const provider = screen.getByLabelText(/provider/i) as HTMLSelectElement;
    const name = screen.getByLabelText(/glyph name/i) as HTMLInputElement;
    expect(provider.value).toBe("oraxen");
    expect(name.value).toBe("coin");
  });

  it("changing provider dispatches updateMenuTitleLayer", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: "nexo" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).provider).toBe("nexo");
  });

  it("typing in the name input dispatches updateMenuTitleLayer", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.change(screen.getByLabelText(/glyph name/i), { target: { value: "diamond" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as any).glyphName).toBe("diamond");
  });
});

describe("LayerEditForm — textarea layer", () => {
  beforeEach(() => {
    seedProject(
      [
        {
          kind: "textarea",
          value: { key: K("t1") },
          x: 8,
          y: 6,
          width: 168,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { t1: { en: "hello\nworld" } },
    );
    selectLayer(0);
  });

  it("renders the multi-line textarea + line-height + alignment + font picker + xy inputs", () => {
    const { container } = render(<LayerEditForm projectId={PACK_ID} />);
    expect(container.querySelector("textarea")).toBeTruthy();
    expect(screen.getByTestId("textarea-line-height")).toBeTruthy();
    expect(screen.getByTestId("textarea-align-left")).toBeTruthy();
    expect(screen.getByTestId("textarea-align-center")).toBeTruthy();
    expect(screen.getByTestId("textarea-align-right")).toBeTruthy();
    expect(screen.getByTestId("textarea-font")).toBeTruthy();
    expect(screen.getByTestId("textarea-x")).toBeTruthy();
    expect(screen.getByTestId("textarea-y")).toBeTruthy();
  });

  it("editing the content writes newlines to the i18n value", () => {
    const { container } = render(<LayerEditForm projectId={PACK_ID} />);
    const ta = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "line1\nline2\nline3" } });
    const updated = useAccountStore.getState().account.projects[0]!.i18nKeys.t1?.en;
    expect(updated).toBe("line1\nline2\nline3");
  });

  it("clicking center alignment updates layer.alignment", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByTestId("textarea-align-center"));
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0] as any;
    expect(layer.alignment).toBe("center");
  });

  it("line height clamps to [1, 32]", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const lh = screen.getByTestId("textarea-line-height") as HTMLInputElement;
    fireEvent.change(lh, { target: { value: "0" } });
    let layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0] as any;
    expect(layer.lineHeight).toBe(1);
    fireEvent.change(lh, { target: { value: "999" } });
    layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0] as any;
    expect(layer.lineHeight).toBe(32);
  });

  it("shows a Y-overflow warning when y + (lines-1)*lineHeight > 140", () => {
    // 5 lines, y=130, lineHeight=10 → line 4 at y=170 > 140.
    seedProject(
      [
        {
          kind: "textarea",
          value: { key: K("t1") },
          x: 0,
          y: 130,
          width: 168,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { t1: { en: "a\nb\nc\nd\ne" } },
    );
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByTestId("textarea-y-overflow-warning")).toBeTruthy();
  });

  it("does not show Y-overflow warning when all lines fit", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.queryByTestId("textarea-y-overflow-warning")).toBeNull();
  });

  it("width input renders and shows layer.width", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const input = screen.getByTestId("textarea-width") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("168");
  });

  it("editing width updates layer.width in store", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const input = screen.getByTestId("textarea-width") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "100" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0] as any;
    expect(layer.width).toBe(100);
  });

  it("width input clamps to [8, 256]", () => {
    render(<LayerEditForm projectId={PACK_ID} />);
    const input = screen.getByTestId("textarea-width") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } });
    let layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0] as any;
    expect(layer.width).toBe(8);
    fireEvent.change(input, { target: { value: "9999" } });
    layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0] as any;
    expect(layer.width).toBe(256);
  });
});

describe("LayerEditForm — text layer size", () => {
  it("renders a size dropdown defaulting to 8 (Normal)", () => {
    seedProject([{ kind: "text", value: { key: K("k") }, x: 0, y: 0 }]);
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    const select = screen.getByLabelText(/size|taille/i) as HTMLSelectElement;
    expect(select.value).toBe("8");
  });

  it("changing the dropdown to 16 writes size=16 on the layer", () => {
    seedProject([{ kind: "text", value: { key: K("k") }, x: 0, y: 0 }]);
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    const select = screen.getByLabelText(/size|taille/i);
    fireEvent.change(select, { target: { value: "16" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as { size?: number }).size).toBe(16);
  });

  it("changing dropdown back to 8 stores undefined (default-omit)", () => {
    seedProject([{ kind: "text", value: { key: K("k") }, x: 0, y: 0, size: 16 }]);
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.change(screen.getByLabelText(/size|taille/i), { target: { value: "8" } });
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as { size?: number }).size).toBeUndefined();
  });

  it("size dropdown is hidden when fontAssetId is set", () => {
    seedProject([{ kind: "text", value: { key: K("k") }, x: 0, y: 0, fontAssetId: A("f1") }]);
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.queryByLabelText(/size|taille/i)).toBeNull();
  });
});

describe("LayerEditForm — textarea layer size + lineHeight align", () => {
  it("renders the size dropdown for textarea layers", () => {
    seedProject([{
      kind: "textarea", value: { key: K("k") }, x: 0, y: 20,
      width: 168, lineHeight: 10, alignment: "left",
    }]);
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    expect(screen.getByLabelText(/size|taille/i)).toBeTruthy();
  });

  it("'Aligner lineHeight' button sets lineHeight to size + 2", () => {
    seedProject([{
      kind: "textarea", value: { key: K("k") }, x: 0, y: 20,
      width: 168, lineHeight: 10, alignment: "left", size: 16,
    }]);
    selectLayer(0);
    render(<LayerEditForm projectId={PACK_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /aligner à la taille|match line height to size/i }));
    const layer = useAccountStore.getState().account.projects[0]!.menus[0]!.title[0]!;
    expect((layer as { lineHeight: number }).lineHeight).toBe(18);
  });
});
