# Cmd+K search palette + toggleable sidebar — Design

> Spec brainstormed on 2026-06-14. Follows [`2026-06-13-workspace-board-curation-design.md`](./2026-06-13-workspace-board-curation-design.md): the `WorkspacePanel` (elements panel) was introduced there with an inline search. This spec moves the search to a **global command palette (GitBook-style)** and makes the panel **toggleable**.

**Status** — Spec validated in brainstorming, to be turned into an implementation plan.

> ⚠️ **Branch dependency** — at brainstorm time, UX fixes of the panel live on the `fix/workspace-board-polish` branch (not merged) and touch `WorkspacePanel.tsx`, `uiStore.ts`, the overview route and the locales — the **same files** as this feature. **Merge `fix/workspace-board-polish` into `main` before** implementing this spec, otherwise divergence/conflicts.

---

## 1. Problem

The `WorkspacePanel` (left) stays permanently open and carries an inline search field that only filters the **element list by their label** (names/titles). Two limits:

1. The panel permanently takes up space; the user wants to be able to **hide** it.
2. The search is **shallow** (labels only) and **buried** in the panel. The user wants a **fast (keyboard shortcut), global (topbar), multi-level** search — able to find not only menus/commands/dialogs but also **their content** (placed items, titles, lore, dialog body).

## 2. Validated direction

Separate **finding** from **organizing**, GitBook-style:

- **Search palette** (`SearchPalette`) — ephemeral floating overlay, opened with **Cmd/Ctrl+K** or via a **🔍 button in the topbar**. Searches everything (elements + content), arrow-key navigable, closable with Esc. Selecting a result opens the element's **individual view** (and selects the sub-element if the match is a slot/text).
- **Toggleable sidebar (`WorkspacePanel`)** — keeps its **organizing** role (categorized list, on-board badges, drag-to-board, creation, context menu). We **remove its inline search field**: the palette is now the only search ("two birds with one stone").

**Principle**: the palette *finds* (fast, deep, ephemeral); the sidebar *browses/organizes* (drag, creation). No redundancy — a single search engine.

## 3. Toggleable sidebar (`WorkspacePanel`)

### 3.1 Unambiguous toggle
There are **two** panels on the left on desktop: the **app nav** (`WorkspaceSidebar`: brand, workspaces, modules, account — always visible on desktop) and the **elements panel** (`WorkspacePanel`). So that it is clear that the toggle controls the elements panel (and not the app nav):

- A **dedicated button in the workspace topbar**, on the left (aligned above the panel), with:
  - an **icon representing a side panel** (`PanelLeft` / open vs closed state via `PanelLeftClose`/`PanelLeftOpen`) — **not** a generic hamburger (which would evoke the app nav);
  - the **"Elements" label** next to the icon.
- The icon **reflects the state** (open/closed) for immediate feedback.

### 3.2 State & persistence
- New flag `uiStore.workspacePanelOpen: boolean` (+ `setWorkspacePanelOpen` / toggle), **persisted** (`uiStore` is already `persist`).
- **Default**: open on first load, then **remembers the choice** (if the user closes it, it stays closed in later sessions).
- **Desktop**: the panel's 240px column is only rendered if `workspacePanelOpen`; otherwise board + editor reclaim the space.
- **Mobile**: unchanged — the panel is already a `Sheet` drawer (cf. board-curation §9); the topbar's "Elements" button is its trigger.

### 3.3 Removal of the inline search
Remove the search `<Input>` at the top of `WorkspacePanel` and the associated `q`/filtering state. The panel now lists all elements (grouped), without local filter. (The palette covers the search.)

## 4. Search palette (`SearchPalette`)

### 4.1 UI
- Centered overlay (reuse the design system's `Dialog`/`DialogContent`, or a dedicated command-palette-style container), ~560px wide, anchored top-center.
- At the top: a search `<input>` (autofocus). Below: the results list, **grouped by type** (Menus / Commands / Dialogs / Content).
- Each result: type icon + **label** + match **context**. Examples:
  - `hub` — menu
  - `/heal` — command
  - `confirm_delete` — dialog
  - `DIAMOND — in shop` (item in a menu)
  - `"Welcome" — title of hub` (text)
  - `"Click to buy" — lore, shop` (item text)

### 4.2 Open / close
- **Cmd/Ctrl+K** (global, when a workspace is open) opens the palette — **including from an input field** (`preventDefault`; it is a standard global shortcut). No-op if the palette is already open.
- A **🔍 "Search" button in the topbar** (with the `⌘K` hint) also opens it (discoverability).
- **Esc** closes; click outside the palette closes.
- State: `uiStore.searchOpen: boolean` (+ setter). Not persisted (transient, like `assistantPanelOpen`).

### 4.3 Keyboard navigation
- **↑ / ↓** move the selection through the flattened list of results (skipping group headers).
- **Enter** activates the selected result.
- Mouse hover also highlights; click activates.

### 4.4 Selection action
On activating a result:
- **Element (menu/command/dialog)** → `navigate` to the individual view `…/element/$elementId`.
- **Item / text inside a menu** → `navigate` to the individual view of the **owner menu**, then select the relevant **slot/element** (`selectionStore.set([elementId], slot?)`) so the editor focuses it.
- **Dialog text (body/button)** → individual view of the owner dialog (no fine sub-selection in V1; the dialog flow is centered).
- Close the palette after activation.

## 5. Search index (`searchIndex.ts`, pure)

`buildSearchIndex(pack, activeLang): SearchEntry[]` — produces a **flat** list of indexable entries. Entry types:

```ts
type SearchEntry =
  | { kind: "menu"; id: MenuId; label: string }
  | { kind: "command"; id: CommandId; label: string }   // label = `/${name}`
  | { kind: "dialog"; id: DialogId; label: string }
  | { kind: "item"; ownerMenuId: MenuId; elementId: ElementId; slot: number; material: string; label: string }
  | { kind: "text"; ownerType: "menu" | "dialog"; ownerId: string; elementId?: ElementId; field: "menuTitle" | "itemTitle" | "itemLore" | "dialogBody" | "dialogButton"; text: string };
```

**Indexed scope** (decided in brainstorm):
- **Names & titles** of menus (resolved title), commands (`/name`), dialogs (id/title).
- **Menu items**: material (DIAMOND…), custom item / head, per slot/element.
- **i18n texts** (active language): item titles + lore, dialog body + button labels, menu titles.

**Out of scope V1**: command triggers/aliases/permissions, action targets ("opens menu X"). *(Postponed — the canvas edges/chips already cover link visibility.)*

`searchQuery(entries, q): RankedResult[]` — **case-insensitive substring** match. Simple ranking:
1. exact match > prefix > substring;
2. element level (menu/command/dialog) > content level (item/text) at equal score.
Memoized by `(pack, activeLang)`; recomputed on the query. Small packs → negligible cost, no persistence/worker.

## 6. Files

**Created**
- `editor/src/features/search/searchIndex.ts` — `buildSearchIndex` + `searchQuery` (pure).
- `editor/src/features/search/SearchPalette.tsx` — overlay UI + keyboard navigation + selection action.
- `editor/src/features/search/useGlobalSearchShortcut.ts` *(or inline in the route)* — Cmd/Ctrl+K listener → `setSearchOpen(true)`.

**Modified**
- `editor/src/features/workspace/WorkspacePanel.tsx` — remove the search `<Input>` + the `q` state.
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` — "Elements" toggle button (topbar) + 🔍 "Search" button; conditional rendering of the panel column according to `workspacePanelOpen`; mount of `<SearchPalette>`; Cmd+K wiring.
- `editor/src/components/WorkspaceTopBarControls.tsx` *(if the topbar lives there)* — host the two buttons (toggle + search). To check: where the topbar controls live.
- `editor/src/state/uiStore.ts` — `workspacePanelOpen` (persisted) + `searchOpen` (transient) + setters.
- `editor/src/locales/en.ts` + `fr.ts` — keys: `search.placeholder`, `search.open` ("Search"), `workspacePanel.toggle` ("Elements"), group headers, context labels.

## 7. Tests

- **`searchIndex`** (unit): builds entries for names/items/texts; `searchQuery` matches and ranks correctly; a content match (item/text) references the right owner (`ownerMenuId`/`elementId`).
- **`SearchPalette`**: typing filters the results; ↑/↓ move the selection (skip headers); Enter navigates (and sub-selects for an item); Esc closes. Mock `useNavigate` + `selectionStore`.
- **Sidebar toggle**: the "Elements" button toggles `uiStore.workspacePanelOpen`; hidden → the panel column is not rendered. Update the existing `WorkspacePanel` test that verified filtering by inline search (the search moved).
- **Cmd+K**: the shortcut opens the palette even from an input (preventDefault); no-op if already open.

## 8. Non-goals

- **Logic/links** search (triggers, aliases, permissions, action targets) — V2.
- **Cross-pack / cross-workspace** search — scope = current pack.
- Persistent indexing / worker — unnecessary given the size of packs.
- Actions in the palette other than "open" (no create/delete/add-to-board from the palette in V1 — that stays in the sidebar/canvas).
