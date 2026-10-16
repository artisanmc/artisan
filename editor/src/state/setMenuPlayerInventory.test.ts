import { menusOf } from "@/domain/documents";
import { type menuId, projectId } from "@/domain/ids";
import type { ElementId } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectsStore } from "./projectsStore";

const PERSONAL = projectId("p_personal");

const getMenu = (mId: ReturnType<typeof menuId>) =>
  menusOf(useProjectsStore.getState().openProjects.projects.find((p) => p.id === PERSONAL)!).find(
    (m) => m.id === mId,
  )!;

const store = () => useProjectsStore.getState();

/** A 3-row chest with its bottom hidden, one STONE button at `position`. */
function hiddenMenu(id: string, position: number) {
  const mId = store().createMenu({ projectId: PERSONAL, id, rows: 3 });
  store().setMenuField({
    projectId: PERSONAL,
    menuId: mId,
    field: "playerInventory",
    value: "hidden",
  });
  store().setSlotMaterial({ projectId: PERSONAL, menuId: mId, position, material: "STONE" });
  const el = getMenu(mId).layers[0]!.elements.find((e) => e.display?.material === "STONE")!;
  return {
    mId,
    elementId: el.id as ElementId,
    positions: () => getMenu(mId).layers[0]!.elements.find((e) => e.id === el.id)?.positions,
  };
}

describe("menu player_inventory", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
  });

  it("stores hidden, and visible as absent", () => {
    const mId = store().createMenu({ projectId: PERSONAL, id: "m_pi", rows: 3 });
    store().setMenuField({
      projectId: PERSONAL,
      menuId: mId,
      field: "playerInventory",
      value: "hidden",
    });
    expect(getMenu(mId).playerInventory).toBe("hidden");
    store().setMenuField({
      projectId: PERSONAL,
      menuId: mId,
      field: "playerInventory",
      value: "visible",
    });
    expect(getMenu(mId).playerInventory).toBeUndefined();
  });

  it("growing the chest keeps player buttons on the same player slot", () => {
    const { mId, positions } = hiddenMenu("m_grow", 27);
    store().setMenuField({ projectId: PERSONAL, menuId: mId, field: "rows", value: 4 });
    expect(positions()).toBe("36");
  });

  it("shrinking the chest moves player buttons with it instead of refusing", () => {
    const { mId, positions } = hiddenMenu("m_shrink", 27 + 30);
    store().setMenuField({ projectId: PERSONAL, menuId: mId, field: "rows", value: 2 });
    expect(positions()).toBe(String(18 + 30));
  });

  it("switching the container type keeps player buttons on the same player slot", () => {
    const { mId, positions } = hiddenMenu("m_type", 28);
    store().setMenuField({
      projectId: PERSONAL,
      menuId: mId,
      field: "inventoryType",
      value: "hopper",
    });
    expect(positions()).toBe("6");
  });

  it("a selection can move down into the player rows, not past the hotbar", () => {
    const { mId, elementId, positions } = hiddenMenu("m_move", 18);
    store().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: mId,
      elementIds: [elementId],
      dCol: 0,
      dRow: 1,
    });
    expect(positions()).toBe("27");
    store().moveSelectionByDelta({
      projectId: PERSONAL,
      menuId: mId,
      elementIds: [elementId],
      dCol: 2,
      dRow: 3,
    });
    expect(positions()).toBe("56");
    expect(() =>
      store().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: mId,
        elementIds: [elementId],
        dCol: 0,
        dRow: 1,
      }),
    ).toThrow(/outside the menu/);
  });

  it("a visible bottom stays out of reach", () => {
    const mId = store().createMenu({ projectId: PERSONAL, id: "m_vis", rows: 3 });
    store().setSlotMaterial({ projectId: PERSONAL, menuId: mId, position: 18, material: "STONE" });
    const el = getMenu(mId).layers[0]!.elements.find((e) => e.display?.material === "STONE")!;
    expect(() =>
      store().moveSelectionByDelta({
        projectId: PERSONAL,
        menuId: mId,
        elementIds: [el.id],
        dCol: 0,
        dRow: 1,
      }),
    ).toThrow(/outside the menu/);
  });
});

describe("menu vanilla_texture", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectsStore.setState({ openProjects: mockOpenProjects() });
  });

  it("stores the texture off, and on as absent", () => {
    const mId = store().createMenu({ projectId: PERSONAL, id: "m_tex", rows: 3 });
    store().setMenuField({
      projectId: PERSONAL,
      menuId: mId,
      field: "vanillaTexture",
      value: false,
    });
    expect(getMenu(mId).vanillaTexture).toBe(false);
    store().setMenuField({
      projectId: PERSONAL,
      menuId: mId,
      field: "vanillaTexture",
      value: true,
    });
    expect(getMenu(mId).vanillaTexture).toBeUndefined();
  });
});
