import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { autoLayout, projectBoard } from "./autoLayout";

const menu = (id: string, opens?: string) =>
  ({
    id,
    rows: 3,
    layers: [
      {
        id: "l",
        name: "default",
        elements: opens
          ? [
              {
                id: "el",
                positions: "0",
                display: {
                  material: "PAPER",
                  click: {
                    left: {
                      steps: [{ kind: "action", action: { type: "open_menu", menuId: opens } }],
                    },
                  },
                },
                states: [],
              },
            ]
          : [],
      },
    ],
  }) as never;

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: "p1" as Project["id"],
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
    ...over,
  } as Project;
}

describe("autoLayout", () => {
  it("places every Document of the project, even those never put on the board", () => {
    const project = makeProject({
      menus: [menu("m1", "m2"), menu("m2")],
      commands: [{ id: "c1", steps: [], arguments: [] } as never],
      dialogs: [{ id: "d1", buttons: [] } as never],
    });
    expect(Object.keys(autoLayout(project)).sort()).toEqual(["c1", "d1", "m1", "m2"]);
  });

  it("keeps a position the user set by hand", () => {
    const project = makeProject({
      menus: [menu("m1", "m2"), menu("m2")],
      canvasLayout: { m2: { x: 900, y: 12 } } as never,
    });
    expect(autoLayout(project).m2).toEqual({ x: 900, y: 12 });
  });

  it("arranges linked menus in navigation order", () => {
    const project = makeProject({ menus: [menu("m1", "m2"), menu("m2")] });
    const layout = autoLayout(project);
    expect(layout.m1!.x).toBeLessThan(layout.m2!.x);
  });

  it("reports the gutter of unlinked Documents", () => {
    const project = makeProject({ menus: [menu("m1", "m2"), menu("m2"), menu("lonely")] });
    const board = projectBoard(project);
    expect(board.gutter).not.toBeNull();
    expect(board.layout.lonely!.y).toBeGreaterThan(board.gutter!.y);
  });

  it("does not recompute for an edit that leaves the graph unchanged", () => {
    const project = makeProject({ menus: [menu("m1", "m2"), menu("m2")] });
    const edited = { ...project, updatedAt: "later" };
    expect(projectBoard(edited)).toBe(projectBoard(project));
  });
});
