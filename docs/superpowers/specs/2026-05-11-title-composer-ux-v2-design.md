# Title Composer UX v2 — Design Spec

**Date:** 2026-05-11
**Status:** Draft (post-brainstorm)
**Scope:** Editor-only — runtime plugin and backend unchanged.

## Goal

Replace the current Title Composer (delivered in SP3 + SP4) with a more
direct visual editor where an admin can compose a Minecraft chest title bar
without learning the underlying glyph / codepoint / ascent / offset
abstractions. The runtime contract (`MenuTitleLayer[]` → `MiniMessage` via
`TitleCompiler.kt`) stays frozen; the editor's responsibility is to project
its higher-level UI onto that contract at save time.

Three concrete pain points the v1 composer left on the table:

1. **"Background" vs "glyph" is a runtime distinction leaking into UX.** A user
   who just wants an image somewhere has to learn that backgrounds are
   anchored at the baseline and glyphs use `<offset>`. They aren't different
   things in the user's head.
2. **Editing a colored title regressed.** Pre-SP3 a single text field with
   live MiniMessage preview was enough. SP3 forced everyone through a
   layered, single-color-per-layer UI and lost the preview.
3. **The pack canvas (Stage) doesn't show the title in its final form.** It
   renders only the first text layer, so an admin can't tell at a glance
   what a deployed menu actually looks like.

## Non-goals

- Multi-color text via a WYSIWYG toolbar. Target users (server admins) know
  MiniMessage; the toolbar is overkill.
- Inline text editing on the canvas. The textarea lives in a side panel,
  not inside the layer itself.
- Touch-first / mobile parity. Defer to a follow-up if needed; v2 targets
  desktop editing primarily but keeps the mobile-first principles for the
  side panel (no hover-only affordances).
- External-glyph picker UI. Stays in Sub-project 5.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│ Pack canvas (Stage.tsx, EXISTING)                                       │
│   - Renders every MenuGroup at its layout coords                        │
│   - MenuGroup uses <TitleRender layers={menu.title} mode="compact" />   │
│     to draw the FULL title composition (replaces the current single-    │
│     line MiniMessageKonvaText).                                         │
│   - Slot items render unchanged, on top of the title.                   │
└───────────┬───────────────────────────────────────────────────────────┘
            │ click a menu
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Properties pane (existing right-side panel)                             │
│   - Menu-level controls (rows, permission, context inputs) UNCHANGED    │
│   - "Title" section: thumbnail preview + button "Edit title…"           │
└───────────┬───────────────────────────────────────────────────────────┘
            │ click "Edit title…"
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│ FOCUS MODE — Title Composer v2 (takes over the editor main pane)        │
│   ┌─────────────────────────────────────┬───────────────────────────┐ │
│   │ Composer canvas (TitleRender + drag)│ Layer side panel          │ │
│   │   - Title bar at 2× scale           │   - Selected layer props  │ │
│   │   - Full-chest body if any image is │   - Text: MiniMessage     │ │
│   │     "stretchToChest"                │     textarea + preview    │ │
│   │   - Layers drag/click-select        │   - Image: thumbnail +    │ │
│   │   - Snap (px / Shift raw / Alt 18)  │     "Stretch to chest" +  │ │
│   │                                     │     dims                  │ │
│   │                                     │   - Position x/y inputs   │ │
│   │                                     │   - Delete button         │ │
│   └─────────────────────────────────────┴───────────────────────────┘ │
│   Bottom bar: [← Back] [+ Image] [+ Text] · compact layer list (z)    │
└───────────────────────────────────────────────────────────────────────┘
```

**Key insight:** the heart of the redesign is a new shared Konva subtree,
`TitleRender`. It renders a `MenuTitleLayer[]` faithfully — including image
glyphs, MiniMessage-styled text, and stretched backgrounds — and it has
two render modes:

- `mode="compact"` — for `MenuGroup` (pack canvas). Read-only. No drag
  handles, no selection halo.
- `mode="edit"` — for the focus-mode composer. Layers are draggable,
  selection halos drawn, click toggles selection store.

Both modes share the same rendering of each layer kind, so what the user
sees on the pack canvas is what they see in the composer and what the
plugin emits in-game.

## Domain Model

### Editor-side (TS)

The domain stays `MenuTitleLayer[]` (runtime contract is frozen). What
changes is what the UI surfaces:

| Runtime kind | UI representation v2 |
|---|---|
| `background` | Image layer with `stretchToChest: true` |
| `glyph` | Image layer with `stretchToChest: false` |
| `text` | Text layer (color/font hint via MiniMessage tags inside `value`) |
| `external_glyph` | (Sub-project 5; not in UI yet) |

The TS union stays as-is so existing data round-trips. The new UI types
sit ON TOP, in a derived "view" model used only by the composer:

```ts
// editor/src/features/canvas/title/composer/types.ts (new)
export type UiLayer =
  | { kind: "image"; assetId: AssetId; x: number; y: number; stretchToChest: boolean }
  | { kind: "text"; value: LText; x: number; y: number; fontAssetId?: AssetId };
```

Mapping functions in `editor/src/features/canvas/title/composer/uiLayerMapping.ts`:

```ts
export function toUiLayers(layers: MenuTitleLayer[]): UiLayer[];
export function fromUiLayers(uiLayers: UiLayer[]): MenuTitleLayer[];
```

Round-trip rules:

- Runtime `background` → UI `image { stretchToChest: true, x: 0, y: 0 }` (the
  runtime layer has no x/y; we synthesise zeros for the UI).
- Runtime `glyph` → UI `image { stretchToChest: false, x, y }`.
- Runtime `text { value, x, y, fontAssetId, color? }` → UI `text { value, x, y, fontAssetId }`.
  **`color` is dropped on read** (deprecated; if present it's silently
  folded into the LText value as `<color:$it>$value</color>` at save time
  for backward compat).
- Reverse:
  - UI `image { stretchToChest: true }` → runtime `background { assetId }` (x/y discarded).
  - UI `image { stretchToChest: false }` → runtime `glyph { assetId, x, y }`.
  - UI `text` → runtime `text { value, x, y, fontAssetId, color: undefined }`.
- **External glyph passthrough.** Runtime `external_glyph` layers have no
  v2 UI representation (Sub-project 5). The mapping preserves them as
  an opaque "passthrough" UI layer that renders as a dashed placeholder
  on the canvas and is not editable in the side panel (read-only "External
  glyph — managed by SP5" message). On save, the layer is written back
  unchanged to `MenuTitleLayer[]`. This guarantees round-trip totality.

### Why a derived UI model?

- Decouples user-facing concepts from runtime kinds (so adding
  `stretchToChest: "tile"` later wouldn't touch the runtime).
- Round-trip is total and lossless modulo the `color` field (intentionally
  dropped — replaced by MiniMessage tags).
- Tests can exercise the mapping in isolation.

### Asset model unchanged

The `Asset` record (`type: "texture" | "glyph" | "font"`, codepoint, ascent,
height, fontMeta) is untouched. The UI layer's `assetId` still points at
one. Background/glyph distinction at the asset level no longer exists in
v2 — both are glyph-typed assets at the runtime level. The "+ Background"
filter from the v1 picker is gone; "+ Image" filters to `type === "glyph"`
across the board.

(Note: SP3 was patched today to filter "+ Background" to glyph already; v2
just renames the button.)

## Composer Layout (Focus Mode)

### Trigger

In `MenuProperties.tsx`, the current `<TitleComposer>` block is replaced by:

```
┌─────────────────────────────────┐
│ Title                           │
│ ┌─────────────────────────────┐ │   ← thumbnail preview (<TitleRender mode="compact" />)
│ │  Shop                       │ │     at small scale (1× or 0.5× of MC px)
│ └─────────────────────────────┘ │
│ [Edit title…]                   │   ← button opens focus mode
└─────────────────────────────────┘
```

Clicking "Edit title…" sets a UI store flag `titleComposerOpen: { packId, menuId }`
and the editor's main pane switches to the composer view.

### Layout

When focus mode is active:

```
┌──────────────────────────────────────────────────────────────────────┐
│ [← Back] · Editing title — shop_menu                                  │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  ┌─────────────────────┐ │
│  │                                        │  │ Selected layer      │ │
│  │   Composer canvas                      │  │                     │ │
│  │   - Title bar (or full chest if a      │  │ Text (MM):          │ │
│  │     stretched image exists)            │  │ ┌─────────────────┐ │ │
│  │   - Layers drawn via TitleRender       │  │ │<gold>Shop</gold>│ │ │
│  │     mode="edit"                        │  │ └─────────────────┘ │ │
│  │   - Drag layers, click to select       │  │ Preview:            │ │
│  │   - 352px wide minimum, full-chest     │  │  Shop  (gold)       │ │
│  │     mode = ~310px tall                 │  │                     │ │
│  │                                        │  │ Font: [vanilla ▾]   │ │
│  │                                        │  │ Position: x  y      │ │
│  │                                        │  │                     │ │
│  │                                        │  │ [Delete]            │ │
│  └────────────────────────────────────────┘  └─────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│ [+ Image]  [+ Text]   |   🖼 logo  T <gold>Shop</gold>   ← layer list │
└──────────────────────────────────────────────────────────────────────┘
```

Files (new):

- `editor/src/features/canvas/title/composer/FocusComposer.tsx` — top-level focus-mode container
- `editor/src/features/canvas/title/composer/ComposerCanvas.tsx` — the central Konva area + drag handlers
- `editor/src/features/canvas/title/composer/LayerSidePanel.tsx` — context-sensitive right panel
- `editor/src/features/canvas/title/composer/AddLayerBar.tsx` — bottom bar with + buttons + compact layer list
- `editor/src/features/canvas/title/composer/TitleRender.tsx` — shared rendering (compact + edit modes)

Files (modify):

- `editor/src/features/canvas/MenuGroup.tsx` — use `<TitleRender mode="compact" />` for the title bar instead of the single MiniMessageKonvaText line
- `editor/src/features/canvas/properties/MenuProperties.tsx` — replace inline composer with the thumbnail+button pattern
- `editor/src/state/uiStore.ts` — add `titleComposerOpen` state and toggle actions
- Top-level editor route (likely `routes/pack.$packId.tsx`) — when `titleComposerOpen` is set, render `FocusComposer` instead of the normal main pane

Files (deleted in this redesign):

- `editor/src/features/canvas/title/TitleComposer.tsx` (replaced by FocusComposer)
- `editor/src/features/canvas/title/TitleMockup.tsx` (replaced by ComposerCanvas + TitleRender)
- `editor/src/features/canvas/title/TitleLayerList.tsx` (replaced by AddLayerBar's compact list)
- `editor/src/features/canvas/title/TitleLayerItem.tsx` (same)
- `editor/src/features/canvas/title/TitleTextEditor.tsx` (replaced by LayerSidePanel's text branch)
- `editor/src/features/canvas/title/titleSelectionStore.ts` (kept — same role)

## TitleRender — shared rendering

```tsx
interface TitleRenderProps {
  menu: Menu;
  pack: Pack;
  activeLang: string;
  scale: number;              // TEX_SCALE (2) for composer, 1 (or smaller) for thumbnail/pack-canvas
  mode: "compact" | "edit";
  selectedLayerIndex?: number;  // edit mode only
  onLayerClick?: (index: number) => void;
  onLayerDrag?: (index: number, x: number, y: number) => void;
}
```

Renders all layers (background → glyphs → texts) in z-order. For:

- **Image layers**: KonvaImage from `assetPreviewUrl(asset)`. If
  `stretchToChest === true`, render full title-bar width starting at the
  title baseline, dimensions = asset's intrinsic dims (which the user
  controls via their PNG dimensions + ascent).
- **Text layers**: `MiniMessageKonvaText` (existing, used by MenuGroup
  already) for rendering colored / styled text from the resolved
  LText value. If `layer.fontAssetId` is set AND the font asset is in the
  store, switch to `McFontText` for pixel-perfect bitmap font rendering
  (existing in SP4).
- **External glyphs**: dashed placeholder (compact) or amber outlined
  placeholder (edit). Until SP5.

In `mode="edit"`, each layer is wrapped in a draggable `Group` with click
handler firing `onLayerClick(idx)`. Selected layer gets a 1px emerald
selection halo (existing pattern from SP3).

In `mode="compact"`, layers are non-interactive (`listening={false}`).

## Pack Canvas — final-form rendering

`MenuGroup.tsx:710` currently has:

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
  menu={menu}
  pack={pack}
  activeLang={activeLang}
  scale={TEX_SCALE}
  mode="compact"
/>
```

For stretched-image layers in `mode="compact"`, the image is drawn under
the slot grid (z-order via Konva node order). Items in slots remain
listening + draggable. Items overlap the image naturally.

The existing dblclick title-bar overlay (`onTitleDblClick`) which opens
the legacy single-line text editor (`TextEditor.tsx`) is **removed** in
v2 — dblclick on a menu's title bar instead opens the focus-mode composer:

```tsx
const openComposer = () => useUiStore.getState().openTitleComposer(packId, menu.id);
<Rect ... onDblClick={openComposer} onDblTap={openComposer} />
```

`TextEditor.tsx` is deleted (the legacy single-line title editor; was kept
in SP3 for backward-compat). After v2 lands there's no other path that
needs it — the composer covers every title-editing need.

## Side Panel — by layer kind

### When no layer is selected

```
┌─────────────────────┐
│ No layer selected   │
│                     │
│ Click a layer on    │
│ the canvas, or use  │
│ + Image / + Text    │
│ below.              │
└─────────────────────┘
```

### When a Text layer is selected

```
┌─────────────────────────────────────┐
│ Text layer                          │
│                                     │
│ Text (MiniMessage)                  │
│ ┌─────────────────────────────────┐ │
│ │ <gold>Shop</gold>               │ │   ← textarea, monospace,
│ │                                 │ │     ~3 rows, vertical resize
│ └─────────────────────────────────┘ │
│                                     │
│ Preview                             │
│ ┌─────────────────────────────────┐ │
│ │ Shop                            │ │   ← MiniMessageInline rendering
│ └─────────────────────────────────┘ │
│                                     │
│ Font  [vanilla ▾]                   │   ← dropdown listing font assets +
│                                     │     "vanilla" as default
│                                     │
│ Position  x [8]  y [5]              │   ← number inputs, also reflect drag
│                                     │
│ [Delete layer]                      │
└─────────────────────────────────────┘
```

- The textarea binds to `layer.value` via the existing `setI18nValue`
  store action; it operates on the active language.
- Preview is a `MiniMessageInline` (HTML), shows the parsed result with
  colors, fonts, etc. — mirrors what the canvas shows.
- Font dropdown: lists `useAssetStore.assets.filter(a => a.type === "font")`
  + an explicit "vanilla" entry that maps to `fontAssetId = undefined`. No
  AssetPicker modal.
- Position inputs are bidirectional with drag-on-canvas: dragging updates
  them, typing in them moves the layer.
- Delete button removes the layer + closes the side panel.

### When an Image layer is selected

```
┌─────────────────────────────────────┐
│ Image layer                         │
│                                     │
│ ┌────────┐  asset_name              │
│ │  IMG   │  glyph · 32 × 8 px       │
│ └────────┘                          │
│                                     │
│ ☐ Stretch to chest (full cover)     │
│                                     │
│ Position  x [32]  y [4]             │   ← disabled if stretchToChest
│                                     │
│ [Delete layer]                      │
└─────────────────────────────────────┘
```

- Thumbnail uses `assetPreviewUrl(asset)`.
- "Stretch to chest" toggles the runtime kind via the mapping (UI image
  with stretch=true → runtime background; otherwise glyph).
- "Too small" hint: if `asset.width < 176` (chest content area MC px), show
  an inline warning under the toggle: "Image is N px wide — Minecraft chest
  is 176 px. It won't cover horizontally." The toggle stays enabled (user
  can still pick "stretch" semantics; they may have intended a partial-bar
  cover).
- Position inputs are **visible but disabled** (greyed out, non-interactive)
  when `stretchToChest === true` (background has no x/y in the runtime
  model). The greyed state makes the relationship clear instead of hiding
  the fields.

## Add Layer Bar (bottom)

```
┌──────────────────────────────────────────────────────────────────┐
│ [← Back] [+ Image] [+ Text]  │  🖼 logo  T <gold>Shop</gold>     │
└──────────────────────────────────────────────────────────────────┘
```

- **+ Image** → opens the existing `AssetPicker` filtered to `type === "glyph"`.
  Picking adds a UI image layer at the canvas center. If the user wants a
  background-style cover, they toggle "Stretch to chest" in the side panel
  after creation. Includes a footer "Upload new…" link that opens
  `AssetUploadDialog` (type=glyph) — the dialog already exists.
- **+ Text** → adds a UI text layer with a freshly minted i18n key and
  default position (x=8, y=5). Auto-selects it so the side panel opens.
- The compact layer list at right shows one chip per layer with:
  - 🖼 icon for image layers + asset name
  - T icon for text layers + truncated value
  - Drag to reorder z (last in array = on top, matches runtime)
  - Click to select (mirrors canvas click)
- Selected layer chip gets a green border + filled background.

### Drag-drop from OS

`ComposerCanvas` accepts native HTML5 drop events for `image/png`. On
drop:

1. Calls `uploadAsset(token, { file, type: "glyph", name: derivedFromFilename })`.
2. On success: `upsertAsset(asset)` + adds a UI image layer at the drop
   position (translated from drop coords to MC px).
3. On failure: toast error.

Names are auto-derived from the filename (sanitized `[a-z0-9_-]+`). If a
name clash occurs, append `_2`, `_3`, etc.

## Interactions

| Action | Result |
|---|---|
| Click empty canvas | Deselect (no layer selected) |
| Click layer | Select that layer; side panel shows its props |
| Drag layer | Move; snaps to integer MC px; Shift = sub-pixel raw; Alt = multiples of 18 (slot grid) |
| Dblclick layer (text) | Auto-focus the textarea in the side panel |
| Dblclick layer (image) | No-op (or toggle stretch?) — final UX is no-op for v2 |
| Backspace / Del with a layer selected | Delete the selected layer — **only if no text input has focus** (so the textarea in the side panel doesn't lose characters). Implemented by checking `document.activeElement` is not inside an `<input>` / `<textarea>`. |
| Ctrl+Z / Ctrl+Y | Undo / redo (add, move, delete, edit) — uses the existing accountStore undo stack if available, otherwise a per-composer-session local stack |
| Esc | Deselect |
| Drag chip in layer list | Reorder z-order |
| Click "← Back" or Esc-on-empty-canvas-twice | Exit focus mode, return to pack canvas |

Snap helpers are the same `snapDragPosition` extracted in SP3
(`editor/src/features/canvas/title/TitleMockup.tsx`). It's moved into
`composer/snap.ts` for reuse.

## Side Panel Wiring

The side panel reads / writes through existing accountStore actions:

- `updateMenuTitleLayer({ packId, menuId, index, patch })` — text/image
  property updates
- `removeMenuTitleLayer({ packId, menuId, index })` — delete
- `reorderMenuTitleLayers({ packId, menuId, fromIndex, toIndex })` — z-order
- `addMenuTitleLayer({ packId, menuId, layer })` — + buttons
- `setI18nValue({ packId, lt, lang, value })` — text textarea binding

The patch shape needs to handle the `stretchToChest` toggle, which means
re-mapping between UI Image (with `stretchToChest`) and runtime Background
(no x/y) / Glyph (with x/y) at save time. Two options:

- **Option A (preferred):** Store layers in the UI store as `UiLayer[]`
  and convert via `fromUiLayers` on every write to accountStore. The
  composer's internal state is normalised to the UI model.
- **Option B:** Keep the underlying runtime layers in accountStore and
  do round-trip conversion at component boundaries (less invasive but
  more confusing — UI model leaks out as raw runtime kinds in places).

Pick A. The composer's local state is `UiLayer[]`. On every user edit
(add, drag, text change, stretch toggle, delete, reorder), the composer
calls `fromUiLayers(uiLayers)` and dispatches
`setMenuTitleLayers({ packId, menuId, layers })` to accountStore. There is
**no manual Save button** — the rest of the editor auto-commits on every
Zustand mutation, so the composer matches that convention. Undo/redo
operates on the accountStore (existing mechanism), so it survives a
back-and-forth between the focus mode and the pack canvas.

## Migration

- Existing `menu.title: MenuTitleLayer[]` is unchanged in storage.
- On read, `toUiLayers(menu.title)` produces the UI model.
- On write, `fromUiLayers(uiLayers)` produces a fresh `MenuTitleLayer[]`.
- Legacy `text.color` field (deprecated in v2): if present on read, fold
  into the LText value via a one-time migration when the user first opens
  the composer for that menu. Specifically, the LText value becomes
  `<color:#NNNNNN>$existing</color>` and `color` is set to undefined. The
  user sees the rebound MiniMessage in the textarea.
- Plugin parser stays tolerant of either shape (already the case from SP3
  Task 16's `MenuTitleParser`).

## Testing

### New tests

- `uiLayerMapping.test.ts` — round-trip every kind permutation (bg/glyph/
  text with and without font, color migration)
- `TitleRender.test.tsx` — renders all kinds, react to selection, dispatch
  drag callbacks (use the existing `vi.mock("react-konva")` placeholder
  pattern from SP3)
- `ComposerCanvas.test.tsx` — click-empty deselects, drag dispatches store
  update, drop-from-OS calls uploadAsset+addLayer
- `LayerSidePanel.test.tsx` — textarea binds to setI18nValue, font
  dropdown toggles fontAssetId, stretch toggle re-routes runtime kind
- `FocusComposer.test.tsx` — back button exits focus mode, Esc-twice
  exits, +Image opens picker, +Text adds and auto-selects
- `MenuGroup.test.tsx` — pack-canvas tile renders all title layers via
  TitleRender (this is a new test file; SP3's TitleMockup tests get
  superseded)

### Tests retired

- `TitleComposer.test.tsx`, `TitleMockup.test.tsx`, `TitleLayerList.test.tsx`,
  `TitleTextEditor.test.tsx` — all deleted along with their source files.

### Manual smoke

1. Open a menu, click "Edit title…" → focus mode opens
2. Drop a PNG from the OS onto the canvas → asset uploads, layer appears
3. Toggle "Stretch to chest" → mockup expands to show the chest body
4. Add a text layer, type `<gold>Hello</gold>` in the textarea → preview
   shows gold "Hello" both in side panel and on the composer canvas
5. Click "← Back" → pack canvas shows the menu's tile with the title
   rendered identically to the focus mode (just smaller)
6. Deploy → in-game title matches what the editor showed

## Decision Log

| Decision | Choice | Justification |
|---|---|---|
| Editing paradigm | **Canvas + side panel (Figma-style)** | User feedback: visual design first. Canvas for spatial, panel for content. |
| Background vs glyph | **Collapsed into Image layer** | User: "Pour moi un background est un glyph." Same mental model. |
| Text styling UX | **MiniMessage textarea + live preview** | Admins know MM. Toolbar was overkill; preview is the value-add. |
| Composer location | **Focus mode (full main pane)** | Sized for the 352×~310px full-chest preview. Properties panel was too cramped. |
| Pack canvas rendering | **Full title composition** | User wants menus in final form on pack canvas, not just first text layer. |
| `layer.color` field | **Deprecated; folded into MiniMessage tags** | Single source of truth for color. Migration is one-time. |
| UI layer model | **Derived view model + mapping** | Decouples UI from runtime. Makes future runtime kinds (tile pattern, etc.) UI-extensible without touching the plugin. |
| Save semantics | **Auto-save on every edit** | Matches the rest of the editor. No "Save" button. |
| Inline text editing | **Out** | MiniMessage tags + rendered output have no clean caret-position mapping. Side panel keeps the model honest. |
| Multi-select | **Out (v2)** | Defer to v3 if the need surfaces. |
| Mobile parity | **Best-effort** | Side panel + canvas works on tablets+. Touch-first redesign is a separate sub-project. |

## Out of scope / future work

- Tile-pattern backgrounds (repeating textures)
- Asset picker integrated into the canvas as a side rail (instead of modal)
- Multi-language preview switcher inside the composer
- Animated glyph frames (per spec § Open Questions)
- Touch gestures (pinch-to-zoom, two-finger pan)
- Templates / presets (e.g., "RPG shop title", "Quest log header")
- Snap guides between layers (smart alignment lines like Figma)

## Sub-project decomposition

This redesign is itself one sub-project, but breaks naturally into 3
implementation phases:

1. **Foundation** — UI layer model + TitleRender + mapping (no UX change yet)
2. **MenuGroup integration** — pack canvas shows final form
3. **Focus composer** — replaces TitleComposer with the new FocusComposer + side panel

Each phase produces a usable intermediate state. Phase 1 lands without
visible UX change. Phase 2 visibly improves the pack canvas. Phase 3 lands
the new editor. The implementation plan (next step) will lay this out as
individual tasks.
