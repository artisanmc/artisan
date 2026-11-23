import { docKey, menusOf } from "@/domain/documents";
import { elementId, projectId } from "@/domain/ids";
import type { Menu, MenuId } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageButtonsRender } from "./ImageButtonsRender";
import { slotXY } from "./menuLayout";

// The button's Group handlers, by node name, so a test can play a drag on them.
type Handlers = Record<string, (event: unknown) => void>;
const groups = new Map<string, Handlers>();
vi.mock("react-konva", () => ({
  Group: (props: Handlers & { name?: string; children?: React.ReactNode }) => {
    if (props.name) groups.set(props.name, props);
    return <div>{props.children}</div>;
  },
  Rect: () => null,
  Image: () => null,
  Text: () => null,
}));
vi.mock("@/lib/useAuthenticatedImage", () => ({ useAuthenticatedImage: () => [undefined] }));

const p = projectId("p_personal");
const e = elementId("journal");
const STRIDE = 36;
let a: MenuId;
let b: MenuId;

const project = () => useProjectsStore.getState().openProjects.projects.find((x) => x.id === p)!;
const menu = (id: MenuId) => menusOf(project()).find((m) => m.id === id)!;
const positionsOf = (id: MenuId) =>
  menu(id)
    .layers.flatMap((layer) => layer.elements)
    .find((el) => el.display.image)?.positions;

beforeEach(() => {
  groups.clear();
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  const store = useProjectsStore.getState();
  a = store.createMenu({ projectId: p, id: "guild", position: { x: 0, y: 0 } });
  b = store.createMenu({ projectId: p, id: "logs", position: { x: 1000, y: 0 } });
  store.setMenuField({ projectId: p, menuId: a, field: "rows", value: 3 });
  store.setMenuField({ projectId: p, menuId: a, field: "playerInventory", value: "hidden" });
  store.addElement({
    projectId: p,
    menuId: a,
    element: { id: e, positions: "0", display: { material: "STONE" }, states: [] },
  });
  const id = menu(a).layers[0]!.elements[0]!.id;
  store.setAppearanceImage({
    projectId: p,
    menuId: a,
    elementId: id,
    image: { asset: "journal", fit: "native" },
    positions: "0-2",
  });
});

/** Grabs the button at (grabX, grabY) of its own pixels and releases that point over `slot` of `to`. */
function drag(grabX: number, grabY: number, to: MenuId, slot: number) {
  const source = menu(a);
  const layout = project().canvasLayout;
  render(
    <ImageButtonsRender
      projectId={p}
      menu={source as Menu}
      frame={{ position: layout[docKey("menu", a)]!, layout }}
    />,
  );
  const id = source.layers[0]!.elements[0]!.id;
  const handlers = groups.get(`image-button:${a}:${id}`)!;
  const target = menu(to);
  const cell = slotXY(slot, target.inventoryType ?? "chest", target.rows);
  const from = layout[docKey("menu", a)]!;
  const into = layout[docKey("menu", to)]!;
  // Where the button's node ends: the grabbed point a few pixels inside the target slot.
  const nodeX = into.x - from.x + cell.x + 5 - grabX;
  const nodeY = into.y - from.y + cell.y + 5 - grabY;
  const node = {
    x: () => nodeX,
    y: () => nodeY,
    position: () => {},
    moveToTop: () => {
      throw new Error("the button must stay under its label");
    },
    getParent: () => ({ moveToTop: () => {} }),
  };
  handlers.onMouseDown!({
    currentTarget: { getRelativePointerPosition: () => ({ x: grabX, y: grabY }) },
  });
  handlers.onDragStart!({ cancelBubble: false, target: node });
  handlers.onDragEnd!({ cancelBubble: false, target: node });
}

describe("dragging an image button", () => {
  it("puts the cell held under the pointer on the slot released over", () => {
    // Held by its third cell, released over slot 13: the button starts at 11.
    drag(2 * STRIDE + 10, 10, a, 13);
    expect(positionsOf(a)).toBe("11-13");
  });

  it("lands on the row under the pointer across the gap above the player rows", () => {
    // Slot 27 is the first player row, drawn 13 px under the menu's last row: a move
    // read in rows of 18 px counted one row too many.
    drag(10, 2, a, 27);
    expect(positionsOf(a)).toBe("27-29");
  });

  it("moves into another menu and selects it there", () => {
    drag(10, 10, b, 4);
    expect(positionsOf(a)).toBeUndefined();
    expect(positionsOf(b)).toBe("4-6");
    expect(useSelectionStore.getState().menuId).toBe(b);
  });

  it("stays in place when released off every grid", () => {
    drag(10, 10, a, 13);
    const before = positionsOf(a);
    groups.clear();
    render(
      <ImageButtonsRender
        projectId={p}
        menu={menu(a) as Menu}
        frame={{ position: { x: 0, y: 0 }, layout: project().canvasLayout }}
      />,
    );
    const handlers = [...groups.values()][0]!;
    const node = {
      x: () => 5000,
      y: () => 5000,
      position: () => {},
      moveToTop: () => {},
      getParent: () => ({ moveToTop: () => {} }),
    };
    handlers.onDragEnd!({ cancelBubble: false, target: node });
    expect(positionsOf(a)).toBe(before);
  });
});
