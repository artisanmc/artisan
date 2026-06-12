# Canvas Edge Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le rendu brouillon des liens du canvas (ancres fixes, courbes molles, aller/retour superposés, pas de flèches) par un routage bézier propre avec ancres réparties, poignées d'édition libres et persistance `editor_edges`.

**Architecture:** Un module pur `edgeRouting.ts` calcule côtés/ancres/points de contrôle ; `Edges.tsx` le rend en Konva `Arrow` ; les overrides manuels vivent dans `pack.canvasEdges` (miroir de `canvasLayout`), exportés en `editor_edges` dans `manifest.yaml` et ré-importés côté backend.

**Tech Stack:** React 19, react-konva (`Arrow`, `Circle`), zustand, immer (`produce`), vitest, yaml, Bun (backend).

**Spec:** `docs/superpowers/specs/2026-06-12-canvas-edge-routing-design.md`

**Conventions repo:**
- Commits : format conventionnel, `rtk git add <paths exacts>` (jamais `git add -A`).
- Tests éditeur : `cd editor && npx vitest run <file>` (fichier seul) / `npm test` (suite).
- Tests backend : `cd backend && bun run test` — **JAMAIS `bun test` direct** (wipe la DB dev).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `editor/src/domain/types.ts` (modify) | `AnchorSide`, `EdgeAnchor`, `Pack.canvasEdges?` |
| `editor/src/features/canvas/edgeRouting.ts` (create) | Géométrie pure : `anchorPoint`, `closestAnchorOnBox`, `autoSide`, `routeEdges` |
| `editor/src/features/canvas/edgeRouting.test.ts` (create) | Tests unitaires routage |
| `editor/src/state/edgeSelectionStore.ts` (create) | Edge sélectionné (zustand) |
| `editor/src/state/accountStore.ts` (modify) | `setEdgeAnchor` / `clearEdgeAnchor` + pruning + rename rewrite |
| `editor/src/state/accountStore.test.ts` (modify) | Tests store |
| `editor/src/features/export/transform.ts` (modify) | `editor_edges` dans manifest |
| `editor/src/features/export/transform.test.ts` (modify) | Tests export |
| `backend/src/lib/packImport.ts` (modify) | `parseEditorEdges`, `readEditorEdgesFromFiles`, `canvasEdges` à l'import |
| `backend/src/lib/packImport.test.ts` (modify) | Tests import |
| `backend/src/routes/editorSession.ts` (modify) | `buildEditorJsonWithLayout` porte aussi `canvasEdges` |
| `backend/src/routes/editorSession.test.ts` (modify) | Test round-trip editorJson |
| `editor/src/features/canvas/Edges.tsx` (rewrite) | Rendu Arrow bézier + sélection + poignées |
| `editor/src/features/canvas/Edges.test.tsx` (create) | Tests composant |
| `editor/src/features/canvas/Stage.tsx` (modify) | Clic vide → désélection edge |
| `docs/architecture/editor-internals.md` (modify) | Doc canvas edges |

---

### Task 1: Types domaine + géométrie de base (`anchorPoint`, `closestAnchorOnBox`, `autoSide`)

**Files:**
- Modify: `editor/src/domain/types.ts` (près de `canvasLayout`, ~ligne 98)
- Create: `editor/src/features/canvas/edgeRouting.ts`
- Test: `editor/src/features/canvas/edgeRouting.test.ts`

- [ ] **Step 1: Ajouter les types domaine**

Dans `editor/src/domain/types.ts`, juste au-dessus de `export interface Pack` :

```ts
export type AnchorSide = "top" | "right" | "bottom" | "left";

/** Endpoint override for a canvas edge — a position on a node border. */
export interface EdgeAnchor {
  side: AnchorSide;
  /** Ratio 0..1 along the side (survives node resize). */
  t: number;
}
```

Dans `Pack`, après `canvasLayout` :

```ts
  /**
   * Manual edge-endpoint overrides, keyed by edge id ("source->target").
   * Editor-only metadata — exported as manifest `editor_edges`.
   */
  canvasEdges?: Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }>;
```

Champ **optionnel** : aucune fixture existante à modifier.

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `editor/src/features/canvas/edgeRouting.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { anchorPoint, autoSide, closestAnchorOnBox, type Box } from "./edgeRouting";

const box = (x: number, y: number, width = 100, height = 80): Box => ({ x, y, width, height });

describe("anchorPoint", () => {
  it("maps {side, t} to border coordinates", () => {
    const b = box(10, 20);
    expect(anchorPoint(b, { side: "top", t: 0.5 })).toEqual({ x: 60, y: 20 });
    expect(anchorPoint(b, { side: "bottom", t: 0 })).toEqual({ x: 10, y: 100 });
    expect(anchorPoint(b, { side: "left", t: 0.25 })).toEqual({ x: 10, y: 40 });
    expect(anchorPoint(b, { side: "right", t: 1 })).toEqual({ x: 110, y: 100 });
  });

  it("clamps t to [0,1]", () => {
    expect(anchorPoint(box(0, 0), { side: "top", t: 2 })).toEqual({ x: 100, y: 0 });
  });
});

describe("closestAnchorOnBox", () => {
  it("projects a point near the right border", () => {
    expect(closestAnchorOnBox(box(0, 0), { x: 98, y: 40 })).toEqual({ side: "right", t: 0.5 });
  });

  it("projects a point near the top border", () => {
    expect(closestAnchorOnBox(box(0, 0), { x: 50, y: 3 })).toEqual({ side: "top", t: 0.5 });
  });

  it("clamps t for points beyond the box corners", () => {
    const a = closestAnchorOnBox(box(0, 0), { x: 200, y: -50 });
    expect(a.t).toBeGreaterThanOrEqual(0);
    expect(a.t).toBeLessThanOrEqual(1);
  });
});

describe("autoSide", () => {
  it("picks the side facing the other box (4 quadrants)", () => {
    const center = box(0, 0);
    expect(autoSide(center, box(300, 0))).toBe("right");
    expect(autoSide(center, box(-300, 0))).toBe("left");
    expect(autoSide(center, box(0, 300))).toBe("bottom");
    expect(autoSide(center, box(0, -300))).toBe("top");
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `cd editor && npx vitest run src/features/canvas/edgeRouting.test.ts`
Expected: FAIL — module `./edgeRouting` introuvable.

- [ ] **Step 4: Implémenter**

Créer `editor/src/features/canvas/edgeRouting.ts` :

```ts
import type { AnchorSide, EdgeAnchor } from "@/domain/types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Outward unit normal of each side. */
export const OUT_NORMAL: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function anchorPoint(box: Box, a: EdgeAnchor): Point {
  const t = clamp01(a.t);
  switch (a.side) {
    case "top":
      return { x: box.x + box.width * t, y: box.y };
    case "bottom":
      return { x: box.x + box.width * t, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height * t };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height * t };
  }
}

/** Nearest border position for an arbitrary point (used to snap handle drags). */
export function closestAnchorOnBox(box: Box, p: Point): EdgeAnchor {
  const dTop = Math.abs(p.y - box.y);
  const dBottom = Math.abs(p.y - (box.y + box.height));
  const dLeft = Math.abs(p.x - box.x);
  const dRight = Math.abs(p.x - (box.x + box.width));
  const tx = clamp01((p.x - box.x) / box.width);
  const ty = clamp01((p.y - box.y) / box.height);
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return { side: "top", t: tx };
  if (min === dBottom) return { side: "bottom", t: tx };
  if (min === dLeft) return { side: "left", t: ty };
  return { side: "right", t: ty };
}

/** Side of `from` facing `to`, by dominant axis between centers. */
export function autoSide(from: Box, to: Box): AnchorSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}
```

- [ ] **Step 5: Vérifier le vert**

Run: `cd editor && npx vitest run src/features/canvas/edgeRouting.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/domain/types.ts editor/src/features/canvas/edgeRouting.ts editor/src/features/canvas/edgeRouting.test.ts
rtk git commit -m "feat(editor): edge anchor types + canvas edge geometry primitives"
```

---

### Task 2: `routeEdges` — répartition des ancres + bézier

**Files:**
- Modify: `editor/src/features/canvas/edgeRouting.ts`
- Test: `editor/src/features/canvas/edgeRouting.test.ts`

- [ ] **Step 1: Tests qui échouent**

Ajouter à `edgeRouting.test.ts` (imports : ajouter `routeEdges` à l'import existant, et `import type { Edge } from "./deriveEdges";`) :

```ts
const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  triggers: [],
});

describe("routeEdges", () => {
  const boxes: Record<string, Box> = { a: box(0, 0), b: box(300, 0) };

  it("routes a single centered edge as a straight horizontal line", () => {
    const [r] = routeEdges({ edges: [edge("a", "b")], boxes });
    expect(r!.from).toMatchObject({ x: 100, y: 40, side: "right" });
    expect(r!.to).toMatchObject({ x: 300, y: 40, side: "left" });
    // control points share the endpoints' y → visually straight
    expect(r!.points[3]).toBe(40);
    expect(r!.points[5]).toBe(40);
  });

  it("gives A->B and B->A distinct anchors (no overlap)", () => {
    const [ab, ba] = routeEdges({ edges: [edge("a", "b"), edge("b", "a")], boxes });
    expect(ab!.from.y).not.toBe(ba!.to.y);
    expect(ab!.to.y).not.toBe(ba!.from.y);
  });

  it("distributes n endpoints on the same side evenly, sorted toward targets", () => {
    const boxes3: Record<string, Box> = {
      a: box(0, 0),
      b: box(300, -200),
      c: box(300, 0),
      d: box(300, 200),
    };
    const routed = routeEdges({
      edges: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
      boxes: boxes3,
    });
    // 3 endpoints on a's right side → t = 1/4, 2/4, 3/4 over height 80
    expect(routed.map((r) => r.from.y)).toEqual([20, 40, 60]);
  });

  it("respects an override and keeps the other end auto", () => {
    const routed = routeEdges({
      edges: [edge("a", "b")],
      boxes,
      overrides: { "a->b": { from: { side: "top", t: 0.5 } } },
    });
    expect(routed[0]!.from).toMatchObject({ x: 50, y: 0, side: "top" });
    expect(routed[0]!.to.side).toBe("left");
  });

  it("skips edges whose nodes have no box", () => {
    expect(routeEdges({ edges: [edge("a", "ghost")], boxes })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/features/canvas/edgeRouting.test.ts`
Expected: FAIL — `routeEdges` n'existe pas.

- [ ] **Step 3: Implémenter `routeEdges`**

Ajouter à `edgeRouting.ts` (import en tête : `import type { Edge } from "./deriveEdges";`) :

```ts
export interface RoutedEdge {
  edge: Edge;
  from: Point & { side: AnchorSide };
  to: Point & { side: AnchorSide };
  /** Cubic bezier: [x0,y0, cx1,cy1, cx2,cy2, x1,y1] — feed Konva Arrow with bezier. */
  points: number[];
}

interface Endpoint {
  edgeIndex: number;
  end: "from" | "to";
  nodeId: string;
  side: AnchorSide;
  /** Set when the user overrode this endpoint — t is final. */
  fixedT?: number;
  /** Sort key for autos: opposite node center projected along the side axis. */
  sortKey: number;
}

function sortKeyFor(box: Box, side: AnchorSide, opposite: Box): number {
  const ocx = opposite.x + opposite.width / 2;
  const ocy = opposite.y + opposite.height / 2;
  // Vertical sides order by the opposite's y, horizontal sides by its x.
  // Unclamped on purpose: far-away nodes still order correctly vs fixed t in [0,1].
  if (side === "left" || side === "right") return (ocy - box.y) / box.height;
  return (ocx - box.x) / box.width;
}

const CTRL_MIN = 24;
const CTRL_MAX = 160;
const CTRL_RATIO = 0.4;

export function routeEdges(args: {
  edges: Edge[];
  boxes: Record<string, Box>;
  overrides?: Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }>;
}): RoutedEdge[] {
  const { edges, boxes, overrides = {} } = args;

  const pairs: ({ fromEp: Endpoint; toEp: Endpoint } | null)[] = edges.map((e, edgeIndex) => {
    const src = boxes[e.source];
    const tgt = boxes[e.target];
    if (!src || !tgt) return null;
    const ov = overrides[e.id];
    const fromSide = ov?.from?.side ?? autoSide(src, tgt);
    const toSide = ov?.to?.side ?? autoSide(tgt, src);
    const fromEp: Endpoint = {
      edgeIndex,
      end: "from",
      nodeId: e.source,
      side: fromSide,
      fixedT: ov?.from ? clamp01(ov.from.t) : undefined,
      sortKey: sortKeyFor(src, fromSide, tgt),
    };
    const toEp: Endpoint = {
      edgeIndex,
      end: "to",
      nodeId: e.target,
      side: toSide,
      fixedT: ov?.to ? clamp01(ov.to.t) : undefined,
      sortKey: sortKeyFor(tgt, toSide, src),
    };
    return { fromEp, toEp };
  });

  // Group endpoints per (node, side), sort, distribute t slots. Overridden
  // endpoints keep their exact t but still occupy a position in the ordering.
  const groups = new Map<string, Endpoint[]>();
  for (const pair of pairs) {
    if (!pair) continue;
    for (const ep of [pair.fromEp, pair.toEp]) {
      const key = `${ep.nodeId}|${ep.side}`;
      const group = groups.get(key);
      if (group) group.push(ep);
      else groups.set(key, [ep]);
    }
  }
  const tOf = new Map<Endpoint, number>();
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        (a.fixedT ?? a.sortKey) - (b.fixedT ?? b.sortKey) ||
        a.edgeIndex - b.edgeIndex ||
        (a.end === "from" ? -1 : 1) - (b.end === "from" ? -1 : 1),
    );
    group.forEach((ep, i) => {
      tOf.set(ep, ep.fixedT ?? (i + 1) / (group.length + 1));
    });
  }

  const out: RoutedEdge[] = [];
  edges.forEach((e, i) => {
    const pair = pairs[i];
    if (!pair) return;
    const src = boxes[e.source]!;
    const tgt = boxes[e.target]!;
    const p0 = anchorPoint(src, { side: pair.fromEp.side, t: tOf.get(pair.fromEp)! });
    const p3 = anchorPoint(tgt, { side: pair.toEp.side, t: tOf.get(pair.toEp)! });
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const len = Math.min(CTRL_MAX, Math.max(CTRL_MIN, dist * CTRL_RATIO));
    const n0 = OUT_NORMAL[pair.fromEp.side];
    const n3 = OUT_NORMAL[pair.toEp.side];
    out.push({
      edge: e,
      from: { ...p0, side: pair.fromEp.side },
      to: { ...p3, side: pair.toEp.side },
      points: [
        p0.x,
        p0.y,
        p0.x + n0.x * len,
        p0.y + n0.y * len,
        p3.x + n3.x * len,
        p3.y + n3.y * len,
        p3.x,
        p3.y,
      ],
    });
  });
  return out;
}
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/features/canvas/edgeRouting.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/features/canvas/edgeRouting.ts editor/src/features/canvas/edgeRouting.test.ts
rtk git commit -m "feat(editor): routeEdges — auto sides, distributed anchors, bezier control points"
```

---

### Task 3: Store — `setEdgeAnchor` / `clearEdgeAnchor` + pruning + rename

**Files:**
- Modify: `editor/src/state/accountStore.ts`
- Test: `editor/src/state/accountStore.test.ts`

- [ ] **Step 1: Tests qui échouent**

Ajouter dans le `describe("accountStore")` de `accountStore.test.ts` (les fixtures `mockAccount()` contiennent le pack `p_personal` avec les menus `m_shop_main`, `m_profile`, `m_about`) :

```ts
it("setEdgeAnchor stores an endpoint override; clearEdgeAnchor removes it and the empty entry", () => {
  useAccountStore.getState().setEdgeAnchor({
    packId: PERSONAL,
    edgeId: "m_shop_main->m_profile",
    end: "from",
    anchor: { side: "top", t: 0.3 },
  });
  let pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.canvasEdges!["m_shop_main->m_profile"]).toEqual({ from: { side: "top", t: 0.3 } });

  useAccountStore.getState().clearEdgeAnchor({
    packId: PERSONAL,
    edgeId: "m_shop_main->m_profile",
    end: "from",
  });
  pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.canvasEdges?.["m_shop_main->m_profile"]).toBeUndefined();
});

it("deleteFromPack prunes canvasEdges entries touching the deleted node", () => {
  useAccountStore.getState().setEdgeAnchor({
    packId: PERSONAL,
    edgeId: "m_shop_main->m_about",
    end: "to",
    anchor: { side: "left", t: 0.5 },
  });
  useAccountStore.getState().deleteFromPack({ packId: PERSONAL, nodeIds: ["m_about"] });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.canvasEdges?.["m_shop_main->m_about"]).toBeUndefined();
});

it("setMenuId rewrites canvasEdges keys", () => {
  useAccountStore.getState().setEdgeAnchor({
    packId: PERSONAL,
    edgeId: "m_shop_main->m_profile",
    end: "from",
    anchor: { side: "bottom", t: 0.8 },
  });
  useAccountStore.getState().setMenuId({
    packId: PERSONAL,
    oldId: menuId("m_profile"),
    newId: menuId("m_profile2"),
  });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.canvasEdges?.["m_shop_main->m_profile"]).toBeUndefined();
  expect(pack.canvasEdges?.["m_shop_main->m_profile2"]).toEqual({
    from: { side: "bottom", t: 0.8 },
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/state/accountStore.test.ts`
Expected: FAIL — `setEdgeAnchor` n'existe pas.

- [ ] **Step 3: Implémenter**

a) Dans l'interface des actions (`accountStore.ts`, à côté de `setCanvasPosition`, ~ligne 149) — importer `EdgeAnchor` depuis `@/domain/types` :

```ts
  /** Override one endpoint of a canvas edge ("source->target" id). */
  setEdgeAnchor: (input: {
    packId: PackId;
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  }) => void;
  /** Remove an endpoint override; drops the entry when both ends are auto again. */
  clearEdgeAnchor: (input: { packId: PackId; edgeId: string; end: "from" | "to" }) => void;
```

b) Implémentation, à côté de `setCanvasPosition` (~ligne 1429) :

```ts
        setEdgeAnchor: ({ packId: pId, edgeId, end, anchor }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              pack.canvasEdges ??= {};
              pack.canvasEdges[edgeId] = { ...pack.canvasEdges[edgeId], [end]: anchor };
            }),
          ),
        clearEdgeAnchor: ({ packId: pId, edgeId, end }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              const entry = pack?.canvasEdges?.[edgeId];
              if (!pack || !entry) return;
              delete entry[end];
              if (!entry.from && !entry.to) delete pack.canvasEdges![edgeId];
            }),
          ),
```

c) Pruning : localiser l'implémentation de `deleteFromPack` (grep `deleteFromPack:` dans `accountStore.ts`). Dans son bloc `produce`, là où `canvasLayout` est nettoyé, ajouter :

```ts
              if (pack.canvasEdges) {
                const dead = new Set(nodeIds);
                for (const key of Object.keys(pack.canvasEdges)) {
                  const [src, tgt] = key.split("->") as [string, string];
                  if (dead.has(src) || dead.has(tgt)) delete pack.canvasEdges[key];
                }
              }
```

(Adapter le nom de la variable locale du pack / des nodeIds à ce qui existe dans le bloc.)

d) Rename rewrite : ajouter un helper module-level dans `accountStore.ts` :

```ts
/** Rekey canvasEdges entries when a node id changes ("a->b" keys embed node ids). */
function rewriteCanvasEdgeIds(pack: Pack, oldId: string, newId: string) {
  if (!pack.canvasEdges) return;
  for (const key of Object.keys(pack.canvasEdges)) {
    const [src, tgt] = key.split("->") as [string, string];
    if (src !== oldId && tgt !== oldId) continue;
    const newKey = `${src === oldId ? newId : src}->${tgt === oldId ? newId : tgt}`;
    pack.canvasEdges[newKey] = pack.canvasEdges[key]!;
    delete pack.canvasEdges[key];
  }
}
```

Puis grep `canvasLayout` dans `accountStore.ts` : chaque bloc de **rename** qui rekeye `canvasLayout` (il y en a deux, ~lignes 1051 et 1802 — `setMenuId` et l'autre rename d'id) appelle aussi `rewriteCanvasEdgeIds(p, oldId as string, newId as string)` juste après le rekey du layout.

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/state/accountStore.test.ts`
Expected: PASS (tous, y compris les 3 nouveaux).

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts
rtk git commit -m "feat(editor): canvasEdges store actions with pruning and rename rekeying"
```

---

### Task 4: Export — `editor_edges` dans `manifest.yaml`

**Files:**
- Modify: `editor/src/features/export/transform.ts` (~ligne 636, bloc `editorLayout`)
- Test: `editor/src/features/export/transform.test.ts`

- [ ] **Step 1: Tests qui échouent**

Ajouter à `transform.test.ts`, juste après les tests `editor_layout` (~ligne 115) :

```ts
  it("emits editor_edges in manifest with live-edge overrides", () => {
    const pack = makePack({
      menus: [
        { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
        { id: menuId("home"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasEdges: {
        "home->shop": { from: { side: "top", t: 0.25 }, to: { side: "left", t: 0.5 } },
      },
    });
    const files = transform(pack);
    const manifest = parse(files["plugins/Artisan/packs/p_test/manifest.yaml"]!);
    expect(manifest.editor_edges).toEqual({
      "home->shop": { from: { side: "top", t: 0.25 }, to: { side: "left", t: 0.5 } },
    });
  });

  it("omits editor_edges when canvasEdges is empty or absent", () => {
    const pack = makePack({
      menus: [{ id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] }],
    });
    const files = transform(pack);
    const manifest = parse(files["plugins/Artisan/packs/p_test/manifest.yaml"]!);
    expect(manifest.editor_edges).toBeUndefined();
  });

  it("filters editor_edges whose source or target is no longer in the pack", () => {
    const pack = makePack({
      menus: [
        { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
        { id: menuId("home"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasEdges: {
        "home->shop": { from: { side: "right", t: 0.5 } },
        "home->ghost": { from: { side: "right", t: 0.5 } },
        "ghost->shop": { to: { side: "left", t: 0.5 } },
      },
    });
    const files = transform(pack);
    const manifest = parse(files["plugins/Artisan/packs/p_test/manifest.yaml"]!);
    expect(manifest.editor_edges).toEqual({
      "home->shop": { from: { side: "right", t: 0.5 } },
    });
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: FAIL — `editor_edges` undefined dans le premier et troisième test.

- [ ] **Step 3: Implémenter**

Dans `transform.ts`, après le calcul d'`editorLayout` (~ligne 638) :

```ts
  const editorEdges = Object.fromEntries(
    Object.entries(pack.canvasEdges ?? {}).filter(([edgeId, v]) => {
      const [src, tgt] = edgeId.split("->") as [string, string];
      return liveIds.has(src) && liveIds.has(tgt) && (v.from || v.to);
    }),
  );
```

Et après le bloc `if (Object.keys(editorLayout).length > 0)` (~ligne 653) :

```ts
  if (Object.keys(editorEdges).length > 0) {
    manifest.editor_edges = editorEdges;
  }
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
rtk git commit -m "feat(editor): export canvasEdges as manifest editor_edges"
```

---

### Task 5: Backend — import `editor_edges`

**Files:**
- Modify: `backend/src/lib/packImport.ts`
- Modify: `backend/src/routes/editorSession.ts:17-23` (`buildEditorJsonWithLayout`)
- Test: `backend/src/lib/packImport.test.ts`, `backend/src/routes/editorSession.test.ts`

- [ ] **Step 1: Tests qui échouent (packImport)**

Ajouter à `backend/src/lib/packImport.test.ts` (le helper `manifestWith(extra)` existant accepte n'importe quelles lignes YAML supplémentaires ; ajouter `readEditorEdgesFromFiles` à l'import ligne 2) :

```ts
describe("readEditorEdgesFromFiles", () => {
  test("parses editor_edges from manifest", () => {
    const files = manifestWith(
      "editor_edges:\n  'shop->confirm': { from: { side: right, t: 0.25 }, to: { side: left, t: 0.5 } }\n",
    );
    expect(readEditorEdgesFromFiles(files, PACK_ID)).toEqual({
      "shop->confirm": { from: { side: "right", t: 0.25 }, to: { side: "left", t: 0.5 } },
    });
  });

  test("missing editor_edges → {}", () => {
    const files = manifestWith(null);
    expect(readEditorEdgesFromFiles(files, PACK_ID)).toEqual({});
  });

  test("drops malformed entries (bad side, non-numeric t, empty anchors)", () => {
    const files = manifestWith(
      [
        "editor_edges:",
        "  'a->b': { from: { side: diagonal, t: 0.5 } }",
        "  'c->d': { from: { side: top, t: oops } }",
        "  'e->f': {}",
        "  'g->h': { to: { side: bottom, t: 0.9 } }",
      ].join("\n") + "\n",
    );
    expect(readEditorEdgesFromFiles(files, PACK_ID)).toEqual({
      "g->h": { to: { side: "bottom", t: 0.9 } },
    });
  });
});

describe("importPackFromFiles canvasEdges", () => {
  test("populates canvasEdges from manifest.editor_edges", () => {
    const files = manifestWith("editor_edges:\n  'shop->x': { from: { side: top, t: 0.1 } }\n");
    const pack = importPackFromFiles(PACK_ID, files);
    expect(pack.canvasEdges).toEqual({ "shop->x": { from: { side: "top", t: 0.1 } } });
  });

  test("no editor_edges → canvasEdges: {}", () => {
    const pack = importPackFromFiles(PACK_ID, manifestWith(null));
    expect(pack.canvasEdges).toEqual({});
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test` (⚠️ jamais `bun test` direct)
Expected: FAIL — `readEditorEdgesFromFiles` non exporté.

- [ ] **Step 3: Implémenter packImport**

Dans `backend/src/lib/packImport.ts` :

a) `ManifestYaml` (~ligne 130) : ajouter `editor_edges?: Record<string, unknown>;`

b) Sous `parseEditorLayout` (~ligne 184) :

```ts
const ANCHOR_SIDES = new Set(["top", "right", "bottom", "left"]);

interface EdgeAnchorJson {
  side: string;
  t: number;
}

function parseAnchor(raw: unknown): EdgeAnchorJson | null {
  if (!raw || typeof raw !== "object") return null;
  const { side, t } = raw as { side?: unknown; t?: unknown };
  if (typeof side !== "string" || !ANCHOR_SIDES.has(side)) return null;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  return { side, t: Math.min(1, Math.max(0, t)) };
}

function parseEditorEdges(
  raw: unknown,
): Record<string, { from?: EdgeAnchorJson; to?: EdgeAnchorJson }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { from?: EdgeAnchorJson; to?: EdgeAnchorJson }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const from = parseAnchor((v as { from?: unknown }).from);
    const to = parseAnchor((v as { to?: unknown }).to);
    if (!from && !to) continue;
    out[id] = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  return out;
}

export function readEditorEdgesFromFiles(
  files: Record<string, string>,
  packId: string,
): Record<string, { from?: EdgeAnchorJson; to?: EdgeAnchorJson }> {
  const m = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  return parseEditorEdges(m.editor_edges);
}
```

c) Dans le retour d'`importPackFromFiles` (~ligne 263), après `canvasLayout: ...` :

```ts
    canvasEdges: parseEditorEdges(manifest.editor_edges),
```

- [ ] **Step 4: éditorSession — test puis implémentation**

Lire le test existant `backend/src/routes/editorSession.test.ts:973` ("manifest editor_layout overrides pack.canvasLayout in stored editorJson") et le dupliquer en l'adaptant : nom `"manifest editor_edges lands in stored editorJson"`, mêmes étapes de setup, lignes YAML du manifest remplacées par :

```ts
        "editor_edges:", "  'shop->x': { from: { side: right, t: 0.5 } }",
```

et assertion finale :

```ts
  expect(stored.canvasEdges).toEqual({ "shop->x": { from: { side: "right", t: 0.5 } } });
```

(`stored` = le `editorJson` parsé, même mécanique que le test copié.)

Puis dans `backend/src/routes/editorSession.ts`, étendre `buildEditorJsonWithLayout` (~ligne 17, ajouter `readEditorEdgesFromFiles` à l'import ligne 12) :

```ts
  pack.canvasLayout = readEditorLayoutFromFiles(files, packId); // files win
  pack.canvasEdges = readEditorEdgesFromFiles(files, packId);
```

- [ ] **Step 5: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS (suite complète, y compris les nouveaux tests).

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/lib/packImport.ts backend/src/lib/packImport.test.ts backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
rtk git commit -m "feat(backend): round-trip manifest editor_edges into editorJson canvasEdges"
```

---

### Task 6: Rendu — `Edges.tsx` (Arrow bézier, sélection, poignées) + Stage

**Files:**
- Create: `editor/src/state/edgeSelectionStore.ts`
- Rewrite: `editor/src/features/canvas/Edges.tsx`
- Modify: `editor/src/features/canvas/Stage.tsx` (onStageClick, ~ligne 92)
- Test: `editor/src/features/canvas/Edges.test.tsx`

- [ ] **Step 1: Store de sélection d'edge**

Créer `editor/src/state/edgeSelectionStore.ts` :

```ts
import { create } from "zustand";

interface EdgeSelectionState {
  edgeId: string | null;
  select: (edgeId: string | null) => void;
}

export const useEdgeSelectionStore = create<EdgeSelectionState>((set) => ({
  edgeId: null,
  select: (edgeId) => set({ edgeId }),
}));
```

- [ ] **Step 2: Tests composant qui échouent**

Créer `editor/src/features/canvas/Edges.test.tsx` (même pattern de mock react-konva que `MenuGroup.test.tsx`) :

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { packId } from "@/domain/ids";
import { mockAccount } from "@/mock/fixtures";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";

import { Edges } from "./Edges";

vi.mock("react-konva", () => ({
  Arrow: (props: Record<string, unknown>) => (
    <div
      data-testid="konva-arrow"
      data-points={JSON.stringify(props.points)}
      onClick={() =>
        (props.onClick as ((e: { cancelBubble: boolean }) => void) | undefined)?.({
          cancelBubble: false,
        })
      }
    />
  ),
  Circle: (props: Record<string, unknown>) => (
    <div
      data-testid="konva-circle"
      data-x={props.x}
      data-y={props.y}
      onDoubleClick={() => (props.onDblClick as (() => void) | undefined)?.()}
    />
  ),
}));

vi.mock("@/lib/themeColors", () => ({ useCssVar: () => "#000000" }));

// Fixed edges — this test exercises routing/selection, not action-walking.
vi.mock("./deriveEdges", () => ({
  deriveEdges: () => [
    { id: "m_shop_main->m_profile", source: "m_shop_main", target: "m_profile", triggers: [] },
    { id: "m_profile->m_shop_main", source: "m_profile", target: "m_shop_main", triggers: [] },
  ],
}));

const PERSONAL = packId("p_personal");
const layout = { m_shop_main: { x: 0, y: 0 }, m_profile: { x: 700, y: 0 } };
const getPack = () => useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;

describe("Edges", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() });
    useEdgeSelectionStore.getState().select(null);
    useSelectionStore.getState().clear();
  });

  it("renders one arrow per edge with distinct anchors for A->B / B->A", () => {
    render(<Edges pack={getPack()} layout={layout} />);
    const arrows = screen.getAllByTestId("konva-arrow");
    expect(arrows).toHaveLength(2);
    const p1 = JSON.parse(arrows[0]!.getAttribute("data-points")!) as number[];
    const p2 = JSON.parse(arrows[1]!.getAttribute("data-points")!) as number[];
    // a->b leaves m_shop_main's right side at a different y than b->a arrives
    expect(p1[1]).not.toBe(p2[7]);
  });

  it("click selects the edge, clears node selection, shows two handles", () => {
    useSelectionStore.getState().replace(["m_about"]);
    render(<Edges pack={getPack()} layout={layout} />);
    fireEvent.click(screen.getAllByTestId("konva-arrow")[0]!);
    expect(useEdgeSelectionStore.getState().edgeId).toBe("m_shop_main->m_profile");
    expect(useSelectionStore.getState().ids.size).toBe(0);
    expect(screen.getAllByTestId("konva-circle")).toHaveLength(2);
  });

  it("double-click on a handle clears the override", () => {
    useAccountStore.getState().setEdgeAnchor({
      packId: PERSONAL,
      edgeId: "m_shop_main->m_profile",
      end: "from",
      anchor: { side: "top", t: 0.2 },
    });
    render(<Edges pack={getPack()} layout={layout} />);
    fireEvent.click(screen.getAllByTestId("konva-arrow")[0]!);
    fireEvent.doubleClick(screen.getAllByTestId("konva-circle")[0]!);
    expect(getPack().canvasEdges?.["m_shop_main->m_profile"]).toBeUndefined();
  });
});
```

Note : si `useSelectionStore` n'a pas de méthode `replace`, ouvrir `editor/src/state/selectionStore.ts` et utiliser la méthode existante équivalente (`set`, `selectOnly`, …) dans le 2ᵉ test.

- [ ] **Step 3: Vérifier l'échec**

Run: `cd editor && npx vitest run src/features/canvas/Edges.test.tsx`
Expected: FAIL (pas d'Arrow, pas de sélection, pas de poignées).

- [ ] **Step 4: Réécrire `Edges.tsx`**

```tsx
import type { EdgeAnchor, Pack } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useEffect, useMemo, useState } from "react";
import { Arrow, Circle } from "react-konva";
import { deriveEdges } from "./deriveEdges";
import { anchorPoint, closestAnchorOnBox, routeEdges, type Box } from "./edgeRouting";
import { COMMAND_BOX, DIALOG_BOX, menuBoxSize } from "./menuLayout";

interface EdgesProps {
  pack: Pack;
  layout: Record<string, { x: number; y: number }>;
}

function deriveHighlightSet(pack: Pack, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (
      pack.menus.some((m) => m.id === id) ||
      pack.commands.some((c) => c.id === id) ||
      (pack.dialogs ?? []).some((d) => d.id === id)
    ) {
      out.add(id);
      continue;
    }
    for (const m of pack.menus) {
      if (m.layers.some((l) => l.elements.some((el) => el.id === id))) {
        out.add(m.id);
        break;
      }
    }
  }
  return out;
}

export function Edges({ pack, layout }: EdgesProps) {
  const selectedIds = useSelectionStore((s) => s.ids);
  const highlightSet = useMemo(() => deriveHighlightSet(pack, selectedIds), [pack, selectedIds]);
  const hoveredEdgeId = useEdgeHoverStore((s) => s.edge?.id ?? null);
  const setHover = useEdgeHoverStore((s) => s.set);
  const moveHover = useEdgeHoverStore((s) => s.move);
  const selectedEdgeId = useEdgeSelectionStore((s) => s.edgeId);
  const brand = useCssVar("--brand");
  const edgeIdle = useCssVar("--border");

  // Selecting a node dismisses the edge selection (and its handles).
  useEffect(() => {
    if (selectedIds.size > 0) useEdgeSelectionStore.getState().select(null);
  }, [selectedIds]);

  const boxes = useMemo(() => {
    const out: Record<string, Box> = {};
    for (const m of pack.menus) {
      const pos = layout[m.id];
      if (pos) out[m.id] = { ...pos, ...menuBoxSize(m.rows) };
    }
    for (const c of pack.commands) {
      const pos = layout[c.id];
      if (pos) out[c.id] = { ...pos, ...COMMAND_BOX };
    }
    for (const d of pack.dialogs ?? []) {
      const pos = layout[d.id];
      if (pos) out[d.id] = { ...pos, ...DIALOG_BOX };
    }
    return out;
  }, [pack, layout]);

  // Live preview while a handle is dragged — committed to the store on drag end.
  const [dragOverride, setDragOverride] = useState<{
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  } | null>(null);

  const overrides = useMemo(() => {
    const base = pack.canvasEdges ?? {};
    if (!dragOverride) return base;
    return {
      ...base,
      [dragOverride.edgeId]: {
        ...base[dragOverride.edgeId],
        [dragOverride.end]: dragOverride.anchor,
      },
    };
  }, [pack.canvasEdges, dragOverride]);

  const routed = useMemo(
    () => routeEdges({ edges: deriveEdges(pack), boxes, overrides }),
    [pack, boxes, overrides],
  );

  const selectEdge = (id: string) => {
    useEdgeSelectionStore.getState().select(id);
    useSelectionStore.getState().clear();
  };

  const selectedRouted = routed.find((r) => r.edge.id === selectedEdgeId) ?? null;

  return (
    <>
      {routed.map((r) => {
        const e = r.edge;
        const isHovered = hoveredEdgeId === e.id;
        const isSelected = selectedEdgeId === e.id;
        const highlighted =
          isHovered || isSelected || highlightSet.has(e.source) || highlightSet.has(e.target);
        const color = highlighted ? brand : edgeIdle;
        return (
          <Arrow
            key={e.id}
            points={r.points}
            bezier
            stroke={color}
            fill={color}
            strokeWidth={highlighted ? 2.5 : 1.5}
            pointerLength={9}
            pointerWidth={8}
            hitStrokeWidth={12}
            onClick={(ev: Konva.KonvaEventObject<MouseEvent>) => {
              ev.cancelBubble = true;
              selectEdge(e.id);
            }}
            onTap={(ev: Konva.KonvaEventObject<Event>) => {
              ev.cancelBubble = true;
              selectEdge(e.id);
            }}
            onMouseEnter={(ev: Konva.KonvaEventObject<MouseEvent>) =>
              setHover(e, ev.evt.clientX, ev.evt.clientY)
            }
            onMouseMove={(ev: Konva.KonvaEventObject<MouseEvent>) =>
              moveHover(ev.evt.clientX, ev.evt.clientY)
            }
            onMouseLeave={() => setHover(null)}
          />
        );
      })}
      {selectedRouted &&
        (["from", "to"] as const).map((end) => {
          const edge = selectedRouted.edge;
          const nodeId = end === "from" ? edge.source : edge.target;
          const box = boxes[nodeId];
          if (!box) return null;
          const pt = end === "from" ? selectedRouted.from : selectedRouted.to;
          const reset = () =>
            useAccountStore.getState().clearEdgeAnchor({ packId: pack.id, edgeId: edge.id, end });
          return (
            <Circle
              key={`${edge.id}:${end}`}
              x={pt.x}
              y={pt.y}
              radius={6}
              fill={brand}
              stroke="#ffffff"
              strokeWidth={1.5}
              draggable
              onDragMove={(ev: Konva.KonvaEventObject<DragEvent>) => {
                const anchor = closestAnchorOnBox(box, ev.target.position());
                ev.target.position(anchorPoint(box, anchor)); // snap to the border
                setDragOverride({ edgeId: edge.id, end, anchor });
              }}
              onDragEnd={() => {
                if (dragOverride) {
                  useAccountStore.getState().setEdgeAnchor({
                    packId: pack.id,
                    edgeId: dragOverride.edgeId,
                    end: dragOverride.end,
                    anchor: dragOverride.anchor,
                  });
                }
                setDragOverride(null);
              }}
              onDblClick={reset}
              onDblTap={reset}
            />
          );
        })}
    </>
  );
}
```

(Le `"#ffffff"` du liseré de poignée est dans le canvas Konva — exempté de la règle tokens CSS.)

- [ ] **Step 5: Stage — clic vide désélectionne l'edge**

Dans `Stage.tsx`, importer `useEdgeSelectionStore` :

```ts
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
```

et dans `onStageClick` (~ligne 92), compléter le bloc clic-à-vide :

```ts
      if (e.target === e.target.getStage()) {
        useSelectionStore.getState().clear();
        useEdgeSelectionStore.getState().select(null);
        useUiStore.getState().setSelectedLayerKey(null);
      }
```

- [ ] **Step 6: Vérifier le vert**

Run: `cd editor && npx vitest run src/features/canvas/Edges.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Vérification visuelle manuelle**

Run: `cd editor && npm run dev` puis ouvrir un pack avec plusieurs menus liés.
Vérifier : courbes lisses avec flèches, ancres réparties, aller/retour non superposés, clic sur lien → poignées, drag poignée → snap au bord + persistance, double-clic → reset, drag d'un nœud → re-routage live, tooltip hover intact.

- [ ] **Step 8: Commit**

```bash
rtk git add editor/src/features/canvas/Edges.tsx editor/src/features/canvas/Edges.test.tsx editor/src/state/edgeSelectionStore.ts editor/src/features/canvas/Stage.tsx
rtk git commit -m "feat(editor): bezier edge rendering with arrows, distributed anchors and draggable endpoint handles"
```

---

### Task 7: Docs + suites complètes

**Files:**
- Modify: `docs/architecture/editor-internals.md`
- Check: `docs/schema/` (manifest)

- [ ] **Step 1: Documenter dans editor-internals.md**

Ajouter une sous-section dans la partie canvas de `docs/architecture/editor-internals.md` :

```markdown
### Canvas edges (liens entre nœuds)

Les liens menu/commande/dialog sont dérivés des actions (`deriveEdges.ts`, inchangé) puis
routés par `edgeRouting.ts` (pur, testé) : côté de sortie/entrée choisi par position
relative des nœuds (`autoSide`), endpoints d'un même côté triés vers leur nœud opposé et
répartis uniformément (`t = i+1/n+1`), tracé bézier cubique à tangentes perpendiculaires
au bord (longueur ∝ distance, clamp 24–160 px). Rendu : `Edges.tsx` en Konva `Arrow`
(tête de flèche côté cible), hover → `EdgeTooltip`, clic → sélection + 2 poignées
draggables le long du bord (snap périmètre via `closestAnchorOnBox`).

Overrides manuels : `pack.canvasEdges[edgeId] = { from?, to? }` avec
`EdgeAnchor = { side, t∈[0,1] }` (ratio → survit au resize). Edge id = `"source->target"`.
Actions store : `setEdgeAnchor` / `clearEdgeAnchor` (double-clic poignée = reset) ;
pruning sur `deleteFromPack`, rekey sur rename d'id. Persistance : `editor_edges` dans
`manifest.yaml` (miroir d'`editor_layout`), round-trip backend dans `packImport.ts`.
```

- [ ] **Step 2: Vérifier le schéma manifest**

Run: `rtk grep -r "editor_layout" docs/schema/` — si un schéma manifest déclare `editor_layout`, ajouter `editor_edges` au même endroit (objet additionnel, entries `{ from?: {side, t}, to?: {side, t} }`). Si aucun résultat (editor_layout non déclaré dans les schémas), aucune modification.

- [ ] **Step 3: Suites complètes**

```bash
cd editor && npm test          # suite éditeur complète
cd ../backend && bun run test  # suite backend complète (JAMAIS bun test direct)
```

Expected: tout vert, zéro régression.

- [ ] **Step 4: Commit final**

```bash
rtk git add docs/architecture/editor-internals.md
rtk git commit -m "docs(architecture): canvas edge routing internals"
```

(Inclure le fichier de schéma si modifié au Step 2.)

---

## Couverture spec → tasks

| Exigence spec | Task |
|---|---|
| Choix du côté auto + ancres réparties + bézier | 1, 2 |
| Flèches + hover/tooltip conservés | 6 |
| Sélection edge + poignées libres + snap bord + reset double-clic | 6 |
| `canvasEdges` + actions store + pruning + rename | 3 |
| Export `editor_edges` (filtré, omis si vide) | 4 |
| Import backend round-trip | 5 |
| Re-routage live au drag de nœud | 2 (dérivation par render) + vérif manuelle Task 6 |
| Doc `editor-internals.md` | 7 |
