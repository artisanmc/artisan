import type { ElementId, MenuId, Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { act, render, renderHook, screen } from "@testing-library/react";
import type Konva from "konva";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PlacementTray } from "./PlacementTray";
import { slotXY } from "./menuLayout";
import { useSlotDrag } from "./useSlotDrag";
import { menusOf } from "@/domain/documents";

vi.mock("react-konva", () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Rect: () => null,
  Text: () => null,
}));
vi.mock("./SlotItem", () => ({
  SlotItem: ({ material }: { material: string }) => <span data-testid="material">{material}</span>,
}));

const projectId = "p" as ProjectId;
const menuId = "m" as MenuId;
const elementId = "items" as ElementId;
let project: Project;
beforeEach(() => {
  project = {
    id: projectId,
    defaultLang: "en",
    i18nKeys: {},
    assets: [],
    dataSources: [],
    documents: {
      menu: [
        {
          id: menuId,
          rows: 3,
          layers: [
            {
              id: "l",
              elements: [
                {
                  id: elementId,
                  positions: "",
                  display: { material: "{entry.material}" },
                  states: [],
                  places: {
                    source: "stock",
                    alias: "entry",
                    keyField: "id",
                    placements: [
                      { key: "a", page: 1, position: 0, cachedDisplay: { material: "STONE" } },
                      { key: "b", page: 1, position: 4 },
                      { key: "c", page: 0, position: 0 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as Project;
  useAccountStore.setState({
    account: { id: "acc" as never, projects: [project], projectOrder: [projectId] },
  });
  usePaginationStore.setState({ pageByElement: { [elementId]: 1 } });
  useSelectionStore.getState().clear();
  useUiStore.setState({ activeLang: "en", menuPreviewArgs: {} });
});

it.each(["paste", "move", "duplicate", "selection"])(
  "preserves placements when ordinary items %s",
  (operation) => {
    const ordinary = {
      id: "ordinary" as ElementId,
      positions: "8",
      display: { material: "STONE" },
      states: [],
    };
    menusOf(project)[0]!.layers[0]!.elements.push(ordinary);
    const before = structuredClone(menusOf(project)[0]!.layers[0]!.elements[0]);
    const store = useAccountStore.getState();
    const target = { projectId, menuId, elementId: ordinary.id };
    if (operation === "paste")
      store.addElement({ projectId, menuId, element: { ...ordinary, positions: "7" } });
    if (operation === "move")
      store.moveElementPosition({ ...target, fromPosition: 8, toPosition: 7 });
    if (operation === "duplicate") store.addElementPosition({ ...target, position: 7 });
    if (operation === "selection")
      store.moveSelectionByDelta({
        projectId,
        menuId,
        elementIds: [ordinary.id],
        dCol: -1,
        dRow: 0,
      });
    const elements = menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!
      .elements;
    expect(elements.find((el) => el.id === elementId)).toEqual(before);
    expect(elements.some((el) => el.positions.includes("7"))).toBe(true);
  },
);

it("resolves tray thumbnails with the placement alias", () => {
  render(
    <PlacementTray
      project={project}
      menu={menusOf(project)[0]!}
      scope={{ stock: [{ id: "new", material: "DIAMOND" }] }}
      boxWidth={352}
      boxHeight={200}
    />,
  );
  expect(screen.getByTestId("material").textContent).toBe("DIAMOND");
});

it.each([
  { altKey: false, outside: false, contextual: false },
  { altKey: true, outside: false, contextual: false },
  { altKey: false, outside: true, contextual: false },
  { altKey: false, outside: false, contextual: true },
])("edits only the dragged placement: %j", ({ altKey, outside, contextual }) => {
  if (contextual) {
    const el = menusOf(project)[0]!.layers[0]!.elements[0]!;
    el.places!.placements.unshift({ key: "hidden", page: 1, position: 0 });
    useUiStore.setState({ menuPreviewArgs: { [menuId]: { stock: [{ id: "a" }] } } });
  }
  const { result } = renderHook(() =>
    useSlotDrag({
      projectId,
      menuId,
      position: { x: 0, y: 0 },
      layout: { [menuId]: { x: 0, y: 0 } },
      menuLayers: menusOf(project)[0]!.layers,
      inventoryType: "chest",
    }),
  );
  const target = outside ? { x: -100, y: -100 } : slotXY(1, "chest");
  const event = {
    evt: { altKey },
    target: {
      x: () => target.x,
      y: () => target.y,
      position: vi.fn(),
      moveToTop: vi.fn(),
      getParent: () => null,
    },
  } as unknown as Konva.KonvaEventObject<DragEvent>;
  act(() => result.current.onSlotDragStart(event, 0, elementId));
  act(() => result.current.onSlotDragEnd(event, 0, elementId));
  const elements = menusOf(useAccountStore.getState().account.projects[0]!)[0]!.layers[0]!.elements;
  expect(elements).toHaveLength(1);
  expect(elements[0]!.places!.placements).toEqual([
    ...(contextual ? [{ key: "hidden", page: 1, position: 0 }] : []),
    ...(outside ? [] : [{ key: "a", page: 1, position: 1, cachedDisplay: { material: "STONE" } }]),
    { key: "b", page: 1, position: 4 },
    { key: "c", page: 0, position: 0 },
  ]);
});
