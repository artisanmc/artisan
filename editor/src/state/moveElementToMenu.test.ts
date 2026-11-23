import { menusOf } from "@/domain/documents";
import { projectId } from "@/domain/ids";
import type { ElementId, MenuId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { mockOpenProjects } from "@/mock/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectsStore } from "./projectsStore";

const p = projectId("p_personal");
let a: MenuId;
let b: MenuId;
const project = () => useProjectsStore.getState().openProjects.projects.find((x) => x.id === p)!;
const elements = (id: MenuId) =>
  menusOf(project())
    .find((m) => m.id === id)!
    .layers.flatMap((layer) => layer.elements);
const store = () => useProjectsStore.getState();

/** An element of menu `a` at `positions`, with a title (and a label) in English. */
function add(positions: string, title: string, image = false): ElementId {
  store().addElement({
    projectId: p,
    menuId: a,
    element: { id: "x" as ElementId, positions, display: { material: "PAPER" }, states: [] },
  });
  const id = elements(a).at(-1)!.id;
  const target = { projectId: p, menuId: a, elementId: id };
  store().setAppearanceTitle({ ...target, lang: "en", value: title });
  store().setAppearanceLabelText({ ...target, lang: "en", value: title });
  if (image) store().setAppearanceImage({ ...target, image: { asset: "img", fit: "native" } });
  return id;
}
const title = (el: { display: { title?: { key: string } } }) =>
  getText(project(), el.display.title as never, "en");

beforeEach(() => {
  useProjectsStore.setState({ openProjects: mockOpenProjects() });
  a = store().createMenu({ projectId: p, id: "guild", position: { x: 0, y: 0 } });
  b = store().createMenu({ projectId: p, id: "logs", position: { x: 1000, y: 0 } });
});

describe("moving into another menu", () => {
  it("moves an image button with its texts", () => {
    const id = add("0-2", "Journal", true);
    expect(
      store().moveImageButton({ projectId: p, menuId: a, elementId: id, toMenuId: b, position: 9 }),
    ).toBe(id);
    expect(elements(a)).toHaveLength(0);
    const moved = elements(b)[0]!;
    expect(moved.positions).toBe("9-11");
    expect(title(moved)).toBe("Journal");
    expect(getText(project(), moved.display.label!.text, "en")).toBe("Journal");
  });

  it("moves an item with one slot whole, with its texts", () => {
    const id = add("4", "Logs");
    const to = store().moveElementToMenu({
      projectId: p,
      menuId: a,
      elementId: id,
      position: 4,
      toMenuId: b,
      toPosition: 13,
    });
    expect(to).toBe(id);
    expect(elements(a)).toHaveLength(0);
    expect(elements(b)[0]).toMatchObject({ id, positions: "13" });
    expect(title(elements(b)[0]!)).toBe("Logs");
  });

  it("takes one slot of an item with several into a copy with its own texts", () => {
    const id = add("0-1", "Wall");
    const to = store().moveElementToMenu({
      projectId: p,
      menuId: a,
      elementId: id,
      position: 1,
      toMenuId: b,
      toPosition: 5,
    })!;
    expect(to).not.toBe(id);
    expect(elements(a)[0]!.positions).toBe("0");
    const copy = elements(b)[0]!;
    expect(copy.positions).toBe("5");
    expect(title(copy)).toBe("Wall");
    expect(copy.display.title!.key).not.toBe(elements(a)[0]!.display.title!.key);
  });

  it("copies with Alt, the source keeping its slot", () => {
    const id = add("4", "Logs");
    store().moveElementToMenu({
      projectId: p,
      menuId: a,
      elementId: id,
      position: 4,
      toMenuId: b,
      toPosition: 0,
      copy: true,
    });
    expect(elements(a)[0]!.positions).toBe("4");
    expect(elements(b)[0]!.positions).toBe("0");
  });

  it("refuses a slot of an image button, losing nothing", () => {
    const id = add("4", "Logs");
    store().addElement({
      projectId: p,
      menuId: b,
      element: { id: "y" as ElementId, positions: "0", display: { material: "STONE" }, states: [] },
    });
    const image = elements(b)[0]!.id;
    store().setAppearanceImage({
      projectId: p,
      menuId: b,
      elementId: image,
      image: { asset: "img", fit: "native" },
      positions: "0-2",
    });
    expect(() =>
      store().moveElementToMenu({
        projectId: p,
        menuId: a,
        elementId: id,
        position: 4,
        toMenuId: b,
        toPosition: 1,
      }),
    ).toThrow();
    expect(elements(a)[0]!.positions).toBe("4");
    expect(elements(b)).toHaveLength(1);
  });
});
