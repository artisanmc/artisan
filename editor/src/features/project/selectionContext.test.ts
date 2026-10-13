import type { ElementId, Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { selectionContext } from "./selectionContext";

const PID = "p1" as ProjectId;

function project(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      {
        id: "m1",
        projectId: PID,
        title: [],
        rows: 3,
        layers: [{ id: "L0", elements: [{ id: "grid", positions: "0", display: {}, states: [] }] }],
      } as any,
      {
        id: "m2",
        projectId: PID,
        title: [],
        rows: 3,
        layers: [{ id: "L0", elements: [{ id: "grid", positions: "1", display: {}, states: [] }] }],
      } as any,
    ],
    commands: [{ id: "c1", projectId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [{ id: "d1", projectId: PID } as any],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {} as any,
  } as Project;
}

const ctx = (ids: string[], menuId: string | null = null) =>
  selectionContext(project(), new Set(ids), menuId);

describe("selectionContext", () => {
  it.each(["c1", "d1", "m1"])("keeps a scoped element distinct from entity %s", (id) => {
    const p = project();
    p.menus[1]!.layers[0]!.elements[0]!.id = id as ElementId;
    expect(selectionContext(p, new Set([id]), "m2")).toEqual({
      kind: "element",
      menuId: "m2",
      elementId: id,
    });
  });
  it("does not resolve a stale scoped element as a command", () => {
    expect(ctx(["c1"], "m2")).toEqual({ kind: "unknown" });
  });
  it("empty selection → none", () => {
    expect(ctx([])).toEqual({ kind: "none" });
  });
  it("plusieurs ids → multi", () => {
    expect(ctx(["m1", "c1"])).toEqual({ kind: "multi" });
  });
  it("a menu → menu", () => {
    expect(ctx(["m1"])).toEqual({ kind: "menu", menuId: "m1" });
  });
  it("a command → command", () => {
    expect(ctx(["c1"])).toEqual({ kind: "command", id: "c1" });
  });
  it("a dialog → dialog", () => {
    expect(ctx(["d1"])).toEqual({ kind: "dialog", id: "d1" });
  });

  /**
   * The case that justifies `selectionMenuId`: `grid` exists in m1 AND m2.
   * Without the scope, the first menu found would be edited.
   */
  it("a shared element id resolves within the selection's menu", () => {
    expect(ctx(["grid"], "m2")).toEqual({ kind: "element", menuId: "m2", elementId: "grid" });
  });
  it("without scope, a shared element id falls back to the first menu", () => {
    expect(ctx(["grid"])).toEqual({ kind: "element", menuId: "m1", elementId: "grid" });
  });
  it("an unknown id → unknown", () => {
    expect(ctx(["zzz"])).toEqual({ kind: "unknown" });
  });
  it("no project → none", () => {
    expect(selectionContext(undefined, new Set(["m1"]), null)).toEqual({ kind: "none" });
  });
});
