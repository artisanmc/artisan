# Canvas: interaction modes (toolbar) + alignment guides — Design

> Spec brainstormed on 2026-06-14. Two board (Konva canvas) UX features: (A) a bottom-center toolbar with Figma-style **Select / Hand (pan)** interaction modes, and (B) **alignment guides + snapping** when dragging nodes. Independent — shippable in phases. Source of truth for the plan.

**Status** — Spec validated in brainstorming, to be turned into a plan.

---

## 1. Context (current interaction model)

- `Stage.tsx`: `<KonvaStage draggable>` → dragging on empty space **pans** (native Konva drag), synced via `syncViewportFromStage` → `usePanZoom` (`viewport {x,y,scale}`). `onWheel` = zoom, 2-finger pinch = zoom (`useStageTouch`).
- Selection: **click only** (`onStageClick`: click on a node selects; click on empty space, guard `e.target === stage`, clears). **No marquee** today. `selectionStore`: `set/add/toggle/clear`, `ids: Set`.
- Nodes (`MenuGroup` board / `CommandGroup` / `DialogGroup`): `draggable`, `onDragStart`=moveToTop, `onDragEnd`→`setCanvasPosition(pack.canvasLayout)`. **No `onDragMove`** on the nodes (free hook-in point for B).
- Box geometry: `nodeBox(pack, id, layout)` → `{x,y,width,height}` (menu via `menuBoxSize(rows)`, `COMMAND_BOX`, `DIALOG_BOX`).
- Overlay layer: `<Layer name="overlay">` (hosts `<Selection>` = Transformer `listening={false}`) → we will draw the marquee + the guides there.
- Keyboard (`useCanvasKeyboard`): Ctrl/⌘ Z/Y/C/V/D, Delete, Esc. **V / H / Space free** (no conflict).
- DOM chrome on the canvas: `ArmedBanner` (top-3, z-20). The `stage-bg-dots relative` wrapper → a bottom-center `z-20` toolbar does not conflict.

---

## A. Interaction modes + toolbar

### A.1 State
- `uiStore.canvasMode: "select" | "hand"` + `setCanvasMode`. **Default `"select"`, persisted** (sticky across sessions; already a `persist` store).
- Ephemeral `spaceHeld` state (local to the Stage or non-persisted uiStore) for the temporary hand on space.

### A.2 Hand mode (`hand`)
- Stage `draggable = (canvasMode === "hand") || spaceHeld`. Drag = pan (current behavior). Cursor `grab`/`grabbing`.
- Clicks do not select (pure navigation) — `onStageClick` short-circuited in hand mode (except `armedMaterial` placement, kept).

### A.3 Select mode (`select`, default)
- Stage **not** `draggable` → dragging on empty space is available for the **marquee**.
- **Marquee (new)**: pointerdown on empty space (target === stage) → start a rectangle; pointermove → grow it (drawn on the overlay layer, in world coords via `screenToWorld`); pointerup → select all **on-board** nodes whose `nodeBox` **intersects** the rectangle (intersection, not full inclusion). **Shift** = add to the existing selection; without Shift = replace. Simple click (no drag) on empty space = clear (current behavior). Click/drag on a node = selection/move (unchanged).
- Implementation: hook `useMarqueeSelection({ stageRef, viewport, pack, layout })` (handles pointer down/move/up + rect∩box hit-test) + overlay component `<MarqueeRect>` (reads the rect state). The hit-test reuses `nodeBox` for each node present in `layout`.

### A.4 Toolbar (DOM)
- Bottom-center DOM overlay (`absolute bottom-4 left-1/2 -translate-x-1/2 z-20`), design-system: two buttons **▣ Select** / **✋ Hand** (lucide icons, e.g. `MousePointer2` / `Hand`), the active one highlighted (`--brand-soft`). `CanvasToolbar.tsx` component. i18n for labels/tooltips.
- Tooltips show the hotkey (`V` / `H`).

### A.5 Keyboard
- **V** → select mode, **H** → hand mode (in `useCanvasKeyboard`, ignored if an input is focused). **Space held** → `spaceHeld=true` (temporary hand); released → returns to the current mode. (space keydown/keyup; ignored if typing is in progress.)

### A.6 Touch
Unchanged: 1 finger = pan (`usePanZoom`), tap = selection, long-press = context menu (`useStageTouch`), 2 fingers = pinch zoom. The modes + marquee are **pointer/desktop**. (No touch marquee in V1.)

---

## B. Alignment guides + snapping

### B.1 Trigger
Add `onDragMove` to the board nodes (`MenuGroup` non-solo, `CommandGroup`, `DialogGroup`) → a shared `useNodeAlignment` hook calls the pure function `alignmentGuides(dragged, others, threshold)`.

### B.2 Pure function `alignmentGuides.ts`
```ts
interface Box { x: number; y: number; width: number; height: number; }
interface Guide { axis: "x" | "y"; pos: number; from: number; to: number; } // line to draw
interface AlignResult { snapX?: number; snapY?: number; guides: Guide[]; }
export function alignmentGuides(dragged: Box, others: Box[], threshold: number): AlignResult;
```
- References compared: **left / centerX / right** of the dragged node vs left/centerX/right of each other → vertical alignment (same column) → candidate `snapX` + guide `axis:"x"`. **top / centerY / bottom** vs those of the others → horizontal alignment (same row) → candidate `snapY` + guide `axis:"y"`.
- We keep the best candidate per axis within the `threshold` (≈ `6 / viewport.scale` world px). `snapX/snapY` = the coordinate (x or y of the top-left corner) adjusted to achieve the alignment. `guides` = full-extent lines covering the dragged node + the aligned node(s) (from/to = min/max of the relevant extremities).

### B.3 Application (drag)
- During the drag: the hook computes `alignmentGuides`, **repositions the Konva node** (`node.x(snapX)`, `node.y(snapY)`) when a snap exists, and publishes the active `guides` into a light state (`useAlignmentStore` store or Stage state) read by `<AlignmentGuides>` (overlay, brand lines `listening={false}`).
- **Alt held** → `alignmentGuides` short-circuited (free move, no snap or guide).
- On `dragEnd`: persist the final (snapped) position via the existing `setCanvasPosition`; clear the guides.

### B.4 Compared data
`others` = `nodeBox` of all on-board nodes **except** the dragged one. The `dragged` box = live position of the node (`node.x()/y()` during the drag) + `nodeBox` dims.

---

## Files (high level)

**Created (editor)**
- `editor/src/features/canvas/CanvasToolbar.tsx` — bottom-center DOM toolbar (mode buttons).
- `editor/src/features/canvas/useMarqueeSelection.ts` + `MarqueeRect.tsx` — rubber-band in select mode.
- `editor/src/features/canvas/alignmentGuides.ts` (pure) + `useNodeAlignment.ts` + `AlignmentGuides.tsx` (overlay).
- (option) `editor/src/state/alignmentStore.ts` — active guides (or local Stage state).

**Modified**
- `editor/src/state/uiStore.ts` — `canvasMode` (persisted) + setter; (ephemeral) `spaceHeld` if put in the store.
- `editor/src/features/canvas/Stage.tsx` — `draggable` gated on the mode; cursor per mode; wire `useMarqueeSelection` + `<MarqueeRect>` + `<AlignmentGuides>` in the overlay layer; mount `<CanvasToolbar>` in the wrapper; short-circuit `onStageClick` in hand mode.
- `MenuGroup.tsx` (board) / `CommandGroup.tsx` / `DialogGroup.tsx` — add `onDragMove` → `useNodeAlignment`.
- `editor/src/features/canvas/useCanvasKeyboard.ts` — V / H / Space hotkeys.
- `editor/src/locales/en.ts` + `fr.ts` — toolbar labels (`canvas.modeSelect`, `canvas.modeHand`…).

---

## Phasing
- **Phase A1**: `canvasMode` + toolbar + gated draggable stage + cursor + V/H/Space hotkeys + hand short-circuits clicks. (No marquee yet — select mode behaves as today but without pan-on-empty-drag.)
- **Phase A2**: marquee (`useMarqueeSelection` + `MarqueeRect`) in select mode.
- **Phase B**: alignment guides + snap (independent; can precede or follow A).

---

## Tests
- `alignmentGuides` (pure): boxes aligned L/centerX/R/T/centerY/B → correct guides + snapX/snapY; nothing outside the threshold; Alt = no computation (tested at the hook level).
- `useMarqueeSelection` / hit-test: rect ∩ boxes → right ids; Shift = additive; click without drag = clear.
- Modes: `setCanvasMode`; Stage `draggable` reflects the mode (+ spaceHeld); hand short-circuits selection on click.
- `CanvasToolbar`: renders the 2 modes, the active one marked; click changes the mode; V/H hotkeys.
- Non-regression: pan/zoom/pinch, click-selection, node drag + `setCanvasPosition` unchanged in select mode.

## Non-goals (V1)
- **Distribution / equal spacing** guides (equidistant multi-selection) — V2.
- Global snap-to-grid, rulers.
- Rotate/scale tools.
- Touch marquee.
- Dedicated "placement/creation" mode (creation stays via right-click / panel).
