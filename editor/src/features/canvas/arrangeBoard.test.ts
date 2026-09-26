import { describe, expect, it } from "vitest";
import { type ArrangeEdge, type ArrangeNode, BOARD_MARGIN, arrangeBoard } from "./arrangeBoard";

const cmd = (key: string): ArrangeNode => ({ key, kind: "command", width: 140, height: 48 });
const menu = (key: string, rows = 3): ArrangeNode => ({
  key,
  kind: "menu",
  width: 352,
  height: 34 + rows * 36 + 194,
});
const dialog = (key: string): ArrangeNode => ({ key, kind: "dialog", width: 140, height: 60 });
const link = (source: string, target: string): ArrangeEdge => ({ source, target });

type Rect = { x: number; y: number; width: number; height: number };
const rects = (nodes: ArrangeNode[], positions: Record<string, { x: number; y: number }>) =>
  nodes.map((n) => ({ key: n.key, ...positions[n.key]!, width: n.width, height: n.height }));
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function assertNoOverlap(
  nodes: ArrangeNode[],
  positions: Record<string, { x: number; y: number }>,
) {
  const all = rects(nodes, positions);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (overlaps(all[i]!, all[j]!)) throw new Error(`${all[i]!.key} overlaps ${all[j]!.key}`);
    }
  }
}

/** Graphe synthétique déterministe : composantes, cycles, arêtes retour, orphelins. */
function synthetic(count: number) {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const nodes: ArrangeNode[] = [];
  const edges: ArrangeEdge[] = [];
  const menus: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    if (r < 0.7) {
      const key = `p${i % 3}/menu_${i}`;
      nodes.push(menu(key, 1 + Math.floor(rand() * 6)));
      menus.push(key);
    } else if (r < 0.9) nodes.push(cmd(`p${i % 3}/cmd_${i}`));
    else nodes.push(dialog(`p${i % 3}/dialog_${i}`));
  }
  for (const n of nodes) {
    if (menus.length === 0 || rand() < 0.15) continue;
    const links = n.kind === "command" ? 1 : Math.floor(rand() * 3);
    for (let k = 0; k < links; k++) {
      const target = menus[Math.floor(rand() * menus.length)]!;
      if (target !== n.key) edges.push(link(n.key, target));
    }
  }
  return { nodes, edges };
}

describe("arrangeBoard", () => {
  it("returns nothing for an empty board", () => {
    expect(arrangeBoard({ nodes: [], edges: [] })).toEqual({ positions: {}, gutter: null });
  });

  it("reads left to right in navigation order: command, then menu, then submenu", () => {
    const nodes = [cmd("c"), menu("m"), menu("sub")];
    const { positions } = arrangeBoard({ nodes, edges: [link("c", "m"), link("m", "sub")] });
    expect(positions.c!.x + 140).toBeLessThan(positions.m!.x);
    expect(positions.m!.x + 352).toBeLessThan(positions.sub!.x);
  });

  it("gives each linked group its own row, biggest first, all starting at the left margin", () => {
    const nodes = [cmd("a"), menu("a_menu"), menu("a_sub"), cmd("b"), menu("b_menu")];
    const { positions } = arrangeBoard({
      nodes,
      edges: [link("a", "a_menu"), link("a_menu", "a_sub"), link("b", "b_menu")],
    });
    expect(positions.a!.x).toBe(BOARD_MARGIN);
    expect(positions.b!.x).toBe(BOARD_MARGIN);
    const firstBottom = Math.max(
      ...["a", "a_menu", "a_sub"].map(
        (k) => positions[k]!.y + nodes.find((n) => n.key === k)!.height,
      ),
    );
    expect(Math.min(positions.b!.y, positions.b_menu!.y)).toBeGreaterThan(firstBottom);
  });

  it("returns top-left corners, starting at the board margin", () => {
    const nodes = [cmd("c"), menu("m")];
    const { positions } = arrangeBoard({ nodes, edges: [link("c", "m")] });
    const xs = Object.values(positions).map((p) => p.x);
    const ys = Object.values(positions).map((p) => p.y);
    expect(Math.min(...xs)).toBe(BOARD_MARGIN);
    expect(Math.min(...ys)).toBe(BOARD_MARGIN);
  });

  it("never overlaps two nodes, even on a large mixed board", () => {
    const { nodes, edges } = synthetic(500);
    const { positions } = arrangeBoard({ nodes, edges });
    expect(Object.keys(positions)).toHaveLength(nodes.length);
    assertNoOverlap(nodes, positions);
  });

  it("gives the same board whatever the input order", () => {
    const { nodes, edges } = synthetic(120);
    const a = arrangeBoard({ nodes, edges });
    const b = arrangeBoard({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
    expect(b).toEqual(a);
  });

  it("ignores back links: a 'back to main menu' button does not move anything", () => {
    const nodes = [cmd("c"), menu("main"), menu("sub")];
    const forward = [link("c", "main"), link("main", "sub")];
    const without = arrangeBoard({ nodes, edges: forward });
    const withBack = arrangeBoard({ nodes, edges: [...forward, link("sub", "main")] });
    expect(withBack).toEqual(without);
  });

  it("starts from the entry that leads to the main hub, whichever command sorts first", () => {
    // "/infosjobs" sorts before "/menu" and its submenu links back to the main menu:
    // the main menu must still come first, the submenu after it.
    const nodes = [
      cmd("/infosjobs"),
      cmd("/menu"),
      menu("jobs"),
      menu("main"),
      menu("crafts"),
      menu("tp"),
    ];
    const edges = [
      link("/infosjobs", "jobs"),
      link("/menu", "main"),
      link("jobs", "main"),
      link("main", "jobs"),
      link("main", "crafts"),
      link("main", "tp"),
    ];
    const { positions } = arrangeBoard({ nodes, edges });
    expect(positions.main!.x).toBeLessThan(positions.jobs!.x);
    expect(positions.main!.x).toBeLessThan(positions.crafts!.x);
  });

  it("sends every forward link to a later column, so no link runs along a column", () => {
    const nodes = [cmd("/menu"), cmd("/tp"), cmd("/res"), menu("main"), menu("tp"), menu("res")];
    const edges = [
      link("/menu", "main"),
      link("/tp", "tp"),
      link("/res", "res"),
      link("main", "tp"),
      link("tp", "res"),
      link("res", "main"),
    ];
    const { positions } = arrangeBoard({ nodes, edges });
    expect(positions.main!.x).toBeLessThan(positions.tp!.x);
    expect(positions.tp!.x).toBeLessThan(positions.res!.x);
  });

  it("centers each command on the menu it opens, on a real-sized board", () => {
    // Shape of a real server: a main menu with submenus and back links, a crafts menu
    // with many recipes, and commands opening menus deep in the graph.
    const recipes = ["pain", "burger", "steak", "elytra", "kebab", "crafter", "mending", "poulet"];
    const nodes = [
      cmd("/infosjobs"),
      cmd("/menu"),
      cmd("/voyageur"),
      cmd("/ressources"),
      menu("jobs", 5),
      menu("main", 5),
      menu("crafts", 5),
      menu("grades", 4),
      menu("quetes", 4),
      menu("tp", 2),
      menu("res", 2),
      ...recipes.map((r) => menu(r)),
      menu("wings"),
    ];
    const edges = [
      link("/infosjobs", "jobs"),
      link("/menu", "main"),
      link("/voyageur", "tp"),
      link("/ressources", "res"),
      link("jobs", "main"),
      link("main", "jobs"),
      ...["crafts", "grades", "quetes", "tp"].flatMap((m) => [link("main", m), link(m, "main")]),
      link("tp", "res"),
      ...recipes.flatMap((r) => [link("crafts", r), link(r, "crafts")]),
      link("elytra", "wings"),
    ];
    const { positions } = arrangeBoard({ nodes, edges });
    const center = (key: string) =>
      positions[key]!.y + nodes.find((n) => n.key === key)!.height / 2;
    for (const [command, target] of [
      ["/infosjobs", "jobs"],
      ["/menu", "main"],
      ["/voyageur", "tp"],
    ] as const) {
      expect(center(command), command).toBe(center(target));
    }
    // Its aligned spot is taken by the menu above: the nearest free one, still beside its menu.
    const res = nodes.find((n) => n.key === "res")!;
    expect(Math.abs(center("/ressources") - center("res"))).toBeLessThanOrEqual(res.height / 2);
    assertNoOverlap(nodes, positions);
  });

  it("puts unlinked Documents in the gutter, below everything else", () => {
    const nodes = [cmd("c"), menu("m"), menu("orphan"), dialog("lonely")];
    const { positions, gutter } = arrangeBoard({ nodes, edges: [link("c", "m")] });
    expect(gutter).not.toBeNull();
    const linkedBottom = Math.max(positions.c!.y + 48, positions.m!.y + 336);
    expect(gutter!.y).toBeGreaterThan(linkedBottom);
    expect(positions.orphan!.y).toBeGreaterThan(gutter!.y);
    expect(positions.lonely!.y).toBeGreaterThan(gutter!.y);
  });

  it("starts the gutter at the margin when nothing is linked yet", () => {
    const { positions, gutter } = arrangeBoard({ nodes: [menu("a"), menu("b")], edges: [] });
    expect(gutter).toEqual({ x: BOARD_MARGIN, y: BOARD_MARGIN });
    assertNoOverlap([menu("a"), menu("b")], positions);
  });

  it("treats a Document that only links to itself as unlinked", () => {
    const { positions, gutter } = arrangeBoard({
      nodes: [menu("self")],
      edges: [link("self", "self")],
    });
    expect(gutter).not.toBeNull();
    expect(positions.self!.y).toBeGreaterThan(gutter!.y);
  });

  it("ignores links whose ends are not on the board", () => {
    const { positions } = arrangeBoard({ nodes: [cmd("c")], edges: [link("c", "hidden")] });
    expect(Object.keys(positions)).toEqual(["c"]);
  });
});

describe("arrangeBoard — positions fixées", () => {
  it("keeps a pinned Document exactly where it was put", () => {
    const nodes = [cmd("c"), menu("m"), menu("sub")];
    const edges = [link("c", "m"), link("m", "sub")];
    const { positions } = arrangeBoard({ nodes, edges, pinned: { m: { x: 1234, y: -50 } } });
    expect(positions.m).toEqual({ x: 1234, y: -50 });
  });

  it("moves nothing else when a Document is pinned where it already was", () => {
    const { nodes, edges } = synthetic(150);
    const free = arrangeBoard({ nodes, edges });
    const key = nodes[7]!.key;
    const pinned = arrangeBoard({ nodes, edges, pinned: { [key]: free.positions[key]! } });
    expect(pinned).toEqual(free);
  });

  it("pushes automatic Documents out of the way of a pinned one", () => {
    const { nodes, edges } = synthetic(150);
    const free = arrangeBoard({ nodes, edges });
    const [a, b] = [nodes[3]!.key, nodes[40]!.key];
    const { positions } = arrangeBoard({ nodes, edges, pinned: { [a]: free.positions[b]! } });
    expect(positions[a]).toEqual(free.positions[b]);
    const pinnedRect = { ...positions[a]!, width: nodes[3]!.width, height: nodes[3]!.height };
    for (const n of nodes) {
      if (n.key === a) continue;
      const r = { ...positions[n.key]!, width: n.width, height: n.height };
      expect(overlaps(pinnedRect, r)).toBe(false);
    }
    assertNoOverlap(nodes, positions);
  });

  it("lets two pinned Documents overlap: the user decided", () => {
    const nodes = [menu("a"), menu("b")];
    const { positions } = arrangeBoard({
      nodes,
      edges: [],
      pinned: { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
    });
    expect(positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 10, y: 10 } });
  });

  it("ignores pins of Documents that no longer exist", () => {
    const nodes = [menu("a")];
    const without = arrangeBoard({ nodes, edges: [] });
    expect(arrangeBoard({ nodes, edges: [], pinned: { gone: { x: 0, y: 0 } } })).toEqual(without);
  });
});
