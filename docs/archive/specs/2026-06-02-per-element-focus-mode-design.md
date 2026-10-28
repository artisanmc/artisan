# Per-Element Focus Mode — Design

> ⚠️ **SUPERSEDED (2026-06-13)** by [`2026-06-13-workspace-board-curation-design.md`](./2026-06-13-workspace-board-curation-design.md). The focus mode described here was **built and then reverted**: it failed because of two parallel editing surfaces (the canvas + separate `MenuEditor`/`CommandEditor`/`DialogEditor` editors) that **diverged**. The new spec keeps the per-element view but (1) enforces a **single shared rendering** board↔individual view (no editor rewrite), and (2) replaces "the canvas keeps everything" with a **curated board + source-of-truth panel**. Kept for its per-type editor designs (Menu/Command/Dialog), reusable as the content of the individual view.

> Spec brainstormed on 2026-06-02 to declutter the editor when working on ONE element, while keeping the multi-element canvas as the main overview.

**Status** — Superseded (see banner above). Never shipped (reverted).

---

## 1. Goal

Today the workspace = a unified Konva canvas that mixes menus, commands and dialogs on the same surface, with a properties panel on the right (~280 px) to edit the details of the selected element. The canvas is valuable for visualizing inter-element relations through edges, but it squeezes commands and dialogs into an editing space that is too narrow. When a HUD module arrives, the situation will get worse.

**This spec does not replace the canvas** — it keeps its value as the single overview. Instead, we add:

1. **A cleanliness refactor**: `MenuGroup.tsx` (1066 lines) and `Stage.tsx` (528 lines) are split into single-responsibility components (~200 lines max). Mandatory prerequisite — we do not add new code on files of this size.
2. **A focus mode**: a new route `/workspace/$id/element/$elementId` that gives the whole screen to ONE element, with an editor suited to its type. Reachable by double-click on the canvas or a dedicated button in the properties panel. Closable with `Esc` or a back button.

## 2. Non-goals (explicit out-of-scope)

These items were discussed in brainstorming and are **deliberately postponed**:

| Item | Reason for skipping |
|---|---|
| Cross-element navigation (forward jumps "Opens menu X" + reverse links "Used by /shop" + backstack) | The canvas edges are enough in V1. To add when a concrete gap emerges. |
| Sidebar drill-in (which would switch to the element list in focus mode) | The workspace sidebar stays stable everywhere — less navigation complexity. |
| Native Minecraft dialog preview | Requires a 1.21+ dialog renderer; slot planned for V2. V1 = form + actions chain like a command. |
| Full replacement of the canvas by the focus mode | The canvas has an overview value that exists nowhere else. The focus mode augments it, it does not replace it. |
| Removal of the persisted `canvasLayout` on the Pack | Still used by the canvas. |
| New element creation flow (sidebar `+` with type picker) | Creation stays on the canvas via the existing `NewMenuDialog` / `NewCommandDialog` / `NewDialogDialog` components. Consistent with "the canvas stays the main view". |

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  /workspace/$workspaceId                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Top bar (pack name, lang, undo/redo, branch, deploy)    │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ Tabs: overview | translations | data-sources | servers  │    │
│  ├──────────────────────────────────────┬──────────────────┤    │
│  │ Stage (Konva)                        │ EditorPane        │    │
│  │  - MenuGroup × N                     │  - Edit / Library │    │
│  │  - CommandGroup × N                  │  - Assets         │    │
│  │  - DialogGroup × N                   │                   │    │
│  │  - Edges                             │  + "Focus" button │    │
│  └──────────────────────────────────────┴──────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
        │  double-click an element              ↓ Focus button
        ▼
┌─────────────────────────────────────────────────────────────────┐
│         /workspace/$workspaceId/element/$elementId              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ← Back | 📋 elem name | lang | undo/redo | ... deploy   │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │   │
│  │              ElementEditor (router)                      │   │
│  │           dispatch on element.type                       │   │
│  │      ┌──────────────┬──────────────┬──────────────┐      │   │
│  │      │ MenuEditor   │ CommandEditor│ DialogEditor │      │   │
│  │      │ (3-col)      │ (2-col / 1)  │ (2-col / 1)  │      │   │
│  │      └──────────────┴──────────────┴──────────────┘      │   │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

The workspace tabs **disappear** in focus mode (focus is a sub-screen of `overview`). All workspace-scope actions (lang, undo, branch, deploy, kebab) **persist** in the focus top bar.

## 4. Refactor split (Phase 1 + 2)

Prerequisite to any new UX. No behavior change — file split only.

### 4.1 `MenuGroup.tsx` (1066 → ~6 files)

| File (new) | Responsibility |
|---|---|
| `MenuGroupContainer.tsx` | Orchestrator: canvas position, drag of the whole menu, selection state, plumbs props to children |
| `MenuBackground.tsx` | Rendering of the custom bg image or vanilla chest |
| `MenuSlots.tsx` | Slot grid, click handlers (open SlotEditor), drag-drop targets for Library items |
| `MenuTitle.tsx` | Title composition (integration with the existing `title/composer/`) |
| `MenuGroupInteractions.tsx` | Global menu event handlers (right-click context menu, double-click → focus mode entry) |
| `menuGeometry.ts` | Pure helpers (coordinate math: slot position from row/col, hit-test, etc.) |

The existing test suite (`MenuGroup.test.tsx`) stays — it must pass after the split with no behavior change. We can add a few unit tests on `menuGeometry.ts` (pure math, easy to test).

### 4.2 `Stage.tsx` (528 → ~4 files)

| File (new) | Responsibility |
|---|---|
| `StageContainer.tsx` | Konva Stage + Layer setup + viewport, rendering of the child groups |
| `StageZoomPan.tsx` | Wheel/pinch zoom + drag pan + bounds |
| `StageDropTarget.tsx` | Hit-test from dnd-kit (extends the existing `stageDropTarget.ts`) |
| `StageSelection.tsx` | Marquee selection rect, multi-select state + interactions |

`CommandGroup.tsx` (83 lines) and `DialogGroup.tsx` (83 lines) stay untouched.

### 4.3 Validation criterion

A file you cannot hold in your head in one read is too big. Target ≤ 200 lines per file. Test suite passes → split succeeded.

## 5. Focus mode route + dispatch (Phase 3)

### 5.1 New TanStack route

`editor/src/routes/workspace.$workspaceId.element.$elementId.tsx` — TanStack file route created next to `workspace.$workspaceId.tsx`.

Loads the pack through the existing loader (`usePackLoader` or `accountStore.packs.find(...)`), resolves the element via:

```ts
const element =
  pack.menus.find(m => m.id === elementId) ??
  pack.commands.find(c => c.id === elementId) ??
  pack.dialogs.find(d => d.id === elementId);
```

If not found → render an empty state `"This element no longer exists"` + a back button to `/workspace/$workspaceId`.

### 5.2 `ElementEditor` dispatcher

Root component of the route. Reads the resolved type and delegates:

```ts
function ElementEditor({ pack, element }: Props) {
  switch (element.kind) {
    case "menu":    return <MenuEditor pack={pack} menu={element} />;
    case "command": return <CommandEditor pack={pack} command={element} />;
    case "dialog":  return <DialogEditor pack={pack} dialog={element} />;
    default:        return <UnknownTypeFallback />;
  }
}
```

### 5.3 Focus mode top bar

Replaces the canvas top bar with:

```
← Back | 📋 shop_menu | [lang ▾] [↶][↷] [Branch ▾] ... [Deploy] [⋮]
```

- `← Back` → `navigate({ to: "/workspace/$workspaceId", params })`
- Type icon (📋 menu / ⌨ command / 💬 dialog) + element name (i18n-aware)
- LangSwitcher, UndoRedoButtons, BranchSwitcher / DirtyBadge / Commit / Promote / Merge, DeployButtons, TopBarKebabMenu: extracted into a shared `WorkspaceTopBarControls` component (minor refactor of `workspace.$workspaceId.tsx`) then mounted identically in the focus top bar. No duplication.
- For `MenuEditor` only: two extra buttons "📚 Library" and "🎨 Assets" that open the floating panels (see §6)

### 5.4 Workspace tabs in focus mode

The `overview / translations / data-sources / servers` tabs are **not rendered** in focus mode. Focus is a sub-screen of `overview`; the other views are workspace-global and make no sense at the scale of one element.

### 5.5 Keyboard

- `Esc` → equivalent to the ← Back button. Captured at the route component level, non-destructive (does not close if an input is focused during editing — standard behavior).
- `Ctrl/⌘ + Z / Y` → undo/redo, works in focus mode identically to the canvas (same temporal stores).

## 6. `MenuEditor` (Phase 4)

### 6.1 Desktop layout (≥ lg)

3 columns — direct heritage of Title Composer v3 but isolated to a single menu:

```
┌────────────────────────────┬──────────────┬──────────────┐
│ Menu canvas (Konva)        │ Properties   │ Layers       │
│ — bg + slots + title       │ — rows       │ — title      │
│ — drag from Library popup  │ — permission │   layers     │
│ — slot click → edit slot   │ — actions    │              │
│ — fills available area     │ — ctxInputs  │              │
└────────────────────────────┴──────────────┴──────────────┘
```

Reused components:
- `MenuGroupContainer` + sub-components (from the P1 split)
- `MenuProperties` (extracted from the historical `pack.$packId.tsx`, already an independent component)
- `LayersPanel` + sub-components (`LayerListItem`, `LayerEditForm`, `AddLayerControls`, `ResizeHandles`, `TitleRender`)

### 6.2 Library / Assets as floating panels

A single menu does not need the Library permanently like the current multi-menu screen. Instead:
- "📚 Library" button in the focus top bar → opens a drawer panel anchored to the right, dismissable (Esc or click outside the panel)
- "🎨 Assets" button → same with the `AssetsTab` content

The drawer reuses the existing `Library` and `AssetsTab` components, just hosted in a drawer wrapper.

### 6.3 Mobile (< lg)

Single column with `Canvas / Properties / Layers / Library / Assets` tabs, `WorkspaceTabs` pattern reused. The canvas is rendered at viewport width, properties and layers below via tabs.

## 7. `CommandEditor` (Phase 5)

### 7.1 Desktop layout (≥ lg) — Two-col 42/58

```
┌──────────────────────┬───────────────────────────────────┐
│ Meta (fixed, ~42%)   │ Actions chain (scrollable)        │
│ - trigger            │ ┌───────────────────────────────┐ │
│ - aliases (chips)    │ │ 1. IF player.balance ≥ 100    │ │
│ - permission         │ ├───────────────────────────────┤ │
│ - description (i18n) │ │   2. open_menu → shop_menu    │ │
│ - argParser config   │ ├───────────────────────────────┤ │
│                      │ │ 3. ELSE send_message          │ │
│                      │ └───────────────────────────────┘ │
│                      │ + Add an action                   │
└──────────────────────┴───────────────────────────────────┘
```

### 7.2 Mobile layout (< lg)

Single column, sections stacked in order: meta → actions.

### 7.3 Actions chain — rendering

**Indented pseudo-code style list** (respecting [[editor-ux-prefer-pseudocode]] — "indented text beats flow cards for nested logic"). No FlowCanvas, no visual cards-and-arrows.

Each action = a card block with:
- Type header (`open_menu`, `IF`, `ELSE`, `send_message`, etc.)
- Visual indentation for nested blocks (children of an `IF`, for example)
- Body initially compact (1-line summary, e.g. `open_menu → shop_menu`); a click anywhere in the block switches to edit mode, the block expands to show its action-type-specific form; a click elsewhere or `Esc` closes it
- Drag handle to reorder (dnd-kit)
- `+` button at the end of the chain to append, or inline between two blocks to insert

The `open_menu` action (and others with a targetId) shows the target name as **plain text** — no click jump in V1 (cross-nav skipped). The name is resolved via `pack.menus.find(...)?.name ?? targetId`.

### 7.4 Data model

No model change. Reads/writes `pack.commands[i].actions[]` through the existing `accountStore` selectors. Mutations go through the existing store actions (`updateCommandAction`, `addCommandAction`, etc. — create if missing).

## 8. `DialogEditor` (Phase 6)

Same shape as `CommandEditor` (two-col desktop / single-col mobile).

Meta: title (i18n), body (i18n textarea), list of buttons. Each button = label (i18n) + its own actions chain (mini-editor identical to the one for commands, factored into a shared `ActionsChainEditor`).

No Minecraft preview in V1. Slot planned for V2 when a 1.21+ dialog renderer exists — `<DialogPreview />` placeholder rendered empty in V1, switchable later.

## 9. Entry points (Phase 7)

### 9.1 Double-click on the canvas

In `MenuGroupInteractions` (and the Command/Dialog equivalents), capture the double-click:

```ts
onDblClick={() => navigate({
  to: "/workspace/$workspaceId/element/$elementId",
  params: { workspaceId, elementId: element.id },
})}
```

Single click → existing behavior (selection). Drag → drag of the node on the canvas (existing). No conflict: Konva distinguishes click / dblclick / dragstart.

### 9.2 "Focus" button in the properties panel

In the canvas `EditorPane`, when exactly ONE element is selected, add a "Focus / Edit full-size" button at the top of the properties panel. Click → same `navigate` as the double-click. More discoverable for new users.

### 9.3 Full loop

```
canvas → dblclick element → focus mode → editing → Esc / ← Back → canvas (selection preserved)
```

On leaving focus mode, the selection of the element left stays active on the canvas (the selection lives in `selectionStore`, route traversal does not reset it).

## 10. Testing strategy

### 10.1 Refactor split (P1 + P2)

- Existing `MenuGroup.test.tsx` tests (~150 cases) and Stage tests (E2E smoke `smoke.spec.ts`) must pass **without modification** after the split. Any failure = refactor bug.
- Targeted unit tests to add for `menuGeometry.ts` (pure math, ~10-15 cases for the slot position / hit-test helpers).

### 10.2 Focus mode (P3-P7)

| Level | Coverage |
|---|---|
| Route | Integration test: direct navigation by URL, empty state if elementId not found, back navigate works |
| `ElementEditor` dispatcher | Unit tests: correct dispatch by type, `UnknownTypeFallback` fallback |
| `MenuEditor` | Reuse of the existing Title Composer v3 tests + 1 test "isolated render without multi-menu canvas" + tests for the Library/Assets buttons opening the floating drawers |
| `CommandEditor` | Responsive tests (two-col ≥ lg, single < lg), inline editing of an action, add/remove/reorder, pseudo-code indentation for `IF`/`ELSE`/nested |
| `DialogEditor` | Same as CommandEditor + tests on multiple buttons with each action chain isolated |
| Entry points | Test dblclick on MenuGroup → navigate, Focus button in properties → navigate, Esc → back |

No new E2E tests. The current `smoke.spec.ts` covers the overview canvas; it does not need extending for the focus mode (tested by React integration).

## 11. Phasing / implementation order

7 phases, each independently shippable without breaking the existing canvas. Possible to stop at any phase if priorities change.

| Phase | Scope | Visible UX? | Risk |
|---|---|---|---|
| **P1** | Split `MenuGroup.tsx` → 6 files | No — pure refactor | Low (test suite gate) |
| **P2** | Split `Stage.tsx` → 4 files | No — pure refactor | Low (E2E smoke gate) |
| **P3** | New route + `ElementEditor` dispatch + empty state + focus top bar | Yes — reachable by direct URL | Low (new isolated code) |
| **P4** | 3-col `MenuEditor` + floating Library/Assets | Yes — usable | Medium (composition of 4-5 existing components) |
| **P5** | Two-col `CommandEditor` + inline pseudo-code actions | Yes — usable | Medium (new editor + inline interactions) |
| **P6** | `DialogEditor` (factors out `ActionsChainEditor` shared with Command) | Yes — usable | Low (clone of Command) |
| **P7** | Entry points: canvas double-click + "Focus" button in properties + `Esc` | Yes — full discovery | Low (added event handlers) |

At P3, the focus URL exists but just looks like the embedded canvas — no user value. At P4-P6, the editors are functional but only reachable by direct URL. P7 closes the UX loop.

Rough estimate (to refine in the implementation plan):
- P1 + P2: 1 day each (mechanical refactor guarded by tests)
- P3: ½ day (route + dispatch + empty state)
- P4: 1 day (composition + floating panels)
- P5: 2 days (the most new logic — inline actions editor)
- P6: ½ day (clone of Command + factoring)
- P7: ½ day (event handlers + Esc)

## 12. Future considerations (V2+)

**Cross-element navigation** — when the focus mode is used in practice and a concrete gap of "seeing who opens this menu" emerges, add:
- Forward links: actions with `targetId` become clickable → navigate to the target
- Reverse links: "Used by" panel in each editor listing the elements that reference this one (derived selector `useReferenceMap(elementId)`)
- Backstack: lightweight store that tracks the focus → focus navigation chain, ← button that pops it

**Minecraft dialog preview** — when a vanilla 1.21+ dialog renderer exists on the editor side, fill the `<DialogPreview />` placeholder of the DialogEditor.

**HUD module** — dedicated editor in the style of an in-game Minecraft preview. Out of scope; it will be its own module when it arrives, following the modular monolith pattern (`editor/src/modules/hud/`). The focus mode described here is extensible to this type: add `<HudEditor />` to the `ElementEditor` dispatcher when the module is scaffolded.

**Full replacement of the canvas** — could be reconsidered if the focus mode takes all the usage value and the canvas becomes a detour. At that point, the sidebar drill-in (rejected in V1) becomes relevant again. Postponed as long as the canvas stays in use.
