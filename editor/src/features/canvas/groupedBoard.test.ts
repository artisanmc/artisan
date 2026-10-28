import type { Project } from "@/domain/types";
import { expect, it } from "vitest";
import { projectBoard, rearrangeProjectLayout } from "./autoLayout";
import { deriveEdges } from "./deriveEdges";
import { groupEdges, serverBoard } from "./groupedBoard";
import { deriveServerGraph } from "./serverGraph";

function project(id = "p"): Project {
  return {
    id,
    name: id,
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    defaultLang: "en",
    assets: [],
    dataSources: [],
    i18nKeys: {},
    canvasLayout: {},
    documents: {
      command: [],
      dialog: [],
      menu: ["main", "craft_a", "craft_b", "quest"].map((name) => ({
        id: `${id}_${name}`,
        projectId: id,
        ...(name.startsWith("craft") ? { folder: "crafts" } : {}),
        title: [],
        rows: 3,
        layers: [
          {
            id: "l",
            elements: (name === "main"
              ? ["craft_a", "quest"]
              : name === "craft_a"
                ? ["craft_b", "main"]
                : []
            ).map((target, index) => ({
              id: `e${index}`,
              positions: String(index),
              display: {
                click: {
                  left: {
                    steps: [
                      { kind: "action", action: { name: "open_menu", value: `${id}_${target}` } },
                    ],
                  },
                },
              },
              states: [],
            })),
          },
        ],
      })),
    },
  } as unknown as Project;
}

it("places a group as one block inside its project, after the main menu", () => {
  const p = project();
  const board = projectBoard(p);
  const frame = board.groups.find((g) => g.id === "crafts")!;
  expect(frame).toBeDefined();
  expect(board.groups.some((g) => g.kind === "project")).toBe(true);
  for (const id of ["p_craft_a", "p_craft_b"]) {
    expect(board.layout[`menu/${id}`]!.x).toBeGreaterThan(frame.x);
    expect(board.layout[`menu/${id}`]!.x + 1).toBeLessThan(frame.x + frame.width);
    expect(board.layout[`menu/${id}`]!.y).toBeGreaterThan(frame.y);
    expect(board.layout[`menu/${id}`]!.y).toBeLessThan(frame.y + frame.height);
  }
  expect(board.layout["menu/p_main"]!.x).toBeLessThan(frame.x);
  const quest = board.layout["menu/p_quest"]!;
  expect(
    quest.x >= frame.x + frame.width ||
      quest.y >= frame.y + frame.height ||
      quest.y + 100 < frame.y,
  ).toBe(true);
});

it("ignores legacy folding and preserves menu links and folder colors", () => {
  const p = project();
  const expanded = projectBoard(p);
  const folded = projectBoard({ ...p, folders: { crafts: { color: "#a855f7" } } });
  expect(folded.layout).toEqual(expanded.layout);
  expect(folded.groups.find((g) => g.id === "crafts")).toMatchObject({ color: "#a855f7" });
  const edges = groupEdges(deriveEdges(p), folded.representatives);
  expect(edges).toEqual(deriveEdges(p));
  expect(projectBoard(p).layout).toEqual(expanded.layout);
  const legacy = { ...p, canvasProjectCollapsed: true };
  expect(projectBoard(legacy).layout).toEqual(expanded.layout);
  expect(serverBoard([legacy], deriveServerGraph([legacy])).positions).toEqual(
    serverBoard([p], deriveServerGraph([p])).positions,
  );
});

it("uses external links to rearrange whole groups while keeping automatic interiors unchanged", () => {
  const p = project();
  p.canvasLayout = { "menu/p_main": { x: 9000, y: 9000 } } as Project["canvasLayout"];
  const before = projectBoard(p);
  const next = { ...p, ...rearrangeProjectLayout(p)! };
  const after = projectBoard(next);
  const frame = after.groups.find((g) => g.id === "crafts")!;
  expect(after.layout["menu/p_main"]!.x).toBeLessThan(frame.x);
  for (const axis of ["x", "y"] as const) {
    expect(after.layout["menu/p_craft_b"]![axis] - after.layout["menu/p_craft_a"]![axis]).toBe(
      before.layout["menu/p_craft_b"]![axis] - before.layout["menu/p_craft_a"]![axis],
    );
  }
  expect(deriveEdges(next)).toEqual(deriveEdges(p));
});

it("keeps entire projects together on the server board, including cross-project links", () => {
  const a = project("a");
  const b = project("b");
  const graph = deriveServerGraph([a, b]);
  graph.edges.push({
    id: "cross",
    source: "a/menu/a_quest",
    target: "b/menu/b_main",
    edge: { id: "cross", source: "menu/a_quest", target: "menu/b_main", triggers: [] },
  });
  const board = serverBoard([a, b], graph);
  const roots = board.groups.filter((g) => g.kind === "project");
  expect(roots).toHaveLength(2);
  const [left, right] = roots;
  expect(left!.x + left!.width <= right!.x || left!.y + left!.height <= right!.y).toBe(true);
  for (const n of graph.nodes) {
    const frame = roots.find((g) => g.projectId === n.projectId)!;
    const pos = board.positions[n.key]!;
    expect(pos.x).toBeGreaterThanOrEqual(frame.x);
    expect(pos.x + n.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(pos.y + n.height).toBeLessThanOrEqual(frame.y + frame.height);
  }
});
