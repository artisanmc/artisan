import { describe, expect, it } from "vitest";
import type { Project } from "@/domain/types";
import { autoLayout, gridArrange } from "./autoLayout";

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "p1" as Project["id"], name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [], commands: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", dialogs: [], canvasLayout: {}, ...over,
  } as Project;
}

describe("autoLayout", () => {
  it("ne retourne QUE les entrées explicites de canvasLayout (pas de grid-fill)", () => {
    const project = makeProject({
      menus: [{ id: "m1" } as any, { id: "m2" } as any],
      canvasLayout: { m1: { x: 10, y: 20 } } as any,
    });
    const layout = autoLayout(project);
    expect(layout).toEqual({ m1: { x: 10, y: 20 } });
    expect("m2" in layout).toBe(false);
  });
});

describe("gridArrange", () => {
  it("place TOUS les éléments (menus + commandes + dialogs) dans une grille", () => {
    const project = makeProject({
      menus: [{ id: "m1" } as any], commands: [{ id: "c1" } as any], dialogs: [{ id: "d1" } as any],
    });
    const layout = gridArrange(project);
    expect(Object.keys(layout).sort()).toEqual(["c1", "d1", "m1"]);
    expect(layout.m1).toEqual({ x: 40, y: 40 });
  });
});
