import { menusOf } from "@/domain/documents";
import type { Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { expect, it, vi } from "vitest";
import { canvasClipboardActions } from "./useCanvasKeyboard";

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
  useProjectsStore.setState({
    openProjects: {
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
  useSelectionStore.getState().set(["menu/shop", "a", "b"]);

  canvasClipboardActions.deleteSelection(PID, ["menu/shop", "a", "b"]);

  const left = menusOf(useProjectsStore.getState().openProjects.projects[0]!)[0]!.layers[0]!
    .elements;
  expect(left.map((el) => el.id)).toEqual(["keep"]);
  expect(menusOf(useProjectsStore.getState().openProjects.projects[0]!)).toHaveLength(1);
});

it("never deletes a module's system menu, and says so", () => {
  const menu = (id: string) => ({ id, projectId: PID, title: [], rows: 3, layers: [] });
  useProjectsStore.setState({
    openProjects: {
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          documents: { menu: [menu("shop_main"), menu("mine")], command: [], dialog: [] },
          dataSources: [],
          i18nKeys: {},
          defaultLang: "fr",
          canvasLayout: {},
        } as unknown as Project,
      ],
    },
  } as never);
  useProjectTemplatesStore.setState({
    entries: {
      [PID]: {
        status: "ready",
        origins: {
          "menus/shop_main.yaml": { module: "boutique", template: "menus", version: 1, hash: "h" },
        },
        hashes: {},
      },
    },
  });
  useModulesStore.setState({
    active: [
      {
        id: "boutique",
        version: "1",
        templates: [
          {
            id: "menus",
            title: "menus",
            version: 1,
            system: true,
            files: [{ path: "menus/shop_main.yaml", hash: "h", size: 1 }],
          },
        ],
      },
    ],
  });
  const kept = vi.fn();

  canvasClipboardActions.deleteSelection(PID, ["menu/shop_main", "menu/mine"], kept);

  expect(menusOf(useProjectsStore.getState().openProjects.projects[0]!).map((m) => m.id)).toEqual([
    "shop_main",
  ]);
  expect(kept).toHaveBeenCalledOnce();
});
