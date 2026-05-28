# Canvas Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the v0 three-level shell (account home → pack canvas → menu editor) into a **single canvas screen** powered by Konva. A pack's menus and commands are rendered as fully-composed inline groups (background, slot grid, free-positioned text labels, layers) directly on the pack canvas. Cross-pack moves and pack navigation happen through a left sidebar of pack miniatures. There is no separate menu editor page.

**Architecture:** SPA frontend, no backend. Single canvas surface rendered with **Konva via react-konva** (Canvas2D, no WebGL, no DOM diagramming library). Konva owns everything inside the canvas (menu Groups, edges, slots, text, transforms, hit-testing, pan/zoom, selection). React + shadcn/Radix own everything around the canvas (left sidebar, right properties pane, bottom material palette, dialogs, context menus). Editing happens in place on the canvas; text editing uses a transient DOM `<input>` overlay positioned over the Konva node, snapshotted back on blur.

**State:** zundo's `temporal` middleware moves from the v0 `menuDraftStore` (which is deleted) onto a slice of `accountStore`, scoped to the active pack — so undo/redo affects pack-level edits but not account-level operations (create/reorder/delete pack). Persistence stays on `localStorage` via `persist` middleware. Hermetic invariant (`assertPackHermetic`) still runs after every mutation; it survives unchanged from v0.

**Reference spec:** [`docs/specs/editor-shell-scaffold.md`](../specs/editor-shell-scaffold.md). This plan supersedes [`docs/plans/2026-04-30-editor-shell-scaffold.md`](2026-04-30-editor-shell-scaffold.md) for the canvas/UI surface; the v0 domain (types, invariant, fixtures, account store basics) survives.

**Out of scope:** multiplayer / collab / WS, MiniMessage parser, real asset upload, layer-conditional rendering UI, Java plugin, resource pack export, command editor UI. (Same out-of-scope as v0.)

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Top bar (DOM, shadcn): pack title · undo/redo · zoom · ...       │
├────────┬────────────────────────────────────────────┬────────────┤
│ Pack   │                                            │ Properties │
│ Mini   │   Konva <Stage>                            │ pane       │
│ Side   │     <Layer name="edges">                   │ (DOM)      │
│ bar    │       <Line ... />                         │            │
│ (DOM)  │     </Layer>                               │ Selection- │
│        │     <Layer name="menus">                   │ driven.    │
│ ┌────┐ │       <Group menu1>                        │            │
│ │ p1 │ │         <Image bg /> <Rect slot/>...       │ Hidden     │
│ ├────┤ │       </Group>                             │ when no    │
│ │ p2 │ │       <Group menu2>...</Group>             │ selection. │
│ ├────┤ │       <Group cmd1>...</Group>              │            │
│ │ p3 │ │     </Layer>                               │            │
│ ├────┤ │     <Layer name="overlay">                 │            │
│ │ +  │ │       <Transformer />                      │            │
│ └────┘ │     </Layer>                               │            │
│        │   </Stage>                                 │            │
│        │                                            │            │
│        ├────────────────────────────────────────────┤            │
│        │ Material palette (DOM bottom dock)         │            │
└────────┴────────────────────────────────────────────┴────────────┘
```

**Key invariants:**
- Konva owns hit-testing inside the Stage. @dnd-kit is used ONLY for sortable interactions in the DOM sidebar — never on the canvas.
- All canvas mutations go through `accountStore` actions. Konva drag callbacks dispatch store updates at drag-end (not on every frame).
- Selection lives in a small dedicated `useSelectionStore` (zustand, NOT in account store, NOT under zundo). Selection is ephemeral and shouldn't be undoable.
- Text editing uses a DOM `<input>`/`<textarea>` overlay; on blur, the value is dispatched to the store. Konva text always reads from the store — DOM is the temporary editing surface only.

---

## Phase 1 — Foundations

### Task 1: Replace React Flow with Konva

Remove the v0 React Flow stack and wire Konva. End of task: an empty Konva Stage renders inside the pack route with pan/zoom working, but no nodes yet. Build/lint/tests pass.

**Files:**
- Modify: `web/package.json` (drop `@xyflow/react`, add `konva`, `react-konva`, `use-image`)
- Delete: `web/src/features/pack-canvas/Canvas.tsx`, `web/src/features/pack-canvas/nodes/MenuNode.tsx`, `web/src/features/pack-canvas/nodes/CommandNode.tsx`
- Keep (framework-agnostic, survives): `web/src/features/pack-canvas/deriveEdges.ts`, `web/src/features/pack-canvas/autoLayout.ts`, their tests
- Create: `web/src/features/canvas/Stage.tsx` (the new Konva root)
- Create: `web/src/features/canvas/usePanZoom.ts` (wheel-zoom + drag-pan logic)
- Modify: `web/src/routes/pack.$packId.tsx` (mount Stage instead of v0 Canvas)

**Steps:**
- [ ] **Step 1: Swap deps**

```bash
cd web && npm uninstall @xyflow/react
npm install konva react-konva use-image
```

- [ ] **Step 2: Delete v0 React Flow components**

```bash
rm -rf web/src/features/pack-canvas/Canvas.tsx \
       web/src/features/pack-canvas/nodes
```

Move `deriveEdges.ts` + `autoLayout.ts` (and their tests) to `web/src/features/canvas/` (rename the directory from `pack-canvas` to `canvas` since "pack-canvas" is the only canvas now). Update imports.

- [ ] **Step 3: Implement `web/src/features/canvas/usePanZoom.ts`**

```ts
import type Konva from "konva";
import { useCallback, useState } from "react";

interface ViewportState { x: number; y: number; scale: number }

export function usePanZoom(initial: ViewportState = { x: 0, y: 0, scale: 1 }) {
  const [viewport, setViewport] = useState<ViewportState>(initial);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.max(0.1, Math.min(4, oldScale * (1 + direction * 0.1)));
    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, []);

  return { viewport, setViewport, onWheel };
}
```

- [ ] **Step 4: Implement `web/src/features/canvas/Stage.tsx`** — render the bare Konva Stage with pan/zoom; no menu rendering yet.

```tsx
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useRef, useState } from "react";
import { Layer, Stage as KonvaStage } from "react-konva";
import { usePanZoom } from "./usePanZoom";

interface StageProps { packId: PackId }

export function Stage({ packId }: StageProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { viewport, onWheel } = usePanZoom();

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  if (!pack) return <div className="p-8 text-zinc-500">Pack not found.</div>;

  return (
    <div ref={wrapperRef} className="h-full w-full bg-[var(--color-bg)]">
      <KonvaStage
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable
        onWheel={onWheel}
      >
        <Layer name="edges" />
        <Layer name="menus" />
        <Layer name="overlay" />
      </KonvaStage>
    </div>
  );
}
```

- [ ] **Step 5: Update the pack route** to mount the new Stage:

```tsx
// web/src/routes/pack.$packId.tsx
import type { PackId } from "@/domain/types";
import { Stage } from "@/features/canvas/Stage";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId")({ component: PackCanvasPage });

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm">
        <Link to="/" className="text-zinc-400 hover:text-zinc-100">← Packs</Link>
        <span className="text-zinc-500">/</span>
        <span className="font-mono">{packId}</span>
      </header>
      <main className="flex-1">
        <Stage packId={packId as PackId} />
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Verify build/lint/tests**

```bash
cd web && npm run build && npx biome check . && npm run test -- --run
```

Expected: build succeeds, biome clean, 24 unit tests still pass (`useUndoShortcut` survives — see Task 14 — but for now it's still wired to the v0 menuDraftStore, which we delete in Phase 3).

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(canvas): drop @xyflow/react, scaffold Konva Stage with pan/zoom"
```

---

### Task 2: Render menu Groups inline (background + slot grid + labels)

Render every menu in the pack as a Konva Group at its `canvasLayout` position. Each Group draws: outer rect (menu boundary), background image (if `menu.background?.assetId`), slot grid (rows × 9 squares with material name truncated), free-positioned text labels (a future-facing slot — no labels in fixtures yet).

**Files:**
- Create: `web/src/features/canvas/MenuGroup.tsx`
- Create: `web/src/features/canvas/CommandGroup.tsx`
- Create: `web/src/features/canvas/menuLayout.ts` (constants: slot size, grid padding, menu rendering box)
- Modify: `web/src/features/canvas/Stage.tsx` (mount the groups)

**Steps:**

- [ ] **Step 1: Define layout constants** in `menuLayout.ts`:

```ts
export const SLOT_SIZE = 32;        // px on canvas (pre-scale)
export const SLOT_GAP = 2;
export const GRID_PADDING = 8;
export const COLS = 9;
export const MENU_HEADER_HEIGHT = 24;

export const menuBoxSize = (rows: number) => ({
  width: GRID_PADDING * 2 + COLS * SLOT_SIZE + (COLS - 1) * SLOT_GAP,
  height: GRID_PADDING * 2 + MENU_HEADER_HEIGHT + rows * SLOT_SIZE + (rows - 1) * SLOT_GAP,
});

export const slotPos = (index: number) => ({
  col: index % COLS,
  row: Math.floor(index / COLS),
});

export const slotXY = (index: number) => {
  const { col, row } = slotPos(index);
  return {
    x: GRID_PADDING + col * (SLOT_SIZE + SLOT_GAP),
    y: GRID_PADDING + MENU_HEADER_HEIGHT + row * (SLOT_SIZE + SLOT_GAP),
  };
};
```

- [ ] **Step 2: Implement `MenuGroup.tsx`** — a `<Group>` with title text, background rect, optional background image (lookup `pack.assets[assetId]`, render via `react-konva`'s `Image` + `useImage` hook), per-slot Rects with material text truncated to 4 chars.

Render order inside the Group, top-to-bottom:
1. Drop shadow / background rect (full menu box, rounded corners, dark fill)
2. Background image (if defined; clipped to the slot grid area)
3. Header text (menu title + id badge)
4. 54-slot grid (Rect + Text per slot)
5. (Future: free-positioned text labels)

Handle drag at the Group level. On `dragend`, dispatch `setCanvasPosition`.

- [ ] **Step 3: Implement `CommandGroup.tsx`** — simpler, single rect + slash-command name.

- [ ] **Step 4: Wire into Stage.tsx** — read `pack.menus` and `pack.commands`, fall back to `autoLayout` for missing positions, render each as a child of the `menus` Layer.

- [ ] **Step 5: Manual visual smoke** — `npm run dev`, open `/pack/p_personal`, verify the 3 menus + 1 command render, you can pan/zoom, and dragging a menu updates its position (persists across reload via the existing `persist` middleware on accountStore).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(canvas): render menu/command groups inline on Konva canvas"
```

---

### Task 3: Render derived edges as Konva Lines

Bring the `deriveEdges` output back as connecting lines on the `edges` Layer. Edges run from the right side of the source group to the left side of the target group, with a Bezier curve.

**Files:**
- Create: `web/src/features/canvas/Edges.tsx`
- Modify: `web/src/features/canvas/Stage.tsx`

**Steps:**

- [ ] **Step 1: Implement `Edges.tsx`** — for each edge, look up source + target node positions from the resolved layout, compute anchor points (right-middle of source box, left-middle of target box), render a `<Line>` with a Bezier-style `points` array or use `tension` to curve it.

```tsx
import type { Pack } from "@/domain/types";
import { Line } from "react-konva";
import { deriveEdges } from "./deriveEdges";
import { menuBoxSize } from "./menuLayout";

interface EdgesProps {
  pack: Pack;
  layout: Record<string, { x: number; y: number }>;
}

export function Edges({ pack, layout }: EdgesProps) {
  const edges = deriveEdges(pack);
  return (
    <>
      {edges.map((e) => {
        const src = layout[e.source];
        const tgt = layout[e.target];
        if (!src || !tgt) return null;
        // Source: right-middle of the source box; target: left-middle of target box.
        const srcBox = boxFor(pack, e.source);
        const tgtBox = boxFor(pack, e.target);
        const sx = src.x + srcBox.width;
        const sy = src.y + srcBox.height / 2;
        const tx = tgt.x;
        const ty = tgt.y + tgtBox.height / 2;
        return (
          <Line
            key={e.id}
            points={[sx, sy, (sx + tx) / 2, sy, (sx + tx) / 2, ty, tx, ty]}
            stroke="#525252"
            strokeWidth={1.5}
            bezier
            tension={0.3}
            listening={false}
          />
        );
      })}
    </>
  );
}

function boxFor(pack: Pack, id: string) {
  const menu = pack.menus.find((m) => m.id === id);
  if (menu) return menuBoxSize(menu.rows);
  // Command: small fixed box
  return { width: 140, height: 48 };
}
```

- [ ] **Step 2: Mount in Stage** — pass the resolved layout into `<Edges>` on the `edges` Layer.

- [ ] **Step 3: Verify visually + tests still pass.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(canvas): draw open_menu edges as Bezier lines on Konva"
```

---

## Phase 2 — Selection, properties, palette

### Task 4: Selection model (single + multi + marquee + Transformer)

Build a dedicated selection store (NOT under zundo, NOT in accountStore). Click on a Group to select; Shift+click to multi-select; click on empty stage to deselect; drag from empty stage to draw a marquee that selects intersecting groups. Render a Konva `<Transformer>` on the `overlay` Layer, attached to selected nodes. Delete-key removes selected menus/commands (with confirmation if any inbound edges exist).

**Files:**
- Create: `web/src/state/selectionStore.ts`
- Create: `web/src/features/canvas/Selection.tsx` (renders the Transformer + marquee Rect)
- Create: `web/src/features/canvas/useSelectionInteractions.ts` (Stage-level click/drag handlers)
- Modify: `web/src/features/canvas/Stage.tsx`, `MenuGroup.tsx`, `CommandGroup.tsx` (wire `onClick` to dispatch selection)

**Steps:**

- [ ] **Step 1: `selectionStore.ts`**

```ts
import { create } from "zustand";

interface SelectionState {
  ids: Set<string>;
  set: (ids: string[] | Set<string>) => void;
  add: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  ids: new Set(),
  set: (ids) => set({ ids: new Set(ids) }),
  add: (id) => set({ ids: new Set([...get().ids, id]) }),
  toggle: (id) => {
    const next = new Set(get().ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ ids: next });
  },
  clear: () => set({ ids: new Set() }),
}));
```

- [ ] **Step 2: Group click handlers** — `MenuGroup`/`CommandGroup` receive an `onSelect(id, additive)` callback. Wire `onClick`/`onTap` to call it with `additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey`.

- [ ] **Step 3: Stage empty-click** — `Stage` `onMouseDown` checks `e.target === e.target.getStage()` to detect clicks on the empty background; clears selection unless additive.

- [ ] **Step 4: Marquee** — track drag-from-empty-stage start/current; render a transparent blue Rect on the `overlay` Layer; on drag-end, compute which groups intersect and call `useSelectionStore.set(intersecting)`.

- [ ] **Step 5: Transformer** — `Selection.tsx` reads `selectionStore`, looks up Konva nodes by id from a refs Map (kept by MenuGroup/CommandGroup via `useEffect` on a Map ref), and attaches Konva's `Transformer` to those nodes for resize/rotate handles. v1 disables resize/rotate for menus (positions are in the model, sizes are derived) — we use Transformer just for the bounding box visual. Set `enabledAnchors={[]}` and `rotateEnabled={false}`.

- [ ] **Step 6: Delete-key** — window keydown handler (in MenuEditor or a new `useCanvasKeyboard` hook): if Delete or Backspace and no input is focused and selection is non-empty, dispatch `deleteSelected` (a new accountStore action). Per the invariant philosophy ([see memory: editor architecture](../../../.claude/projects/.../project_niveau2_redesign.md)), `deleteSelected` does **not** silently rewrite orphan `open_menu` refs. It runs `assertPackHermetic` after the deletion: if any inbound ref exists, the deletion is rejected with a toast ("This menu is referenced by N action(s); remove them first or fork them"), and the user resolves the refs manually. **Tests required:** delete-without-inbound-refs succeeds; delete-with-inbound-refs throws and leaves state unchanged.

- [ ] **Step 7: Unit tests** — selectionStore (set/add/toggle/clear), `deleteSelected` happy path + orphan rewrite path.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(canvas): selection model with marquee, Transformer overlay, delete shortcut"
```

---

### Task 5: Properties pane (right, fixed, opens on selection)

A right-side DOM panel (shadcn) that opens when selection is exactly 1 item. Shows the editable fields for the selected entity:
- If a menu is selected: title, rows (1-6), permission, default background asset
- If a command is selected: name, aliases, permission, description
- If multiple items are selected: count summary, "Multi-edit not supported in v1"
- If nothing is selected: hidden (collapsed) or shows pack-level metadata (name, description, source badge)

The panel writes to accountStore actions (some of which need to be added: `setMenuField`, `setCommandField`).

**Files:**
- Create: `web/src/features/canvas/PropertiesPane.tsx`
- Create: `web/src/features/canvas/MenuProperties.tsx`, `CommandProperties.tsx`, `PackProperties.tsx`
- Modify: `web/src/state/accountStore.ts` (add `setMenuField`, `setCommandField`, `setPackField` actions, all running `assertPackHermetic` after)
- Modify: `web/src/routes/pack.$packId.tsx` (mount `<PropertiesPane>` next to `<Stage>`)

**Steps:**

- [ ] **Step 1: Add store actions** — `setMenuField({ packId, menuId, field, value })` etc. Each runs `produce` + `assertPackHermetic` and rejects on failure (e.g. setting `menu.rows = 1` while the menu has slots in row 5+ should be either rejected here or auto-pruning slots — decide: **reject** with a clear error, the user must remove the offending slots first).

- [ ] **Step 2: PropertiesPane** — reads `selectionStore`, dispatches the right sub-component, all fields are shadcn `Input`/`Textarea` controlled by accountStore.

- [ ] **Step 3: Mount in route** — split layout: Stage flex-1 in the middle, PropertiesPane fixed-width 320px on the right (collapsible later, not in v1).

- [ ] **Step 4: Tests** — render with a single-menu selection, type into the title field, assert accountStore was updated.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(canvas): properties pane editing menu/command/pack metadata"
```

---

### Task 6: Material palette (bottom dock)

A horizontal dock at the bottom of the canvas area (below the Stage, full width), DOM, shadcn-styled. Searchable list of vanilla materials. Each material is a Konva-aware drag source — drag onto a slot inside a MenuGroup, drop, dispatch `setMaterialAtPosition`.

The drag pattern uses **HTML drag-and-drop** (browser native), NOT @dnd-kit, because the drop target is inside a Konva canvas. On `dragstart`, set `dataTransfer` with the material name; the canvas Stage listens for `dragover`/`drop` events on its container `<div>` and forwards them to Konva by computing the slot under the cursor.

**Files:**
- Create: `web/src/features/canvas/MaterialPalette.tsx`
- Create: `web/src/features/canvas/usePaletteDrop.ts` (Stage container drop handlers)
- Modify: `web/src/state/accountStore.ts` (add `setSlotMaterial({ packId, menuId, position, material })` — replaces v0's `setMaterialAtPosition` from menuDraftStore)
- Modify: `web/src/features/canvas/Stage.tsx` (wire dragover/drop)
- Modify: `web/src/routes/pack.$packId.tsx` (mount `<MaterialPalette>` below Stage)

**Steps:**

- [ ] **Step 1: Implement palette** — DOM list of materials (search bar, virtual scroll if list grows), each `<button draggable>` with `onDragStart` writing the material to `dataTransfer`.

- [ ] **Step 2: Implement `usePaletteDrop`** — listens on the Stage wrapper `<div>` (NOT Konva itself, since browser drag events don't fire on canvas children). On `drop`, compute the canvas-space coordinate of the cursor (account for stage transform), then call `stage.getIntersection({ x, y })` to find the slot Rect under the cursor. The slot Rect's `name` attr identifies the menu+position.

- [ ] **Step 3: `setSlotMaterial` action** — same shape as v0's `setMaterialAtPosition` but operates directly on `accountStore` (no draft layer; edits are immediate but will be undoable via zundo in Task 14).

- [ ] **Step 4: Tests** — store action: set on existing element, set on empty position, hermetic invariant still holds. Drop coordinate logic is hard to unit test without Konva runtime; cover in Playwright.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(canvas): material palette with drag-onto-slot drop"
```

---

### Task 7: In-canvas text editing (DOM overlay pattern)

When the user double-clicks a text node inside a menu (the menu title in v1), show a DOM `<input>` positioned exactly over the Konva text. On Enter or blur, write back to the store; the Konva text re-renders from the new store value.

**Files:**
- Create: `web/src/features/canvas/TextEditor.tsx`
- Create: `web/src/features/canvas/useTextEditing.ts`
- Modify: `web/src/features/canvas/MenuGroup.tsx` (wire `onDblClick` on the title to open the editor)

**Steps:**

- [ ] **Step 1: Editor state** — local React state at the Stage level holds the active text edit: `{ targetId, field, screenRect, value }`. (Could be in selectionStore as a separate slice; for v1 keep it as Stage-level state.)

- [ ] **Step 2: Compute screen rect** — given a Konva node, `node.getClientRect()` returns its viewport rect. Use that to position the absolute-positioned `<input>` over it.

- [ ] **Step 3: Live re-position on stage transform** — if the user pans/zooms while editing, the `<input>` moves with the underlying node. Easiest: subscribe to viewport updates and recompute on every `viewport` change while editing is active.

- [ ] **Step 4: Commit on blur or Enter** — dispatch `setMenuField({ field: "title", value })`. Escape cancels.

- [ ] **Step 5: Verify visual + commit**

```bash
git commit -m "feat(canvas): in-place text editing via DOM overlay on Konva nodes"
```

---

## Phase 3 — Sidebar, navigation, undo refactor

### Task 8: PackMiniSidebar (left, sortable, drop targets, +)

Replace v0's right-side `MovePackSidebar` with a left-side sidebar of pack miniatures. Each mini is a 200×120px DOM card showing a cheap visual approximation of the pack's canvas (boxes proportional to menu/command positions, no edges, no interactivity). The mini is:

- **Clickable** → navigates to that pack
- **Sortable** (vertical, @dnd-kit `SortableContext`) → calls `reorderPacks`
- **Drop target** (HTML drag) → when a Konva menu Group is dragged out of the canvas onto this mini, dispatch `moveMenuToPack`

A header row has the active pack name + a `+` button → opens the `NewPackDialog`.

**Files:**
- Create: `web/src/features/account/PackMiniSidebar.tsx`
- Create: `web/src/features/account/PackMini.tsx` (single mini render)
- Create: `web/src/features/account/PackMiniPreview.tsx` (the cheap SVG/HTML rendering of a pack's nodes)
- Keep: `web/src/features/account/NewPackDialog.tsx` (slightly modified, opens from the sidebar `+`)
- Delete: `web/src/features/pack-canvas/MovePackSidebar.tsx` and its test
- Delete: `web/src/features/account/PackGrid.tsx`, `PackCard.tsx`, `PackGrid.test.tsx` (Niveau 1 grid is gone — handled by the sidebar)
- Modify: `web/src/routes/pack.$packId.tsx` (mount sidebar)

**Steps:**

- [ ] **Step 1: PackMiniPreview** — given a `Pack`, render an inline SVG that draws each menu as a small filled rect at its `canvasLayout` position, scaled to fit a 200×120 viewBox. Use the `autoLayout` fallback for missing positions. Edges are NOT drawn (too noisy at this scale).

- [ ] **Step 2: PackMini** — wraps Preview in a card (border, rounded, hover ring). Active pack gets emerald ring. Click navigates via `useNavigate`. Drop handler accepts a menu drag (HTML `dragover`/`drop`, with `dataTransfer` payload `{ kind: "menu", menuId }`) and dispatches `moveMenuToPack` inside a try/catch that surfaces errors via a toast (shadcn) — see Task 9.

- [ ] **Step 3: PackMiniSidebar** — vertical list, @dnd-kit `SortableContext` for reorder, `+` button at top opens `NewPackDialog`.

- [ ] **Step 4: Wire menu drag-out** — in `MenuGroup.tsx`, on `dragstart` of the Group (Konva drag), set a window-level state `draggingMenuId`; the sidebar reads this state and shows visual affordance (highlights drop targets). On Konva `dragend`, check if the drop position is over the sidebar viewport rect — if so, dispatch `moveMenuToPack` and revert the canvas position; otherwise let `setCanvasPosition` fire normally.

  *Alternative considered:* Konva drag and HTML drag don't compose. We can't use `dataTransfer` on a Konva drag. Instead, we hit-test the cursor's screen position against the sidebar's `getBoundingClientRect()` on Konva `dragend`. Tested: it works.

- [ ] **Step 5: Delete v0 components** in the same commit:

```bash
rm web/src/features/account/PackGrid.tsx \
   web/src/features/account/PackCard.tsx \
   web/src/features/account/PackGrid.test.tsx \
   web/src/features/pack-canvas/MovePackSidebar.tsx \
   web/src/features/pack-canvas/MovePackSidebar.test.tsx
```

- [ ] **Step 6: Tests** — PackMini renders, navigates on click, drop handler dispatches `moveMenuToPack`, sidebar reorder dispatches `reorderPacks`.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(account): pack-mini sidebar replaces v0 grid + move sidebar"
```

---

### Task 9: Toast feedback for failed mutations

shadcn toast for hermetic-invariant rejections (e.g. `moveMenuToPack` cross-pack), undo/redo confirmations, and other action errors. Replaces the v0 inline red text in the pack header.

**Files:**
- Run: `npx shadcn@latest add sonner` (or equivalent toast library — the v0 plan's spec doesn't mandate one)
- Create: `web/src/components/Toaster.tsx`
- Modify: `web/src/main.tsx` (mount `<Toaster>` once at the root)
- Modify: action consumers (sidebar drop, paste-with-cross-pack, etc.) to call `toast.error(...)` on caught errors

**Steps:**

- [ ] **Step 1: Add the toast lib + mount once.**
- [ ] **Step 2: Wrap mutation dispatches with try/catch + toast.error.**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ui): toast feedback for invariant-rejected mutations"
```

---

### Task 10: Routing collapse + empty state

`/` now redirects to `/pack/<last-active-or-first>`. `/pack/$packId/menu/$menuId` is removed entirely (404 → redirect to `/pack/$packId`). Empty-state CTA on the canvas when the pack list is empty.

**Files:**
- Modify: `web/src/routes/index.tsx` (redirect on mount)
- Delete: `web/src/routes/pack_.$packId.menu.$menuId.tsx`
- Delete: `web/src/features/menu-editor/` (whole directory — MenuEditor, Palette, Properties, InventoryGrid, useUndoShortcut, tests). Their functionality is now inline.
- Delete: `web/src/state/menuDraftStore.ts` and its test
- Modify: `web/src/state/accountStore.ts` (track `lastActivePackId`)
- Create: `web/src/features/canvas/EmptyState.tsx` (shown when pack list is empty)

**Steps:**

- [ ] **Step 1: lastActivePackId** — add to `Account` type? No — keep it in a separate `useUiStore` (zustand + persist), since it's UI preference, not domain. `setLastActivePackId(id)` is dispatched from the pack route on mount.

- [ ] **Step 2: Index redirect** — on mount, read `lastActivePackId` from `useUiStore`. If valid (still exists in accountStore), navigate to `/pack/<id>`. If not, navigate to the first pack. If no packs, render `<EmptyState>`.

- [ ] **Step 3: EmptyState** — a centered card with "Crée ton premier pack" + a button that opens `NewPackDialog`. After create, navigate to the new pack.

- [ ] **Step 4: Delete the menu route file + menu-editor dir + menuDraftStore.** Update routeTree.gen.ts via `npm run generate-routes`.

- [ ] **Step 5: Tests** — index redirects to active pack; index with 0 packs shows CTA.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(routing): collapse 3 niveaus into one canvas route, add empty state"
```

---

### Task 11: Undo/redo refactor (zundo on accountStore, pack scope)

Replace v0's `useMenuDraftStore.temporal` (deleted in Task 10) with a `temporal()` wrapper around a slice of accountStore. Scope: only undo pack-level edits (menu/slot/element changes), NOT account-level operations (create/delete/reorder pack). Undo/redo keyboard shortcuts wired at the canvas level.

**Files:**
- Modify: `web/src/state/accountStore.ts` (wrap with `temporal`, configure `partialize` to only include the active pack's data)
- Create: `web/src/features/canvas/useCanvasKeyboard.ts` (Ctrl+Z, Ctrl+Shift+Z, Delete, Backspace, plus copy/paste/duplicate from Task 13)
- Modify: `web/src/routes/pack.$packId.tsx` (call the keyboard hook)

**Steps:**

- [ ] **Step 1: Refactor accountStore** — wrap the existing `create(persist(...))` in `temporal(...)`. Use `partialize` to exclude `packs` from the partial state... actually, that's the opposite — we WANT pack edits to be in the temporal history. The right pattern:

  - Keep `account.packs` in the temporal history (changes are undoable)
  - Exclude `account.packOrder` from temporal (reorder is undoable per-action via the dedicated undo, but reorder events shouldn't fight with menu edits)

  Decision: **all account state goes through temporal**, but call `temporal.getState().clear()` after `createPack`/`deletePack`/`reorderPacks` so those actions break the undo stack and don't tangle with pack-internal edits. (Standard zundo pattern.)

- [ ] **Step 2: useCanvasKeyboard** — single hook called once in the pack route. Handles undo/redo (with the input/textarea guard from v0's `useUndoShortcut`).

- [ ] **Step 3: Migrate the v0 `useUndoShortcut` test** to test the new pack-scoped undo through accountStore.

- [ ] **Step 4: Tests** — undo a slot material change reverts the store; undo a pack reorder is a no-op (because we cleared the temporal stack); undo doesn't affect selection state (selectionStore is outside the temporal scope).

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(state): zundo wraps accountStore at pack scope, drop menuDraftStore"
```

---

## Phase 4 — Polish: context menu, copy/paste, decommission

### Task 12: Context menu (right-click, shadcn DOM overlay)

Right-click on a menu Group, command Group, or slot opens a context menu with: Copy, Paste, Duplicate, Delete, Move to pack ▶ (submenu listing other packs).

**Files:**
- Create: `web/src/features/canvas/ContextMenu.tsx` (shadcn `DropdownMenu` controlled positioning)
- Create: `web/src/features/canvas/useContextMenu.ts`
- Modify: `web/src/features/canvas/Stage.tsx` (`onContextMenu={(e) => { e.evt.preventDefault(); openCtx(...) }}`)

**Steps:**

- [ ] **Step 1: Disable default browser menu** at the Stage container level.

- [ ] **Step 2: Open at cursor** — store `{ open: true, x, y, target }` in local state; render `<ContextMenu>` absolute-positioned at that screen point.

- [ ] **Step 3: Items dispatch the corresponding store action** (via Task 13 for copy/paste/duplicate, Task 4 for delete, Task 8 for move-to-pack).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(canvas): right-click context menu on Konva nodes via shadcn overlay"
```

---

### Task 13: Copy / paste / duplicate

Window-level Ctrl+C, Ctrl+V, Ctrl+D handlers (with input-focus guard). Clipboard format: `application/json` (Artisan-specific MIME or fallback to text JSON), structure `{ kind: "artisan.clipboard", version: 1, items: [{ type: "menu" | "command" | "slot", data: ... }] }`.

Paste behavior:
- Same pack: clone with new ids, offset position by 24px
- Different pack: clone, rewrite ids, run `assertPackHermetic` on the destination. If it fails (the pasted entity carries an `open_menu` whose target isn't in the destination pack), **reject the paste** with a toast: "This entity references menus that aren't in the destination pack. Fork the referenced menu(s) into this pack first, or edit the source action." Don't try to silently rewrite. (The fork mechanism doesn't exist in v1 — but the future evolution is documented in memory; the philosophy is that the user, not the editor, decides how to resolve cross-pack refs.)
- Slot paste onto a slot: replace
- Slot paste onto empty slot: create

**Files:**
- Create: `web/src/features/canvas/clipboard.ts` (serialize/deserialize, paste resolution, id rewriting)
- Modify: `web/src/features/canvas/useCanvasKeyboard.ts` (wire Ctrl+C/V/D)
- Modify: `web/src/state/accountStore.ts` (add `pasteEntities({ packId, items, position })` and `duplicateMenu({ packId, menuId })`)

**Steps:**

- [ ] **Step 1: Define the clipboard schema** with `zod` (already a candidate dep — install if not present). Serialize `{ kind, version, items }`.

- [ ] **Step 2: Copy** — selection → schema → `navigator.clipboard.writeText(JSON.stringify(payload))`. Keep a fallback to in-memory clipboard for environments where the clipboard API is denied.

- [ ] **Step 3: Paste** — read clipboard, validate with zod, rewrite ids (deep traversal), call `pasteEntities`.

- [ ] **Step 4: Duplicate** — same as copy + paste in one action; offset by 24px.

- [ ] **Step 5: Tests** — round-trip a menu through copy/paste, asserts new ids and original integrity. Cross-pack paste of an entity carrying an `open_menu` to an out-of-pack target is rejected (assertPackHermetic throws), state is unchanged, toast surfaces the error message.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(canvas): copy/paste/duplicate with id rewrite and cross-pack confirmation"
```

---

### Task 14: E2E smoke (Playwright) for the new flow

Replace the v0 smoke test which assumed three routes. New smoke:

1. Load app on empty localStorage → see seed packs in sidebar
2. Click `Personal` mini → canvas shows menus + 1 edge
3. Drag a slot from the palette onto a slot in `m_profile` → slot fills with material text
4. Reload → material persists
5. Ctrl+Z → material reverts
6. Right-click a menu → Delete → menu disappears, edge from `m_shop_main` is rewritten or pruned
7. Drag `m_about` Group out of the canvas onto the `Shop System` mini → menu moves cross-pack, click `Shop System` confirms
8. Drag `m_shop_main` onto `Shop System` mini → toast error (cross-pack `open_menu`), source unchanged

**Files:**
- Modify: `web/tests/e2e/smoke.spec.ts`

**Steps:**

- [ ] **Step 1: Rewrite the smoke** to walk the new flow.

- [ ] **Step 2: Run** until green.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(e2e): playwright smoke for canvas redesign flow"
```

---

### Task 15: Decommission stragglers + final verification

Sweep for any v0 dead code, stale imports, unused tests, orphaned comments referring to "Niveau 1/2/3", ensure README/CLAUDE.md (if any) is consistent.

**Files:**
- Touch as needed.

**Steps:**

- [ ] **Step 1: `git grep -nE "Niveau|menuDraftStore|MovePackSidebar|PackGrid|PackCard|MenuEditor|InventoryGrid|@xyflow"`** — should return zero hits.

- [ ] **Step 2: `npm run test -- --run && npm run build && npx biome check . && npm run test:e2e`** — every check green.

- [ ] **Step 3: Tag**

```bash
git tag -a v0.2.0-canvas -m "Canvas redesign — single Konva surface with inline menus + pack mini sidebar"
```

- [ ] **Step 4: Commit any sweeps**

```bash
git commit -m "chore: scrub v0 references and dead code"
```

---

## Open questions to resolve during execution (not blockers)

These are intentionally deferred — flag them when the task that hits them comes up, decide there:

- **Invariant relaxation (dangling vs cross-pack):** v1 keeps the strict `assertPackHermetic` semantics inherited from the v0 scaffold — it doesn't distinguish "target doesn't exist anywhere" (dangling) from "target exists in another pack" (cross-pack), both throw with the same `cross-pack open_menu` error. The future-correct semantics (per Iban's design philosophy: dangling refs are runtime's problem, only true cross-pack must be blocked at the editor boundary) requires (a) the invariant to take the whole `Account` instead of a single `Pack`, and (b) a fork mechanism so users can resolve cross-pack rejections by inlining the dependency. Both are deferred — the strict-for-now behavior matches the v1 UX of "reject with a clear message, user resolves manually".
- **Layer UI:** menus have multiple `Layer` entities in the model. v1 renders all layers stacked. A layer panel (toggle visibility, switch active edit layer) is a follow-up plan item, not in this scope.
- **Snap-to-grid for menu Group positions:** nice-to-have, easy to add as a 16px snap on `dragend` in `setCanvasPosition`. Defer unless it feels missing during walkthrough.
- **Multi-edit in PropertiesPane:** v1 shows "Multi-edit not supported" when 2+ items are selected. Common-field multi-edit is straightforward to add later.
- **MaterialPalette virtualization:** if we ship 1000+ materials (Nexo / ItemAdder integration), virtualize. v1 ships ~12, no virtualization needed.
- **Background image upload UI:** the `Asset` entity exists but there's no upload flow. v1 hard-codes a fixture asset for backgrounds; real upload is a follow-up plan item.

---

## Verification matrix at end of execution

| Check | Expected |
|---|---|
| `npm run test -- --run` | every suite green |
| `npm run build` | clean, `dist/` populated |
| `npm run lint` | zero diagnostics |
| `npm run test:e2e` | smoke green |
| Manual: panning the canvas at 60fps with the seed pack | smooth, no jank |
| Manual: drag a menu Group onto a sidebar mini | moves cross-pack, hermetic-rejected attempts toast and revert |
| Manual: copy a menu, paste, undo, redo | round-trips |
| Manual: right-click a slot → Copy → paste in another menu | works, new id generated |
| Manual: empty localStorage → first run | sees CTA, can create first pack, lands on it |

---

## Out of scope (deferred to later plans)

Same list as v0 plan, plus:

- Layer panel UI (toggle visibility, active layer)
- Snap-to-grid configurability
- Multi-edit in properties pane
- Asset upload flow
- Resource-pack export
- Real backend / WS / multiplayer
- Onboarding wizard beyond the empty-state CTA
