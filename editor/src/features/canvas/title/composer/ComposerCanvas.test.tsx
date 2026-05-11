import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { I18nKey, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { ComposerCanvas } from "./ComposerCanvas";

vi.mock("react-konva", () => ({
  Stage: ({
    children,
    width,
    height,
  }: {
    children: React.ReactNode;
    width: number;
    height: number;
  }) => (
    <div data-testid="stage" data-width={width} data-height={height}>
      {children}
    </div>
  ),
  Layer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layer">{children}</div>
  ),
}));
vi.mock("./TitleRender", () => ({
  TitleRender: (props: {
    mode: string;
    selectedIndex?: number;
    onLayerClick?: (i: number) => void;
  }) => (
    <div
      data-testid="title-render"
      data-mode={props.mode}
      data-selected={props.selectedIndex ?? "null"}
      onClick={() => props.onLayerClick?.(0)}
    />
  ),
  titleRenderHeight: () => 100,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as never,
      packs: [
        {
          id: PACK_ID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [
            {
              id: MENU_ID,
              packId: PACK_ID,
              title: layers,
              rows: 3,
              layers: [],
            },
          ],
          commands: [],
          templates: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys: { [K("g")]: { en: "Hello" } },
          defaultLang: "en",
          dialogs: [],
          canvasLayout: {},
        },
      ],
      packOrder: [PACK_ID],
    },
  } as never);
  useUiStore.setState({ activeLang: "en" } as never);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  seedPack([]);
});

describe("ComposerCanvas", () => {
  it("renders TitleRender in edit mode", () => {
    const { getByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />,
    );
    expect(getByTestId("title-render").getAttribute("data-mode")).toBe("edit");
  });

  it("passes selectedIndex from titleSelectionStore", () => {
    useTitleSelectionStore.getState().setSelectedIndex(2);
    const { getByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />,
    );
    expect(getByTestId("title-render").getAttribute("data-selected")).toBe("2");
  });

  it("clicking a layer updates the selection store", () => {
    const { getByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />,
    );
    fireEvent.click(getByTestId("title-render"));
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(0);
  });

  it("Stage height comes from titleRenderHeight (mocked to 100)", () => {
    const { getByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />,
    );
    expect(getByTestId("stage").getAttribute("data-height")).toBe("100");
  });
});
