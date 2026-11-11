# Artisan editor visual map

Exhaustive description of every screen of the web editor — sidebars, panels, buttons, and their position. Source: reading of the `editor/src/` routes and components as of 2026-05-28.

> **Stack note**: React 19 + Vite 6 + TanStack Router + Zustand + shadcn/ui (Radix) + Konva for the canvas.

---

## 1. Global shell (`__root.tsx`)

**Layout**: full-height horizontal flex container.

| Region | Position | Width | Visibility |
|---|---|---|---|
| `ProjectSidebar` | Left, sticky | 192 px (`w-48`) | Only if authenticated |
| `<Outlet />` (active route) | Right, `flex-1` | remainder | Always |

Right border zinc-800, zinc-950 background on the sidebar.

---

## 2. Authentication pages

### `/login` & `/signup`

Identical layout: `min-h-screen flex items-center justify-center p-8`, centered `max-w-sm` container.

**Login form** (top → bottom):
1. Title "Sign in" (`text-xl font-semibold`)
2. Input email (`type=email`, required)
3. Input password (`type=password`, required, `minLength=8`)
4. Error message (red, conditional)
5. Submit button "Sign in" (`bg-black text-white px-4 py-2`)
6. `DiscordLoginButton` (OAuth)
7. Link to `/signup`

**Signup form**: adds a `name` input (required) between email and password; the rest is identical with a link to `/login`.

---

## 3. Account / network pages

### `/account`

Single column `max-w-2xl mx-auto p-8`, gap-6.

1. **Header**
   - Title "Account"
   - Subtitle "Signed in as `{name}` (`{email}`)"
2. **Networks section**
   - Uppercase tracking-wider heading
   - If no network: "Create a Network" button → `/setup`
   - Otherwise: grid of cards (`block p-2 border rounded hover:bg-muted`) linking to `/networks/$networkId`
   - "+ Add a server" link at the bottom of the section
3. **`LogoutButton`** at the end of the page

### `/networks` (list)

Single column `min-h-screen p-8`. Title "My Networks" (`text-2xl`).

- **Empty state**: sentence "No Network" + code snippet `\artisan setup` + `/setup` link
- **Filled state**: `grid gap-3`, each card `p-4 border border-zinc-700 rounded` shows the name (font-medium) and the tier (text-xs muted)
- "+ Add a server" link under the list

### `/networks/$networkId` (detail)

Column `max-w-3xl mx-auto p-8`, gap-8.

**Header**: network name (`text-2xl`) on the left, "Settings" link in `text-sm text-zinc-400` on the right.

Three sections (uppercase tracking-wider heading each):

1. **Projects**
   - Empty → "No project"
   - Filled → vertical list of cards (`p-3 border rounded`) that open `networks.$networkId.servers.$serverId.projects.$projectId`
2. **Server Keys**
   - Empty → "No server_key"
   - Filled → list of `flex justify-between` cards with `id` in font-mono on the left and a red "Delete" button on the right
3. **Members** → placeholder "Invitations coming soon"

### `/networks/$networkId/settings`

Column `max-w-2xl mx-auto p-8`, grid gap-8. Title "Settings".

**"Transfer ownership" section**:
- `text-lg` heading
- `text-sm text-zinc-400` description
- "Generate a transfer link" button (`bg-zinc-700`)
- If a link is generated: read-only font-mono input with the token + expiry label

---

## 4. Global settings (`/settings`)

Horizontal split `flex h-full`:

| Pane | Width | Content |
|---|---|---|
| **Left nav** | 224 px (`w-56`) | Right border, padding 3. Single active section "Appearance" (`bg-zinc-800 px-3 py-2 text-left text-sm` button) |
| **Right content** | `flex-1 overflow-auto p-6` | `AppearanceSection` (hosts among others the `EditorLangSwitcher` — language of the UI itself, not of the project) |

---

## 5. Setup wizard (`/setup`)

`min-h-screen flex items-center justify-center p-8`, centered card `max-w-lg flex flex-col gap-6`.

Header: step indicator (`text-xs text-muted-foreground` right-aligned).

**4 steps in sequence**:

1. **Step 1 — Network**: list of existing networks (p-3 border rounded buttons; selected = `border-primary bg-muted`) + "New network" field with a "Create" button below
2. **Step 2 — Project**: same structure as step 1 but for projects
3. **Step 3 — Server Key**: "Generate a server key" button → the key appears in a `bg-muted px-3 py-2 font-mono break-all` code block with the note "copy it now — shown only once"
4. **Step 4 — Installation**: three `<pre>` blocks with config instructions, the server_key, and the reload command

**Footer** of the 4 steps: "Back" button (variant=outline, disabled on step 1) + "Next" / "Finish" button (disabled depending on validation).

---

## 6. Link / session / transfer flows

### `/link` (claiming a network from the plugin)

`min-h-screen p-8`. 5 states:

| State | Content |
|---|---|
| Loading | "Loading…" |
| Invalid / Already used / Expired / Error | `text-2xl` title, error message, recovery instructions |
| Done | "Setup complete! Go back to your Minecraft server" |
| Ready (multi-network) | Heading "Choose the destination Network", `grid gap-2` of buttons (each `p-3 border`, checkmark on selection), "Confirm" button (`bg-blue-600`) |
| Ready (single network) | Heading "Link this server", confirmation text, "Confirm" button |

### `/session` (historical redirect — accounts-only)

The editor session mode (`/artisan editor` trust dance) was removed (accounts-only cutover). `/session` is now a simple redirect page: it shows a toast (`sessionGone.message`) then redirects to `/login`. It only exists so old `?token=...` links do not 404.

### `/transfer`

`max-w-md mx-auto p-8`. Variants: Loading, Error, Expired, Consumed, Not found, Ready-to-accept, Accepted.

**Ready-to-accept**:
- Title "Transfer ownership" (`text-2xl`)
- Sentence "You are about to become owner of `{networkName}`"
- Metadata `{projectCount} projects · {serverKeyCount} server_keys` (text-sm zinc-400)
- "Accept" button (`bg-blue-600`)

**Accepted**: message + automatic redirect to `/networks/$networkId`.

---

## 7. Project — the main editing screen

Route: `networks.$networkId.servers.$serverId.projects.$projectId`. Vertical layout (top bar → tabs → content).

### 7.1 Top bar (fixed height 48 px / `h-12`)

zinc-950 background, zinc-800 bottom border, `flex items-center gap-2 px-2`.

From left to right:

| Element | Details |
|---|---|
| **Project name** | `flex-1 truncate font-mono text-sm text-zinc-200` |
| **`LangSwitcher`** | h-9 text-xs font-mono button with the language code + ▾ caret — changes the language of the **project content** (not the UI) |
| **Undo / Redo** | Two `TopBarIconButton`s (`h-9 w-9`), `Undo2` / `Redo2` icons (lucide-react), disabled if there is nothing to undo |
| **Revert** | h-8 text-xs zinc-400 button, label "Revert" |
| **Deploy** | h-8 emerald-700 button, label "Deploy" / "Deploying…" |
| **`TopBarKebabMenu` ⋮** | MoreVertical h-8 w-8 icon — opens a menu with: Export ZIP / Import / Export / Patterns / ─── / Delete (red) |

### 7.2 Tab strip (under the top bar, if a project is loaded)

`role=tablist border-b border-zinc-800 px-2`. 3 tabs:

| Tab | Active state | Possible badge |
|---|---|---|
| **Overview** (default) | `border-b-2 border-blue-500` | — |
| **Translations** | same | Amber dot with the number of missing translations |
| **Data-Sources** | same | — |

Inactive: `border-transparent text-zinc-400`.

### 7.3 Branch bar (conditional if `networkId` is resolved)

`border-b border-zinc-800 p-3 flex flex-col gap-2` section above the content:
- Row 1: `BranchSwitcher` + "Commit" button + "Promote" button + "Merge" button
- Row 2: `HistoryPanel` (list of the branch's recent commits)

### 7.4 Overview tab content

Resizable `SplitPane` (drag the middle bar):

**Desktop (≥ lg)** — horizontal:
- **Stage** (left, min 400 px): Konva canvas (see §8)
- **EditorPane** (right, ~280 px, min 280): Edit / Library / Assets tabs (see §9)

**Mobile (< lg)** — vertical:
- **Stage** (top, min 200 px)
- **EditorPane** (bottom, ~120 px, min 120)

### 7.5 Floating overlays (on the project)

- **`PatternsGallery`**: side sheet (Radix Sheet) triggered from the kebab
- **Export errors dialog**: modal with a list of validation errors
- **`DeleteProjectDialog`**: red confirmation (see §11)
- **`LibraryDragOverlay`**: floating ghost that follows the cursor during a drag from the Library
- **Draft notice banner**: `fixed top-4 right-4 z-50`, amber background, auto-dismiss 5 s

### 7.6 Translations tab content

See §10.

### 7.7 Data-Sources tab content

See §10 (continued).

---

## 8. The Stage (Konva canvas)

The container observes its size via `ResizeObserver`. Inside: a react-konva `<Stage>` on which are rendered:

- **MenuGroup** — one Konva group per menu (background, slots, title layers, items)
- **CommandGroup** — visualization of linked commands
- **DialogGroup** — visualization of linked dialogs
- **Edges** — `Konva.Line` between linked entities (click → opens target menu)
- **Selection** — outline/glow of the selected item
- **ContextMenu** — overlaid DOM menu (right click / touch long press)
- **EdgeTooltip / ItemTooltip** — hover tooltips

**Native interactions**:
- Click → places the armed material OR selects
- Right click / long press → context menu
- Wheel → pan/zoom
- Touch → pan
- Drag of a title layer → repositions

**DOM overlays above the canvas**:
- `TextEditor` (inline editing of a selected text layer)
- `ArmedBanner` (appears at the top when a material is armed for placement)

---

## 9. EditorPane (right sidebar, 3 tabs)

Full-height `<Tabs>`. TabsList at the top, 36 px high, `flex items-center gap-5 border-b border-zinc-800 px-3`. Active tab indicator = emerald-500 underline.

### 9.1 **Edit** tab → `SelectionInspector`

Unified property editor that routes according to the current selection:

| Selection | Rendered component |
|---|---|
| Project | `ProjectProperties` |
| Menu | `MenuProperties` |
| Element | `ElementEditor` (custom layout — see below) |
| Command | `CommandEditor` |
| Dialog | `DialogEditor` |

#### `ElementEditor` (the richest)

`flex h-full flex-col bg-zinc-950`:

1. **Identity strip** (top, `border-b bg-zinc-900 px-3 py-2`)
   - 8×8 px material thumbnail
   - `font-mono text-xs` title
   - `text-[10px] text-zinc-500` subtitle: menu name + number of states
2. **Body** (`flex-1 overflow-auto px-3 py-3`)
   - `ElementIdField`
   - `PositionsField`
   - `IterationField`
   - **SortableStates** (Lane) — state cards (each card shows thumbnail / title / count / lore / conditions; drag to reorder)
   - **ClickHandlers** (Lane) — action blocks per click type (left, right, shift, ctrl…)

### 9.2 **Library** tab (item library)

Minecraft material / custom item picker.

1. **Filter bar** (top)
   - "Search…" input
   - Category chips (border-rounded-full, active = `border-emerald-600 bg-emerald-600/10 text-emerald-300`)
2. **Virtualized grid** (`@tanstack/react-virtual`)
   - 48×48 px tiles, 6 px gap
   - Each `ItemTile`: `rounded border border-zinc-600`, emerald hover if armed
   - Lazy image (PNG icon pre-rendered server-side) or category letter placeholder
   - `cursor-grab` (drag to the canvas) + click → arms the material for placement

### 9.3 **Assets** tab

See §10 below.

---

## 10. Content panels (Translations, Data-Sources, Assets)

### 10.1 `TranslationPanelContent`

Full width when activated from the tab strip. Vertical:

1. **Header** (`border-b px-4 py-3`)
   - Title "Translations" (font-mono text-sm)
   - Stats "{N} translated / {total} total"
   - Missing dot (amber) or checkmark (emerald)
2. **Language tabs** (`border-b bg-zinc-950 px-2 py-1.5`, horizontal scroll)
   - Each language = button (`rounded` when active: `border-emerald-500/60 bg-emerald-500/15`)
   - "src" badge on the source language, missing count badge on the others
   - "+" button (border-dashed) at the end to add a language
3. **Warning banner** (conditional, when on the default lang): `border-b border-amber-600/40 bg-amber-600/5 text-amber-200`
4. **Mode + filter controls** (`border-b px-4 py-2`)
   - Left: **Visual** / **YAML** segmented control
   - Right (Visual mode): Missing / Translated / All filter
5. **Body**
   - **Visual**: scrollable list, each row shows key (font-mono), source text (read-only, or editable when on the source language), target textarea, colored MiniMessage preview
   - **YAML**: CodeMirror editor (zinc dark theme, folding, line numbers)

### 10.2 `DataSourcesPanelContent`

Horizontal layout:

| Pane | Width | Content |
|---|---|---|
| **`DataSourcesSidebar`** | shrink-0 | List of sources (left-aligned buttons; active = `border-l-2 border-emerald-500`). "+ Create" button at the bottom |
| **Right** | `flex-1 p-4` | If selected: `DataSourceEditor` (name + type + configuration form). Otherwise: centered "Select a source" message |

### 10.3 `AssetsTab` (sub-tab of the right sidebar, not of the tab strip)

Horizontal split:

**Left** (`flex-1 p-3 flex flex-col gap-2`)
- "Upload PNG/SVG" button (Button)
- "Import a font" button (Button variant=outline)
- "Search…" input
- Filter chips: all / texture / glyph / font (active = emerald)
- Virtualized `AssetGrid` — `border rounded p-2` cards with thumbnail + name

**Right** (`w-72 shrink-0`, conditional if an asset is selected)
- `AssetDetailPanel` — properties (ascent, height, namespace, etc.)
- "Rename", "Duplicate glyph" (if type=glyph), "Delete" buttons

**Triggered dialogs**:
- `AssetUploadDialog` — drag-drop / file picker for PNG/SVG, ascent + height + name fields
- `AssetImportFontDialog` — drag-drop of an MCFont zip, parse + glyph preview

---

## 11. Title composer (editing a menu's title layers)

When a menu is selected, the EditorPane (Edit tab) shows `MenuProperties` in the center and — depending on the editing mode — a **3rd `LayersPanel` column** appears on the right (~280 px, sticky).

### `LayersPanel`

Vertical layout:

1. **Header**: "Layers" (font-mono text-xs)
2. **`AddLayerControls`**: two buttons "+ Image" and "+ Text" (drag from these buttons to place the new layer near the cursor, or a simple click to attach it to the last-selected menu)
3. **Drag-reorderable list** of `LayerListItem`:
   - Each row: type icon (image/text) + name + "×" delete button
   - Drag handle to reorder
4. **`LayerEditForm`** (panel footer, conditional if a layer is selected)
   - **Image layer**:
     - Asset picker
     - x, y coordinates (numeric inputs)
     - "Calibrate for chest" toggle (ascent = -11)
     - "Duplicate glyph" button (creates a copy of the asset to mutate its `height` per menu)
   - **Text layer**:
     - MiniMessage textarea (with live preview of `<gold>`, `<bold>` tags)
     - x, y coordinates
     - `TextSizeSelector` (change the font size)
     - `font_asset_id` (optional font picker)
   - **Textarea layer**: adds to the Text fields → width, line_height, alignment (`left` / `center` / `right`)

### Direct manipulation on the canvas
- Drag a layer → repositions (x/y)
- `WidthResizeHandle` (on textarea) → horizontal resize only

---

## 12. Common dialogs / modals

| Dialog | Trigger | Content |
|---|---|---|
| **`NewProjectDialog`** | "+ New project" button in `ProjectSidebar` | Name input + conditional error + Cancel/Create footer |
| **`DeleteProjectDialog`** | Kebab menu "Delete" | "Are you sure?" confirmation + irreversible warning + red "Delete" button |
| **`AssetUploadDialog`** | "Upload" button in AssetsTab | Drag-drop zone + ascent/height/name fields + preview |
| **`AssetImportFontDialog`** | "Import a font" button | MCFont zip drag-drop + parse preview |
| **`CommitDialog`** | "Commit" button in the branch toolbar | Message input + Commit/Cancel footer |
| **Export validation errors** | Automatic on "Export ZIP" click if there are errors | List of errors + Close button |
| **Conflict resolution modal** | Appears on editor ↔ disk conflict | Side-by-side diff + "Use editor" / "Use server" / "Manual" choice |

All based on `Radix Dialog` via the shadcn `Dialog` primitive (`DialogContent`, `DialogHeader`, `DialogTitle`).

---

## 13. `ProjectSidebar` (detailed)

`<nav>` `flex h-full flex-col gap-3 p-2`. Right border zinc-800, zinc-950 background.

From top to bottom:

1. **`NetworkDropdown`**
   - **Closed**: `w-full rounded border border-zinc-800 px-3 py-2 text-left` button
     - "Network" label (`text-[10px] uppercase tracking-wide text-zinc-500`)
     - Active network name (`text-zinc-100`)
     - ▼ caret on the right (if > 1 network)
   - **Open**: `absolute z-10 mt-1 rounded border bg-zinc-950 shadow-lg` dropdown
     - Other networks listed (`w-full px-3 py-2 text-left text-sm` buttons)
     - Divider
     - "Manage networks →" link (`text-xs text-zinc-400`)

2. **"My Projects" section** (`flex-1 overflow-auto`)
   - `px-2 py-1 text-[10px] uppercase` heading
   - DnD-kit context + Sortable
   - Each item:
     - Link `rounded px-2 py-1 pr-7 text-sm text-zinc-200 hover:bg-zinc-800`
     - Active: `bg-zinc-800`
     - Drag handle `absolute right-1` (opacity 0 on desktop, visible on hover or mobile)

3. **"+ New project" button** (conditional on `activeNetworkId`)
   - `mt-1 block w-full px-2 py-1 text-left text-xs text-zinc-400 hover:text-zinc-200`
   - Opens `NewProjectDialog`

4. **"Installed modules" section** (`mt-4`), absent when no module has anything to configure
   - Uppercase heading
   - One group per module: its Config screens then "Configuration" (`/m/<id>`); a module's
     project stays in the projects list, with a `<Badge>` carrying the module's name

5. **`⚙ Settings` link** (sticky bottom)
   - `flex items-center gap-2 px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800` → `/settings`

---

## 14. Top bar — button details

### `LangSwitcher` (project language)

- **Trigger**: `h-9 text-xs font-mono` button showing the language code + ▾ caret
- **Menu** (`align=end border-zinc-700 bg-zinc-900`)
  - One row per language: uppercase code + "default" badge (`text-[9px]`) or ★ (set-default) + × (remove) actions
  - Separator
  - "+ Add language" button (`text-emerald-300`)

### Undo / Redo
- Two `h-9 w-9` icon buttons (Undo2 / Redo2)
- `opacity-50 cursor-not-allowed` if nothing in the stack

### Deploy buttons
- **Revert**: `h-8 text-xs text-zinc-400`, label "Revert"
- **Deploy**: `h-8 bg-emerald-700 text-xs font-medium text-white`, dynamic label "Deploy" / "Deploying…"

### `TopBarKebabMenu` (⋮)
- Trigger: MoreVertical icon `h-8 w-8`
- Dropdown items:
  1. Export ZIP
  2. Import
  3. Export
  4. Patterns
  5. ─── (separator)
  6. **Delete** (`text-red-400`)

---

## 15. Special global states

| State | Visual |
|---|---|
| Not authenticated | `ProjectSidebar` hidden, protected routes redirect to `/login` |
| No project loaded | The Overview/Translations/Data-Sources tab strip is not shown; the content shows an empty state or the wizard |
| Sync conflict | `fixed top-4 right-4 z-50 amber` banner that auto-dismisses after 5 s |
| Drag from Library | `LibraryDragOverlay` (48×48 px ghost, `border-2 border-emerald-500/70`, `shadow-2xl`) that follows the cursor |
| Network error | `Toaster` (sonner) at the bottom right |
| Armed material (click = place) | `ArmedBanner` appears at the top of the Stage |

---

## 16. Inventory of the shadcn/ui primitives used

`Button`, `Card`, `Dialog` (+ Header/Title/Content/Trigger), `DropdownMenu` (+ Item/Separator/Trigger/Content), `Input`, `Sheet`, `Tabs` (+ List/Trigger/Content).

All in `editor/src/components/ui/`.

---

## 17. Inventory of custom components (by feature)

**Layout** : `ProjectSidebar`, `NetworkDropdown`, `NewProjectDialog`, `TopBarKebabMenu`, `SplitPane`, `Toaster`, `EditorLangSwitcher`.

**Canvas (`features/canvas/`)** : `Stage`, `MenuGroup`, `CommandGroup`, `DialogGroup`, `Edges`, `Selection`, `ContextMenu`, `EdgeTooltip`, `ItemTooltip`, `TextEditor`, `ArmedBanner`, `EmptyState`, `ConditionListEditor`.

**Title composer (`features/canvas/title/composer/`)** : `LayersPanel`, `LayerListItem`, `LayerEditForm`, `AddLayerControls`, `WidthResizeHandle`, `TextSizeSelector`, `TitleRender`, `PlainTitleForm`.

**EditorPane** : `SelectionInspector`, `ProjectProperties`, `MenuProperties`, `ElementEditor`, `CommandEditor`, `DialogEditor`, `Library`, `ItemTile`, `MaterialPicker`, `LibraryDragOverlay`, `LibraryDragGhost`.

**Assets (`features/assets/`)** : `AssetsTab`, `AssetGrid`, `AssetDetailPanel`, `AssetUploadDialog`, `AssetImportFontDialog`.

**Translations (`features/translations/`)** : `TranslationPanelContent`, `VisualBody`, `YamlBody`, `ModeTab`, `FilterTab`.

**Data sources (`features/data-sources/`)** : `DataSourcesPanelContent`, `DataSourcesSidebar`, `DataSourceEditor`.

**Auth (`features/auth/`)** : `LoginForm`, `SignupForm`, `LogoutButton`, `DiscordLoginButton`.

**Setup (`features/setup/`)** : `SetupWizard`, `Step1Network`, `Step2Server`, `Step3Project`, `Step4Install`.

**Branches (`features/branches/`)** : `BranchSwitcher`, `CommitDialog`, `HistoryPanel`, `PromoteButton`, `MergeButton`.

**Deploy / export (`features/deploy/` + `features/export/`)** : `DeployButtons` (Revert + Deploy), `runExportZip` utility, `PatternsGallery`.

**Top bar** : `TopBarIconButton`, `UndoRedoButtons`, `LangSwitcher`.

**Misc** : `DeleteProjectDialog`.
