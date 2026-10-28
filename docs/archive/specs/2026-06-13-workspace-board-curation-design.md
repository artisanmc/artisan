# Workspace: curated board + source-of-truth panel + individual view — Design

> Spec brainstormed on 2026-06-13. **Amends and partially supersedes** [`2026-06-02-per-element-focus-mode-design.md`](./2026-06-02-per-element-focus-mode-design.md): we keep its per-element view concept, we replace its canvas model ("the canvas keeps everything" → "curated board"), and we reintroduce the navigation panel it ruled out. Source of truth for the associated implementation plan.

**Status** — Spec validated in brainstorming, to be turned into an implementation plan.

---

## 1. The problem

Today the workspace is a **free Canva-style canvas**: `autoLayout(pack)` forces *every* menu, command and dialog into a grid, and the user can drag them to tidy them (positions persisted in `pack.canvasLayout`). `Edges` draws the links between them.

The user's finding (in their own words):

- The canvas becomes **a mess from about ten elements** (edge spaghetti, dense grid).
- Its **only real benefit** = seeing which menus/commands are linked — but this benefit **only appears after manual tidying work**.
- It is **not suited to all elements**: a command that opens no menu floats "somewhere" on the canvas, with no placement logic.
- What is really useful and must be kept: **seeing menu→menu links**, **displaying menus side by side**, **copy-paste between menus**.

The user's main job in the workspace is **focused editing of one element**; the spatial overview is, for that usage, more a cost than a benefit.

### 1.1 Lesson from the old focus mode (reverted)

A focus mode had been built then **reverted**. Reasons (user's words): *"redundant with the canvas, and quite a few bugs — the elements were not functional or designed the same, so instead of fixing I removed them to avoid struggling"*.

→ The root cause is not the focus idea, but **two parallel editing surfaces that diverge**. This is invariant #1 of this spec (§2).

## 2. Guiding principles

1. **A single rendering/editing implementation per element type.** The board and the individual view render a menu via *the same* component (`MenuGroup` + sub-components), a command/dialog via *the same* flow components. The individual view = this component rendered **alone and centered**, not a rewrite. Zero possible divergence → the cause of the revert disappears.
2. **Decouple "existing in the pack" from "being on the board".** The pack contains all elements; the board only shows a chosen subset.
3. **Curation removes the redundancy.** An off-board element is edited only via the individual view; focus is therefore no longer a duplicate of the canvas.
4. **Mobile-first** ([[mobile-first]]): no hover-only affordance, panels as drawers below `lg`.
5. **Design-system first** ([[design-system-first]]): every new component via `components/ui` + tokens, specimen on `/admin/design` if missing.

## 3. Data model

**`pack.canvasLayout` becomes the board membership set.** An element is "on the board" **iff** it has an explicit entry `canvasLayout[id] = {x, y}`.

- `autoLayout.ts` **no longer fills** the grid for missing elements. It only returns the explicit entries of `pack.canvasLayout`.
- The old grid logic is **kept but moved** into a `gridArrange(ids)` function called only by the "Arrange all on the board" button (§8).
- No DB schema or `Pack` type change: `canvasLayout` already exists (`Record<string, {x,y}>`). Only its *semantics* change (membership, not just position). To document in `entities.md` / `editor-internals.md`.

### 3.1 Three distinct actions

| Action | Effect | From where |
|---|---|---|
| **Add to the board** | Writes `canvasLayout[id]` (at the drop position, or via `gridArrange`) | Drag panel→board, or panel context menu |
| **Remove from the board** | Deletes `canvasLayout[id]` — **the element stays in the pack** (still in the panel) | Context menu on a board node, or panel |
| **Delete from the pack** | Destructive: removes the element from the pack (existing: `deleteFromPack`) | Panel or board, with confirmation |

New `accountStore` actions: `addToBoard({packId, id, position?})`, `removeFromBoard({packId, id})`. `deleteFromPack` already exists.

## 4. The left panel — source of truth

New `WorkspacePanel` component (or a close name), 3rd zone of the overview, left of the board.

- Lists **everything** in the pack, grouped by category: **Menus**, **Commands**, **Dialogs** (extensible to future modules).
- **Search** (text filter on name/id).
- Each item shows: type icon, name, and an **"on the board"** badge if present in `canvasLayout`.
- **Interactions**:
  - **Click** → opens the element's **individual view** (§6). Does not add to the board.
  - **Drag** → adds to the board (drop on the canvas places at the cursor position).
  - **Context menu**: Edit (= click) · Add/Remove from the board · Duplicate · Delete from the pack.
- **Creation**: `+` button per category (or a single one with a type picker) reusing the existing `NewMenuDialog` / `NewCommandDialog` / `NewDialogDialog`. A created element appears in the panel; it is added to the board only if created via right-click on the canvas (existing flow) — otherwise it lives off-board by default.
- Built via the design system (`components/ui`, tokens). Drag pattern: `dnd-kit` (already the workspace's dependency).

## 5. The board (curated canvas)

`Stage.tsx` only maps the elements present in `canvasLayout` (menus, commands, dialogs together). Everything else about the canvas (pan/zoom, selection, edges, copy-paste, dropping Library items on slots) **stays identical**.

### 5.1 Ghost chips (off-board links)

When a node on the board references a target **absent** from the board (e.g. `hub` opens `shop`, but `shop` is not placed), we do not draw an edge into the void. Instead, a **clickable ghost chip** on the source node: `→ shop ↗`. Click = `addToBoard(shop)` (and then draws the real edge). `Edges.tsx` only draws edges between nodes present on the board; links to off-board elements are delegated to the chips.

### 5.2 Side by side & copy-paste

These two needs are **already** served by the board (several visible nodes + existing `canvasClipboardActions`). Curation does not remove them — it makes them more useful (you only place side by side what you want to compare). No new UX needed here.

## 6. The individual view (deep-linkable)

New child TanStack route under the current server-scoped route:

```
/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId
```

(The `childMatches` hook + `<Outlet/>` already present in `networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` is exactly the hook-in point — it already switches the rendering to the child route when it matches.)

- **Deep-linkable**: reload keeps the view, the browser back button works, shareable link.
- Resolution: `pack.menus/commands/dialogs.find(... === elementId)`. Not found → empty state "This element no longer exists" + back to the board.
- **Dispatch by type** (`ElementView` router):
  - **Menu** → the **same** `MenuGroup` + sub-components as the board, rendered **alone, centered**, at the available width. Clicking a slot edits it in the right pane (current behavior unchanged).
  - **Command / Dialog** → the **same** flow editor as used elsewhere, **centered** (indented pseudo-code list, cf. [[editor-ux-prefer-pseudocode]]) — no cards-and-arrows FlowCanvas. The right pane carries the properties (trigger, cooldown, requirements / title, body, buttons).
- **Focus top bar**: `⟵ Back to the board` + type icon + name + shared workspace controls (existing `WorkspaceTopBarControls`, mounted identically). No bar duplication.
- `Esc` = back to the board (non-destructive if an input is focused).

> **Key difference vs the 2026-06-02 spec**: that one created distinct `MenuEditor`/`CommandEditor`/`DialogEditor` components — the entry door to the divergence that caused the revert. Here, `ElementView` **reimplements nothing**: it mounts the rendering components already used by the board, in a solo layout. The only "new" thing is the layout container, not the editing.

## 7. Prerequisite refactor

For principle #1 (shared rendering) to hold, a menu's rendering must be **mountable alone** as well as in the board. Today `MenuGroup.tsx` (603 lines) assumes a board context (absolute position, node drag). Before the individual view:

- Extract from `MenuGroup` a **context-agnostic** rendering core (slots, background, title, slot editing) from the *board* concerns (position, inter-node drag, multi-selection). The board-node becomes a thin wrapper around the core; the individual view mounts the core directly.
- Likewise as needed for the command/dialog flow editor: a shared `ActionsChainEditor`, usable centered (individual view) as in the pane.
- Target ≤ ~200 lines/file, guarded by the existing test suites (`MenuGroup.test.tsx` must pass without behavior change).

This is a subset of the P1/P2 refactor of the 2026-06-02 spec, reframed on the "single rendering" goal rather than "split for size".

## 8. Migration & empty states

- **Existing packs**: on arrival of this version, start with an **empty board** (we no longer auto-fill `canvasLayout`). Positions already persisted (elements actually dragged in the past) remain and are displayed. For packs where everything was implicitly placed, the board will appear empty → intended (the starting finding is "it's a mess with everything").
- **"Arrange all on the board" button** (in the empty state + accessible from the panel): calls `gridArrange` on all elements, writing `canvasLayout` entries — one click to get the old behavior back if desired.
- **Empty board** → engaging empty state: "Drag an element here, or open one from the panel" + the button above.
- **Opening a pack** → board mode by default.

## 9. Mobile (< lg)

- Left panel → **drawer** (`WorkspaceSidebar` pattern already in place).
- Single-panel center; right pane → drawer/tab.
- **Board ↔ Individual view** switch via navigation (the child route handles the state). No hover-only affordance — the add/remove/delete actions go through a context menu (long-press) or visible buttons.

## 10. Code impact (high level)

| Area | Change |
|---|---|
| `editor/src/features/canvas/autoLayout.ts` | No longer fill the grid; only emit explicit entries. Extract `gridArrange(ids)` for the "Arrange all" button. |
| `editor/src/features/canvas/Stage.tsx` | Only map elements in `canvasLayout`. Wire the ghost chips rendering. |
| `editor/src/features/canvas/Edges.tsx` | Edges only between present nodes; delegate off-board to the chips. |
| `editor/src/features/canvas/MenuGroup.tsx` (+ split) | Extract a context-agnostic rendering core (refactor §7). |
| **New** `WorkspacePanel` | Left panel: categories, search, drag source, badges, context menu, creation. |
| **New** route `…/element/$elementId.tsx` + `ElementView` | Deep-linkable individual view; dispatch by type; mounts the shared rendering components. |
| **New** shared `ActionsChainEditor` (if not already factorable) | Command/dialog flow editor reusable centered + in the pane. |
| `state/accountStore` | `addToBoard` / `removeFromBoard`; existing `deleteFromPack`. |
| Overview route `…workspaces.$workspaceId.tsx` | Add the left panel zone to the overview layout (3 desktop zones: panel · board · editor). The existing child route (`childMatches`/`Outlet`) renders the individual view. |
| Docs | `editor-internals.md` (board/panel/individual view model, `canvasLayout` semantics), `entities.md` (`canvasLayout` semantics). Mark 2026-06-02 as superseded. |

## 11. Phasing

Each phase shippable without breaking the existing.

| Phase | Scope | Visible UX | Risk |
|---|---|---|---|
| **P1** | Refactor: extract the context-agnostic menu rendering core (§7), guarded by tests | No | Low (tests gate) |
| **P2** | Membership model: `autoLayout` no longer auto-fills + `gridArrange` + `addToBoard`/`removeFromBoard` + empty-board migration + "Arrange all" button | Yes (curated board) | Medium (`canvasLayout` semantics) |
| **P3** | `WorkspacePanel` (list, search, badges, drag→board, context menu, click=open) | Yes | Medium |
| **P4** | Route `…/element/$elementId` + `ElementView` dispatch + focus top bar + empty state; **menu** individual view (solo rendering core) | Yes (off-board editing for menus) | Medium |
| **P5** | **Command/dialog** individual view (centered flow, shared `ActionsChainEditor`) | Yes | Medium |
| **P6** | Ghost chips (clickable off-board links) + board node double-click → individual view | Yes | Low |
| **P7** | Mobile: panel/editor drawers, board↔individual switch, hover-free actions | Yes | Low |

## 12. Testing

- **Refactor (P1)**: `MenuGroup.test.tsx` passes without behavior change; unit tests on the extracted geometry helpers.
- **Model (P2)**: `autoLayout` only emits explicit entries; `addToBoard`/`removeFromBoard` mutate `canvasLayout` without touching the rest of the pack; `removeFromBoard` ≠ `deleteFromPack` (the element survives); `gridArrange` places everything.
- **Panel (P3)**: rendering grouped by category, search filter, reactive "on the board" badge, click → navigate to the element route, drag → `addToBoard`.
- **Individual view (P4/P5)**: direct navigation by URL, empty state if not found, back works; solo-rendered menu edits through the **same** path as the board (anti-divergence test: editing a slot in the individual view and on the board produces the same store mutation); centered command/dialog flow edits/adds/reorders.
- **Chips (P6)**: a link to an off-board target renders a chip; click = `addToBoard` + the real edge appears.
- **Mobile (P7)**: drawers, no hover-only, actions accessible.

## 13. Non-goals (V1)

- **Rich cross-navigation** (reverse links "used by", backstack) — postponed as in 2026-06-02; edges + chips are enough.
- **Native Minecraft dialog preview** — V2 slot (1.21+ renderer required).
- **Several boards / scenes per pack** — a single board per pack in V1.
- **DB schema change** — `canvasLayout` reused as is, only its semantics evolve.
- **HUD module** — `ElementView` is extensible (add a case to the dispatch) when the module arrives.
