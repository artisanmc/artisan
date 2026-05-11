import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { TitleThumbnail } from "./TitleThumbnail";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [
        {
          id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
          menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
          commands: [], templates: [], assets: [], dataSources: [],
          importedConnectors: [], i18nKeys: { [K("g")]: { en: "Hello" } },
          defaultLang: "en", dialogs: [], canvasLayout: {},
        },
      ],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => seedPack([]));

describe("TitleThumbnail", () => {
  it("renders 'No title' when title is empty", () => {
    seedPack([]);
    const { getByText } = render(<TitleThumbnail packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByText(/no title/i)).toBeTruthy();
  });

  it("renders the resolved text of the first text layer", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    const { getByText } = render(<TitleThumbnail packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByText("Hello")).toBeTruthy();
  });

  it("renders a count badge when multiple layers exist", () => {
    seedPack([
      { kind: "glyph", assetId: "a" as any, x: 0, y: 0 },
      { kind: "glyph", assetId: "b" as any, x: 0, y: 0 },
      { kind: "text", value: { key: K("g") }, x: 0, y: 0 },
    ]);
    const { getByText } = render(<TitleThumbnail packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByText(/3 layers/i)).toBeTruthy();
  });
});
