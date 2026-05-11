import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { useUiStore } from "@/state/uiStore";

// Mock AssetPicker so we don't render the real one (which depends on
// network-backed previews). Surfaces the typeFilter via data attribute so
// tests can assert it, and exposes a "pick" button that returns a font
// Asset.
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: {
    open: boolean;
    onClose: () => void;
    typeFilter: string;
    onPick: (asset: Asset) => void;
    title?: string;
  }) =>
    props.open ? (
      <div data-testid="asset-picker" data-type-filter={props.typeFilter}>
        <button
          type="button"
          data-testid="asset-picker-pick"
          onClick={() =>
            props.onPick({
              id: "asset_font" as AssetId,
              serverKeyId: "sk1",
              type: "font",
              name: "fancy",
              width: 0,
              height: 0,
              ascent: null,
              codepoint: null,
              fontMeta: null,
              contentHash: "h_font",
              createdAt: "",
              updatedAt: "",
            })
          }
        >
          pick
        </button>
        <button
          type="button"
          data-testid="asset-picker-close"
          onClick={() => props.onClose()}
        >
          close
        </button>
      </div>
    ) : null,
}));

// Import AFTER the mock so the component picks up the mocked module.
import { TitleTextEditor } from "./TitleTextEditor";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const ASSET_FONT = "asset_font" as AssetId;
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

function seedFontAsset(): void {
  const asset: Asset = {
    id: ASSET_FONT,
    serverKeyId: "sk1",
    type: "font",
    name: "fancy",
    width: 0,
    height: 0,
    ascent: null,
    codepoint: null,
    fontMeta: null,
    contentHash: "h_font",
    createdAt: "",
    updatedAt: "",
  };
  useAssetStore.setState({ assets: [asset] });
}

function currentLayer(): MenuTitleLayer | undefined {
  return useAccountStore.getState().account.packs[0]?.menus[0]?.title[0];
}

beforeEach(() => {
  useAssetStore.getState().reset();
  useUiStore.setState({ activeLang: "en" });
});

describe("TitleTextEditor", () => {
  it("renders with the existing text layer's resolved value", () => {
    const menu = seedPack([
      { kind: "text", value: { key: I18N_KEY }, x: 4, y: 5 },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId("title-text-input") as HTMLInputElement;
    expect(input.value).toBe("Hello world");
  });

  it("typing into the text input writes via setI18nValue", () => {
    const menu = seedPack([
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId("title-text-input");
    fireEvent.change(input, { target: { value: "Goodbye" } });
    const pack = useAccountStore.getState().account.packs[0]!;
    expect(pack.i18nKeys[I18N_KEY]?.en).toBe("Goodbye");
  });

  it("changing the color input calls updateMenuTitleLayer with the new color", () => {
    const menu = seedPack([
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    const colorInput = screen.getByTestId("title-color-input");
    fireEvent.input(colorInput, { target: { value: "#aabbcc" } });
    const layer = currentLayer();
    expect(layer?.kind).toBe("text");
    if (layer?.kind === "text") {
      expect(layer.color).toBe("#aabbcc");
    }
  });

  it("clicking color clear resets color to undefined", () => {
    const menu = seedPack([
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0, color: "#112233" },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("title-color-clear"));
    const layer = currentLayer();
    expect(layer?.kind).toBe("text");
    if (layer?.kind === "text") {
      expect(layer.color).toBeUndefined();
    }
  });

  it("displays 'vanilla' when no fontAssetId is set", () => {
    const menu = seedPack([
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("title-font-name").textContent).toContain(
      "vanilla",
    );
  });

  it("displays the asset name when fontAssetId is set", () => {
    seedFontAsset();
    const menu = seedPack([
      {
        kind: "text",
        value: { key: I18N_KEY },
        x: 0,
        y: 0,
        fontAssetId: ASSET_FONT,
      },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("title-font-name").textContent).toContain(
      "fancy",
    );
  });

  it("picking a font from the AssetPicker sets fontAssetId on the layer", () => {
    const menu = seedPack([
      { kind: "text", value: { key: I18N_KEY }, x: 0, y: 0 },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    // Open the picker.
    fireEvent.click(screen.getByTestId("title-font-pick"));
    const picker = screen.getByTestId("asset-picker");
    expect(picker.getAttribute("data-type-filter")).toBe("font");
    // Simulate a pick.
    fireEvent.click(screen.getByTestId("asset-picker-pick"));
    const layer = currentLayer();
    expect(layer?.kind).toBe("text");
    if (layer?.kind === "text") {
      expect(layer.fontAssetId).toBe("asset_font");
    }
  });

  it("clicking font clear resets fontAssetId to undefined", () => {
    seedFontAsset();
    const menu = seedPack([
      {
        kind: "text",
        value: { key: I18N_KEY },
        x: 0,
        y: 0,
        fontAssetId: ASSET_FONT,
      },
    ]);
    render(
      <TitleTextEditor
        packId={PACK_ID}
        menu={menu}
        index={0}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("title-font-clear"));
    const layer = currentLayer();
    expect(layer?.kind).toBe("text");
    if (layer?.kind === "text") {
      expect(layer.fontAssetId).toBeUndefined();
    }
  });
});
