# MenuTitleLayer + WYSIWYG Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Branch:** `feat/title-composer`

**Goal:** Sub-project 3 of the texture pack system — replace `Menu.title: LText` with `Menu.title: MenuTitleLayer[]` (background + glyphs + text segments, each positioned in pixels). Add a WYSIWYG composer UI in the editor (Konva mockup + layer list). Implement the runtime compiler in the plugin (Kotlin) that turns the layer array into a MiniMessage string with negative-space offsets.

**Architecture:** Editor stores titles as a JSON array of typed layer objects. Each layer references an `assetId` (from Sub-project 1's library) by ID, not by content. The plugin downloads the resource pack zip (Sub-project 2) and parses a new `assets/interfaze/asset-index.json` inside it to map `assetId → codepoint char + ascent + height`. At render time, the plugin's `TitleCompiler` walks the layer array and emits `<font:interfaze:default><offset:Xpx>\uE0XX</offset></font>` for glyphs and `<offset:Xpx><color:#…>text</color></offset>` for text — concatenated into a single MiniMessage Component used as the inventory title.

**Tech Stack:** Editor = React + Zustand + Konva. Backend = Bun + fflate (existing `resourcePackBuilder` extended). Plugin = Kotlin + Jackson + Adventure (MiniMessage). Tests = Vitest, `bun:test`, JUnit + MockBukkit.

---

## Reference

- Spec: `docs/superpowers/specs/2026-05-11-texture-pack-system-design.md` § "Domain Model > MenuTitle" + § "Compilation runtime (plugin)"
- Sub-project 1 (deployed): `docs/superpowers/plans/2026-05-11-asset-library-backend.md` — provides `assets` table, `Asset` type, `useAssetStore`, asset picker pattern
- Sub-project 2 (deployed): `docs/superpowers/plans/2026-05-11-resource-pack-generator.md` — provides `resourcePackBuilder`, `font/default.json`, `ResourcePackManager`, `setResourcePack()` distribution

Out of scope:
- Custom font rendering (`fontAssetId`) — Sub-project 4 (the field exists in the type but plugin falls back to vanilla)
- Background as full-menu-cover rendering — Sub-project 4 (treated as a big glyph for now)
- External glyph **picker UI** — Sub-project 5 (the `external_glyph` kind exists in types + plugin compiler so format is forward-compatible, but no editor surface adds layers of this kind yet)
- Export/import bundling — Sub-project 6

---

## Domain types (canonical)

### Editor (TS)

```ts
// editor/src/domain/types.ts (replaces the current Menu.title: LText)
export type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;
      color?: string }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };

export interface Menu {
  // ... existing fields ...
  title: MenuTitleLayer[];  // was: title: LText
  // ...
}
```

### Plugin (Kotlin)

```kotlin
// plugin/src/main/kotlin/gg/interfaze/plugin/model/MenuTitleLayer.kt
sealed class MenuTitleLayer {
    data class Background(val assetId: String) : MenuTitleLayer()
    data class Glyph(val assetId: String, val x: Int, val y: Int) : MenuTitleLayer()
    data class Text(
        val value: LText,
        val x: Int,
        val y: Int,
        val fontAssetId: String? = null,
        val color: String? = null,
    ) : MenuTitleLayer()
    data class ExternalGlyph(
        val provider: String,
        val glyphName: String,
        val x: Int,
        val y: Int,
    ) : MenuTitleLayer()
}
```

### Asset index (zip-embedded)

```json
// assets/interfaze/asset-index.json (new file in the resource pack zip)
{
  "version": 1,
  "assets": {
    "asset_a1b2c3": { "name": "coin_icon", "type": "glyph", "codepoint": 57344, "ascent": 8, "height": 9 },
    "asset_d4e5f6": { "name": "shop_bg",   "type": "glyph", "codepoint": 57345, "ascent": -8, "height": 200 }
  }
}
```

---

## File structure

### Editor (create)
- `editor/src/domain/migrateTitle.ts` — `migrateTitle(legacy) → MenuTitleLayer[]`
- `editor/src/domain/migrateTitle.test.ts`
- `editor/src/features/canvas/title/titleSelectionStore.ts` — selected layer index per active menu
- `editor/src/features/canvas/title/TitleComposer.tsx` — top-level panel hosting mockup + list
- `editor/src/features/canvas/title/TitleMockup.tsx` — Konva chest-title-bar mockup with drag
- `editor/src/features/canvas/title/TitleLayerList.tsx` — z-order list with HTML5 DnD reorder
- `editor/src/features/canvas/title/TitleLayerItem.tsx` — one row of the list
- `editor/src/features/canvas/title/TitleTextEditor.tsx` — modal for editing a text layer
- `editor/src/features/canvas/title/TitleComposer.test.tsx`
- `editor/src/features/assets/AssetPicker.tsx` — shared modal, filter by `AssetType`
- `editor/src/features/assets/AssetPicker.test.tsx`

### Editor (modify)
- `editor/src/domain/types.ts` — replace `Menu.title: LText` with `MenuTitleLayer[]`
- `editor/src/state/accountStore.ts` — title-layer actions, ingest migration
- `editor/src/features/canvas/properties/MenuProperties.tsx` — replace title input with `<TitleComposer>`
- `editor/src/features/canvas/MenuGroup.tsx` — render the first text layer (or default) in the canvas tile
- `editor/src/features/export/transform.ts` — emit the layered title format; tolerate legacy

### Backend (modify)
- `backend/src/lib/assetIndexBuilder.ts` (new) + test — `buildAssetIndex(assets) → object`
- `backend/src/lib/resourcePackBuilder.ts` + test — include `assets/interfaze/asset-index.json` in the zip

### Plugin (create)
- `plugin/src/main/kotlin/gg/interfaze/plugin/model/MenuTitleLayer.kt`
- `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/AssetCatalog.kt` + test
- `plugin/src/main/kotlin/gg/interfaze/plugin/render/TitleCompiler.kt` + test

### Plugin (modify)
- `plugin/src/main/kotlin/gg/interfaze/plugin/model/Menu.kt` — `title: List<MenuTitleLayer>` (was `LText`)
- `plugin/src/main/kotlin/gg/interfaze/plugin/engine/BundleCompiler.kt` (or wherever YAML is parsed) — read the new array; tolerate legacy String
- `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackManager.kt` — invoke `AssetCatalog.update` from `onUpdate`
- `plugin/src/main/kotlin/gg/interfaze/plugin/render/MenuRenderer.kt` — call `TitleCompiler.compileTitle` instead of `getText(pack, menu.title, lang)`

### Docs
- `CLAUDE.md` — note the title-layer YAML format, bump test counts

---

## Task list

Each task = one commit. Use **explicit `git add <paths>`** — never `git add -A`. The repo has WIP from the user across the tree; sweeping adds will absorb unrelated files.

---

### Task 1: Editor types — add `MenuTitleLayer` union, change `Menu.title` to array

**Files:**
- Modify: `editor/src/domain/types.ts`

Add the union (place near `LText`/`AssetId` definitions):

```ts
export type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;
      color?: string }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };
```

Change in the `Menu` interface: `title: LText` → `title: MenuTitleLayer[]`.

- [ ] **Step 1**: Make the change.
- [ ] **Step 2**: `cd editor && npx tsc --noEmit` — note all new errors (consumers of `menu.title`). Don't fix yet — Task 2's migration helper handles old data, and subsequent tasks fix consumers.
- [ ] **Step 3**: Commit:
  ```bash
  git add editor/src/domain/types.ts
  git commit -m "feat(editor): MenuTitleLayer union + Menu.title becomes array"
  ```

---

### Task 2: `migrateTitle` helper

**Files (both new):**
- `editor/src/domain/migrateTitle.ts`
- `editor/src/domain/migrateTitle.test.ts`

```ts
// migrateTitle.ts
import type { LText, MenuTitleLayer } from "./types";

const DEFAULT_TEXT_X = 8;
const DEFAULT_TEXT_Y = 5;

export function migrateTitle(legacy: LText | MenuTitleLayer[] | null | undefined): MenuTitleLayer[] {
  if (Array.isArray(legacy)) return legacy;
  if (!legacy) return [];
  return [{ kind: "text", value: legacy, x: DEFAULT_TEXT_X, y: DEFAULT_TEXT_Y }];
}
```

```ts
// migrateTitle.test.ts
import { describe, expect, it } from "vitest";
import { migrateTitle } from "./migrateTitle";

describe("migrateTitle", () => {
  it("wraps an LText into a single text layer", () => {
    const result = migrateTitle({ key: "menu.title" } as never);
    expect(result).toEqual([{ kind: "text", value: { key: "menu.title" }, x: 8, y: 5 }]);
  });

  it("returns arrays unchanged", () => {
    const layers = [{ kind: "background", assetId: "asset_a" }] as never;
    expect(migrateTitle(layers)).toBe(layers);
  });

  it("returns [] for null/undefined", () => {
    expect(migrateTitle(null)).toEqual([]);
    expect(migrateTitle(undefined)).toEqual([]);
  });
});
```

- [ ] TDD: write test, run (fail), implement, run (pass), commit:
  ```bash
  git add editor/src/domain/migrateTitle.ts editor/src/domain/migrateTitle.test.ts
  git commit -m "feat(editor): migrateTitle helper (LText → text layer)"
  ```

---

### Task 3: Apply migration at pack ingest (account store)

**Files:**
- Modify: `editor/src/state/accountStore.ts`

Find the place where packs are loaded into the store (look for `setAccount` or `loadPack` or similar — read the file). For each pack's menus, run `menu.title = migrateTitle(menu.title)` before storing. Same for any "import pack" or "create menu" code path.

- [ ] Add `import { migrateTitle } from "@/domain/migrateTitle"`.
- [ ] Walk each menu at ingest and assign `menu.title = migrateTitle(menu.title)`.
- [ ] Run `npx vitest run` to confirm any tests that consumed legacy `menu.title: LText` are migrated through this path.
- [ ] Commit:
  ```bash
  git add editor/src/state/accountStore.ts
  git commit -m "feat(editor): migrate Menu.title at pack ingest"
  ```

---

### Task 4: Account store actions for title layers

**Files:**
- Modify: `editor/src/state/accountStore.ts`

Add actions (mirror the existing Immer pattern, e.g., `setMenuTitle`):

```ts
setMenuTitleLayers: (args: { packId: PackId; menuId: MenuId; layers: MenuTitleLayer[] }) => void;
updateMenuTitleLayer: (args: { packId: PackId; menuId: MenuId; index: number; patch: Partial<MenuTitleLayer> }) => void;
addMenuTitleLayer: (args: { packId: PackId; menuId: MenuId; layer: MenuTitleLayer }) => void;
removeMenuTitleLayer: (args: { packId: PackId; menuId: MenuId; index: number }) => void;
reorderMenuTitleLayers: (args: { packId: PackId; menuId: MenuId; fromIndex: number; toIndex: number }) => void;
```

Implementation uses `set(produce((draft) => { ... }))`. For `updateMenuTitleLayer`, type-narrow `current` and spread `patch`:
```ts
const layer = menu.title[index];
if (!layer) return;
menu.title[index] = { ...layer, ...patch } as MenuTitleLayer;
```

For `reorderMenuTitleLayers`, splice from→to:
```ts
const [moved] = menu.title.splice(fromIndex, 1);
if (moved) menu.title.splice(toIndex, 0, moved);
```

The old `setMenuTitle` action can stay for now (some callers may still use it for legacy paths) — it should write to `menu.title[0]` if it's a text layer, otherwise prepend a text layer. Document as deprecated.

- [ ] Add actions to the interface AND the implementation.
- [ ] Add a small test in `accountStore.test.ts` (next to existing tests) that exercises `addMenuTitleLayer` + `reorderMenuTitleLayers` + `removeMenuTitleLayer`.
- [ ] Commit:
  ```bash
  git add editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts
  git commit -m "feat(editor): account store actions for title layers"
  ```

---

### Task 5: `titleSelectionStore` (Zustand)

**Files (both new):**
- `editor/src/features/canvas/title/titleSelectionStore.ts`
- `editor/src/features/canvas/title/titleSelectionStore.test.ts`

```ts
// titleSelectionStore.ts
import { create } from "zustand";

interface TitleSelectionState {
  selectedIndex: number | null;
  setSelectedIndex: (index: number | null) => void;
  reset: () => void;
}

export const useTitleSelectionStore = create<TitleSelectionState>()((set) => ({
  selectedIndex: null,
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  reset: () => set({ selectedIndex: null }),
}));
```

Test the 3 actions. TDD pattern (red/green/commit).

- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/title/titleSelectionStore.ts editor/src/features/canvas/title/titleSelectionStore.test.ts
  git commit -m "feat(editor): titleSelectionStore"
  ```

---

### Task 6: `AssetPicker` shared modal

**Files (both new):**
- `editor/src/features/assets/AssetPicker.tsx`
- `editor/src/features/assets/AssetPicker.test.tsx`

A modal that shows assets filtered by `AssetType`, with click → callback. Reuses `useAssetStore` (no API call — assumes AssetsTab has loaded the data).

```tsx
// AssetPicker.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Asset, AssetType } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { useState } from "react";
import { useAssetStore } from "./assetStore";

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  typeFilter: AssetType;          // "texture" | "glyph" | "font"
  onPick: (asset: Asset) => void;
  title?: string;
}

export function AssetPicker({ open, onClose, typeFilter, onPick, title }: AssetPickerProps) {
  const all = useAssetStore((s) => s.assets);
  const [search, setSearch] = useState("");
  const matches = all
    .filter((a) => a.type === typeFilter)
    .filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">{title ?? `Pick a ${typeFilter}`}</DialogTitle>
        </DialogHeader>
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="grid grid-cols-6 gap-1.5 overflow-y-auto p-1">
          {matches.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => { onPick(asset); onClose(); }}
              title={asset.name}
              className={cx(
                "aspect-square rounded border bg-zinc-900 hover:border-emerald-500",
                "border-zinc-700",
              )}
            >
              <img
                src={assetPreviewUrl(asset)}
                alt={asset.name}
                className="h-full w-full object-contain p-1"
                style={{ imageRendering: "pixelated" }}
              />
            </button>
          ))}
          {matches.length === 0 && (
            <div className="col-span-6 py-4 text-center text-xs text-zinc-500">
              No {typeFilter} assets found.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Tests:
- Renders only assets matching `typeFilter`
- Search filters by name
- Click on a tile calls `onPick` with the asset and `onClose`

- [ ] Commit:
  ```bash
  git add editor/src/features/assets/AssetPicker.tsx editor/src/features/assets/AssetPicker.test.tsx
  git commit -m "feat(editor): AssetPicker shared modal"
  ```

---

### Task 7: `TitleMockup` (Konva)

**Files (both new):**
- `editor/src/features/canvas/title/TitleMockup.tsx`
- `editor/src/features/canvas/title/TitleMockup.test.tsx`

A Konva `Stage` rendering a chest title bar at 2× scale (vanilla GUI dimensions: chest title bar is 176×16 px → 352×32 px on screen). For each layer: render at `(layer.x * SCALE, layer.y * SCALE)`. Draggable; on drag end update store via `updateMenuTitleLayer`.

Pseudo-structure:
```tsx
const SCALE = 2;
const WIDTH = 176; const HEIGHT = 16;

export function TitleMockup({ packId, menu }: Props) {
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const selected = useTitleSelectionStore((s) => s.selectedIndex);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);

  return (
    <Stage width={WIDTH * SCALE} height={HEIGHT * SCALE}>
      <Layer>
        <Rect width={WIDTH * SCALE} height={HEIGHT * SCALE} fill="#3f3f3f" />
        {menu.title.map((layer, idx) => (
          <LayerNode
            key={idx}
            layer={layer}
            index={idx}
            packId={packId}
            menuId={menu.id}
            selected={selected === idx}
            onSelect={() => setSelected(idx)}
            onDragEnd={(x, y) => updateLayer({ packId, menuId: menu.id, index: idx, patch: { x, y } as any })}
            scale={SCALE}
          />
        ))}
      </Layer>
    </Stage>
  );
}
```

`LayerNode` for `kind === "glyph"` and `kind === "background"` shows a `KonvaImage` from `assetPreviewUrl(asset)`. For `kind === "text"`, shows a `KonvaText` with the resolved string from `getText(pack, value, lang)`. For `kind === "external_glyph"`, renders a placeholder rectangle for now.

Drag handler computes `snapped = { x: Math.round(stage.x() / SCALE), y: Math.round(stage.y() / SCALE) }`. Shift→raw, Alt→multiples of 18 (slot grid). Read modifier keys from `e.evt`.

Tests:
- Mocking `@/components/ui/dialog` / Konva is unnecessary; use `vi.mock("react-konva", ...)` returning placeholder divs (see how existing canvas tests handle this if any).
- Render with a 2-layer menu, assert each layer is drawn.
- Click a layer → `useTitleSelectionStore.getState().selectedIndex === idx`.

If Konva tests are too flaky, structure the component so the logic (drag→snap, modifier keys) lives in a pure helper in the same file, and test that helper directly.

- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/title/TitleMockup.tsx editor/src/features/canvas/title/TitleMockup.test.tsx
  git commit -m "feat(editor): TitleMockup Konva preview"
  ```

---

### Task 8: `TitleLayerList` + `TitleLayerItem`

**Files (3 new):**
- `editor/src/features/canvas/title/TitleLayerList.tsx`
- `editor/src/features/canvas/title/TitleLayerItem.tsx`
- `editor/src/features/canvas/title/TitleLayerList.test.tsx`

Ordered list, top of the list = front in z-order. Reordering uses HTML5 DnD:

```tsx
function handleDragStart(e: React.DragEvent, idx: number) {
  e.dataTransfer.setData("application/x-layer-index", String(idx));
}
function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
function handleDrop(e: React.DragEvent, toIndex: number) {
  const fromIndex = Number(e.dataTransfer.getData("application/x-layer-index"));
  if (Number.isNaN(fromIndex) || fromIndex === toIndex) return;
  reorder({ packId, menuId, fromIndex, toIndex });
}
```

Each `TitleLayerItem`: type icon + label preview + x/y + delete button. Click on the row → selects. Delete button calls `removeMenuTitleLayer`.

For label preview:
- `background` → "Bg: " + asset name (look up via `useAssetStore`)
- `glyph` → "Glyph: " + asset name + " (x,y)"
- `text` → "Text: " + resolved text + " (x,y)"
- `external_glyph` → "External: " + provider + ":" + glyphName

Tests:
- Renders one row per layer
- Drag idx 0 → idx 2 triggers `reorderMenuTitleLayers({ fromIndex: 0, toIndex: 2 })`
- Click delete on row N triggers `removeMenuTitleLayer({ index: N })`
- Click row → updates `titleSelectionStore.selectedIndex`

- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/title/TitleLayerList.tsx editor/src/features/canvas/title/TitleLayerItem.tsx editor/src/features/canvas/title/TitleLayerList.test.tsx
  git commit -m "feat(editor): TitleLayerList + Item"
  ```

---

### Task 9: `TitleTextEditor` modal

**Files:**
- Create: `editor/src/features/canvas/title/TitleTextEditor.tsx`
- Create: `editor/src/features/canvas/title/TitleTextEditor.test.tsx`

Modal for editing a `text` layer: LText i18n value (use existing `useTextEdit` hook), color (color input), and (optional) custom font picker (AssetPicker with `typeFilter="font"` — but the font upload doesn't exist yet, so the picker will be empty; UX-wise it's a forward hook).

Form fields:
- Text (per-language LText editor)
- Color: HTML `<input type="color">`, plus a "clear" button to reset to undefined (= default white)
- Font: button "Pick font…" (opens AssetPicker with `typeFilter="font"`) + display the selected font name (or "vanilla") + clear button

On submit, calls `updateMenuTitleLayer` with `{ value, color, fontAssetId }`.

Tests:
- Renders with an existing text layer's values
- Changing text calls update
- Picking a font (mock AssetPicker output) sets `fontAssetId`

- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/title/TitleTextEditor.tsx editor/src/features/canvas/title/TitleTextEditor.test.tsx
  git commit -m "feat(editor): TitleTextEditor modal"
  ```

---

### Task 10: `TitleComposer` panel (wires everything)

**Files (2 new):**
- `editor/src/features/canvas/title/TitleComposer.tsx`
- `editor/src/features/canvas/title/TitleComposer.test.tsx`

```tsx
export function TitleComposer({ packId, menu }: Props) {
  const addLayer = useAccountStore((s) => s.addMenuTitleLayer);
  const [picker, setPicker] = useState<{ kind: "background" | "glyph" } | null>(null);
  const [textEditor, setTextEditor] = useState<number | null>(null);  // index of layer being edited

  const onAddBackground = () => setPicker({ kind: "background" });
  const onAddGlyph     = () => setPicker({ kind: "glyph" });
  const onAddText      = () => addLayer({ packId, menuId: menu.id, layer: { kind: "text", value: { key: newI18nKey() }, x: 8, y: 5 } });

  return (
    <div className="flex flex-col gap-2">
      <TitleMockup packId={packId} menu={menu} />
      <div className="flex gap-1">
        <Button size="sm" onClick={onAddBackground}>+ Background</Button>
        <Button size="sm" onClick={onAddGlyph}>+ Glyph</Button>
        <Button size="sm" onClick={onAddText}>+ Text</Button>
      </div>
      <TitleLayerList packId={packId} menu={menu} onEditText={setTextEditor} />
      {picker && (
        <AssetPicker
          open
          typeFilter={picker.kind === "background" ? "texture" : "glyph"}
          onClose={() => setPicker(null)}
          onPick={(asset) => {
            const layer = picker.kind === "background"
              ? { kind: "background" as const, assetId: asset.id }
              : { kind: "glyph" as const, assetId: asset.id, x: 0, y: 0 };
            addLayer({ packId, menuId: menu.id, layer });
          }}
        />
      )}
      {textEditor !== null && (
        <TitleTextEditor
          packId={packId}
          menu={menu}
          index={textEditor}
          onClose={() => setTextEditor(null)}
        />
      )}
    </div>
  );
}
```

`newI18nKey()`: existing helper that mints a fresh `i18nKey_<random>` key (look up in `editor/src/domain/`).

Tests:
- `+ Text` adds a new text layer to the store
- `+ Background` opens AssetPicker with `typeFilter="texture"`
- `+ Glyph` opens AssetPicker with `typeFilter="glyph"`
- Picking an asset in the picker calls `addMenuTitleLayer` with the right kind

- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/title/TitleComposer.tsx editor/src/features/canvas/title/TitleComposer.test.tsx
  git commit -m "feat(editor): TitleComposer top-level panel"
  ```

---

### Task 11: Wire `TitleComposer` into `MenuProperties.tsx`

**Files:**
- Modify: `editor/src/features/canvas/properties/MenuProperties.tsx`

Replace the existing title `<PropertyField>` block:

```tsx
// Remove:
// <PropertyField
//   label={t(titleEdit.isFallback ? "menuProperties.titleLabelFallback" : "menuProperties.titleLabel", { lang: titleEdit.lang })}
//   value={titleEdit.value}
//   onChange={...}
// />
// {titleEdit.value.includes("<") && <... preview ...>}

// Replace with:
<TitleComposer packId={packId} menu={menu} />
```

Remove the `useTextEdit(packId, menu.title)` call since it expects an `LText` not an array.

- [ ] Run `npx vitest run` from `editor/`. Tests for `MenuProperties` likely need adjustment.
- [ ] Run `npx tsc --noEmit` — there should be no consumer of `menu.title` as `LText` left in the codebase.
- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/properties/MenuProperties.tsx
  git commit -m "feat(editor): wire TitleComposer into MenuProperties"
  ```

---

### Task 12: Update `MenuGroup.tsx` canvas tile

**Files:**
- Modify: `editor/src/features/canvas/MenuGroup.tsx`

The canvas tile draws the menu's title bar text via `<KonvaText>` somewhere. Find that and reduce it to render the first `text` layer of `menu.title` (or an empty string if no text layer):

```tsx
const firstTextLayer = menu.title.find((l) => l.kind === "text") as
  | { kind: "text"; value: LText } | undefined;
const titleText = firstTextLayer ? getText(pack, firstTextLayer.value, activeLang) : "";
```

Use `titleText` in the `<KonvaText>` props.

A richer canvas-tile render (showing background+glyphs+text) is out of scope; the composer's mockup is where that lives.

- [ ] Commit:
  ```bash
  git add editor/src/features/canvas/MenuGroup.tsx
  git commit -m "feat(editor): MenuGroup tile renders first text layer"
  ```

---

### Task 13: Export pipeline (transform.ts)

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts`

The pack export emits YAML for the plugin. Update the title serialization. Each layer becomes a `{kind, ...}` map:

```yaml
title:
  - kind: background
    asset_id: asset_a1b2c3
  - kind: glyph
    asset_id: asset_d4e5f6
    x: 32
    y: 4
  - kind: text
    value:
      key: i18nKey_xyz
    x: 8
    y: 5
    color: "#FFAA00"
```

Add a test that round-trips through transform → YAML → check the YAML body contains the expected `title:` array.

Also add a reader that accepts the LEGACY format (`title: "<string>"` becomes `[{ kind: "text", value: ..., x: 8, y: 5 }]`) — for backward-compatible YAML imports.

- [ ] Commit:
  ```bash
  git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
  git commit -m "feat(editor): export titles as MenuTitleLayer array"
  ```

---

### Task 14: Backend — `assetIndexBuilder`

**Files (both new):**
- `backend/src/lib/assetIndexBuilder.ts`
- `backend/src/lib/assetIndexBuilder.test.ts`

Pure function `buildAssetIndex(assets: AssetRow[]): object` that produces:

```json
{
  "version": 1,
  "assets": {
    "<assetId>": { "name": "...", "type": "glyph", "codepoint": <int>, "ascent": <int>, "height": <int> }
  }
}
```

Include all assets (texture + glyph), but `codepoint` is omitted for non-glyph or null-codepoint rows.

Tests:
- Empty assets → `{ version: 1, assets: {} }`
- Glyph emits codepoint + ascent + height
- Texture omits codepoint
- Multiple assets are keyed by id

- [ ] Commit:
  ```bash
  git add backend/src/lib/assetIndexBuilder.ts backend/src/lib/assetIndexBuilder.test.ts
  git commit -m "feat(backend): assetIndexBuilder for pack-embedded catalog"
  ```

---

### Task 15: Embed `asset-index.json` in the pack zip

**Files:**
- Modify: `backend/src/lib/resourcePackBuilder.ts`
- Modify: `backend/src/lib/resourcePackBuilder.test.ts`

In `buildResourcePackZip`, add to the `files` map before zipping:

```ts
import { buildAssetIndex } from "./assetIndexBuilder";

// ... existing code ...
files["assets/interfaze/asset-index.json"] =
  strToU8(JSON.stringify(buildAssetIndex(assets), null, 2));
```

Update tests to assert the new file is present in the zip and parses correctly. Also assert the hash *changes* when assets change (this should already be true via the other content; just confirm).

- [ ] Commit:
  ```bash
  git add backend/src/lib/resourcePackBuilder.ts backend/src/lib/resourcePackBuilder.test.ts
  git commit -m "feat(backend): embed asset-index.json in resource pack zip"
  ```

---

### Task 16: Plugin — `MenuTitleLayer.kt` + YAML parsing

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/model/MenuTitleLayer.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/model/Menu.kt` (or the file holding the `Menu` class) — change `title: LText` to `title: List<MenuTitleLayer>`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/engine/BundleCompiler.kt` (or wherever menu YAML is parsed) — read the title array; tolerate legacy String

```kotlin
// MenuTitleLayer.kt
package gg.interfaze.plugin.model

sealed class MenuTitleLayer {
    data class Background(val assetId: String) : MenuTitleLayer()
    data class Glyph(val assetId: String, val x: Int, val y: Int) : MenuTitleLayer()
    data class Text(
        val value: LText,
        val x: Int,
        val y: Int,
        val fontAssetId: String? = null,
        val color: String? = null,
    ) : MenuTitleLayer()
    data class ExternalGlyph(
        val provider: String,
        val glyphName: String,
        val x: Int,
        val y: Int,
    ) : MenuTitleLayer()
}
```

YAML parser logic (in `BundleCompiler` or `MenuYamlMapper`):

```kotlin
fun parseTitle(node: Any?): List<MenuTitleLayer> = when (node) {
    null -> emptyList()
    is String -> listOf(MenuTitleLayer.Text(value = LText.literal(node), x = 8, y = 5))
    is Map<*, *> -> { /* single-layer map: treat as if [it] */ listOf(parseTitleLayer(node)) }
    is List<*> -> node.mapNotNull { (it as? Map<*, *>)?.let(::parseTitleLayer) }
    else -> emptyList()
}

private fun parseTitleLayer(m: Map<*, *>): MenuTitleLayer = when (m["kind"]) {
    "background" -> MenuTitleLayer.Background(assetId = m["asset_id"] as String)
    "glyph" -> MenuTitleLayer.Glyph(
        assetId = m["asset_id"] as String,
        x = (m["x"] as? Number)?.toInt() ?: 0,
        y = (m["y"] as? Number)?.toInt() ?: 0,
    )
    "text" -> MenuTitleLayer.Text(
        value = parseLText(m["value"]),
        x = (m["x"] as? Number)?.toInt() ?: 0,
        y = (m["y"] as? Number)?.toInt() ?: 0,
        fontAssetId = m["font_asset_id"] as? String,
        color = m["color"] as? String,
    )
    "external_glyph" -> MenuTitleLayer.ExternalGlyph(
        provider = m["provider"] as String,
        glyphName = m["glyph_name"] as String,
        x = (m["x"] as? Number)?.toInt() ?: 0,
        y = (m["y"] as? Number)?.toInt() ?: 0,
    )
    else -> error("Unknown title layer kind: ${m["kind"]}")
}
```

Tests:
- Parse a legacy `title: "<string>"` → one text layer at (8,5)
- Parse a layered title with all 4 kinds
- Unknown kind throws
- `parseTitle(null)` returns empty

Use the existing `BundleCompilerTest` or create a new `MenuYamlMapperTest`. Add ~6 tests.

- [ ] Commit:
  ```bash
  git add plugin/src/main/kotlin/gg/interfaze/plugin/model/MenuTitleLayer.kt plugin/src/main/kotlin/gg/interfaze/plugin/model/Menu.kt plugin/src/main/kotlin/gg/interfaze/plugin/engine/BundleCompiler.kt plugin/src/test/kotlin/gg/interfaze/plugin/BundleCompilerTest.kt
  git commit -m "feat(plugin): MenuTitleLayer model + YAML parsing"
  ```

---

### Task 17: Plugin — `AssetCatalog`

**Files (both new):**
- `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/AssetCatalog.kt`
- `plugin/src/test/kotlin/gg/interfaze/plugin/AssetCatalogTest.kt`

A service that downloads the resource pack zip via OkHttp and parses `assets/interfaze/asset-index.json` to build a `Map<String, AssetEntry>`. Atomic swap on update.

```kotlin
package gg.interfaze.plugin.resourcepack

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipInputStream

data class AssetEntry(
    val name: String,
    val type: String,
    val codepoint: Int?,
    val ascent: Int,
    val height: Int,
) {
    val codepointChar: Char? get() = codepoint?.let { it.toChar() }
}

class AssetCatalog(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val mapper: ObjectMapper = ObjectMapper(),
) {
    private val state = AtomicReference<Map<String, AssetEntry>>(emptyMap())

    fun lookup(assetId: String): AssetEntry? = state.get()[assetId]

    fun update(packUrl: String, expectedHash: String) {
        val req = Request.Builder().url(packUrl).build()
        httpClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return
            val body = resp.body?.byteStream() ?: return
            ZipInputStream(body).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (entry.name == "assets/interfaze/asset-index.json") {
                        val json = zip.readBytes().toString(Charsets.UTF_8)
                        state.set(parse(json))
                        return
                    }
                    entry = zip.nextEntry
                }
            }
        }
    }

    private fun parse(json: String): Map<String, AssetEntry> {
        val root = mapper.readTree(json)
        val assets = root["assets"] ?: return emptyMap()
        val out = mutableMapOf<String, AssetEntry>()
        assets.fields().forEach { (id, node) ->
            out[id] = AssetEntry(
                name = node["name"].asText(),
                type = node["type"].asText(),
                codepoint = if (node["codepoint"]?.isNumber == true) node["codepoint"].asInt() else null,
                ascent = node["ascent"]?.asInt() ?: 0,
                height = node["height"]?.asInt() ?: 0,
            )
        }
        return out
    }
}
```

Tests using `MockWebServer` (already a dep in plugin tests for the bundle downloader):
- Empty initial state — `lookup("x") == null`
- After `update()` with a mock zip containing `asset-index.json`, `lookup("asset_a1b2c3")` returns the parsed entry
- HTTP failure → state unchanged

Wire into `ResourcePackManager.onUpdate`: after setting `currentPackInfo`, call `assetCatalog.update(info.url, info.hash)` on a background thread.

- [ ] Commit:
  ```bash
  git add plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/AssetCatalog.kt plugin/src/test/kotlin/gg/interfaze/plugin/AssetCatalogTest.kt plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackManager.kt
  git commit -m "feat(plugin): AssetCatalog (zip-embedded asset index)"
  ```

---

### Task 18: Plugin — `TitleCompiler`

**Files (both new):**
- `plugin/src/main/kotlin/gg/interfaze/plugin/render/TitleCompiler.kt`
- `plugin/src/test/kotlin/gg/interfaze/plugin/TitleCompilerTest.kt`

Pure function `compileTitle(layers, lang, pack, assetCatalog, externalGlyphsCatalog): Component`. Walks the layers, builds a MiniMessage string segment per layer, and finally renders the concatenated string via `MiniMessage.miniMessage().deserialize(...)`.

```kotlin
package gg.interfaze.plugin.render

import gg.interfaze.plugin.model.MenuTitleLayer
import gg.interfaze.plugin.model.Pack
import gg.interfaze.plugin.resourcepack.AssetCatalog
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage

object TitleCompiler {
    fun compileTitle(
        layers: List<MenuTitleLayer>,
        lang: String,
        pack: Pack,
        assetCatalog: AssetCatalog,
        externalGlyphsCatalog: ExternalGlyphsCatalog? = null,
    ): Component {
        if (layers.isEmpty()) return Component.empty()
        val sb = StringBuilder()
        for (layer in layers) {
            sb.append(compileLayer(layer, lang, pack, assetCatalog, externalGlyphsCatalog))
        }
        return MiniMessage.miniMessage().deserialize(sb.toString())
    }

    private fun compileLayer(
        layer: MenuTitleLayer,
        lang: String,
        pack: Pack,
        assetCatalog: AssetCatalog,
        externalGlyphsCatalog: ExternalGlyphsCatalog?,
    ): String = when (layer) {
        is MenuTitleLayer.Background -> {
            val entry = assetCatalog.lookup(layer.assetId) ?: return ""
            val ch = entry.codepointChar ?: return ""
            // No offset for backgrounds — they anchor at the title baseline.
            "<font:interfaze:default>${escapeChar(ch)}</font>"
        }
        is MenuTitleLayer.Glyph -> {
            val entry = assetCatalog.lookup(layer.assetId) ?: return ""
            val ch = entry.codepointChar ?: return ""
            wrapOffset(layer.x, "<font:interfaze:default>${escapeChar(ch)}</font>")
        }
        is MenuTitleLayer.Text -> {
            val text = getText(pack, layer.value, lang)
            val colored = layer.color?.let { "<color:$it>$text</color>" } ?: text
            // fontAssetId is forward-compat — Sub-project 4 wraps in <font:interfaze:my_font>.
            wrapOffset(layer.x, colored)
        }
        is MenuTitleLayer.ExternalGlyph -> {
            val glyph = externalGlyphsCatalog?.lookup(layer.provider, layer.glyphName) ?: return "□"
            wrapOffset(layer.x, "<font:${glyph.namespace}:default>${escapeChar(glyph.char)}</font>")
        }
    }

    private fun wrapOffset(xPixels: Int, body: String): String =
        if (xPixels == 0) body else "<offset:${xPixels}px>$body</offset>"

    private fun escapeChar(ch: Char): String = ch.toString()  // Adventure handles raw chars in MiniMessage
}
```

Tests:
- Empty layers → `Component.empty()`
- Text only at x=10, color=#FFAA00 → contains `<offset:10px><color:#FFAA00>hello</color></offset>` (assert via reflection on the compiled string before deserialize, OR use Adventure's serializer to round-trip)
- Glyph layer → `<font:interfaze:default>` + the codepoint char
- External glyph with missing catalog → falls back to "□"
- Background layer renders without offset

For the "assert the intermediate string" pattern: make `compileLayer` package-private or extract `compileLayerString(...)` as `internal` so tests can assert text-level. This keeps Adventure assertions clean.

`getText(pack, value, lang)` is an existing helper (used by `MenuRenderer`). `ExternalGlyphsCatalog` exists in the custom-items work — confirm its interface.

- [ ] Commit:
  ```bash
  git add plugin/src/main/kotlin/gg/interfaze/plugin/render/TitleCompiler.kt plugin/src/test/kotlin/gg/interfaze/plugin/TitleCompilerTest.kt
  git commit -m "feat(plugin): TitleCompiler (layers → MiniMessage)"
  ```

---

### Task 19: Plugin — wire `TitleCompiler` into `MenuRenderer`

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/render/MenuRenderer.kt`

Find the place where the inventory title is currently set from `menu.title`. It's likely something like:

```kotlin
val title = getText(pack, menu.title, lang)
val inv = Bukkit.createInventory(holder, rows * 9, MiniMessage.miniMessage().deserialize(title))
```

Replace with:

```kotlin
val title = TitleCompiler.compileTitle(menu.title, lang, pack, assetCatalog, externalGlyphsCatalog)
val inv = Bukkit.createInventory(holder, rows * 9, title)
```

`assetCatalog` and `externalGlyphsCatalog` need to be injected into `MenuRenderer` (constructor or setter). Plumb them from `InterfazePlugin` where the renderer is constructed.

Update `InterfazePlugin.kt` to:
1. Instantiate the `AssetCatalog` once
2. Pass it to `MenuRenderer`
3. Hook `assetCatalog.update(info.url, info.hash)` from `ResourcePackManager.onUpdate` (done in Task 17 already — verify)

Run `./gradlew test`. The existing `MenuRendererTest` may need updates if it asserted on the raw text title.

- [ ] Commit:
  ```bash
  git add plugin/src/main/kotlin/gg/interfaze/plugin/render/MenuRenderer.kt plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt plugin/src/test/kotlin/gg/interfaze/plugin/MenuRendererTest.kt
  git commit -m "feat(plugin): MenuRenderer uses TitleCompiler"
  ```

---

### Task 20: Docs

**Files:**
- Modify: `CLAUDE.md`

Add a small section under "Structure des packs sur disque" describing the new title YAML format. Update test counts after the suites are run.

- [ ] Commit:
  ```bash
  git add CLAUDE.md
  git commit -m "docs: menu title layer format + test counts"
  ```

---

## Final verification

- [ ] `cd backend && bun test` → 0 regressions, new asset-index tests pass
- [ ] `cd editor && npx vitest run` → 0 regressions, new title-composer tests pass
- [ ] `cd editor && npx tsc --noEmit` → no new errors
- [ ] `cd plugin && ./gradlew test` → 0 regressions, new title-compiler + asset-catalog tests pass
- [ ] Manual smoke test:
  1. Open editor, edit a menu, drag a glyph from the asset library into the title composer, drag it to position (32, 4)
  2. Verify the layer list shows it and the mockup updates live
  3. Save the menu; check the exported YAML has the layer
  4. Restart the backend (or trigger a rebuild) — check the resource pack zip contains `asset-index.json`
  5. Restart the Minecraft container; join the server; open the menu in-game; verify the glyph appears at the right position in the chest title bar

---

## Self-review vs spec § Domain Model > MenuTitle and § Compilation runtime

(Full mapping was produced by the planning agent — see chat history. Every requirement maps to a task. Deferrals: custom font rendering (S-P 4), background-as-full-cover polish (S-P 4), external glyph picker UI (S-P 5).)
