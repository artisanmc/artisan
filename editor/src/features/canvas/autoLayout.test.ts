import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { autoLayout, projectBoard, rearrangeProjectLayout } from "./autoLayout";
import { menusOf } from "@/domain/documents";

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
                      steps: [{ kind: "action", action: { name: "open_menu", value: opens } }],
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
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
    ...over,
  } as Project;
}

describe("autoLayout", () => {
  it("places every Document of the project, even those never put on the board", () => {
    const project = makeProject({
      documents: {
        menu: [menu("m1", "m2"), menu("m2")],
        command: [{ id: "c1", steps: [], arguments: [] } as never],
        dialog: [{ id: "d1", buttons: [] } as never],
      },
    });
    expect(Object.keys(autoLayout(project)).sort()).toEqual(["c1", "d1", "m1", "m2"]);
  });

  it("keeps a position the user set by hand", () => {
    const project = makeProject({
      documents: {
        menu: [menu("m1", "m2"), menu("m2")],
      },
      canvasLayout: { m2: { x: 900, y: 12 } } as never,
    });
    expect(autoLayout(project).m2).toEqual({ x: 900, y: 12 });
  });

  it("arranges linked menus in navigation order", () => {
    const project = makeProject({ documents: { menu: [menu("m1", "m2"), menu("m2")] } });
    const layout = autoLayout(project);
    expect(layout.m1!.x).toBeLessThan(layout.m2!.x);
  });

  it("reports the gutter of unlinked Documents", () => {
    const project = makeProject({
      documents: { menu: [menu("m1", "m2"), menu("m2"), menu("lonely")] },
    });
    const board = projectBoard(project);
    expect(board.gutter).not.toBeNull();
    expect(board.layout.lonely!.y).toBeGreaterThan(board.gutter!.y);
  });

  it("does not recompute for an edit that leaves the graph unchanged", () => {
    const project = makeProject({ documents: { menu: [menu("m1", "m2"), menu("m2")] } });
    const edited = { ...project, updatedAt: "later" };
    expect(projectBoard(edited)).toBe(projectBoard(project));
  });
});

describe("rearrangeProjectLayout — modes", () => {
  const opens = (id: string, targets: string[]) => ({
    id,
    rows: 3,
    layers: [
      {
        id: "l",
        name: "default",
        elements: targets.map((target, index) => ({
          id: `e${index}`,
          positions: String(index),
          display: {
            click: {
              left: { steps: [{ kind: "action", action: { name: "open_menu", value: target } }] },
            },
          },
          states: [],
        })),
      },
    ],
  });
  /** A main menu opening eight submenus: the rank that makes a column of ten. */
  const fanout = () => {
    const children = ["a", "b", "c", "d", "e", "f", "g", "h"];
    return makeProject({
      documents: {
        menu: [opens("main", children), ...children.map((c) => opens(c, []))] as never,
      },
    });
  };

  it("columns releases the positions; another mode persists them all", () => {
    const project = fanout();
    expect(rearrangeProjectLayout(project, undefined, "columns")!.canvasLayout).toEqual({});
    for (const mode of ["wrap", "auto", "cluster", "force"] as const) {
      const layout = rearrangeProjectLayout(project, undefined, mode)!.canvasLayout;
      expect(Object.keys(layout), mode).toHaveLength(menusOf(project).length);
    }
  });

  it("two modes give two distinct layouts", () => {
    const project = fanout();
    const wrap = rearrangeProjectLayout(project, undefined, "wrap")!.canvasLayout;
    const cluster = rearrangeProjectLayout(project, undefined, "cluster")!.canvasLayout;
    expect(cluster).not.toEqual(wrap);
  });
});
