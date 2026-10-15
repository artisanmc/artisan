import type { Menu, MenuId, Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { beforeEach, expect, it, vi } from "vitest";
import { canvasClipboardActions } from "./useCanvasKeyboard";
import { menusOf } from "@/domain/documents";

const PID = "p1" as ProjectId;
const A = "a" as MenuId;
const B = "b" as MenuId;

const menu = (id: MenuId, elements: { id: string; positions: string }[]): Menu =>
  ({
    id,
    projectId: PID,
    title: [],
    rows: 3,
    layers: [
      {
        id: `${id}-l`,
        name: "l",
        elements: elements.map((e) => ({ ...e, display: { material: "STONE" }, states: [] })),
      },
    ],
  }) as unknown as Menu;

const positionsIn = (menuId: MenuId) =>
  menusOf(useAccountStore.getState().account.projects[0]!)
    .find((m) => m.id === menuId)!
    .layers.flatMap((l) => l.elements.map((e) => e.positions));

const copy = async (menuId: MenuId, ids: string[]) => {
  useSelectionStore.getState().set(ids, null, menuId);
  await canvasClipboardActions.copySelection(PID, ids);
};

beforeEach(() => {
  useAccountStore.setState({
    account: {
      id: "acc",
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          documents: {
            menu: [
              menu(A, [
                { id: "x", positions: "0" },
                { id: "y", positions: "1" },
              ]),
              menu(B, [{ id: "z", positions: "4" }]),
            ],
            command: [],
            dialog: [],
          },
          dataSources: [],
          i18nKeys: {},
          canvasLayout: {},
        } as unknown as Project,
      ],
    },
  } as never);
});

it("pastes into the anchored slot", async () => {
  await copy(A, ["x"]);
  await canvasClipboardActions.pasteFromClipboard(PID, undefined, { menuId: A, position: 13 });
  expect(positionsIn(A)).toEqual(["0", "1", "13"]);
});

it("pastes into the anchored menu, not the selected one", async () => {
  await copy(A, ["x"]);
  await canvasClipboardActions.pasteFromClipboard(PID, undefined, { menuId: B, position: 20 });
  expect(positionsIn(A)).toEqual(["0", "1"]);
  expect(positionsIn(B)).toEqual(["4", "20"]);
});

it("keeps the copied items' relative layout", async () => {
  await copy(A, ["x", "y"]);
  await canvasClipboardActions.pasteFromClipboard(PID, undefined, { menuId: B, position: 9 });
  expect(positionsIn(B)).toEqual(["4", "9", "10"]);
});

it("moves on to the next free slot when the anchored one is taken", async () => {
  await copy(A, ["x"]);
  await canvasClipboardActions.pasteFromClipboard(PID, undefined, { menuId: B, position: 4 });
  expect(positionsIn(B)).toEqual(["4", "5"]);
});

it("keeps the copied position when the anchored group overflows the grid", async () => {
  await copy(A, ["x", "y"]);
  const onError = vi.fn();
  await canvasClipboardActions.pasteFromClipboard(PID, onError, { menuId: B, position: 26 });
  // x lands on 26; y would land on 27 (off a 27-slot chest) so it keeps slot 1.
  expect(positionsIn(B)).toEqual(["4", "26", "1"]);
  expect(onError).not.toHaveBeenCalled();
});

it("without an anchor, keeps the previous behaviour", async () => {
  await copy(A, ["x"]);
  await canvasClipboardActions.pasteFromClipboard(PID);
  expect(positionsIn(A)).toEqual(["0", "1", "2"]);
});
