import type { ProjectId } from "@/domain/types";
import type { BoardNode, ServerGraph } from "@/features/canvas/serverGraph";
import { describe, expect, it } from "vitest";
import { filterBoard, parseBoardFilter } from "./boardFilter";

const node = (projectId: string, docId: string, kind: BoardNode["kind"]): BoardNode => ({
  key: `${projectId}/${docId}`,
  projectId: projectId as ProjectId,
  docId,
  kind,
  width: 10,
  height: 10,
});

const graph: ServerGraph = {
  nodes: [
    node("boutique", "menu_catalogue", "menu"),
    node("core", "cmd_menu", "command"),
    node("core", "menu_accueil", "menu"),
  ],
  edges: [
    { id: "a", source: "core/cmd_menu", target: "core/menu_accueil", edge: {} as never },
    { id: "b", source: "core/menu_accueil", target: "boutique/menu_catalogue", edge: {} as never },
  ],
  unresolved: [],
};

describe("filterBoard", () => {
  it("keeps everything without a filter", () => {
    expect(filterBoard(graph, {})).toEqual({ nodes: graph.nodes, edges: graph.edges });
  });

  it("hides unchecked projects, and drops links that leave the rest", () => {
    const shown = filterBoard(graph, { hide: ["boutique"] });
    expect(shown.nodes.map((n) => n.key)).toEqual(["core/cmd_menu", "core/menu_accueil"]);
    expect(shown.edges.map((e) => e.id)).toEqual(["a"]);
  });

  it("filters by type", () => {
    expect(filterBoard(graph, { kind: "command" }).nodes.map((n) => n.key)).toEqual([
      "core/cmd_menu",
    ]);
  });

  it("matches text in the Document id, case-insensitively", () => {
    expect(filterBoard(graph, { q: "CATAL" }).nodes.map((n) => n.key)).toEqual([
      "boutique/menu_catalogue",
    ]);
  });

  it("matches the displayed label too", () => {
    const labelOf = (n: BoardNode) => (n.docId === "cmd_menu" ? "/spawn" : undefined);
    expect(filterBoard(graph, { q: "/spa" }, labelOf).nodes.map((n) => n.key)).toEqual([
      "core/cmd_menu",
    ]);
  });
});

describe("parseBoardFilter", () => {
  it("keeps only known values from the URL", () => {
    expect(
      parseBoardFilter({
        hide: ["core", "boutique", "core"],
        kind: "menu",
        q: "acc",
        doc: "core/x",
      }),
    ).toEqual({ hide: ["boutique", "core"], kind: "menu", q: "acc", doc: "core/x" });
    expect(parseBoardFilter({ hide: [""], kind: "npc", q: 3, doc: 1 })).toEqual({});
  });

  it("accepts a single hidden project written as a plain string", () => {
    expect(parseBoardFilter({ hide: "core" })).toEqual({ hide: ["core"] });
  });
});
