# Canvas Modes + Alignment Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Figma-style canvas interaction modes (Select / Hand) with a bottom toolbar + hotkeys + marquee box-selection, and alignment guides + snapping when dragging board nodes.

**Architecture:** A persisted `uiStore.canvasMode` gates the Konva stage's `draggable` (Hand = pan; Select = stage not draggable so drag-on-empty draws a marquee that selects intersecting nodes). A bottom-center DOM toolbar + V/H/Space hotkeys switch modes. Dragging a node fires `onDragMove` → a pure `alignmentGuides()` computes edge/center alignment vs other nodes' boxes, snaps the node, and publishes guide lines to an overlay layer. Spec: `docs/superpowers/specs/2026-06-14-canvas-modes-and-alignment-design.md`.

**Tech Stack:** React 19, Konva (`react-konva`), Zustand (persist), Vitest + RTL. Tests: `cd editor && npx vitest run <path>`. Canvas tests mock `react-konva` (Group→div with `data-name`/`data-x`).

**Verified facts:**
- `screenToWorld(stagePoint: {x,y}, viewport: {x,y,scale}): {x,y}` from `@/features/canvas/hitTest` = `{ x: (p.x-vp.x)/vp.scale, y: (p.y-vp.y)/vp.scale }`.
- `nodeBox(pack, id, layout): {x,y,width,height} | null` from `@/features/canvas/menuLayout`.
- `Stage.tsx`: `<KonvaStage draggable onClick={onStageClick} ... onDragMove/onDragEnd sync>`; wrapper `<div ref={wrapperRef} className="stage-bg-dots relative h-full w-full">`; overlay `<Layer name="overlay"><Selection stageRef={stageRef} /></Layer>`. `ArmedBanner` is `absolute top-3 ... z-20`.
- `usePanZoom()` → `{ viewport, setViewport, onWheel, onTouchMove, onTouchEnd }`.
- `selectionStore`: `set(ids: Iterable<string>, focusedSlot?: number|null)`, `add`, `toggle`, `clear`, `ids: Set<string>`.
- `useCanvasKeyboard` has a `useEffect` keydown handler guarded by `isEditableTarget(e.target)` then `const cmdOrCtrl = e.ctrlKey||e.metaKey`.
- Node drag: `MenuGroup` (board) uses `useMenuDrag` → `onMenuDragStart` (moveToTop) / `onMenuDragEnd` (setCanvasPosition); `CommandGroup`/`DialogGroup` have inline `onDragStart`(moveToTop)/`onDragEnd`(setCanvasPosition). No `onDragMove` today.
- `uiStore` uses `persist` with an ALLOWLIST `partialize`.

---

## File Structure

**Created**
- `editor/src/features/canvas/CanvasToolbar.tsx` — bottom-center DOM toolbar (Select/Hand).
- `editor/src/features/canvas/marqueeHitTest.ts` — pure `rectIntersectsBoxes`.
- `editor/src/features/canvas/useMarqueeSelection.ts` + `MarqueeRect.tsx` — rubber-band (select mode).
- `editor/src/features/canvas/alignmentGuides.ts` — pure guide/snap computation.
- `editor/src/features/canvas/useNodeAlignment.ts` + `AlignmentGuides.tsx` — drag-time guides overlay.
- `editor/src/state/alignmentStore.ts` — active guide lines (ephemeral).

**Modified**
- `editor/src/state/uiStore.ts` — `canvasMode` (persisted) + setter.
- `editor/src/features/canvas/Stage.tsx` — draggable gated on mode + cursor + Space-hold; mount toolbar + marquee + guides; hand-mode short-circuits select-on-click.
- `editor/src/features/canvas/useCanvasKeyboard.ts` — V/H hotkeys.
- `editor/src/features/canvas/MenuGroup.tsx` / `CommandGroup.tsx` / `DialogGroup.tsx` — `onDragMove` (alignment) + clear guides on dragEnd.
- `editor/src/locales/en.ts` + `fr.ts` — toolbar labels.

**Phases:** A1 = T1–T3 (modes+toolbar+hotkeys), A2 = T4 (marquee), B = T5–T6 (guides+snap). A and B are independent.

---

## Task 1 — `uiStore.canvasMode` (persisted)

**Files:** Modify `editor/src/state/uiStore.ts`; Test `editor/src/state/uiStore.test.ts`.

- [ ] **Step 1 — failing test** (append to existing test file)
```ts
describe("uiStore — canvasMode", () => {
  it("défaut 'select', setter le change", () => {
    useUiStore.setState({ canvasMode: "select" } as any);
    expect(useUiStore.getState().canvasMode).toBe("select");
    useUiStore.getState().setCanvasMode("hand");
    expect(useUiStore.getState().canvasMode).toBe("hand");
  });
});
```

- [ ] **Step 2 — run, expect FAIL**: `cd editor && npx vitest run src/state/uiStore.test.ts -t canvasMode`

- [ ] **Step 3 — implement.** In the `UiState` interface add:
```ts
  /** Mode d'interaction du canvas : sélection (clic + marquee) ou main (pan). Persisté. */
  canvasMode: "select" | "hand";
  setCanvasMode: (m: "select" | "hand") => void;
```
In the store object:
```ts
      canvasMode: "select",
      setCanvasMode: (m) => set({ canvasMode: m }),
```
In the `persist` `partialize` allowlist, add `canvasMode: state.canvasMode,`.

- [ ] **Step 4 — run, expect PASS**: same command.

- [ ] **Step 5 — commit**
```bash
git add editor/src/state/uiStore.ts editor/src/state/uiStore.test.ts
git commit -m "feat(editor): uiStore canvasMode (select/hand, persisted)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2 — `CanvasToolbar` (bottom-center modes)

**Files:** Create `editor/src/features/canvas/CanvasToolbar.tsx`; Modify `editor/src/locales/en.ts` + `fr.ts`; Modify `Stage.tsx` (mount); Test `editor/src/features/canvas/CanvasToolbar.test.tsx`.

- [ ] **Step 1 — i18n keys.** `en.ts`: add a `canvas` sub-block (or extend the existing `canvas` block) with:
```ts
    modeSelect: "Select",
    modeHand: "Pan",
```
`fr.ts`: `modeSelect: "Sélection"`, `modeHand: "Navigation"`. (Place inside the existing `canvas: { ... }` block in each file — verify it exists; it holds `newMenu`/`newCommand` etc.)

- [ ] **Step 2 — failing test**
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/state/uiStore";
import { CanvasToolbar } from "./CanvasToolbar";

describe("CanvasToolbar", () => {
  beforeEach(() => useUiStore.setState({ canvasMode: "select" } as any));
  it("rend les 2 modes et marque l'actif via aria-pressed", () => {
    render(<CanvasToolbar />);
    const sel = screen.getByRole("button", { name: /select|sélection/i });
    const hand = screen.getByRole("button", { name: /pan|navigation/i });
    expect(sel).toHaveAttribute("aria-pressed", "true");
    expect(hand).toHaveAttribute("aria-pressed", "false");
  });
  it("cliquer un mode le sélectionne", () => {
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /pan|navigation/i }));
    expect(useUiStore.getState().canvasMode).toBe("hand");
  });
});
```

- [ ] **Step 3 — run, expect FAIL**: `cd editor && npx vitest run src/features/canvas/CanvasToolbar.test.tsx`

- [ ] **Step 4 — implement** `CanvasToolbar.tsx`
```tsx
import { useTranslation } from "react-i18next";
import { Hand, MousePointer2 } from "lucide-react";
import { useUiStore } from "@/state/uiStore";

export function CanvasToolbar() {
  const { t } = useTranslation();
  const mode = useUiStore((s) => s.canvasMode);
  const setMode = useUiStore((s) => s.setCanvasMode);
  const btn = (active: boolean) =>
    `flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] transition-colors ${
      active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
    }`;
  return (
    <div className="-translate-x-1/2 absolute bottom-4 left-1/2 z-20 flex items-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface-raised)]/95 p-1 backdrop-blur"
         style={{ boxShadow: "var(--shadow-md)" }}>
      <button type="button" aria-pressed={mode === "select"} title={`${t("canvas.modeSelect")} (V)`}
        onClick={() => setMode("select")} className={btn(mode === "select")}>
        <MousePointer2 className="size-4" /> {t("canvas.modeSelect")}
      </button>
      <button type="button" aria-pressed={mode === "hand"} title={`${t("canvas.modeHand")} (H)`}
        onClick={() => setMode("hand")} className={btn(mode === "hand")}>
        <Hand className="size-4" /> {t("canvas.modeHand")}
      </button>
    </div>
  );
}
```
Verify tokens (`--brand-soft`, `--brand`, `--surface-raised`, `--border`, `--shadow-md`) exist in globals.css.

- [ ] **Step 5 — mount in Stage.tsx.** Import `CanvasToolbar` and render it inside the wrapper `<div className="stage-bg-dots relative ...">`, right after `<ArmedBanner />`:
```tsx
<CanvasToolbar />
```

- [ ] **Step 6 — run, expect PASS** (toolbar test) + `cd editor && npx vitest run src/features/canvas` (no regression).

- [ ] **Step 7 — commit**
```bash
git add editor/src/features/canvas/CanvasToolbar.tsx editor/src/features/canvas/CanvasToolbar.test.tsx editor/src/features/canvas/Stage.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): canvas mode toolbar (Select/Hand)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3 — Stage draggable gating + cursor + hotkeys (V/H/Space)

**Files:** Modify `editor/src/features/canvas/Stage.tsx`, `editor/src/features/canvas/useCanvasKeyboard.ts`; Test `editor/src/features/canvas/Stage.modes.test.tsx`.

Goal: Hand → stage pans (draggable), clicks don't select; Select → stage NOT draggable (drag-empty free for marquee in T4); Space-hold = temp hand; V/H switch modes.

- [ ] **Step 1 — failing test** (`Stage.modes.test.tsx`) — reuse the react-konva mock pattern (Stage→div, KonvaStage exposing `data-draggable`):
```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { Stage } from "./Stage";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage" data-draggable={String(!!p.draggable)}>{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => <div data-name={p.name}>{p.children}</div>,
  Rect: () => <div />, Image: () => <div />, Text: () => <div />, Line: () => <div />,
  Transformer: () => <div />, Arrow: () => <div />, Circle: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("./title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));
vi.mock("./Edges", () => ({ Edges: () => <div /> }));

const PID = "p1" as PackId;
function pack(): Pack {
  return { id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [], commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {} } as Pack;
}
describe("Stage — modes", () => {
  beforeEach(() => useAccountStore.setState({ account: { id: "a" as any, packs: [pack()], packOrder: [PID] } } as any));
  it("hand mode → stage draggable", () => {
    useUiStore.setState({ canvasMode: "hand" } as any);
    render(<Stage packId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("true");
  });
  it("select mode → stage NOT draggable", () => {
    useUiStore.setState({ canvasMode: "select" } as any);
    render(<Stage packId={PID} />);
    expect(screen.getByTestId("konva-stage").getAttribute("data-draggable")).toBe("false");
  });
});
```

- [ ] **Step 2 — run, expect FAIL**: `cd editor && npx vitest run src/features/canvas/Stage.modes.test.tsx`

- [ ] **Step 3 — implement in Stage.tsx.**
- Read the mode + add Space-hold local state near the other hooks:
```tsx
const canvasMode = useUiStore((s) => s.canvasMode);
const [spaceHeld, setSpaceHeld] = useState(false);
useEffect(() => {
  const isEditable = (el: EventTarget | null) => {
    const n = el as HTMLElement | null;
    const tag = n?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || !!n?.isContentEditable;
  };
  const down = (e: KeyboardEvent) => { if (e.code === "Space" && !isEditable(e.target)) { e.preventDefault(); setSpaceHeld(true); } };
  const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceHeld(false); };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
}, []);
const panMode = canvasMode === "hand" || spaceHeld;
```
- On `<KonvaStage>`: change `draggable` → `draggable={panMode}`.
- Cursor: on the wrapper `<div>` add a dynamic class/style: `style={{ cursor: panMode ? (/*dragging?*/ "grab") : "default" }}` (simplest: `grab` in pan mode, `default` otherwise).
- Hand-mode short-circuits selection: at the very top of `onStageClick`, after the `armedMaterial` block, guard the clear-selection branch so it only clears in select mode — i.e. wrap the `if (e.target === e.target.getStage()) { clear... }` with `if (!panMode && e.target === ...)`. (In pan mode, a click shouldn't clear/select.) Keep the armedMaterial placement working in both modes.

- [ ] **Step 4 — V/H hotkeys in useCanvasKeyboard.ts.** Inside the existing keydown handler (after the `isEditableTarget` guard, before/after the cmdOrCtrl shortcuts), add:
```ts
if (!cmdOrCtrl && (e.key === "v" || e.key === "V")) { useUiStore.getState().setCanvasMode("select"); return; }
if (!cmdOrCtrl && (e.key === "h" || e.key === "H")) { useUiStore.getState().setCanvasMode("hand"); return; }
```
Import `useUiStore` if not already imported. (Space-hold is handled in Stage, Step 3.)

- [ ] **Step 5 — run tests**: `cd editor && npx vitest run src/features/canvas/Stage.modes.test.tsx src/features/canvas` → PASS.

- [ ] **Step 6 — commit**
```bash
git add editor/src/features/canvas/Stage.tsx editor/src/features/canvas/useCanvasKeyboard.ts editor/src/features/canvas/Stage.modes.test.tsx
git commit -m "feat(editor): gate stage pan on canvasMode + V/H/Space hotkeys + cursor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4 — Marquee box-selection (select mode)

**Files:** Create `editor/src/features/canvas/marqueeHitTest.ts`, `useMarqueeSelection.ts`, `MarqueeRect.tsx`; Modify `Stage.tsx`; Tests `marqueeHitTest.test.ts` + extend Stage tests.

- [ ] **Step 1 — pure hit-test test** (`marqueeHitTest.test.ts`)
```ts
import { describe, expect, it } from "vitest";
import { rectIntersectsBoxes } from "./marqueeHitTest";

describe("rectIntersectsBoxes", () => {
  it("retourne les ids des boîtes qui intersectent le rect (monde)", () => {
    const boxes = { a: { x: 0, y: 0, width: 50, height: 50 }, b: { x: 200, y: 200, width: 50, height: 50 } };
    expect(rectIntersectsBoxes({ x: 10, y: 10, width: 100, height: 100 }, boxes)).toEqual(["a"]);
    expect(rectIntersectsBoxes({ x: -10, y: -10, width: 300, height: 300 }, boxes).sort()).toEqual(["a", "b"]);
    expect(rectIntersectsBoxes({ x: 1000, y: 1000, width: 5, height: 5 }, boxes)).toEqual([]);
  });
  it("normalise les rects à largeur/hauteur négatives (drag vers le haut-gauche)", () => {
    const boxes = { a: { x: 0, y: 0, width: 50, height: 50 } };
    expect(rectIntersectsBoxes({ x: 100, y: 100, width: -120, height: -120 }, boxes)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2 — run, expect FAIL**: `cd editor && npx vitest run src/features/canvas/marqueeHitTest.test.ts`

- [ ] **Step 3 — implement `marqueeHitTest.ts`**
```ts
interface Box { x: number; y: number; width: number; height: number; }
/** ids des boîtes qui intersectent le rectangle (coords monde). Rect normalisé (w/h peuvent être négatifs). */
export function rectIntersectsBoxes(rect: Box, boxes: Record<string, Box>): string[] {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y2 = Math.max(rect.y, rect.y + rect.height);
  const out: string[] = [];
  for (const [id, b] of Object.entries(boxes)) {
    if (b.x < x2 && b.x + b.width > x1 && b.y < y2 && b.y + b.height > y1) out.push(id);
  }
  return out;
}
```

- [ ] **Step 4 — run, expect PASS**: same command (2 tests).

- [ ] **Step 5 — `useMarqueeSelection.ts` + `MarqueeRect.tsx`.**
`useMarqueeSelection({ stageRef, viewport, pack, layout, active })`: when `active` (select mode), handle stage `onMouseDown`/`onMouseMove`/`onMouseUp` (or pointer): on down with `e.target === stage` (empty), record world start; on move, update a `rect` state (world coords via `screenToWorld(stage.getPointerPosition(), viewport)`); on up, build `boxes` = `{ id: nodeBox(pack,id,layout) }` for every id in `layout`, call `rectIntersectsBoxes(rect, boxes)`, then `selectionStore.set(ids)` (or `add` each if `e.evt.shiftKey`); clear rect. Expose the live `rect` (world) + handlers. Return `{ rect, onMouseDown, onMouseMove, onMouseUp }`.
`MarqueeRect.tsx`: a Konva `<Rect>` (in the overlay layer) drawn at `rect` (world coords; the layer is inside the scaled stage so world coords are correct), `fill` brand at low opacity, `stroke` brand, `listening={false}`. Renders null when no rect.
Provide full code:
```tsx
// useMarqueeSelection.ts
import { useCallback, useState } from "react";
import type Konva from "konva";
import type { Pack } from "@/domain/types";
import { screenToWorld } from "./hitTest";
import { nodeBox } from "./menuLayout";
import { rectIntersectsBoxes } from "./marqueeHitTest";
import { useSelectionStore } from "@/state/selectionStore";

interface Args { stageRef: React.RefObject<Konva.Stage | null>; viewport: { x: number; y: number; scale: number }; pack: Pack | undefined; layout: Record<string, { x: number; y: number }>; active: boolean; }
export function useMarqueeSelection({ stageRef, viewport, pack, layout, active }: Args) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);

  const onMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!active) return;
    if (e.target !== e.target.getStage()) return; // only empty space
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    const w = screenToWorld(p, viewport);
    setStart(w); setRect({ x: w.x, y: w.y, width: 0, height: 0 });
  }, [active, stageRef, viewport]);

  const onMouseMove = useCallback(() => {
    if (!active || !start) return;
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    const w = screenToWorld(p, viewport);
    setRect({ x: start.x, y: start.y, width: w.x - start.x, height: w.y - start.y });
  }, [active, start, stageRef, viewport]);

  const onMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!active || !rect || !start) { setRect(null); setStart(null); return; }
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    if (pack) for (const id of Object.keys(layout)) { const b = nodeBox(pack, id, layout); if (b) boxes[id] = b; }
    const hit = rectIntersectsBoxes(rect, boxes);
    const sel = useSelectionStore.getState();
    if (e.evt.shiftKey) for (const id of hit) sel.add(id);
    else sel.set(hit);
    setRect(null); setStart(null);
  }, [active, rect, start, pack, layout]);

  return { rect, onMouseDown, onMouseMove, onMouseUp };
}
```
```tsx
// MarqueeRect.tsx
import { Rect } from "react-konva";
import { useCssVar } from "@/lib/themeColors";
export function MarqueeRect({ rect }: { rect: { x: number; y: number; width: number; height: number } | null }) {
  const brand = useCssVar("--brand");
  if (!rect) return null;
  return <Rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={brand} opacity={0.12} stroke={brand} strokeWidth={1} listening={false} />;
}
```
(Verify `useCssVar` exists — `MenuGroup` imports it from `@/lib/themeColors`. If not, pass a literal brand hex acceptable for Konva per the canvas exception.)

- [ ] **Step 6 — wire into Stage.tsx.** Call the hook: `const marquee = useMarqueeSelection({ stageRef, viewport, pack, layout, active: canvasMode === "select" && !spaceHeld });`. Add its handlers to `<KonvaStage>`: `onMouseDown={marquee.onMouseDown}`, and MERGE into existing `onMouseMove`/`onMouseUp` if present (the stage currently has none for mouse move/up — add them: `onMouseMove={marquee.onMouseMove} onMouseUp={marquee.onMouseUp}`). Render `<MarqueeRect rect={marquee.rect} />` inside `<Layer name="overlay">` (next to `<Selection>`).

- [ ] **Step 7 — integration test** (extend `Stage.modes.test.tsx` or new): with 2 on-board menus and select mode, simulate down/move/up over the empty area covering one box → `selectionStore.ids` contains it. (If simulating Konva mouse events through the mock is impractical, at minimum unit-test the hook's `onMouseUp` logic by calling the returned handler with a stubbed `stageRef.getPointerPosition`; OR rely on the pure `rectIntersectsBoxes` test for the core + a smoke render. Report the approach.)

- [ ] **Step 8 — run + commit**
```bash
cd editor && npx vitest run src/features/canvas
git add editor/src/features/canvas/marqueeHitTest.ts editor/src/features/canvas/marqueeHitTest.test.ts editor/src/features/canvas/useMarqueeSelection.ts editor/src/features/canvas/MarqueeRect.tsx editor/src/features/canvas/Stage.tsx editor/src/features/canvas/Stage.modes.test.tsx
git commit -m "feat(editor): marquee box-selection in select mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5 — `alignmentGuides` (pure)

**Files:** Create `editor/src/features/canvas/alignmentGuides.ts`; Test `alignmentGuides.test.ts`.

- [ ] **Step 1 — failing tests**
```ts
import { describe, expect, it } from "vitest";
import { alignmentGuides } from "./alignmentGuides";

const A = { x: 100, y: 100, width: 50, height: 50 }; // other node
describe("alignmentGuides", () => {
  it("snap left quand le bord gauche est dans le threshold", () => {
    const dragged = { x: 104, y: 300, width: 50, height: 50 }; // left=104, A.left=100, diff 4 <= 6
    const r = alignmentGuides(dragged, [A], 6);
    expect(r.snapX).toBe(100);              // aligné sur A.left
    expect(r.guides.some((g) => g.axis === "x" && g.pos === 100)).toBe(true);
  });
  it("snap centerY (même ligne) quand les centres verticaux s'alignent", () => {
    const dragged = { x: 300, y: 123, width: 50, height: 50 }; // centerY=148, A.centerY=125 -> diff 23 (hors), ajustons
    const d2 = { x: 300, y: 102, width: 50, height: 50 };       // centerY=127 vs 125 -> diff 2
    const r = alignmentGuides(d2, [A], 6);
    expect(r.snapY).toBe(100);              // centerY alignés -> top = A.centerY - height/2 = 125-25 = 100
    expect(r.guides.some((g) => g.axis === "y")).toBe(true);
  });
  it("rien hors threshold", () => {
    const r = alignmentGuides({ x: 500, y: 500, width: 50, height: 50 }, [A], 6);
    expect(r.snapX).toBeUndefined();
    expect(r.snapY).toBeUndefined();
    expect(r.guides).toEqual([]);
  });
});
```

- [ ] **Step 2 — run, expect FAIL**: `cd editor && npx vitest run src/features/canvas/alignmentGuides.test.ts`

- [ ] **Step 3 — implement `alignmentGuides.ts`**
```ts
export interface Box { x: number; y: number; width: number; height: number; }
export interface Guide { axis: "x" | "y"; pos: number; from: number; to: number; }
export interface AlignResult { snapX?: number; snapY?: number; guides: Guide[]; }

/** Calcule snap + guides d'alignement du box déplacé vs les autres, dans threshold (coords monde). Pur. */
export function alignmentGuides(dragged: Box, others: Box[], threshold: number): AlignResult {
  // candidats X (alignement vertical / même colonne) : la coord X-cible et le décalage du coin haut-gauche pour y arriver.
  // refs du dragged : left=x, centerX=x+w/2, right=x+w. Pareil pour chaque other.
  const xRefs = (b: Box) => [b.x, b.x + b.width / 2, b.x + b.width];
  const yRefs = (b: Box) => [b.y, b.y + b.height / 2, b.y + b.height];
  const dragXRefs = xRefs(dragged); // [left, centerX, right]
  const dragYRefs = yRefs(dragged);
  let bestX: { dist: number; targetRef: number; refIndex: number } | null = null;
  let bestY: { dist: number; targetRef: number; refIndex: number } | null = null;
  const others2 = others;
  for (const o of others2) {
    const ox = xRefs(o), oy = yRefs(o);
    for (let i = 0; i < 3; i++) {
      for (const t of ox) { const d = Math.abs(dragXRefs[i]! - t); if (d <= threshold && (!bestX || d < bestX.dist)) bestX = { dist: d, targetRef: t, refIndex: i }; }
      for (const t of oy) { const d = Math.abs(dragYRefs[i]! - t); if (d <= threshold && (!bestY || d < bestY.dist)) bestY = { dist: d, targetRef: t, refIndex: i }; }
    }
  }
  const guides: Guide[] = [];
  let snapX: number | undefined; let snapY: number | undefined;
  if (bestX) {
    // refIndex 0=left,1=centerX,2=right -> offset du coin x : target - offsetWithinWidth
    const offset = bestX.refIndex === 0 ? 0 : bestX.refIndex === 1 ? dragged.width / 2 : dragged.width;
    snapX = bestX.targetRef - offset;
    const ys = [dragged.y, dragged.y + dragged.height, ...others2.flatMap((o) => [o.y, o.y + o.height])];
    guides.push({ axis: "x", pos: bestX.targetRef, from: Math.min(...ys), to: Math.max(...ys) });
  }
  if (bestY) {
    const offset = bestY.refIndex === 0 ? 0 : bestY.refIndex === 1 ? dragged.height / 2 : dragged.height;
    snapY = bestY.targetRef - offset;
    const xs = [dragged.x, dragged.x + dragged.width, ...others2.flatMap((o) => [o.x, o.x + o.width])];
    guides.push({ axis: "y", pos: bestY.targetRef, from: Math.min(...xs), to: Math.max(...xs) });
  }
  return { snapX, snapY, guides };
}
```

- [ ] **Step 4 — run, expect PASS** (3 tests). Adjust the test's expected numbers only if the offset math differs from intent (the impl is the source of truth for the formula; verify by hand: left-snap → snapX = targetLeft; centerX-snap → snapX = targetCenter - w/2; right-snap → snapX = targetRight - w).

- [ ] **Step 5 — commit**
```bash
git add editor/src/features/canvas/alignmentGuides.ts editor/src/features/canvas/alignmentGuides.test.ts
git commit -m "feat(editor): pure alignmentGuides (edge/center snap + guide lines)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6 — Wire alignment guides into node drag

**Files:** Create `editor/src/state/alignmentStore.ts`, `editor/src/features/canvas/useNodeAlignment.ts`, `editor/src/features/canvas/AlignmentGuides.tsx`; Modify `MenuGroup.tsx`/`CommandGroup.tsx`/`DialogGroup.tsx`, `Stage.tsx`; Test `useNodeAlignment.test.ts`.

- [ ] **Step 1 — alignmentStore** (`alignmentStore.ts`)
```ts
import { create } from "zustand";
import type { Guide } from "@/features/canvas/alignmentGuides";
interface AlignmentState { guides: Guide[]; setGuides: (g: Guide[]) => void; clear: () => void; }
export const useAlignmentStore = create<AlignmentState>((set) => ({
  guides: [], setGuides: (guides) => set({ guides }), clear: () => set({ guides: [] }),
}));
```

- [ ] **Step 2 — useNodeAlignment test** (`useNodeAlignment.test.ts`) — test the pure handler logic: given a Konva-like node stub (`{ x(), y(), x(v), y(v) }`), other on-board boxes, and Alt off, dragging near an alignment snaps the node + sets store guides; Alt on = no snap.
```ts
import { describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAlignmentStore } from "@/state/alignmentStore";
import { computeAndApplyAlignment } from "./useNodeAlignment";

const PID = "p1" as PackId;
function seed() {
  useAccountStore.setState({ account: { id: "a" as any, packOrder: [PID], packs: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any,
            { id: "m2", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: { m1: { x: 100, y: 100 }, m2: { x: 104, y: 600 } } as any,
  } as Pack] } } as any);
}
describe("computeAndApplyAlignment", () => {
  it("snappe le nœud et publie des guides (Alt off)", () => {
    seed();
    useAlignmentStore.getState().clear();
    let nx = 104, ny = 600;
    const node = { x: (v?: number) => (v === undefined ? nx : ((nx = v), nx)), y: (v?: number) => (v === undefined ? ny : ((ny = v), ny)) } as any;
    computeAndApplyAlignment(PID, "m2", node, false);
    expect(nx).toBe(100); // aligné sur m1.left (diff 4 <= threshold)
    expect(useAlignmentStore.getState().guides.length).toBeGreaterThan(0);
  });
  it("Alt on → pas de snap ni guide", () => {
    seed(); useAlignmentStore.getState().clear();
    let nx = 104, ny = 600;
    const node = { x: (v?: number) => (v === undefined ? nx : ((nx = v), nx)), y: (v?: number) => (v === undefined ? ny : ((ny = v), ny)) } as any;
    computeAndApplyAlignment(PID, "m2", node, true);
    expect(nx).toBe(104);
    expect(useAlignmentStore.getState().guides).toEqual([]);
  });
});
```

- [ ] **Step 3 — run, expect FAIL**: `cd editor && npx vitest run src/features/canvas/useNodeAlignment.test.ts`

- [ ] **Step 4 — implement `useNodeAlignment.ts`** (export the pure-ish `computeAndApplyAlignment` + a hook returning an `onDragMove`)
```ts
import { useCallback } from "react";
import type Konva from "konva";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAlignmentStore } from "@/state/alignmentStore";
import { alignmentGuides, type Box } from "./alignmentGuides";
import { nodeBox } from "./menuLayout";

const THRESHOLD = 8;

export function computeAndApplyAlignment(
  packId: PackId, selfId: string, node: { x: (v?: number) => number; y: (v?: number) => number }, altKey: boolean,
) {
  const align = useAlignmentStore.getState();
  if (altKey) { align.clear(); return; }
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId);
  if (!pack) return;
  const layout = pack.canvasLayout as Record<string, { x: number; y: number }>;
  const selfBox = nodeBox(pack, selfId, layout);
  if (!selfBox) return;
  const dragged: Box = { x: node.x(), y: node.y(), width: selfBox.width, height: selfBox.height };
  const others: Box[] = [];
  for (const id of Object.keys(layout)) { if (id === selfId) continue; const b = nodeBox(pack, id, layout); if (b) others.push(b); }
  const res = alignmentGuides(dragged, others, THRESHOLD);
  if (res.snapX !== undefined) node.x(res.snapX);
  if (res.snapY !== undefined) node.y(res.snapY);
  align.setGuides(res.guides);
}

export function useNodeAlignment(packId: PackId, selfId: string) {
  const onDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const alt = (e.evt as unknown as { altKey?: boolean }).altKey ?? false;
    computeAndApplyAlignment(packId, selfId, e.target as unknown as { x: (v?: number) => number; y: (v?: number) => number }, alt);
  }, [packId, selfId]);
  return { onDragMove };
}
```

- [ ] **Step 5 — `AlignmentGuides.tsx` overlay**
```tsx
import { Line } from "react-konva";
import { useCssVar } from "@/lib/themeColors";
import { useAlignmentStore } from "@/state/alignmentStore";
export function AlignmentGuides() {
  const guides = useAlignmentStore((s) => s.guides);
  const brand = useCssVar("--brand");
  return (<>{guides.map((g, i) => (
    <Line key={i} points={g.axis === "x" ? [g.pos, g.from, g.pos, g.to] : [g.from, g.pos, g.to, g.pos]}
      stroke={brand} strokeWidth={1} dash={[4, 4]} listening={false} />
  ))}</>);
}
```

- [ ] **Step 6 — wire into nodes + Stage.**
- `MenuGroup` (board root `<Group>`, gated on `!solo`): add `onDragMove`. Get it from `useNodeAlignment(packId, menu.id)` (call the hook at component top). Add to the Group: `onDragMove={solo ? undefined : nodeAlign.onDragMove}`. In `useMenuDrag`'s `onMenuDragEnd` (or the Group's onDragEnd path), call `useAlignmentStore.getState().clear()` after persisting.
- `CommandGroup`/`DialogGroup`: call `useNodeAlignment(packId, command.id/dialog.id)`, add `onDragMove={nodeAlign.onDragMove}` to the root `<Group>`, and add `useAlignmentStore.getState().clear()` to their existing `onDragEnd` (after `setCanvasPosition`).
- `Stage.tsx`: render `<AlignmentGuides />` inside `<Layer name="overlay">`.

- [ ] **Step 7 — run + commit**
```bash
cd editor && npx vitest run src/features/canvas src/state && npx tsc --noEmit
git add editor/src/state/alignmentStore.ts editor/src/features/canvas/useNodeAlignment.ts editor/src/features/canvas/useNodeAlignment.test.ts editor/src/features/canvas/AlignmentGuides.tsx editor/src/features/canvas/MenuGroup.tsx editor/src/features/canvas/CommandGroup.tsx editor/src/features/canvas/DialogGroup.tsx editor/src/features/canvas/Stage.tsx
git commit -m "feat(editor): alignment guides + snapping on node drag (Alt disables)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Documentation (before merge)
`docs/architecture/editor-internals.md` — extend the canvas section: interaction modes (`canvasMode`, toolbar, V/H/Space), marquee selection, alignment guides/snap. CHANGELOG `[Unreleased]` UX line. If >~30 lines → `/sync-docs`.

---

## Self-Review

**Spec coverage:** §A.1 canvasMode → T1; §A.2/A.3 draggable gating + hand short-circuit → T3; §A.4 toolbar → T2; §A.5 hotkeys V/H/Space → T3; §A.6 touch unchanged → no task (untouched); marquee §A.3 → T4 (pure hit-test + hook + rect overlay, intersect, Shift=add); §B alignment → T5 (pure) + T6 (wire onDragMove, snap, guides overlay, Alt disables, clear on dragEnd). Non-goals respected (no distribution guides, grid, touch marquee, placement mode).

**Placeholders:** none. T4 Step 7 offers a fallback test approach (hook-unit vs konva-event sim) with a "report which" — that's a bounded testing-strategy choice, not a placeholder. The alignmentGuides test numbers note "impl is source of truth for the offset formula" — the formula IS given in T5 Step 3.

**Type/name consistency:** `canvasMode`/`setCanvasMode`; `rectIntersectsBoxes`; `alignmentGuides`/`Box`/`Guide`/`AlignResult`; `useAlignmentStore`(`guides`/`setGuides`/`clear`); `useNodeAlignment`/`computeAndApplyAlignment`; `useMarqueeSelection`(`rect`/`onMouseDown`/`onMouseMove`/`onMouseUp`); `MarqueeRect`/`AlignmentGuides`/`CanvasToolbar` — consistent across tasks. `nodeBox`/`screenToWorld`/`selectionStore.set/add` used per their real signatures.
