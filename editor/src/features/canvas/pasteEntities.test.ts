import type { I18nKey, Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { expect, it } from "vitest";
import { rewriteIds } from "./clipboard";
import { findSelectedEntities } from "./useCanvasKeyboard";
import { menusOf } from "@/domain/documents";

const PID = "p1" as ProjectId;
const KEY = "menus.crafter.title" as I18nKey;

it("gives a pasted menu's plain title its own key, leaving the original's intact", () => {
  const crafter = {
    id: "crafter" as MenuId,
    projectId: PID,
    title: [{ kind: "plain", value: { key: KEY } }],
    rows: 3,
    layers: [],
  } as unknown as Menu;
  useAccountStore.setState({
    account: {
      id: "acc",
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          documents: {
            menu: [crafter],
            command: [],
            dialog: [],
          },
          dataSources: [],
          i18nKeys: { [KEY]: { fr: "Crafter" } },
          defaultLang: "fr",
          canvasLayout: {},
        } as unknown as Project,
      ],
    },
  } as never);
  const { menus } = rewriteIds({ menus: [JSON.parse(JSON.stringify(crafter))], commands: [] });
  useAccountStore
    .getState()
    .pasteEntities({ projectId: PID, menus, commands: [], offset: { x: 0, y: 0 } });

  const project = useAccountStore.getState().account.projects[0]!;
  const [original, copy] = menusOf(project);
  const keyOf = (m: Menu) => (m.title[0] as { value: { key: I18nKey } }).value.key;
  expect(keyOf(original!)).toBe(KEY);
  expect(project.i18nKeys[KEY]).toEqual({ fr: "Crafter" });
  expect(project.i18nKeys[keyOf(copy!)]).toEqual({ fr: "Crafter" });
  expect(keyOf(copy!)).not.toBe(KEY);
});

it("copies only the items when their menu is selected alongside them", () => {
  const menu = {
    id: "crafter" as MenuId,
    projectId: PID,
    title: [],
    rows: 3,
    layers: [
      { id: "l", name: "l", elements: [{ id: "iron", positions: "0", display: {}, states: [] }] },
    ],
  } as unknown as Menu;
  useAccountStore.setState({
    account: {
      id: "acc",
      projectOrder: [PID],
      projects: [
        { id: PID, documents: { menu: [menu], command: [] }, i18nKeys: {} } as unknown as Project,
      ],
    },
  } as never);
  const copied = findSelectedEntities(PID, ["crafter", "iron"], null);
  expect(copied.menus).toEqual([]);
  expect(copied.elements.map((e) => e.element.id)).toEqual(["iron"]);
});
