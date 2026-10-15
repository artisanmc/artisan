import type { Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { expect, it } from "vitest";
import { canvasClipboardActions } from "./useCanvasKeyboard";
import { menusOf } from "@/domain/documents";

const PID = "p1" as ProjectId;

it("deletes the selected items of a menu but never the menu that holds them", () => {
  const menu = {
    id: "shop" as MenuId,
    projectId: PID,
    title: [],
    rows: 3,
    layers: [
      {
        id: "l",
        name: "l",
        elements: [
          { id: "a", positions: "0", display: {}, states: [] },
          { id: "b", positions: "1", display: {}, states: [] },
          { id: "keep", positions: "2", display: {}, states: [] },
        ],
      },
    ],
  } as unknown as Menu;
  useAccountStore.setState({
    account: {
      id: "acc",
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          documents: {
            menu: [menu],
            command: [],
            dialog: [],
          },
          dataSources: [],
          i18nKeys: {},
          defaultLang: "fr",
          canvasLayout: {},
        } as unknown as Project,
      ],
    },
  } as never);
  useSelectionStore.getState().set(["shop", "a", "b"]);

  canvasClipboardActions.deleteSelection(PID, ["shop", "a", "b"]);

  const left = menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!.elements;
  expect(left.map((el) => el.id)).toEqual(["keep"]);
  expect(menusOf(useAccountStore.getState().account.projects[0]!)).toHaveLength(1);
});
