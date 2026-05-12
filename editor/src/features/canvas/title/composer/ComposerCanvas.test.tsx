import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { I18nKey, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
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
  TitleRender: (props: { packId: string; menuId: string; scale: number }) => (
    <div
      data-testid="title-render"
      data-pack-id={props.packId}
      data-menu-id={props.menuId}
      data-scale={props.scale}
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
  seedPack([]);
});

describe("ComposerCanvas", () => {
  it("mounts TitleRender for the given pack/menu", () => {
    const { getByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />,
    );
    const node = getByTestId("title-render");
    expect(node.getAttribute("data-pack-id")).toBe(PACK_ID);
    expect(node.getAttribute("data-menu-id")).toBe(MENU_ID);
  });

  it("Stage height comes from titleRenderHeight (mocked to 100)", () => {
    const { getByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />,
    );
    expect(getByTestId("stage").getAttribute("data-height")).toBe("100");
  });

  it("renders nothing when the menu does not exist", () => {
    const { queryByTestId } = render(
      <ComposerCanvas packId={PACK_ID} menuId={"missing" as MenuId} />,
    );
    expect(queryByTestId("stage")).toBeNull();
  });
});
