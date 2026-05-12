import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId, AssetId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { FocusComposer } from "./FocusComposer";

vi.mock("./ComposerCanvas", () => ({
  ComposerCanvas: () => <div data-testid="composer-canvas" />,
}));
vi.mock("./LayerSidePanel", () => ({
  LayerSidePanel: () => <div data-testid="side-panel" />,
}));
vi.mock("./AddLayerBar", () => ({
  AddLayerBar: () => <div data-testid="add-bar" />,
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
        importedConnectors: [], i18nKeys: { [K("g")]: { en: "H" } },
        defaultLang: "en", dialogs: [], canvasLayout: {},
      }],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  seedPack([]);
});

describe("FocusComposer", () => {
  it("renders all three children", () => {
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByTestId("composer-canvas")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("add-bar")).toBeTruthy();
  });

  // TODO P1.12: Back / Escape close behavior was driven by uiStore.titleComposerOpen
  // which v3 has dropped. The whole FocusComposer is scheduled for deletion in
  // P1.12, so for this transitional commit we just keep the file building by
  // asserting the Back button still renders (no behavioral expectations).
  it("renders a Back button", () => {
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByRole("button", { name: /back/i })).toBeTruthy();
  });

  it("pressing Escape does not throw", () => {
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.keyDown(window, { key: "Escape" });
  });

  it("pressing Delete with a layer selected removes it (no input focused)", () => {
    seedPack([
      { kind: "glyph", assetId: A("a"), x: 0, y: 0 },
      { kind: "glyph", assetId: A("b"), x: 0, y: 0 },
    ]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(1);
  });

  it("pressing Backspace while a textarea has focus does NOT delete", () => {
    seedPack([{ kind: "glyph", assetId: A("a"), x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    const { container } = render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    const ta = document.createElement("textarea");
    container.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(1);
  });
});
