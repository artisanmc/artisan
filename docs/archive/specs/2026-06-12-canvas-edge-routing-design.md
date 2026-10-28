# Canvas — clean routing of links between nodes

**Date**: 2026-06-12
**Status**: validated (brainstorming with visual mockups)

## Problem

The links between menus on the canvas are messy:

- All the links of a node leave from the same point (middle-right of the source) and arrive at the same point (middle-left of the target) — `Edges.tsx` uses fixed anchors.
- The current path is an orthogonal path distorted by `bezier` + `tension 0.3` → soft curves, never straight.
- A back-and-forth A↔B produces two edges (`A->B` and `B->A`) that overlap.
- A target located to the left of its source generates a loop backwards (the exit is always on the right).
- No arrow: the direction of a link is invisible.

## Validated decisions

| Question | Decision |
|---|---|
| Path style | **Smooth bezier curves** in node-editor style (horizontal/vertical tangents at the edge, like Blender/React Flow). Chosen over orthogonal elbows and straight lines, on simple + dense-scene mockups. |
| Manual editing | **Free handle**: drag the end of a link along the node's edge, position remembered. Chosen over the "4 ports per side" model. |
| Back-and-forth A↔B | Two separate curves, naturally offset by the anchor distribution (no merge into a bidirectional link). |
| Arrows | Arrowhead on the target side of each link. |

## Design

### 1. Automatic routing (default)

New pure module `editor/src/features/canvas/edgeRouting.ts`:

- **Side choice**: for each edge, the exit side (source) and entry side (target) are chosen among top/bottom/left/right according to the relative position of the two boxes (angle between centers). A target on the left → exit by the left side.
- **Anchor distribution**: for each node, the edges touching the same side are sorted by the direction of the opposite node, then evenly spaced along that side. Consequences: no more single starting point, and A→B / B→A get distinct anchors → two parallel curves without overlap.
- **Path**: cubic bezier. Tangents perpendicular to the exit/entry side, length proportional to the distance between anchors (clamped min/max). Two aligned nodes with facing anchors = a straight line.
- Everything is derived on each render (like `deriveEdges`): dragging a node re-routes in real time.

`deriveEdges.ts` (deriving edges from actions) does not change.

### 2. Manual editing of the ends

- Click on a link → "edge selected" state; a handle appears at each end.
- Drag of a handle: snapped to the node perimeter, repositionable anywhere on the edge.
- Representation: `Anchor = { side: "top" | "right" | "bottom" | "left", t: number }` with `t ∈ [0,1]` the ratio along the side → survives node resizing (changing a menu's `rows`).
- An overridden end is fixed; the other stays automatic as long as it is untouched. The automatic anchors on the same side distribute taking the overridden positions into account.
- Reset: double-click on the handle → back to automatic (override removed).

### 3. Persistence

- New domain field: `pack.canvasEdges: Record<string, { from?: Anchor; to?: Anchor }>`, key = existing edge id (`"source->target"`). Exact mirror of the `canvasLayout` pattern.
- Export (`transform.ts`): `editor_edges` block in `manifest.yaml`, next to `editor_layout`. Overrides only; filtered on live ids (same pruning rules as `editor_layout`). Omitted if empty.
- Import: inverse round-trip (`editor_edges` → `pack.canvasEdges`), orphan entries ignored.
- Store: actions `setEdgeAnchor(packId, edgeId, end, anchor)` / `clearEdgeAnchor(packId, edgeId, end)` in `accountStore.ts`.

### 4. Rendering (`Edges.tsx`)

- Replaces the orthogonal+tension `Line` with the bezier path from `edgeRouting` (Konva `Shape`/`Path` or bezier `Line` with the real control points).
- Arrowhead at the arrival (triangle oriented along the final tangent).
- Keeps: hover (`EdgeTooltip`, `hitStrokeWidth: 12`), selection highlight (`--brand` / `--border` via `useCssVar` — no hard-coded hex, the Konva canvas is exempt from the tokens rule but we keep the existing CSS vars).
- Adds: edge selection on click, handles (draggable circles) on the selected edge.

## Out of scope

- Obstacle avoidance (a link may cross an unrelated node).
- Visual merge of bidirectional links.
- Node auto-layout (unchanged, `autoLayout.ts`).
- Editing intermediate points of the path (only the ends are editable).

## Tests

- `edgeRouting.test.ts`: side choice (4 quadrants), multi-edge distribution on the same side, sort stability, overridden anchors mixed with automatic ones, `{side, t}` ↔ coordinates parameterization, control points (aligned = straight).
- `accountStore.test.ts`: set/clear of anchors, pruning on node deletion.
- `transform.test.ts`: `editor_edges` round-trip, omission if empty, dead-id filtering.
- Component: selectable edge, handles visible on selection, double-click reset.

## Docs to update

- `docs/architecture/editor-internals.md` — canvas layout section (routing, anchors, `canvasEdges`).
