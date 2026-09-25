import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { COMMAND_BOX, DIALOG_BOX, menuBoxSize } from "./menuLayout";
import { deriveServerGraph, documentKey } from "./serverGraph";

type Link = { to: string; kind?: "menu" | "dialog" };

function menu(id: string, links: Link[] = [], rows = 3) {
  return {
    id,
    rows,
    layers: [
      {
        id: "l_default",
        name: "default",
        elements: links.map((link, i) => ({
          id: `el_${i}`,
          positions: String(i),
          display: {
            material: "PAPER",
            click: {
              left: {
                steps: [
                  {
                    kind: "action",
                    action:
                      link.kind === "dialog"
                        ? { type: "open_dialog", dialogId: link.to }
                        : { type: "open_menu", menuId: link.to },
                  },
                ],
              },
            },
          },
          states: [],
        })),
      },
    ],
  };
}

function project(
  id: string,
  docs: {
    menus?: ReturnType<typeof menu>[];
    commands?: { id: string; opens: string }[];
    dialogs?: string[];
  },
): Project {
  return {
    id,
    name: id,
    menus: docs.menus ?? [],
    commands: (docs.commands ?? []).map((c) => ({
      id: c.id,
      name: c.id,
      arguments: [],
      steps: [{ kind: "action", action: { type: "open_menu", menuId: c.opens } }],
    })),
    dialogs: (docs.dialogs ?? []).map((d) => ({ id: d, buttons: [] })),
  } as unknown as Project;
}

describe("deriveServerGraph", () => {
  it("keys every Document by its project, so equal ids in two projects never collide", () => {
    const graph = deriveServerGraph([
      project("core", { menus: [menu("accueil")] }),
      project("boutique", { menus: [menu("catalogue")] }),
    ]);
    expect(graph.nodes.map((n) => n.key)).toEqual([
      documentKey("boutique", "catalogue"),
      documentKey("core", "accueil"),
    ]);
  });

  it("links a menu to a menu of another project, as the game does", () => {
    const graph = deriveServerGraph([
      project("core", { menus: [menu("accueil", [{ to: "catalogue" }])] }),
      project("boutique", { menus: [menu("catalogue")] }),
    ]);
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      [documentKey("core", "accueil"), documentKey("boutique", "catalogue")],
    ]);
  });

  it("links commands and dialogs", () => {
    const graph = deriveServerGraph([
      project("core", {
        menus: [menu("accueil", [{ to: "regles", kind: "dialog" }])],
        commands: [{ id: "cmd_menu", opens: "accueil" }],
        dialogs: ["regles"],
      }),
    ]);
    expect(graph.edges.map((e) => [e.source, e.target])).toEqual([
      [documentKey("core", "accueil"), documentKey("core", "regles")],
      [documentKey("core", "cmd_menu"), documentKey("core", "accueil")],
    ]);
  });

  it("reports a missing target instead of inventing a node", () => {
    const graph = deriveServerGraph([
      project("core", { menus: [menu("accueil", [{ to: "fantome" }])] }),
    ]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([
      { source: documentKey("core", "accueil"), targetId: "fantome", reason: "missing" },
    ]);
  });

  it("reports an id shared by two projects as ambiguous: the game would pick one arbitrarily", () => {
    const graph = deriveServerGraph([
      project("core", { menus: [menu("accueil", [{ to: "doublon" }]), menu("doublon")] }),
      project("boutique", { menus: [menu("doublon")] }),
    ]);
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([
      { source: documentKey("core", "accueil"), targetId: "doublon", reason: "ambiguous" },
    ]);
  });

  it("sizes nodes with the same functions the canvas renders with", () => {
    const graph = deriveServerGraph([
      project("core", {
        menus: [menu("grand", [], 6)],
        commands: [{ id: "cmd_x", opens: "grand" }],
        dialogs: ["d"],
      }),
    ]);
    const size = (docId: string) => {
      const n = graph.nodes.find((node) => node.docId === docId)!;
      return { width: n.width, height: n.height };
    };
    expect(size("grand")).toEqual(menuBoxSize("chest", 6));
    expect(size("grand")).toEqual({ width: 352, height: 444 });
    expect(size("cmd_x")).toEqual(COMMAND_BOX);
    expect(size("d")).toEqual(DIALOG_BOX);
  });

  it("is independent of the order projects arrive in", () => {
    const a = project("core", { menus: [menu("accueil", [{ to: "catalogue" }])] });
    const b = project("boutique", { menus: [menu("catalogue")] });
    expect(deriveServerGraph([a, b])).toEqual(deriveServerGraph([b, a]));
  });
});
