import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Menu, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

import { MenuProperties } from "./MenuProperties";

// Mock AssetPicker so opening the LayerEditForm sub-form doesn't drag in
// the real picker (which needs an auth token + fetch). Matches the mock in
// LayersPanel.test.tsx so the title section can mount cleanly.
vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) =>
    props.open ? <div data-testid="asset-picker">picker {props.typeFilter}</div> : null,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "shop_menu" as MenuId;

function seedPack() {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [
        {
          id: PACK_ID,
          name: "my_pack",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [
            {
              id: MENU_ID,
              packId: PACK_ID,
              title: [],
              rows: 3,
              layers: [],
            },
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
        },
      ],
      packOrder: [PACK_ID],
    },
  } as any);
}

beforeEach(() => {
  seedPack();
  useUiStore.setState({
    selectedMenuId: null,
    lastSelectedMenuId: null,
    selectedLayerKey: null,
    hiddenLayerKeys: new Set<string>(),
    draggingNewLayer: null,
    activeLang: "en",
  } as any);
});

describe("MenuProperties — embedded title section", () => {
  it("renders the title section with the LayersPanel for the provided menu", () => {
    const menu = useAccountStore.getState().account.packs[0]!.menus[0]! as Menu;
    render(<MenuProperties packId={PACK_ID} menu={menu} />);

    // Section wrapper present (i18n-agnostic — keyed by data-testid).
    expect(screen.getByTestId("menu-properties-title-section")).toBeInTheDocument();
    // LayersPanel itself mounted (its outer wrapper has data-testid="layers-panel").
    expect(screen.getByTestId("layers-panel")).toBeInTheDocument();
    // The AddLayerControls (the section's primary affordance) is visible.
    expect(screen.getByTestId("add-layer-controls")).toBeInTheDocument();
  });
});
