import type { Project, ProjectId } from "@/domain/types";
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
  it("sélection vide → none", () => {
    expect(ctx([])).toEqual({ kind: "none" });
  });
  it("plusieurs ids → multi", () => {
    expect(ctx(["m1", "c1"])).toEqual({ kind: "multi" });
  });
  it("un menu → menu", () => {
    expect(ctx(["m1"])).toEqual({ kind: "menu", menuId: "m1" });
  });
  it("une commande → command", () => {
    expect(ctx(["c1"])).toEqual({ kind: "command", id: "c1" });
  });
  it("un dialogue → dialog", () => {
    expect(ctx(["d1"])).toEqual({ kind: "dialog", id: "d1" });
  });

  /**
   * Le cas qui justifie `selectionMenuId` : `grid` existe dans m1 ET m2.
   * Sans le scope, on éditerait le premier menu trouvé.
   */
  it("un id d'élément partagé se résout dans le menu de la sélection", () => {
    expect(ctx(["grid"], "m2")).toEqual({ kind: "element", menuId: "m2", elementId: "grid" });
  });
  it("sans scope, un id d'élément partagé retombe sur le premier menu", () => {
    expect(ctx(["grid"])).toEqual({ kind: "element", menuId: "m1", elementId: "grid" });
  });
  it("un id inconnu → unknown", () => {
    expect(ctx(["zzz"])).toEqual({ kind: "unknown" });
  });
  it("pas de project → none", () => {
    expect(selectionContext(undefined, new Set(["m1"]), null)).toEqual({ kind: "none" });
  });
});
