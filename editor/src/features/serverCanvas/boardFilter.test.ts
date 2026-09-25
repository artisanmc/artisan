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

  it("shows one project, and drops links that leave it", () => {
    const shown = filterBoard(graph, { project: "core" });
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
});

describe("parseBoardFilter", () => {
  it("keeps only known values from the URL", () => {
    expect(parseBoardFilter({ project: "core", kind: "menu", q: "acc" })).toEqual({
      project: "core",
      kind: "menu",
      q: "acc",
    });
    expect(parseBoardFilter({ project: "", kind: "npc", q: 3 })).toEqual({});
  });
});
