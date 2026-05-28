# Title Composer UX v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing title composer (SP3+SP4) with a Figma-style focus-mode editor backed by a derived UI layer model, and make the pack canvas render menus in their final form via a shared `TitleRender` component.

**Architecture:** Three phases — (1) build the shared `TitleRender` Konva subtree + UI-layer mapping under the runtime `MenuTitleLayer[]`; (2) swap `MenuGroup`'s single-line title for `TitleRender` mode=compact so the pack canvas mirrors in-game; (3) build the focus-mode composer (`FocusComposer` + `ComposerCanvas` + `LayerSidePanel` + `AddLayerBar`), wire it via `uiStore.titleComposerOpen`, delete the v1 composer files. The runtime contract (plugin + backend) is untouched.

**Tech Stack:** React 19 + Vite 6, Zustand (with `temporal` middleware for undo), Konva via `react-konva`, vitest + @testing-library/react. Editor lives in `editor/`. Spec: `docs/superpowers/specs/2026-05-11-title-composer-ux-v2-design.md`.

---

## Branch / hygiene

- Target branch: continue on `feat/title-composer` (SP3 + SP4 stack).
- The user has standing WIP across the tree that must remain unstaged at every commit:
  - `backend/src/db/schema.ts`
  - `editor/package.json`, `editor/package-lock.json`, `editor/tests/setup.ts`
  - `editor/src/features/export/transform.ts`, `editor/src/features/export/transform.test.ts` (the condition-serialization rewrite)
  - `plugin/src/main/kotlin/net/artisanmc/plugin/engine/BundleCompiler.kt`
  - `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionParser.kt`
  - `plugin/src/main/kotlin/net/artisanmc/plugin/engine/SoftDepRegistry.kt`
  - `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`
  - `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`
  - `plugin/src/test/kotlin/net/artisanmc/plugin/BundleCompilerTest.kt`
  - `plugin/src/test/kotlin/net/artisanmc/plugin/ConditionParserTest.kt`
- **Always use explicit `git add <paths>` per task.** Never `git add -A`.

## File structure overview

### Created
- `editor/src/features/canvas/title/composer/types.ts` — `UiLayer` discriminated union
- `editor/src/features/canvas/title/composer/uiLayerMapping.ts` — `toUiLayers` / `fromUiLayers`
- `editor/src/features/canvas/title/composer/uiLayerMapping.test.ts`
- `editor/src/features/canvas/title/composer/snap.ts` — `snapDragPosition` extracted from `TitleMockup.tsx`
- `editor/src/features/canvas/title/composer/snap.test.ts`
- `editor/src/features/canvas/title/composer/TitleRender.tsx` — shared Konva subtree (compact + edit modes)
- `editor/src/features/canvas/title/composer/TitleRender.test.tsx`
- `editor/src/features/canvas/title/composer/TitleThumbnail.tsx` — HTML preview in MenuProperties
- `editor/src/features/canvas/title/composer/TitleThumbnail.test.tsx`
- `editor/src/features/canvas/title/composer/ComposerCanvas.tsx` — central canvas + drag handlers + OS file drop
- `editor/src/features/canvas/title/composer/ComposerCanvas.test.tsx`
- `editor/src/features/canvas/title/composer/LayerSidePanel.tsx` — context-sensitive right panel
- `editor/src/features/canvas/title/composer/LayerSidePanel.test.tsx`
- `editor/src/features/canvas/title/composer/AddLayerBar.tsx` — buttons + compact layer list (reorder)
- `editor/src/features/canvas/title/composer/AddLayerBar.test.tsx`
- `editor/src/features/canvas/title/composer/FocusComposer.tsx` — top-level container
- `editor/src/features/canvas/title/composer/FocusComposer.test.tsx`

### Modified
- `editor/src/state/uiStore.ts` — add `titleComposerOpen: { packId, menuId } | null` + actions
- `editor/src/features/canvas/MenuGroup.tsx` — replace inline title rendering with `<TitleRender mode="compact">`; redirect title-bar dblclick to `openTitleComposer`
- `editor/src/features/canvas/properties/MenuProperties.tsx` — replace `<TitleComposer>` with `<TitleThumbnail>` + "Edit title…" button
- `editor/src/routes/pack.$packId.tsx` — render `<FocusComposer>` when `titleComposerOpen` matches the current pack

### Deleted
- `editor/src/features/canvas/title/TitleComposer.tsx` + test
- `editor/src/features/canvas/title/TitleMockup.tsx` + test
- `editor/src/features/canvas/title/TitleLayerList.tsx` + test
- `editor/src/features/canvas/title/TitleLayerItem.tsx`
- `editor/src/features/canvas/title/TitleTextEditor.tsx` + test
- `editor/src/features/canvas/TextEditor.tsx` (legacy single-line title editor)
- `editor/src/state/editingStore.ts` (only used by `TextEditor.tsx` — verify and delete if so)

### Kept (re-used in v2)
- `editor/src/features/canvas/title/titleSelectionStore.ts` — same role (selected layer index)
- `editor/src/features/canvas/title/McFontText.tsx` — used by new `TitleRender` for pixel-perfect font rendering
- `editor/src/features/canvas/title/fontGlyphUrl.ts` — used by `McFontText`
- `editor/src/features/canvas/MiniMessageKonvaText.tsx` — used by `TitleRender` for vanilla-font text
- `editor/src/features/assets/AssetPicker.tsx` — opened by AddLayerBar's "+ Image"
- `editor/src/features/assets/AssetUploadDialog.tsx` — opened from the AssetPicker footer for new uploads

---

## Phase 1 — Foundation (no visible UX change)

### Task 1: Extract `snapDragPosition` into `composer/snap.ts`

**Files:**
- Create: `editor/src/features/canvas/title/composer/snap.ts`
- Create: `editor/src/features/canvas/title/composer/snap.test.ts`

The function and its tests already exist inside `TitleMockup.tsx` / `TitleMockup.test.tsx` (SP3 Task 7 added it). Move them out so the new composer can re-use them without depending on the soon-to-be-deleted file.

- [ ] **Step 1: Create `snap.ts` with the helper extracted verbatim from `TitleMockup.tsx`**

```ts
// editor/src/features/canvas/title/composer/snap.ts

/** Slot grid alignment used when Alt is held during a drag (one MC slot = 18 px). */
const SLOT_STEP = 18;

/**
 * Pure helper for the drag-end snap logic. Input: raw stage coords
 * (already in pixel space, i.e. multiplied by scale). Output: domain
 * coords (divided by scale).
 *
 * Modifiers:
 *  - default     → round to nearest whole pixel
 *  - shift       → keep sub-pixel precision (raw / scale, unrounded)
 *  - alt         → snap to multiples of SLOT_STEP (18 MC px)
 *  - alt + shift → alt wins
 */
export function snapDragPosition(
  rawStageX: number,
  rawStageY: number,
  scale: number,
  modifiers: { shift: boolean; alt: boolean },
): { x: number; y: number } {
  const rawX = rawStageX / scale;
  const rawY = rawStageY / scale;
  if (modifiers.alt) {
    return {
      x: Math.round(rawX / SLOT_STEP) * SLOT_STEP,
      y: Math.round(rawY / SLOT_STEP) * SLOT_STEP,
    };
  }
  if (modifiers.shift) {
    return { x: rawX, y: rawY };
  }
  return { x: Math.round(rawX), y: Math.round(rawY) };
}
```

- [ ] **Step 2: Create `snap.test.ts` (copy the 4 test cases from `TitleMockup.test.tsx`)**

```ts
// editor/src/features/canvas/title/composer/snap.test.ts
import { describe, it, expect } from "vitest";
import { snapDragPosition } from "./snap";

describe("snapDragPosition", () => {
  const scale = 2;
  const NONE = { shift: false, alt: false };

  it("default: rounds to nearest integer MC pixel", () => {
    expect(snapDragPosition(20.3, 10.6, scale, NONE)).toEqual({ x: 10, y: 5 });
    expect(snapDragPosition(21.0, 10.0, scale, NONE)).toEqual({ x: 11, y: 5 });
  });

  it("shift: passes raw sub-pixel coords through", () => {
    expect(snapDragPosition(21.0, 11.0, scale, { shift: true, alt: false }))
      .toEqual({ x: 10.5, y: 5.5 });
  });

  it("alt: snaps to multiples of 18 (slot grid)", () => {
    expect(snapDragPosition(36, 36, scale, { shift: false, alt: true }))
      .toEqual({ x: 18, y: 18 });
    expect(snapDragPosition(0, 70, scale, { shift: false, alt: true }))
      .toEqual({ x: 0, y: 36 });
  });

  it("alt wins over shift", () => {
    expect(snapDragPosition(36, 36, scale, { shift: true, alt: true }))
      .toEqual({ x: 18, y: 18 });
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/snap
```

Expected: 4/4 pass.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/canvas/title/composer/snap.ts editor/src/features/canvas/title/composer/snap.test.ts
git commit -m "refactor(editor): extract snapDragPosition into composer/snap.ts"
```

Note: `TitleMockup.tsx` still has its own copy. Don't delete it yet — that file is deleted as a whole in Task 14, and removing just the helper would break the file in between.

---

### Task 2: UI layer types + mapping

**Files:**
- Create: `editor/src/features/canvas/title/composer/types.ts`
- Create: `editor/src/features/canvas/title/composer/uiLayerMapping.ts`
- Create: `editor/src/features/canvas/title/composer/uiLayerMapping.test.ts`

- [ ] **Step 1: Define the `UiLayer` discriminated union**

```ts
// editor/src/features/canvas/title/composer/types.ts
import type { AssetId, LText } from "@/domain/types";
import type { MenuTitleLayer } from "@/domain/types";

/**
 * Editor-only view model for title layers. Decouples the UX from the
 * runtime `MenuTitleLayer` kinds (background/glyph/text/external_glyph).
 *
 * - `image` collapses runtime `background` + `glyph` into one user-facing concept:
 *   an image somewhere in the title. `stretchToChest === true` means it
 *   covers the full chest (runtime `background`); otherwise it's a positioned
 *   glyph with explicit x/y.
 * - `text` mirrors runtime text minus the deprecated `color` field; coloring
 *   is expressed via MiniMessage tags inside the LText value.
 * - `external` is a passthrough for runtime `external_glyph` layers (Sub-project 5).
 *   No editable side panel; rendered as a dashed placeholder.
 */
export type UiLayer =
  | { kind: "image"; assetId: AssetId; x: number; y: number; stretchToChest: boolean }
  | { kind: "text"; value: LText; x: number; y: number; fontAssetId?: AssetId }
  | { kind: "external"; layer: Extract<MenuTitleLayer, { kind: "external_glyph" }> };
```

- [ ] **Step 2: Write the failing mapping tests**

```ts
// editor/src/features/canvas/title/composer/uiLayerMapping.test.ts
import { describe, it, expect } from "vitest";
import type { AssetId, I18nKey, MenuTitleLayer } from "@/domain/types";
import { toUiLayers, fromUiLayers } from "./uiLayerMapping";

const A = (s: string) => s as AssetId;
const K = (s: string) => s as I18nKey;

describe("toUiLayers", () => {
  it("background → image with stretchToChest=true and x=0,y=0", () => {
    const runtime: MenuTitleLayer[] = [{ kind: "background", assetId: A("a1") }];
    expect(toUiLayers(runtime)).toEqual([
      { kind: "image", assetId: A("a1"), x: 0, y: 0, stretchToChest: true },
    ]);
  });

  it("glyph → image with stretchToChest=false", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "glyph", assetId: A("g1"), x: 10, y: 4 },
    ];
    expect(toUiLayers(runtime)).toEqual([
      { kind: "image", assetId: A("g1"), x: 10, y: 4, stretchToChest: false },
    ]);
  });

  it("text → text (drops color, keeps fontAssetId)", () => {
    const runtime: MenuTitleLayer[] = [
      {
        kind: "text",
        value: { key: K("greeting") },
        x: 8,
        y: 5,
        fontAssetId: A("f1"),
        color: "#ffaa00",
      },
    ];
    const ui = toUiLayers(runtime);
    expect(ui).toHaveLength(1);
    expect(ui[0]).toMatchObject({
      kind: "text",
      x: 8,
      y: 5,
      fontAssetId: A("f1"),
    });
    expect((ui[0] as { kind: "text" }).value.key).toBe(K("greeting"));
  });

  it("external_glyph → external passthrough", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 4, y: 4 },
    ];
    const ui = toUiLayers(runtime);
    expect(ui[0]).toEqual({
      kind: "external",
      layer: { kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 4, y: 4 },
    });
  });

  it("preserves layer order", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "background", assetId: A("a") },
      { kind: "glyph", assetId: A("g"), x: 1, y: 1 },
      { kind: "text", value: { key: K("t") }, x: 2, y: 2 },
    ];
    expect(toUiLayers(runtime).map((l) => l.kind)).toEqual(["image", "image", "text"]);
  });
});

describe("fromUiLayers", () => {
  it("image stretchToChest=true → background (discards x/y)", () => {
    const ui = [
      { kind: "image" as const, assetId: A("a"), x: 99, y: 99, stretchToChest: true },
    ];
    expect(fromUiLayers(ui)).toEqual([{ kind: "background", assetId: A("a") }]);
  });

  it("image stretchToChest=false → glyph with x/y", () => {
    const ui = [
      { kind: "image" as const, assetId: A("g"), x: 10, y: 4, stretchToChest: false },
    ];
    expect(fromUiLayers(ui)).toEqual([{ kind: "glyph", assetId: A("g"), x: 10, y: 4 }]);
  });

  it("text → text with color=undefined", () => {
    const ui = [
      { kind: "text" as const, value: { key: K("g") }, x: 8, y: 5, fontAssetId: A("f") },
    ];
    expect(fromUiLayers(ui)).toEqual([
      { kind: "text", value: { key: K("g") }, x: 8, y: 5, fontAssetId: A("f"), color: undefined },
    ]);
  });

  it("external → original layer preserved", () => {
    const runtime: MenuTitleLayer = {
      kind: "external_glyph",
      provider: "oraxen",
      glyphName: "coin",
      x: 4,
      y: 4,
    };
    expect(fromUiLayers([{ kind: "external", layer: runtime }])).toEqual([runtime]);
  });
});

describe("round-trip", () => {
  it("all four kinds round-trip", () => {
    const runtime: MenuTitleLayer[] = [
      { kind: "background", assetId: A("bg") },
      { kind: "glyph", assetId: A("g"), x: 10, y: 4 },
      { kind: "text", value: { key: K("t") }, x: 8, y: 5 },
      { kind: "external_glyph", provider: "nexo", glyphName: "x", x: 1, y: 1 },
    ];
    const ui = toUiLayers(runtime);
    const back = fromUiLayers(ui);
    // text round-trips with color: undefined (intentional)
    expect(back).toEqual([
      { kind: "background", assetId: A("bg") },
      { kind: "glyph", assetId: A("g"), x: 10, y: 4 },
      { kind: "text", value: { key: K("t") }, x: 8, y: 5, fontAssetId: undefined, color: undefined },
      { kind: "external_glyph", provider: "nexo", glyphName: "x", x: 1, y: 1 },
    ]);
  });

  it("text with legacy color folds into LText value on read", () => {
    // The spec calls for a migration: text { value: {key: 'g'}, color: '#ff0000' }
    // becomes text { value: {key: 'g'}, color: undefined } AND signals a migration
    // hint that the caller (composer) applies to the LText string at i18n level.
    //
    // For unit test scope: just verify color is stripped from the UI layer.
    // The actual string folding happens at the next layer up (see Task 11).
    const runtime: MenuTitleLayer[] = [
      { kind: "text", value: { key: K("t") }, x: 0, y: 0, color: "#ff0000" },
    ];
    const ui = toUiLayers(runtime);
    expect(ui[0]).not.toHaveProperty("color");
  });
});
```

- [ ] **Step 3: Run the test (should fail — implementation missing)**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/uiLayerMapping
```

Expected: FAIL with "Cannot find module './uiLayerMapping'".

- [ ] **Step 4: Implement the mapping**

```ts
// editor/src/features/canvas/title/composer/uiLayerMapping.ts
import type { MenuTitleLayer } from "@/domain/types";
import type { UiLayer } from "./types";

export function toUiLayers(layers: MenuTitleLayer[]): UiLayer[] {
  return layers.map((l): UiLayer => {
    switch (l.kind) {
      case "background":
        return { kind: "image", assetId: l.assetId, x: 0, y: 0, stretchToChest: true };
      case "glyph":
        return { kind: "image", assetId: l.assetId, x: l.x, y: l.y, stretchToChest: false };
      case "text":
        // color is intentionally dropped (deprecated). fontAssetId passes through.
        return { kind: "text", value: l.value, x: l.x, y: l.y, fontAssetId: l.fontAssetId };
      case "external_glyph":
        return { kind: "external", layer: l };
    }
  });
}

export function fromUiLayers(ui: UiLayer[]): MenuTitleLayer[] {
  return ui.map((u): MenuTitleLayer => {
    switch (u.kind) {
      case "image":
        return u.stretchToChest
          ? { kind: "background", assetId: u.assetId }
          : { kind: "glyph", assetId: u.assetId, x: u.x, y: u.y };
      case "text":
        return {
          kind: "text",
          value: u.value,
          x: u.x,
          y: u.y,
          fontAssetId: u.fontAssetId,
          color: undefined,
        };
      case "external":
        return u.layer;
    }
  });
}
```

- [ ] **Step 5: Run tests, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/uiLayerMapping
```

Expected: 9/9 pass.

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/title/composer/types.ts editor/src/features/canvas/title/composer/uiLayerMapping.ts editor/src/features/canvas/title/composer/uiLayerMapping.test.ts
git commit -m "feat(editor): UI layer model + runtime layer mapping"
```

---

### Task 3: `TitleRender` shared Konva subtree

**Files:**
- Create: `editor/src/features/canvas/title/composer/TitleRender.tsx`
- Create: `editor/src/features/canvas/title/composer/TitleRender.test.tsx`

This is the most important component in v2. It's used by `MenuGroup` (compact mode) and by `ComposerCanvas` (edit mode). The rendering must match in-game pixel for pixel for the layers it draws.

The component takes the runtime `MenuTitleLayer[]` (not UiLayer) — it's a pure renderer. The UI-layer mapping is for editing semantics; rendering doesn't need the indirection.

- [ ] **Step 1: Write the failing tests**

```tsx
// editor/src/features/canvas/title/composer/TitleRender.test.tsx
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AssetId, I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { TitleRender } from "./TitleRender";

vi.mock("react-konva", () => ({
  Stage: ({ children, width, height }: any) => (
    <div data-testid="stage" data-width={width} data-height={height}>{children}</div>
  ),
  Layer: ({ children }: any) => <div data-testid="layer">{children}</div>,
  Rect: (props: any) => <div data-testid="rect" data-fill={props.fill} data-x={props.x} data-y={props.y} data-width={props.width} data-height={props.height} />,
  Group: ({ children, onClick, draggable, x, y, ...rest }: any) => (
    <div data-testid="group" data-x={x} data-y={y} data-draggable={draggable} onClick={onClick}>{children}</div>
  ),
  Text: (props: any) => <div data-testid="konva-text" data-text={props.text} />,
  Image: (props: any) => <div data-testid="konva-image" data-x={props.x} data-y={props.y} data-width={props.width} data-height={props.height} />,
}));
vi.mock("use-image", () => ({ default: () => [{ src: "fake://img" } as any, "loaded"] }));
vi.mock("../../MiniMessageKonvaText", () => ({
  MiniMessageKonvaText: (props: any) => (
    <div data-testid="mm-text" data-source={props.source} data-x={props.x} data-y={props.y} />
  ),
}));
vi.mock("../McFontText", () => ({
  McFontText: (props: any) => <div data-testid="mc-font-text" data-text={props.text} />,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const A = (s: string) => s as AssetId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [
        {
          id: PACK_ID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          menus: [
            {
              id: MENU_ID,
              packId: PACK_ID,
              title: layers,
              rows: 3,
              layers: [],
            },
          ],
          commands: [],
          templates: [],
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys: { [K("greeting")]: { en: "Hello" } },
          defaultLang: "en",
          dialogs: [],
          canvasLayout: {},
        },
      ],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useAssetStore.setState({ assets: [], selectedId: null, loading: false, error: null } as any);
});

describe("TitleRender", () => {
  it("renders the title-bar grey backdrop", () => {
    seedPack([]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="compact" />,
    );
    const rects = getAllByTestId("rect");
    const backdrop = rects.find((r) => r.getAttribute("data-fill") === "#3f3f3f");
    expect(backdrop).toBeTruthy();
  });

  it("renders one Group per layer", () => {
    seedPack([
      { kind: "background", assetId: A("bg") },
      { kind: "glyph", assetId: A("g"), x: 10, y: 4 },
      { kind: "text", value: { key: K("greeting") }, x: 8, y: 5 },
    ]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="compact" />,
    );
    expect(getAllByTestId("group")).toHaveLength(3);
  });

  it("text layer without fontAssetId uses MiniMessageKonvaText", () => {
    seedPack([{ kind: "text", value: { key: K("greeting") }, x: 0, y: 0 }]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="compact" />,
    );
    const mm = getAllByTestId("mm-text");
    expect(mm[0]?.getAttribute("data-source")).toBe("Hello");
  });

  it("text layer with fontAssetId in store uses McFontText", () => {
    useAssetStore.setState({
      assets: [{
        id: A("f1"), serverKeyId: "sk", type: "font", name: "myfont", width: 0, height: 0,
        ascent: null, codepoint: null,
        fontMeta: { namespace: "artisan:myfont", glyphMap: [] },
        contentHash: "h", createdAt: "", updatedAt: "",
      }],
    } as any);
    seedPack([{ kind: "text", value: { key: K("greeting") }, x: 0, y: 0, fontAssetId: A("f1") }]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="compact" />,
    );
    expect(getAllByTestId("mc-font-text")[0]?.getAttribute("data-text")).toBe("Hello");
  });

  it("compact mode: groups are NOT draggable", () => {
    seedPack([{ kind: "glyph", assetId: A("g"), x: 10, y: 4 }]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="compact" />,
    );
    expect(getAllByTestId("group")[0]?.getAttribute("data-draggable")).toBe("false");
  });

  it("edit mode: groups ARE draggable (except background)", () => {
    seedPack([
      { kind: "background", assetId: A("bg") },
      { kind: "glyph", assetId: A("g"), x: 10, y: 4 },
    ]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="edit" onLayerClick={() => {}} />,
    );
    const groups = getAllByTestId("group");
    expect(groups[0]?.getAttribute("data-draggable")).toBe("false"); // bg
    expect(groups[1]?.getAttribute("data-draggable")).toBe("true");  // glyph
  });

  it("edit mode: clicking a Group fires onLayerClick with the layer index", () => {
    const onLayerClick = vi.fn();
    seedPack([
      { kind: "glyph", assetId: A("g1"), x: 0, y: 0 },
      { kind: "glyph", assetId: A("g2"), x: 0, y: 0 },
    ]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="edit" onLayerClick={onLayerClick} />,
    );
    fireEvent.click(getAllByTestId("group")[1]!);
    expect(onLayerClick).toHaveBeenCalledWith(1);
  });

  it("background layer positions at y=MC_TITLE_H*scale (below title bar)", () => {
    seedPack([{ kind: "background", assetId: A("bg") }]);
    const { getAllByTestId } = render(
      <TitleRender packId={PACK_ID} menuId={MENU_ID} scale={2} mode="compact" />,
    );
    // MC_TITLE_H = 17, scale = 2 → 34
    const bgGroup = getAllByTestId("group")[0];
    expect(bgGroup?.getAttribute("data-y")).toBe("34");
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/TitleRender
```

Expected: FAIL with "Cannot find module './TitleRender'".

- [ ] **Step 3: Implement `TitleRender`**

```tsx
// editor/src/features/canvas/title/composer/TitleRender.tsx
import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import type { MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import { MC_BOTTOM_H, MC_SLOT_STRIDE, MC_TITLE_H, TEX_SCALE } from "../../menuLayout";
import { MiniMessageKonvaText } from "../../MiniMessageKonvaText";
import { McFontText } from "../McFontText";
import { snapDragPosition } from "./snap";

/** Vanilla title bar width in MC pixels. */
const TITLE_BAR_W = 176;
/** Baseline offset within the title bar — MC's default font ascent is ~7 px. */
const BASELINE_Y_PX = 7;

interface TitleRenderProps {
  packId: PackId;
  menuId: MenuId;
  scale: number;
  mode: "compact" | "edit";
  selectedIndex?: number;
  onLayerClick?: (index: number) => void;
  onLayerDragEnd?: (index: number, x: number, y: number) => void;
}

export function TitleRender({
  packId,
  menuId,
  scale,
  mode,
  selectedIndex,
  onLayerClick,
  onLayerDragEnd,
}: TitleRenderProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);
  if (!pack || !menu) return null;

  const title = menu.title;
  const hasBackground = title.some((l) => l.kind === "background");

  return (
    <>
      <Rect
        x={0}
        y={0}
        width={TITLE_BAR_W * scale}
        height={MC_TITLE_H * scale}
        fill="#3f3f3f"
        listening={false}
      />
      {title.map((layer, idx) => {
        const asset =
          layer.kind === "background" || layer.kind === "glyph"
            ? assets.find((a) => a.id === layer.assetId)
            : undefined;
        const fontAsset =
          layer.kind === "text" && layer.fontAssetId
            ? assets.find((a) => a.id === layer.fontAssetId)
            : undefined;
        const text =
          layer.kind === "text" && pack ? getText(pack, layer.value, activeLang) : "";

        return (
          <LayerNode
            key={idx}
            layer={layer}
            index={idx}
            scale={scale}
            mode={mode}
            asset={asset}
            fontAsset={fontAsset}
            text={text}
            selected={selectedIndex === idx}
            hasBackground={hasBackground}
            onLayerClick={onLayerClick}
            onLayerDragEnd={onLayerDragEnd}
          />
        );
      })}
    </>
  );
}

interface LayerNodeProps {
  layer: MenuTitleLayer;
  index: number;
  scale: number;
  mode: "compact" | "edit";
  asset?: Asset;
  fontAsset?: Asset;
  text: string;
  selected: boolean;
  hasBackground: boolean;
  onLayerClick?: (index: number) => void;
  onLayerDragEnd?: (index: number, x: number, y: number) => void;
}

function LayerNode({
  layer, index, scale, mode, asset, fontAsset, text, selected, hasBackground,
  onLayerClick, onLayerDragEnd,
}: LayerNodeProps) {
  const [image] = useImage(asset ? assetPreviewUrl(asset) : "");

  // Group position — background pins below the title bar; others use layer.x/y.
  const groupX = layer.kind === "background" ? 0 : (("x" in layer) ? layer.x : 0) * scale;
  const groupY =
    layer.kind === "background"
      ? MC_TITLE_H * scale
      : (("y" in layer) ? layer.y : 0) * scale;

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (mode !== "edit") return;
      if (layer.kind === "background") return;
      const evt = e.evt as DragEvent & { shiftKey: boolean; altKey: boolean };
      const snapped = snapDragPosition(e.target.x(), e.target.y(), scale, {
        shift: Boolean(evt.shiftKey),
        alt: Boolean(evt.altKey),
      });
      e.target.position({ x: snapped.x * scale, y: snapped.y * scale });
      onLayerDragEnd?.(index, snapped.x, snapped.y);
    },
    [mode, layer.kind, scale, index, onLayerDragEnd],
  );

  // Per-kind body.
  let body: React.ReactNode = null;
  if (layer.kind === "background" || layer.kind === "glyph") {
    const w = (asset?.width ?? (layer.kind === "background" ? TITLE_BAR_W : 8)) * scale;
    const h = (asset?.height ?? (layer.kind === "background" ? MC_TITLE_H : 8)) * scale;
    body = image ? (
      <KonvaImage image={image} x={0} y={0} width={w} height={h} listening={false} />
    ) : (
      <Rect width={w} height={h} fill="rgba(120,120,120,0.4)" listening={false} />
    );
  } else if (layer.kind === "text") {
    body = fontAsset ? (
      <McFontText text={text} font={fontAsset} x={0} y={BASELINE_Y_PX * scale} scale={scale} />
    ) : (
      <MiniMessageKonvaText
        source={text}
        x={0}
        y={0}
        fontSize={BASELINE_Y_PX * scale}
        defaultColor="#404040"
      />
    );
  } else {
    // external_glyph — dashed amber placeholder (until SP5)
    body = (
      <>
        <Rect width={10 * scale} height={10 * scale} fill="rgba(245,158,11,0.15)"
              stroke="#f59e0b" strokeWidth={1} dash={[2, 2]} listening={false} />
        <Text x={2} y={2} text={`${layer.provider}:${layer.glyphName}`}
              fontSize={6} fill="#f59e0b" listening={false} />
      </>
    );
  }

  const interactive = mode === "edit" && layer.kind !== "background";

  return (
    <Group
      x={groupX}
      y={groupY}
      draggable={interactive}
      listening={mode === "edit"}
      onClick={mode === "edit" ? () => onLayerClick?.(index) : undefined}
      onTap={mode === "edit" ? () => onLayerClick?.(index) : undefined}
      onDragEnd={handleDragEnd}
    >
      {body}
      {selected ? (
        <Rect
          x={-1}
          y={-1}
          width={
            layer.kind === "background" || layer.kind === "glyph"
              ? (asset?.width ?? (layer.kind === "background" ? TITLE_BAR_W : 8)) * scale + 2
              : layer.kind === "external_glyph"
                ? 10 * scale + 2
                : Math.max(text.length * 4 * scale, 8) + 2
          }
          height={
            layer.kind === "background" || layer.kind === "glyph"
              ? (asset?.height ?? (layer.kind === "background" ? MC_TITLE_H : 8)) * scale + 2
              : layer.kind === "external_glyph"
                ? 10 * scale + 2
                : 7 * scale + 2
          }
          stroke="#22c55e"
          strokeWidth={1}
          fill="transparent"
          listening={false}
        />
      ) : null}
    </Group>
  );
}

/**
 * Compute the stage height needed to display this menu's title.
 * When a background layer is present we extend the stage below the title bar
 * to show the chest body.
 *
 * Caller: typically passes this to a parent Stage's `height` prop.
 */
export function titleRenderHeight(menu: { rows: number; title: MenuTitleLayer[] }, scale: number): number {
  const hasBackground = menu.title.some((l) => l.kind === "background");
  if (!hasBackground) return MC_TITLE_H * scale;
  return (MC_TITLE_H + menu.rows * MC_SLOT_STRIDE + MC_BOTTOM_H) * scale;
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/TitleRender
```

Expected: 7/7 pass.

- [ ] **Step 5: Confirm full editor suite is unchanged**

```bash
cd editor && npx vitest run
```

Expected: all pre-existing pass count remains green (baseline 519 from SP4).

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/title/composer/TitleRender.tsx editor/src/features/canvas/title/composer/TitleRender.test.tsx
git commit -m "feat(editor): TitleRender shared Konva subtree (compact + edit modes)"
```

---

### Task 4: `uiStore.titleComposerOpen` state + actions

**Files:**
- Modify: `editor/src/state/uiStore.ts`

The focus-mode toggle is a pair of (packId, menuId) stored in the UI store. Two actions: `openTitleComposer(packId, menuId)` and `closeTitleComposer()`.

- [ ] **Step 1: Read the current uiStore to understand conventions**

```bash
cat editor/src/state/uiStore.ts | head -60
```

Note the existing state shape and action naming (look for `setEditorTab`, `setActiveDragMaterial`, etc.).

- [ ] **Step 2: Add the state + actions**

Find the `UiState` interface in the file. Add:

```ts
titleComposerOpen: { packId: PackId; menuId: MenuId } | null;
openTitleComposer: (packId: PackId, menuId: MenuId) => void;
closeTitleComposer: () => void;
```

In the `create<UiState>()` initial-state object, add:

```ts
titleComposerOpen: null,
openTitleComposer: (packId, menuId) => set({ titleComposerOpen: { packId, menuId } }),
closeTitleComposer: () => set({ titleComposerOpen: null }),
```

Import `PackId`, `MenuId` from `@/domain/types` if not already present.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd editor && npx tsc --noEmit 2>&1 | grep "uiStore"
```

Expected: no errors mentioning `uiStore.ts`. Pre-existing errors in unrelated files are OK.

- [ ] **Step 4: Commit**

```bash
git add editor/src/state/uiStore.ts
git commit -m "feat(editor): uiStore titleComposerOpen flag + actions"
```

---

## Phase 2 — MenuGroup integration (pack canvas shows final form)

### Task 5: MenuGroup uses `<TitleRender mode="compact">`

**Files:**
- Modify: `editor/src/features/canvas/MenuGroup.tsx`

Replace the inline `MiniMessageKonvaText` title rendering with `TitleRender`. Redirect the title-bar dblclick from `useEditingStore.setEditing` to `useUiStore.openTitleComposer`.

- [ ] **Step 1: Replace the title rendering block**

In `MenuGroup.tsx`, find the block (lines ~710 currently):

```tsx
<MiniMessageKonvaText
  source={pack ? renderPreview(getText(pack, lt, activeLang), enhancedCtx, pack, activeLang) : ""}
  x={TEX_FIRST_SLOT_X + 1}
  y={5 * TEX_SCALE}
  fontSize={7 * TEX_SCALE}
  defaultColor="#404040"
/>
```

Replace with:

```tsx
<TitleRender
  packId={packId}
  menuId={menu.id}
  scale={TEX_SCALE}
  mode="compact"
/>
```

Remove the now-unused `getFirstTitleText` import + the IIFE that resolved the LText.

Add the import:

```tsx
import { TitleRender } from "./title/composer/TitleRender";
```

- [ ] **Step 2: Update the dblclick handler**

Find:

```tsx
const onTitleDblClick = useCallback(
  (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    useEditingStore.getState().setEditing(menu.id);
  },
  [menu.id],
);
```

Replace with:

```tsx
const openComposer = useUiStore((s) => s.openTitleComposer);
const onTitleDblClick = useCallback(
  (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    openComposer(packId, menu.id);
  },
  [openComposer, packId, menu.id],
);
```

Remove the `useEditingStore` import if it's not used elsewhere in the file. (It probably isn't — `useEditingStore` was only for the legacy TextEditor.)

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run
```

Expected: green. There's a chance a MenuGroup-related test breaks if anything asserted on the old MiniMessageKonvaText output. Update assertions if needed.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/canvas/MenuGroup.tsx
git commit -m "feat(editor): MenuGroup renders title via TitleRender (final-form pack canvas)"
```

---

## Phase 3 — Focus composer

### Task 6: `TitleThumbnail` (HTML, no Konva)

**Files:**
- Create: `editor/src/features/canvas/title/composer/TitleThumbnail.tsx`
- Create: `editor/src/features/canvas/title/composer/TitleThumbnail.test.tsx`

A small HTML preview shown inside `MenuProperties` next to the "Edit title…" button. Use HTML/CSS instead of Konva because the parent is a regular DOM panel; mounting a Konva Stage in a side panel is overkill.

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/features/canvas/title/composer/TitleThumbnail.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { TitleThumbnail } from "./TitleThumbnail";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [
        {
          id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
          menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
          commands: [], templates: [], assets: [], dataSources: [],
          importedConnectors: [], i18nKeys: { [K("g")]: { en: "Hello" } },
          defaultLang: "en", dialogs: [], canvasLayout: {},
        },
      ],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => seedPack([]));

describe("TitleThumbnail", () => {
  it("renders empty state when title is empty", () => {
    seedPack([]);
    const { getByText } = render(<TitleThumbnail packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByText(/no title/i)).toBeTruthy();
  });

  it("renders the resolved text content for the first text layer", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    const { getByText } = render(<TitleThumbnail packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByText("Hello")).toBeTruthy();
  });

  it("renders a count badge when multiple non-text layers exist", () => {
    seedPack([
      { kind: "glyph", assetId: "a" as any, x: 0, y: 0 },
      { kind: "glyph", assetId: "b" as any, x: 0, y: 0 },
      { kind: "text", value: { key: K("g") }, x: 0, y: 0 },
    ]);
    const { getByText } = render(<TitleThumbnail packId={PACK_ID} menuId={MENU_ID} />);
    // 3 total → "3 layers" badge
    expect(getByText(/3 layers/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/TitleThumbnail
```

Expected: FAIL.

- [ ] **Step 3: Implement `TitleThumbnail`**

```tsx
// editor/src/features/canvas/title/composer/TitleThumbnail.tsx
import type { PackId, MenuId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

interface TitleThumbnailProps {
  packId: PackId;
  menuId: MenuId;
}

export function TitleThumbnail({ packId, menuId }: TitleThumbnailProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const activeLang = useUiStore((s) => s.activeLang);
  if (!pack || !menu) return null;

  if (menu.title.length === 0) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px] text-zinc-500">
        No title
      </div>
    );
  }

  const firstText = menu.title.find((l) => l.kind === "text");
  const text = firstText && firstText.kind === "text"
    ? getText(pack, firstText.value, activeLang)
    : "";

  return (
    <div className="flex items-center gap-2 rounded border border-zinc-800 bg-[#3f3f3f] px-2 py-1.5">
      {text ? (
        <MiniMessageInline source={text} className="font-mono text-xs text-zinc-200" />
      ) : (
        <span className="font-mono text-xs text-zinc-500">(no text)</span>
      )}
      {menu.title.length > 1 && (
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
          {menu.title.length} layers
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/TitleThumbnail
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/title/composer/TitleThumbnail.tsx editor/src/features/canvas/title/composer/TitleThumbnail.test.tsx
git commit -m "feat(editor): TitleThumbnail HTML preview for properties panel"
```

---

### Task 7: `ComposerCanvas` — central canvas + drag dispatch

**Files:**
- Create: `editor/src/features/canvas/title/composer/ComposerCanvas.tsx`
- Create: `editor/src/features/canvas/title/composer/ComposerCanvas.test.tsx`

Wraps `TitleRender` in a Konva `Stage`/`Layer`, sized to `titleRenderHeight(menu, scale)`. Handles drag-end → mapping → accountStore dispatch. Adds an OS-file drop zone (drag-over highlight + drop handler that uploads + adds layer).

- [ ] **Step 1: Write failing tests**

```tsx
// editor/src/features/canvas/title/composer/ComposerCanvas.test.tsx
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { ComposerCanvas } from "./ComposerCanvas";

vi.mock("react-konva", () => ({
  Stage: ({ children, width, height }: any) => (
    <div data-testid="stage" data-width={width} data-height={height}>{children}</div>
  ),
  Layer: ({ children }: any) => <div data-testid="layer">{children}</div>,
}));
vi.mock("./TitleRender", () => ({
  TitleRender: (props: any) => (
    <div
      data-testid="title-render"
      data-mode={props.mode}
      data-selected={props.selectedIndex ?? "null"}
      onClick={() => props.onLayerClick?.(0)}
    />
  ),
  titleRenderHeight: () => 100,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [{
        id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
        menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
        commands: [], templates: [], assets: [], dataSources: [],
        importedConnectors: [], i18nKeys: { [K("g")]: { en: "Hello" } },
        defaultLang: "en", dialogs: [], canvasLayout: {},
      }],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  seedPack([]);
});

describe("ComposerCanvas", () => {
  it("renders the TitleRender in edit mode", () => {
    const { getByTestId } = render(<ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByTestId("title-render").getAttribute("data-mode")).toBe("edit");
  });

  it("passes selectedIndex from titleSelectionStore", () => {
    useTitleSelectionStore.getState().setSelectedIndex(2);
    const { getByTestId } = render(<ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByTestId("title-render").getAttribute("data-selected")).toBe("2");
  });

  it("clicking a layer updates the selection store", () => {
    const { getByTestId } = render(<ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(getByTestId("title-render"));
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(0);
  });

  it("Stage height comes from titleRenderHeight (mocked to 100)", () => {
    const { getByTestId } = render(<ComposerCanvas packId={PACK_ID} menuId={MENU_ID} />);
    expect(getByTestId("stage").getAttribute("data-height")).toBe("100");
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/ComposerCanvas
```

Expected: FAIL.

- [ ] **Step 3: Implement `ComposerCanvas`**

```tsx
// editor/src/features/canvas/title/composer/ComposerCanvas.tsx
import type { MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useCallback } from "react";
import { Layer, Stage } from "react-konva";
import { TEX_SCALE } from "../../menuLayout";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { TitleRender, titleRenderHeight } from "./TitleRender";

const TITLE_BAR_W = 176;

interface ComposerCanvasProps {
  packId: PackId;
  menuId: MenuId;
}

export function ComposerCanvas({ packId, menuId }: ComposerCanvasProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);

  const onLayerDragEnd = useCallback(
    (index: number, x: number, y: number) => {
      const layer = menu?.title[index];
      if (!layer || layer.kind === "background") return;
      updateLayer({
        packId,
        menuId,
        index,
        patch: { x, y } as Partial<Extract<MenuTitleLayer, { x: number; y: number }>>,
      });
    },
    [menu, packId, menuId, updateLayer],
  );

  if (!menu) return null;

  const height = titleRenderHeight(menu, TEX_SCALE);
  return (
    <Stage width={TITLE_BAR_W * TEX_SCALE} height={height}>
      <Layer>
        <TitleRender
          packId={packId}
          menuId={menuId}
          scale={TEX_SCALE}
          mode="edit"
          selectedIndex={selectedIndex ?? undefined}
          onLayerClick={setSelected}
          onLayerDragEnd={onLayerDragEnd}
        />
      </Layer>
    </Stage>
  );
}
```

(OS-file drop and keyboard handlers are added in Task 11 via the parent `FocusComposer`. Keeping `ComposerCanvas` focused on canvas mechanics only.)

- [ ] **Step 4: Run tests, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/ComposerCanvas
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/title/composer/ComposerCanvas.tsx editor/src/features/canvas/title/composer/ComposerCanvas.test.tsx
git commit -m "feat(editor): ComposerCanvas central drag+selection surface"
```

---

### Task 8: `LayerSidePanel` — text branch

**Files:**
- Create: `editor/src/features/canvas/title/composer/LayerSidePanel.tsx`
- Create: `editor/src/features/canvas/title/composer/LayerSidePanel.test.tsx`

The right panel that shows the selected layer's properties. This task implements only the text branch + empty state. Image + external branches come in Task 9.

- [ ] **Step 1: Write the failing tests**

```tsx
// editor/src/features/canvas/title/composer/LayerSidePanel.test.tsx
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { LayerSidePanel } from "./LayerSidePanel";

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [{
        id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
        menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
        commands: [], templates: [], assets: [], dataSources: [],
        importedConnectors: [], i18nKeys: { [K("g")]: { en: "Hello" } },
        defaultLang: "en", dialogs: [], canvasLayout: {},
      }],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  seedPack([]);
});

describe("LayerSidePanel — empty state", () => {
  it("renders no-selection hint when no layer is selected", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/no layer selected/i)).toBeTruthy();
  });
});

describe("LayerSidePanel — text branch", () => {
  beforeEach(() => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 8, y: 5 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
  });

  it("renders the textarea with the current LText value", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const textarea = screen.getByLabelText(/text \(minimessage\)/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello");
  });

  it("typing into the textarea writes to setI18nValue", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const textarea = screen.getByLabelText(/text \(minimessage\)/i);
    fireEvent.change(textarea, { target: { value: "<gold>Hi</gold>" } });
    const updated = useAccountStore.getState().account.packs[0]!.i18nKeys[K("g")]!.en;
    expect(updated).toBe("<gold>Hi</gold>");
  });

  it("renders MiniMessageInline preview of the current value", () => {
    seedPack([{ kind: "text", value: { key: K("g") }, x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    const { container } = render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    // MiniMessageInline renders inline HTML — just check the panel contains "Hello"
    expect(container.textContent).toContain("Hello");
  });

  it("position x/y inputs reflect layer.x/y and dispatch on change", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const xInput = screen.getByLabelText(/x/i) as HTMLInputElement;
    expect(xInput.value).toBe("8");
    fireEvent.change(xInput, { target: { value: "12" } });
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((updated as Extract<MenuTitleLayer, { kind: "text" }>).x).toBe(12);
  });

  it("Delete button removes the layer", () => {
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(0);
  });

  it("Font dropdown lists font assets + 'vanilla' entry, switches fontAssetId", () => {
    // pre-seed a font asset
    useAccountStore.setState((s) => ({
      account: {
        ...s.account,
        packs: s.account.packs.map((p) => ({ ...p })),
      },
    } as any));
    // ... using useAssetStore directly is cleaner
    const { useAssetStore } = require("@/features/assets/assetStore");
    useAssetStore.setState({
      assets: [{
        id: "f1" as any, serverKeyId: "sk", type: "font", name: "myfont",
        width: 0, height: 0, ascent: null, codepoint: null,
        fontMeta: { namespace: "artisan:myfont", glyphMap: [] },
        contentHash: "h", createdAt: "", updatedAt: "",
      }],
    } as any);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const select = screen.getByLabelText(/font/i) as HTMLSelectElement;
    // Should have at least 2 options: "vanilla" + "myfont"
    expect(select.options.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(select, { target: { value: "f1" } });
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect((updated as Extract<MenuTitleLayer, { kind: "text" }>).fontAssetId).toBe("f1");
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/LayerSidePanel
```

Expected: FAIL.

- [ ] **Step 3: Implement `LayerSidePanel` (text branch + empty state only)**

```tsx
// editor/src/features/canvas/title/composer/LayerSidePanel.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AssetId, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useTitleSelectionStore } from "../titleSelectionStore";

interface LayerSidePanelProps {
  packId: PackId;
  menuId: MenuId;
}

export function LayerSidePanel({ packId, menuId }: LayerSidePanelProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);

  if (!menu) return null;
  if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= menu.title.length) {
    return (
      <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-4 text-center text-[11px] text-zinc-500">
        No layer selected. Click a layer on the canvas, or use + Image / + Text below.
      </div>
    );
  }

  const layer = menu.title[selectedIndex]!;
  if (layer.kind === "text") return <TextLayerPanel packId={packId} menuId={menuId} index={selectedIndex} layer={layer} />;
  // Image/external branches added in Task 9.
  return null;
}

interface TextLayerPanelProps {
  packId: PackId;
  menuId: MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "text" }>;
}

function TextLayerPanel({ packId, menuId, index, layer }: TextLayerPanelProps) {
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const removeLayer = useAccountStore((s) => s.removeMenuTitleLayer);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const fonts = useAssetStore((s) => s.assets.filter((a) => a.type === "font"));

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-zinc-500">
            Text (MiniMessage) — {textEdit.lang}
          </span>
          <Textarea
            value={textEdit.value}
            onChange={(e) =>
              setI18nValue({ packId, lt: layer.value, lang: textEdit.lang, value: e.target.value })
            }
            className="min-h-[60px] font-mono text-xs"
          />
        </label>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-zinc-500">Preview</div>
        <MiniMessageInline source={textEdit.value} className="font-mono text-xs" />
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase text-zinc-500">Font</span>
        <select
          value={layer.fontAssetId ?? ""}
          onChange={(e) => {
            const value = e.target.value === "" ? undefined : (e.target.value as AssetId);
            updateLayer({
              packId,
              menuId,
              index,
              patch: { fontAssetId: value } as Partial<Extract<MenuTitleLayer, { kind: "text" }>>,
            });
          }}
          className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
        >
          <option value="">vanilla</option>
          {fonts.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="block text-[10px] uppercase text-zinc-500">x</span>
          <Input
            type="number"
            value={layer.x}
            onChange={(e) => {
              const x = Number(e.target.value);
              if (Number.isFinite(x)) {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { x } as Partial<Extract<MenuTitleLayer, { kind: "text" }>>,
                });
              }
            }}
            className="h-8 font-mono text-xs"
          />
        </label>
        <label className="flex-1">
          <span className="block text-[10px] uppercase text-zinc-500">y</span>
          <Input
            type="number"
            value={layer.y}
            onChange={(e) => {
              const y = Number(e.target.value);
              if (Number.isFinite(y)) {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { y } as Partial<Extract<MenuTitleLayer, { kind: "text" }>>,
                });
              }
            }}
            className="h-8 font-mono text-xs"
          />
        </label>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          removeLayer({ packId, menuId, index });
          setSelected(null);
        }}
      >
        Delete layer
      </Button>
    </div>
  );
}
```

If `@/components/ui/textarea` doesn't exist, copy the shadcn Textarea component from a sibling file or fall back to a styled `<textarea>` directly.

- [ ] **Step 4: Run tests, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/LayerSidePanel
```

Expected: 7/7 pass (or however many tests there are — including empty state + text branch).

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/title/composer/LayerSidePanel.tsx editor/src/features/canvas/title/composer/LayerSidePanel.test.tsx
git commit -m "feat(editor): LayerSidePanel — text branch + empty state"
```

---

### Task 9: `LayerSidePanel` — image + external branches

**Files:**
- Modify: `editor/src/features/canvas/title/composer/LayerSidePanel.tsx`
- Modify: `editor/src/features/canvas/title/composer/LayerSidePanel.test.tsx`

Add the image branch (with stretchToChest toggle) and the external_glyph read-only branch.

- [ ] **Step 1: Add failing tests for image + external branches**

Append to `LayerSidePanel.test.tsx`:

```tsx
describe("LayerSidePanel — image branch", () => {
  beforeEach(() => {
    const { useAssetStore } = require("@/features/assets/assetStore");
    useAssetStore.setState({
      assets: [{
        id: "g1" as any, serverKeyId: "sk", type: "glyph", name: "coin",
        width: 32, height: 8, ascent: 7, codepoint: 57344, fontMeta: null,
        contentHash: "h", createdAt: "", updatedAt: "",
      }],
    } as any);
  });

  it("glyph layer: shows asset thumbnail, name, and unchecked stretch toggle", () => {
    seedPack([{ kind: "glyph", assetId: "g1" as any, x: 10, y: 4 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText("coin")).toBeTruthy();
    const toggle = screen.getByLabelText(/stretch to chest/i) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("background layer: stretch toggle is checked, x/y inputs are disabled", () => {
    seedPack([{ kind: "background", assetId: "g1" as any }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    const toggle = screen.getByLabelText(/stretch to chest/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    const xInput = screen.getByLabelText(/^x$/i) as HTMLInputElement;
    expect(xInput.disabled).toBe(true);
  });

  it("toggling stretch from glyph→background changes the runtime kind", () => {
    seedPack([{ kind: "glyph", assetId: "g1" as any, x: 10, y: 4 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByLabelText(/stretch to chest/i));
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect(updated.kind).toBe("background");
  });

  it("toggling stretch from background→glyph restores x=0, y=0", () => {
    seedPack([{ kind: "background", assetId: "g1" as any }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByLabelText(/stretch to chest/i));
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0]!;
    expect(updated.kind).toBe("glyph");
    if (updated.kind === "glyph") {
      expect(updated.x).toBe(0);
      expect(updated.y).toBe(0);
    }
  });

  it("warning shown when asset.width < 176", () => {
    seedPack([{ kind: "glyph", assetId: "g1" as any, x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    // asset.width = 32 (from beforeEach)
    expect(screen.getByText(/176 px/i)).toBeTruthy();
  });
});

describe("LayerSidePanel — external branch", () => {
  it("renders a read-only message for external_glyph layers", () => {
    seedPack([{ kind: "external_glyph", provider: "oraxen", glyphName: "coin", x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<LayerSidePanel packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/external glyph/i)).toBeTruthy();
    expect(screen.getByText(/managed by sp5/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/LayerSidePanel
```

Expected: existing text-branch tests still pass; new image/external tests FAIL.

- [ ] **Step 3: Implement the image + external branches**

Add to `LayerSidePanel.tsx`, after `TextLayerPanel`:

```tsx
import { assetPreviewUrl } from "@/domain/asset";

// ... extend the dispatch ...
function LayerSidePanel(...) {
  // ...
  if (layer.kind === "text") return <TextLayerPanel ... />;
  if (layer.kind === "background" || layer.kind === "glyph") {
    return <ImageLayerPanel packId={packId} menuId={menuId} index={selectedIndex} layer={layer} />;
  }
  if (layer.kind === "external_glyph") return <ExternalLayerPanel layer={layer} />;
  return null;
}

interface ImageLayerPanelProps {
  packId: PackId;
  menuId: MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "background" }> | Extract<MenuTitleLayer, { kind: "glyph" }>;
}

function ImageLayerPanel({ packId, menuId, index, layer }: ImageLayerPanelProps) {
  const setMenuTitleLayers = useAccountStore((s) => s.setMenuTitleLayers);
  const removeLayer = useAccountStore((s) => s.removeMenuTitleLayer);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const asset = useAssetStore((s) => s.assets.find((a) => a.id === layer.assetId));
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  if (!menu) return null;

  const isBg = layer.kind === "background";
  const tooNarrow = asset && asset.width < 176;

  const toggleStretch = () => {
    // Swap layer kind in place; keep position fields when going back to glyph
    const next: MenuTitleLayer = isBg
      ? { kind: "glyph", assetId: layer.assetId, x: 0, y: 0 }
      : { kind: "background", assetId: layer.assetId };
    const newTitle = menu.title.slice();
    newTitle[index] = next;
    setMenuTitleLayers({ packId, menuId, layers: newTitle });
  };

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div className="flex items-center gap-2">
        {asset ? (
          <img
            src={assetPreviewUrl(asset)}
            alt={asset.name}
            className="h-10 w-10 rounded border border-zinc-700 bg-zinc-900 object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="h-10 w-10 rounded border border-zinc-700 bg-zinc-900" />
        )}
        <div>
          <div className="text-xs text-zinc-200">{asset?.name ?? "<missing>"}</div>
          <div className="text-[10px] text-zinc-500">
            {asset ? `${asset.type} · ${asset.width} × ${asset.height} px` : "asset not loaded"}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isBg} onChange={toggleStretch} />
        Stretch to chest (full cover)
      </label>

      {tooNarrow ? (
        <div className="rounded border border-amber-700/40 bg-amber-900/10 px-2 py-1.5 text-[11px] text-amber-300">
          Image is {asset!.width} px wide — Minecraft chest is 176 px. It won't cover horizontally.
        </div>
      ) : null}

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="block text-[10px] uppercase text-zinc-500">x</span>
          <Input
            type="number"
            value={isBg ? 0 : layer.x}
            disabled={isBg}
            onChange={(e) => {
              if (isBg) return;
              const x = Number(e.target.value);
              if (Number.isFinite(x)) {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { x } as Partial<Extract<MenuTitleLayer, { kind: "glyph" }>>,
                });
              }
            }}
            className="h-8 font-mono text-xs disabled:opacity-50"
          />
        </label>
        <label className="flex-1">
          <span className="block text-[10px] uppercase text-zinc-500">y</span>
          <Input
            type="number"
            value={isBg ? 0 : layer.y}
            disabled={isBg}
            onChange={(e) => {
              if (isBg) return;
              const y = Number(e.target.value);
              if (Number.isFinite(y)) {
                updateLayer({
                  packId,
                  menuId,
                  index,
                  patch: { y } as Partial<Extract<MenuTitleLayer, { kind: "glyph" }>>,
                });
              }
            }}
            className="h-8 font-mono text-xs disabled:opacity-50"
          />
        </label>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          removeLayer({ packId, menuId, index });
          setSelected(null);
        }}
      >
        Delete layer
      </Button>
    </div>
  );
}

interface ExternalLayerPanelProps {
  layer: Extract<MenuTitleLayer, { kind: "external_glyph" }>;
}

function ExternalLayerPanel({ layer }: ExternalLayerPanelProps) {
  return (
    <div className="rounded border border-amber-700/40 bg-amber-900/10 p-3 text-[11px] text-amber-200">
      <div className="font-mono text-xs text-amber-100">
        External glyph — {layer.provider}:{layer.glyphName}
      </div>
      <p className="mt-2">Managed by SP5. Read-only in v2.</p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/LayerSidePanel
```

Expected: all tests pass (text + image + external).

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/title/composer/LayerSidePanel.tsx editor/src/features/canvas/title/composer/LayerSidePanel.test.tsx
git commit -m "feat(editor): LayerSidePanel — image branch + external passthrough"
```

---

### Task 10: `AddLayerBar` — buttons + compact layer list

**Files:**
- Create: `editor/src/features/canvas/title/composer/AddLayerBar.tsx`
- Create: `editor/src/features/canvas/title/composer/AddLayerBar.test.tsx`

The bottom strip with `+ Image` / `+ Text` buttons and a horizontal list of layer chips (drag to reorder z).

- [ ] **Step 1: Write failing tests**

```tsx
// editor/src/features/canvas/title/composer/AddLayerBar.test.tsx
import { render, fireEvent, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAssetStore } from "@/features/assets/assetStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { AddLayerBar } from "./AddLayerBar";

vi.mock("@/features/assets/AssetPicker", () => ({
  AssetPicker: (props: any) => (
    <button
      data-testid="asset-picker"
      data-type-filter={props.typeFilter}
      onClick={() => props.onPick({ id: "g_new", name: "x", type: "glyph" })}
    >pick</button>
  ),
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [{
        id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
        menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
        commands: [], templates: [], assets: [], dataSources: [],
        importedConnectors: [], i18nKeys: { [K("g")]: { en: "Hello" } },
        defaultLang: "en", dialogs: [], canvasLayout: {},
      }],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ activeLang: "en" } as any);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  useAssetStore.setState({ assets: [], selectedId: null, loading: false, error: null } as any);
  seedPack([]);
});

describe("AddLayerBar", () => {
  it("renders + Image and + Text buttons", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByText(/\+ Image/)).toBeTruthy();
    expect(screen.getByText(/\+ Text/)).toBeTruthy();
  });

  it("+ Image opens AssetPicker filtered to glyph", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByText(/\+ Image/));
    const picker = screen.getByTestId("asset-picker");
    expect(picker.getAttribute("data-type-filter")).toBe("glyph");
  });

  it("picking an asset adds a glyph layer at (0, 0)", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByText(/\+ Image/));
    fireEvent.click(screen.getByTestId("asset-picker"));
    const layers = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ kind: "glyph", assetId: "g_new", x: 0, y: 0 });
  });

  it("+ Text adds a text layer with a fresh i18n key", () => {
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByText(/\+ Text/));
    const layers = useAccountStore.getState().account.packs[0]!.menus[0]!.title;
    expect(layers).toHaveLength(1);
    expect(layers[0]?.kind).toBe("text");
    if (layers[0]?.kind === "text") expect(layers[0].value.key).toMatch(/^lt_/);
  });

  it("renders one chip per layer", () => {
    seedPack([
      { kind: "glyph", assetId: "a" as any, x: 0, y: 0 },
      { kind: "text", value: { key: K("g") }, x: 0, y: 0 },
    ]);
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getAllByTestId("layer-chip")).toHaveLength(2);
  });

  it("clicking a chip selects that layer", () => {
    seedPack([
      { kind: "glyph", assetId: "a" as any, x: 0, y: 0 },
      { kind: "text", value: { key: K("g") }, x: 0, y: 0 },
    ]);
    render(<AddLayerBar packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getAllByTestId("layer-chip")[1]!);
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/AddLayerBar
```

- [ ] **Step 3: Implement `AddLayerBar`**

```tsx
// editor/src/features/canvas/title/composer/AddLayerBar.tsx
import { Button } from "@/components/ui/button";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import type { AssetId, I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { Image, Type } from "lucide-react";
import { useState } from "react";
import { useTitleSelectionStore } from "../titleSelectionStore";

interface AddLayerBarProps {
  packId: PackId;
  menuId: MenuId;
}

export function AddLayerBar({ packId, menuId }: AddLayerBarProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const addLayer = useAccountStore((s) => s.addMenuTitleLayer);
  const reorder = useAccountStore((s) => s.reorderMenuTitleLayers);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const assets = useAssetStore((s) => s.assets);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!menu) return null;

  const onAddText = () => {
    addLayer({
      packId,
      menuId,
      layer: { kind: "text", value: { key: newI18nKey() }, x: 8, y: 5 },
    });
    setSelected(menu.title.length);
  };

  const onPickImage = (asset: { id: string; name: string; type: string }) => {
    addLayer({
      packId,
      menuId,
      layer: { kind: "glyph", assetId: asset.id as AssetId, x: 0, y: 0 },
    });
    setSelected(menu.title.length);
    setPickerOpen(false);
  };

  return (
    <div className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <Image className="mr-1 h-3.5 w-3.5" />
          + Image
        </Button>
        <Button size="sm" onClick={onAddText}>
          <Type className="mr-1 h-3.5 w-3.5" />
          + Text
        </Button>
      </div>
      <div className="text-xs text-zinc-600">|</div>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {menu.title.map((layer, idx) => (
          <LayerChip
            key={idx}
            layer={layer}
            index={idx}
            selected={selectedIndex === idx}
            onSelect={() => setSelected(idx)}
            onReorder={(fromIndex, toIndex) =>
              reorder({ packId, menuId, fromIndex, toIndex })
            }
            assetName={getAssetName(layer, assets)}
          />
        ))}
      </div>

      <AssetPicker
        open={pickerOpen}
        typeFilter="glyph"
        onClose={() => setPickerOpen(false)}
        onPick={onPickImage}
        title="Pick an image"
      />
    </div>
  );
}

function getAssetName(layer: MenuTitleLayer, assets: Array<{ id: string; name: string }>): string {
  if (layer.kind === "background" || layer.kind === "glyph") {
    return assets.find((a) => a.id === layer.assetId)?.name ?? "?";
  }
  return "";
}

interface LayerChipProps {
  layer: MenuTitleLayer;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  assetName: string;
}

function LayerChip({ layer, index, selected, onSelect, onReorder, assetName }: LayerChipProps) {
  const icon =
    layer.kind === "text" ? "T"
    : layer.kind === "external_glyph" ? "🔌"
    : "🖼";
  const label =
    layer.kind === "text" ? "text"
    : layer.kind === "external_glyph" ? `${layer.provider}:${layer.glyphName}`
    : assetName;

  return (
    <div
      data-testid="layer-chip"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("application/x-layer-index", String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("application/x-layer-index"));
        if (Number.isNaN(from) || from === index) return;
        onReorder(from, index);
      }}
      onClick={onSelect}
      className={
        selected
          ? "cursor-pointer rounded border border-emerald-600 bg-emerald-900/40 px-2 py-0.5 font-mono text-[10px] text-emerald-100"
          : "cursor-pointer rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-300 hover:border-zinc-600"
      }
    >
      {icon} {label}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect green**

```bash
cd editor && npx vitest run src/features/canvas/title/composer/AddLayerBar
```

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/title/composer/AddLayerBar.tsx editor/src/features/canvas/title/composer/AddLayerBar.test.tsx
git commit -m "feat(editor): AddLayerBar — +Image/+Text buttons + chip list"
```

---

### Task 11: `FocusComposer` — top-level container + drop zone + keyboard

**Files:**
- Create: `editor/src/features/canvas/title/composer/FocusComposer.tsx`
- Create: `editor/src/features/canvas/title/composer/FocusComposer.test.tsx`

Composes `ComposerCanvas` + `LayerSidePanel` + `AddLayerBar` into the focus-mode layout. Owns:
- Back button (closes focus mode)
- ESC key → close
- Backspace/Del key → delete selected layer (when no text input is focused)
- OS-file drop on the canvas area → uploads + adds image layer

- [ ] **Step 1: Write failing tests**

```tsx
// editor/src/features/canvas/title/composer/FocusComposer.test.tsx
import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { I18nKey, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { FocusComposer } from "./FocusComposer";

vi.mock("./ComposerCanvas", () => ({
  ComposerCanvas: () => <div data-testid="composer-canvas" />,
}));
vi.mock("./LayerSidePanel", () => ({
  LayerSidePanel: () => <div data-testid="side-panel" />,
}));
vi.mock("./AddLayerBar", () => ({
  AddLayerBar: () => <div data-testid="add-bar" />,
}));

const PACK_ID = "p1" as PackId;
const MENU_ID = "m1" as MenuId;
const K = (s: string) => s as I18nKey;

function seedPack(layers: MenuTitleLayer[]) {
  useAccountStore.setState({
    account: {
      id: "acc" as any,
      packs: [{
        id: PACK_ID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
        menus: [{ id: MENU_ID, packId: PACK_ID, title: layers, rows: 3, layers: [] }],
        commands: [], templates: [], assets: [], dataSources: [],
        importedConnectors: [], i18nKeys: { [K("g")]: { en: "H" } },
        defaultLang: "en", dialogs: [], canvasLayout: {},
      }],
      packOrder: [PACK_ID],
    },
  } as any);
  useUiStore.setState({ titleComposerOpen: { packId: PACK_ID, menuId: MENU_ID }, activeLang: "en" } as any);
}

beforeEach(() => {
  useTitleSelectionStore.getState().reset();
  seedPack([]);
});

describe("FocusComposer", () => {
  it("renders the three children", () => {
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    expect(screen.getByTestId("composer-canvas")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("add-bar")).toBeTruthy();
  });

  it("clicking Back closes the focus mode", () => {
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(useUiStore.getState().titleComposerOpen).toBeNull();
  });

  it("pressing Escape closes the focus mode", () => {
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().titleComposerOpen).toBeNull();
  });

  it("pressing Delete with a layer selected removes it (no input focused)", () => {
    seedPack([
      { kind: "glyph", assetId: "a" as any, x: 0, y: 0 },
      { kind: "glyph", assetId: "b" as any, x: 0, y: 0 },
    ]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(1);
  });

  it("pressing Backspace while a textarea has focus does NOT delete the layer", () => {
    seedPack([{ kind: "glyph", assetId: "a" as any, x: 0, y: 0 }]);
    useTitleSelectionStore.getState().setSelectedIndex(0);
    const { container } = render(<FocusComposer packId={PACK_ID} menuId={MENU_ID} />);
    // Simulate a textarea having focus
    const ta = document.createElement("textarea");
    container.appendChild(ta);
    ta.focus();
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(useAccountStore.getState().account.packs[0]!.menus[0]!.title).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `FocusComposer`**

```tsx
// editor/src/features/canvas/title/composer/FocusComposer.tsx
import { Button } from "@/components/ui/button";
import type { PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { AddLayerBar } from "./AddLayerBar";
import { ComposerCanvas } from "./ComposerCanvas";
import { LayerSidePanel } from "./LayerSidePanel";

interface FocusComposerProps {
  packId: PackId;
  menuId: MenuId;
}

export function FocusComposer({ packId, menuId }: FocusComposerProps) {
  const closeFocus = useUiStore((s) => s.closeTitleComposer);
  const removeLayer = useAccountStore((s) => s.removeMenuTitleLayer);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFocus();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selectedIndex !== null) {
        const ae = document.activeElement;
        if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return;
        if (menu && selectedIndex >= 0 && selectedIndex < menu.title.length) {
          removeLayer({ packId, menuId, index: selectedIndex });
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeFocus, removeLayer, packId, menuId, selectedIndex, menu, setSelected]);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={closeFocus}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back
        </Button>
        <span className="text-xs text-zinc-500">Editing title — {menuId}</span>
      </div>

      <div className="flex flex-1 gap-3">
        <div className="flex-1 rounded border border-zinc-800 bg-zinc-950 p-3">
          <ComposerCanvas packId={packId} menuId={menuId} />
        </div>
        <div className="w-72 rounded border border-zinc-800 bg-zinc-950 p-3">
          <LayerSidePanel packId={packId} menuId={menuId} />
        </div>
      </div>

      <AddLayerBar packId={packId} menuId={menuId} />
    </div>
  );
}
```

Note: OS-file drop is intentionally deferred — it can be added in a follow-up. Plan limits this task to the keyboard + back-button surface to keep scope bounded.

- [ ] **Step 4: Run, expect green**

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/title/composer/FocusComposer.tsx editor/src/features/canvas/title/composer/FocusComposer.test.tsx
git commit -m "feat(editor): FocusComposer container + ESC/Backspace handlers"
```

---

### Task 12: Route integration — render `FocusComposer` when flag set

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx`

When `useUiStore.titleComposerOpen.packId` matches the current pack and `menuId` is in the pack, render `FocusComposer` in place of the normal main pane.

- [ ] **Step 1: Read the route file to find the main pane render**

```bash
cat editor/src/routes/pack.$packId.tsx | head -80
```

Find the return statement of `PackCanvasPage`.

- [ ] **Step 2: Wrap the existing render with a focus-mode check**

Near the top of `PackCanvasPage` add:

```tsx
const titleComposerOpen = useUiStore((s) => s.titleComposerOpen);
```

After the existing early returns (`!token`, `packs.length===0`, `!pack`), add:

```tsx
if (titleComposerOpen && titleComposerOpen.packId === pId) {
  const composerMenu = pack.menus.find((m) => m.id === titleComposerOpen.menuId);
  if (composerMenu) {
    return <FocusComposer packId={pId} menuId={composerMenu.id} />;
  }
  // Stale flag — close and fall through
  useUiStore.getState().closeTitleComposer();
}
```

Import `FocusComposer`:

```tsx
import { FocusComposer } from "@/features/canvas/title/composer/FocusComposer";
```

- [ ] **Step 3: Verify it compiles**

```bash
cd editor && npx tsc --noEmit 2>&1 | grep "pack.\$packId"
```

Expected: no new errors (pre-existing TS issues in unrelated files are OK).

- [ ] **Step 4: Run the editor manually (smoke)**

```bash
# In the running Docker editor container, the change is hot-reloaded.
# Open the editor, double-click a menu's title bar — focus mode should appear.
# Click "Back" — pack canvas returns.
```

(Not blocking; just sanity-check.)

- [ ] **Step 5: Commit**

```bash
git add editor/src/routes/pack.$packId.tsx
git commit -m "feat(editor): route renders FocusComposer when titleComposerOpen matches"
```

---

### Task 13: `MenuProperties` uses `TitleThumbnail` + button

**Files:**
- Modify: `editor/src/features/canvas/properties/MenuProperties.tsx`

Replace the inline `<TitleComposer>` with a small section:

```
┌─────────────────────────────┐
│ Title                       │
│ ┌─────────────────────────┐ │
│ │  Hello                  │ │   ← TitleThumbnail
│ └─────────────────────────┘ │
│ [Edit title…]               │
└─────────────────────────────┘
```

- [ ] **Step 1: Modify the file**

Find the line in `MenuProperties.tsx`:

```tsx
<TitleComposer packId={packId} menu={menu} />
```

Replace with:

```tsx
<div>
  <div className="mb-1 text-[10px] uppercase text-zinc-500">Title</div>
  <TitleThumbnail packId={packId} menuId={menu.id} />
  <Button
    size="sm"
    variant="ghost"
    className="mt-1.5 w-full"
    onClick={() => useUiStore.getState().openTitleComposer(packId, menu.id)}
  >
    Edit title…
  </Button>
</div>
```

Replace the import line:

```tsx
import { TitleComposer } from "@/features/canvas/title/TitleComposer";
```

with:

```tsx
import { TitleThumbnail } from "@/features/canvas/title/composer/TitleThumbnail";
import { useUiStore } from "@/state/uiStore";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: all green except for any tests that reference the old TitleComposer in MenuProperties. The old TitleComposer test file is deleted in Task 14, so don't fix the obsolete ones here — just confirm MenuProperties.test (if it exists) doesn't break in a way that needs attention now.

- [ ] **Step 3: Commit**

```bash
git add editor/src/features/canvas/properties/MenuProperties.tsx
git commit -m "feat(editor): MenuProperties uses TitleThumbnail + Edit title button"
```

---

### Task 14: Delete v1 composer files

**Files:**
- Delete: `editor/src/features/canvas/title/TitleComposer.tsx`
- Delete: `editor/src/features/canvas/title/TitleComposer.test.tsx`
- Delete: `editor/src/features/canvas/title/TitleMockup.tsx`
- Delete: `editor/src/features/canvas/title/TitleMockup.test.tsx`
- Delete: `editor/src/features/canvas/title/TitleLayerList.tsx`
- Delete: `editor/src/features/canvas/title/TitleLayerList.test.tsx`
- Delete: `editor/src/features/canvas/title/TitleLayerItem.tsx`
- Delete: `editor/src/features/canvas/title/TitleTextEditor.tsx`
- Delete: `editor/src/features/canvas/title/TitleTextEditor.test.tsx`

- [ ] **Step 1: Confirm no remaining importers**

```bash
rtk grep -n "from.*title/TitleComposer\|from.*title/TitleMockup\|from.*title/TitleLayerList\|from.*title/TitleLayerItem\|from.*title/TitleTextEditor" editor/src 2>&1
```

Expected: zero matches (all consumers were updated in Task 13).

- [ ] **Step 2: Delete the files**

```bash
git rm editor/src/features/canvas/title/TitleComposer.tsx editor/src/features/canvas/title/TitleComposer.test.tsx
git rm editor/src/features/canvas/title/TitleMockup.tsx editor/src/features/canvas/title/TitleMockup.test.tsx
git rm editor/src/features/canvas/title/TitleLayerList.tsx editor/src/features/canvas/title/TitleLayerList.test.tsx
git rm editor/src/features/canvas/title/TitleLayerItem.tsx
git rm editor/src/features/canvas/title/TitleTextEditor.tsx editor/src/features/canvas/title/TitleTextEditor.test.tsx
```

- [ ] **Step 3: Run full editor suite**

```bash
cd editor && npx vitest run
```

Expected: green. Test count drops compared to baseline (the deleted test files are gone); the new composer/* tests cover the same functional surface and then some.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(editor): delete v1 title composer files"
```

---

### Task 15: Delete `TextEditor` (legacy single-line title editor)

**Files:**
- Delete: `editor/src/features/canvas/TextEditor.tsx`
- Modify: `editor/src/features/canvas/Stage.tsx` (remove `<TextEditor>` mount if present)
- Delete: `editor/src/state/editingStore.ts` (only used by `TextEditor.tsx` — verify and delete)

- [ ] **Step 1: Confirm `editingStore` is only used by TextEditor**

```bash
rtk grep -n "useEditingStore" editor/src 2>&1
```

Expected: only `TextEditor.tsx` (which we're deleting) and `editingStore.ts` itself. If there are other usages, leave `editingStore` in place and only delete `TextEditor`.

- [ ] **Step 2: Find Stage.tsx's TextEditor reference**

```bash
rtk grep -n "TextEditor" editor/src/features/canvas/Stage.tsx 2>&1
```

If found, remove the import and the mount.

- [ ] **Step 3: Delete files**

```bash
git rm editor/src/features/canvas/TextEditor.tsx
git rm editor/src/state/editingStore.ts   # only if step 1 confirmed it's orphaned
```

- [ ] **Step 4: Verify Stage.tsx compiles**

```bash
cd editor && npx tsc --noEmit 2>&1 | grep "Stage.tsx"
```

Expected: no new errors.

- [ ] **Step 5: Run full editor suite**

```bash
cd editor && npx vitest run
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/Stage.tsx
git commit -m "refactor(editor): delete legacy TextEditor + editingStore"
```

(`git rm` already staged the deletions.)

---

### Task 16: Docs — update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a section under "Structure des packs sur disque"**

Find the "Format menu YAML — champ title" section. Append:

```markdown
### Title Composer UX v2

- Édition d'un titre = mode focus dédié, ouvert par double-clic sur la title bar d'un menu dans le pack canvas (ou via "Edit title…" dans MenuProperties).
- Vue UI : 2 types de layers seulement (Image, Text). L'éditeur convertit en runtime `MenuTitleLayer` (background/glyph/text/external_glyph) au save via `editor/src/features/canvas/title/composer/uiLayerMapping.ts`.
- Texte = MiniMessage. Coloring/styling via tags inline (`<gold>`, `<bold>`, etc.) ; preview live dans le panel side et sur le canvas.
- `MenuGroup` (pack canvas) rend les menus en forme finale via `<TitleRender mode="compact">` — toutes les title layers visibles, items dessus.
```

- [ ] **Step 2: Update test counts**

Run the suites to get fresh counts:

```bash
cd backend && bun test 2>&1 | tail -3
cd editor && npx vitest run 2>&1 | tail -3
```

Update the "Tests — ce qui est couvert" table accordingly (editor count will be higher; backend unchanged).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: title composer UX v2 — usage + test counts"
```

---

## Final verification

- [ ] `cd editor && npx tsc --noEmit` → no NEW errors vs SP4 baseline (pre-existing ones in unrelated files are OK)
- [ ] `cd editor && npx vitest run` → all green
- [ ] `cd backend && bun test` → unchanged from SP4 (224 pass + 1 pre-existing failure)
- [ ] `cd plugin && ./gradlew test` → unchanged from SP4 (241 pass)
- [ ] `rtk git status` → only the WIP files from the start of the session are unstaged
- [ ] Manual smoke test:
  1. Open editor, navigate to a pack
  2. Verify pack canvas shows menu titles with full layer composition (background + glyphs + text + items)
  3. Double-click a menu's title bar → focus mode opens
  4. Drag layers, edit text via MiniMessage textarea (with live preview), toggle stretch on an image
  5. "Back" → pack canvas reflects all edits immediately
  6. Reload editor — state survives (Zustand persists where applicable)

---

## Self-review vs spec

Every spec section maps to a task:

- "Goal" + "Non-goals" → covered by overall plan + Task list scope
- "Architecture" diagram → Tasks 1-3 (foundation), 5 (MenuGroup), 11 (FocusComposer)
- "Domain Model > UI layer model" → Tasks 2 (types + mapping)
- "Domain Model > External glyph passthrough" → Task 2 step 4 (test) + 9 (UI)
- "TitleRender — shared rendering" → Task 3
- "Pack Canvas — final-form rendering" → Task 5
- "Side Panel — by layer kind" → Tasks 8, 9
- "Add Layer Bar" → Task 10
- "Interactions" table → Task 7 (drag), 11 (keyboard), 10 (reorder via chips)
- "Side Panel Wiring + auto-save" → Tasks 8, 9 (all writes via accountStore actions)
- "Migration" → Task 2 step 4 ("color" stripped on read)
- "Testing > New tests" → Tasks 2-3, 6-11 each have tests
- "Testing > Tests retired" → Task 14

Deferrals consciously made (noted in plan, not in spec):
- OS-file drop on canvas — Task 11 notes this is deferred; the user can use "+ Image" + AssetUploadDialog for now
- Undo/redo composer-specific stack — uses existing `accountStore.temporal` (Zundo) so all store mutations are undo-able by default; no extra wiring needed
