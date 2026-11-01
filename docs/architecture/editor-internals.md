# Editor & rendering internals

> **Phase F (2026-10):** no more backend. The editor is served by the plugin (build
> `npm run build`, same origin as the hub API; ADR
> `editor-web-server`) and keeps only that mode. Demo, accounts, billing, administration,
> public pricing pages, hosted projects and copy to Minecraft are removed
> (sections dropped from this file); the assistant stays in the repo, outside the build. The
> dated entries below that mention "the backend" describe cloud behavior: the
> same route is now served by the hub (see `rest-endpoints.md`), without snapshot mirror,
> without Versions (empty list) and without server-side draft rebase.

`ServerPlaceholderInput` wraps the catalog-agnostic `PlaceholderInput` for live
PlaceholderAPI `%…%` completion in title, lore, dialog and action text fields,
including `RevealField` and module MiniMessage fields. `{…}` keeps its own catalog.
`serverPapiPlaceholdersStore` scopes declarations by session/Network/Server,
deduplicates pending requests and ignores late replies after scope changes/logout.
The root refreshes every 15 s and on `projects_reloaded`; fields refresh on focus.
Offline/errors clear suggestions.
Only expansion-declared tokens are offered, without an external catalog or guessed prefixes.

Draft API requests allow 45 seconds so the hub's 30-second response window for a
leaf server can complete (10 s for the hub's own server). A local transport timeout becomes retryable `fetch_timeout`
(504), preserving the pending operation ID: a publication may already be durable
even if its acknowledgement is lost. The plugin confirms the durable write before
runtime reload, which separately announces `projects_reloaded`. Regression coverage:
`editor/src/lib/api/projectDrafts.test.ts` (28-second success and server timeout).

## Client API (`lib/api/client.ts`, issue #45)

A single transport to the hub: `apiFetch(path, init)` (JSON response) and `apiRequest(path,
init)` (the `Response`, for binaries and for routes whose status is part of the contract,
like the 202 of `rename`). `API_URL` is declared there and nowhere else; the session
cookie goes with every call; `init.json` encodes the body, `init.timeoutMs` sets a
local timeout. All of `lib/api/*` and every one-off call (head textures, PAPI placeholders,
authenticated images, model rendering, resource pack) go through it: no more raw
`fetch` in `src/`.

A single error class, `ApiError { code, status, body, detail }`: `code` is the hub's `error`
(`http_<status>` if it sends none, `hasCode` tells which), `status` is the HTTP status;
a transport failure is `network_error` (status 0), a local timeout `fetch_timeout` (504,
like the hub for a silent plugin), a cancellation `aborted`. `ApiError.from(e)` normalizes
any exception. Modules that return an `{ok:false, error}` result classify
by `code` (never by status alone), `network_error` apart. `DraftApiError` is the case of the
draft routes (`draft`, `conflicts`, `diskFiles` read from the body);
`AuthUnreachableError` and `ServerConfigError` are gone: `getMe` rejects an `ApiError`
for anything that is not a 401, `patchServerConfig` rejects the hub's `ApiError` (`detail`
carries the plugin's explanation). Tests: `src/lib/api/client.test.ts`.

## Open Projects store (`state/projectsStore.ts`, `state/projects/*Slice.ts`, issue #46)

`useProjectsStore` remains the entry point for importers (70 production modules), but its
code lives per domain in `state/projects/`: one slice per file (`projectsSlice`,
`dialogsSlice`, `commandsSlice`, `menusSlice`, `elementsSlice`, `canvasSlice`, `i18nSlice`,
`dataSlice`), each exporting its interface and `createXSlice(context)`, and `helpers.ts` for
what several slices share (the `gc*LTexts`, `shiftPlayerPositions`…). `ProjectsState`
(`types.ts`) is the intersection of the slices plus `openProjects` (`{ projects, projectOrder }`, type `OpenProjects`; the old `Account` and its always-empty `id` are gone, there are no accounts); `ProjectsSliceContext` is what
a slice receives: `set`, `get`, `clearTemporal` and the mutators of `mutate.ts`
(`mutateProject`, `mutateMenu`, `mutateElement`, `mutateAppearance`, `mutateClickHandler`,
`mutateCommand`, `mutateDialog`). An action internal to the Project goes through one of them: a single
`produce`, the target lookup, **nothing at all** if it is missing, the body, then `updatedAt`
stamped — unless the body returns `false` (early exit) or with `{ touch: false }`
(board, sources: these actions never stamped). The store composes the slices under
`temporal` (zundo, `partialize` on `account`): same actions, same undo history,
nothing changes for the editor.

Next steps, store by store, alongside and not instead: give a slice its own
store (`useDialogsStore`…) and migrate its importers, then limit zundo to what is undoable;
the data switch (`account` split) last.

## Image buttons

`Appearance.image = { asset, fit?: "native" | "contain" | "stretch", offset_x?, offset_y? }` selects a project PNG
instead of `material`/`item`. `ImageButtonEditor` exposes the choice in each
appearance card; width and height edit the Element's existing `positions` into
one complete rectangle. States share that footprint but keep independent images,
conditions, title/lore and actions. Iteration and explicit placements are excluded.
`domain/imageButton.ts` validates resize/move operations and rejects collisions.
`ImageButtonsRender` draws the display image once and drags the whole rectangle.
The **Buttons → Images** tab lists button-classified PNGs with `ceil(width/16)` ×
`ceil(height/16)` slot footprints and supports upload and direct drag/drop.
The image drag overlay uses asset dimensions × `TEX_SCALE` × the live Stage zoom;
it has no thumbnail frame or padding. Dropped buttons retain native image sizing.
An image-only overlay modifier cancels the source-card grab offset and centers the
native-sized preview on the pointer; grabbing the name or footprint label behaves identically.
`domain/assetUsage.ts` resolves optional image `usages` (`button`, `menu`). Legacy
`background` and `decoration` usages normalize to `menu`. Missing metadata is inferred from menu display/state images and
title layers; explicit `[]` stays unclassified. Resources exposes unclassified
images for review. Classification filters choices, never rendering or existing
references; several usages share one asset and its descriptor, not copied PNGs.
Contextual pickers filter by usage; **Show all images** enables reuse and adds
the chosen usage without discarding previous ones. In composed mode, **Menu appearance**
exposes one **Add an image** picker beside **+ Text** (`imageControl` slot of
`AddLayerControls`), which appends a positionable glyph layer and preserves existing
title layers. Switching vanilla → composed keeps the plain title's fields (color…). Background/glyph rendering kinds remain unchanged for compatibility.
`addImageButton` validates and inserts the whole footprint atomically; converting
an item also sets its image and automatic positions in one undoable operation.
New buttons use native pixels, centered by default. X/Y offsets (integer pixels)
move the image within its clipped area; they never change click targets. Existing
images keep their fit/footprint when replaced; **Fit slots to image** is explicit.
`menu/v1/imageButtonGeometry.ts` shares canvas/resource-pack sizing and centering, and
`imageButtonArea` — the rectangle of raw slots a button covers and its image origin — used
by the editor (`imageButtonRect`, `rectanglePositions`) and its pack builder (`lib/pack/imageButtons.ts`),
mirrored by the plugin (`ImageButtonLayout.kt`, same test cases). With `player_inventory:
hidden`, a rectangle may sit in the inventory rows or the hotbar, never across two sections.
`useAuthenticatedImageUrl` shares authenticated PNG requests and blob URLs by
principal and full content-versioned URL. `AssetPreview` (picker/editor) and the
canvas reuse those bytes, including the picker-to-canvas handoff. Picker thumbnails
load near the viewport. The last consumer releases the preview in a microtask,
aborting pending downloads and revoking blob URLs; account/content changes cannot
reuse a different scope. Regression coverage: `useAuthenticatedImage.test.tsx`.
Transient HTTP 5xx preview failures retry twice (500 ms, then 1 s) while mounted;
permanent 4xx failures are not retried. Unmount/session change cancels pending retries.
In the self-hosted build (`SELF_HOSTED`), `assetPreviewUrl` and `fontGlyphUrl` resolve to
routes the plugin already serves (`features/assets/localAssetUrl.ts`): the draft blob
(`…/drafts/:id/blobs/:hash`) when the bytes changed in the private draft, otherwise the
published file (`/api/v1/projects/:id/binary?path=`). Asset CRUD runs in the browser
(`features/assets/localAssets.ts`, a port of the former backend `assetHandlers.ts` on top of
the draft snapshot and blobs), switched at the `lib/api/userAssets.ts` boundary.

**Using another project's resources.** `features/project/ProjectSource.tsx` lists the server's
other projects from the server index the project view already loads (`useOtherServerProjects`,
published state, the edited project excluded), so nothing is loaded twice. Its choice is
`ProjectSourceId`: `null` (this project), one project id, or `ALL_PROJECTS` (every other project,
offered from two on); children get the resolved `Project[]`. A library shows them read only,
several projects merged (assets keyed `projectId:id`, captured items grouped by project): assets through `useOtherProjectAssets` (`listLocalAssets` on the
published disk, kept out of `assetStore`), captured items straight from the indexed `Project`.
Using one copies it first, a snapshot with no link back:
- an asset: `copyAsset` (`lib/api/userAssets.ts`) reuses an identical one (type + hash, glyph
  metrics, font glyph map), otherwise reads its files (`readAssetFiles`) and runs the `/copy`
  draft mutation (`localAssets.ts` `copyIn`): free name `name_2`… among every asset id
  (`freeAssetName`), a glyph gets this project's next codepoint, a font its own namespace.
  `copyAssetInto` toasts the outcome; `dropCopiedImageButton` reads the slot at release, then
  places the copy.
- a captured item: the drag payload carries it (`captured`), and `adoptCapturedItem` adds it
  with its id at the drop, click or pick, or reuses one with the same id or stack.

The pack builder (`lib/pack/imageButtons.ts`) collects all display/state variants from menu files and
resizes PNGs with nearest-neighbour sampling into 18-pixel slot cells. Contain
centres with transparent padding; stretch fills the rectangle; native keeps source pixels.
Source assets are unchanged. Derived keys include the asset SHA-256, pixel dimensions, fit and Y,
with an X/Y suffix only for nonzero offsets (legacy keys are preserved);
each has its own font namespace and measured glyph advance in the asset index.
`ImageButtonLayout` mirrors that key/geometry in Kotlin. The renderer evaluates
the appearance once, appends its glyph to the title and fills the footprint with
empty-model items carrying the shared tooltip/clicks. Missing images or invalid
footprints produce no active image button. Plain title text renders after images.

## Project display name

`features/project/ProjectTopBarControls` subscribes to the current project's name so
settings edits update the header immediately, falling back to the loaded name.
`projectFromFiles` defaults Boutique-owned projects (`manifest.module: boutique`)
to `Boutique` when their metadata name is absent or matches their internal/disk ID.
Explicit custom names remain unchanged; IDs and folder names are unaffected.

## Publish workflow (`features/project/publish/`)

Save (account draft) and Deploy (the only disk write, compare-and-swap) live in
`features/project/publish/`: `publishFlow.ts` is the pure reducer (`saving`, the
deploy `review`, the `conflict` modal with its source `save | open | draft`, tree,
disk files and per-file choices, the last failure), tested without React;
`usePublishFlow(projectId, offline)` runs the workflow against the stores and the hub
(conflicts found at draft open, silent rebase of a draft conflict without diverging
file, the `OPEN_DEPLOY_REVIEW` event of the History tab); `SaveControls` and
`ConflictResolutionDialog` only render. A new conflict always starts with no choice.
Opening the review also asks the server whether the changed files would load
(`checkDocuments`, `POST …/check`, the `documents_check` Deploy runs before writing): the
review's `documents` is `pending`, then `ready` with its problems or `unavailable` (never read
as a green light). `DeployReviewDialog` lists each problem on its file in the `ChangeList`
(`problems` prop: a count on the header, the lines above the diff, the file opened) and
disables Deploy while there are any. A reply is kept only for the review it was asked for.

**Several Projects in one Deploy.** The review also lists the player's other drafts with
changes (`otherDrafts.ts`: `listServers` → `listServerProjects` of each online server →
`listDrafts` of each Project, at most 6 at a time; the open Project's working copy is left
out, its other drafts are not). Each is a row with a checkbox, unpicked by default; one draft
per Project can be picked (picking a draft of the open Project unpicks its working copy). A
picked draft shows its `ChangeList` and is checked by the server like the working copy; a
draft this browser edited further than the hub's copy is `unsynced` and cannot be picked.
`useOtherDrafts` holds the list, the picks and the checks. Confirm deploys the open Project
first (its conflicts open the resolution as before), then each picked draft from the hub's
copy (`publishDraft`), one after the other, stopping at the first failure; a toast says what
went out, what failed and what was not tried. Each Project is written on its own: one that
went out stays out. Deploy is enabled when this browser holds changes in another Project
(`pendingElsewhere`). The assistant's "Review and deploy" fires `OPEN_DEPLOY_REVIEW` with
`preselect`: the drafts its conversation started, picked when the review opens.

## Workspace page (`features/project/ProjectCanvasPage.tsx`)

The page keeps only loading (`useProjectLoader`) and layout (topbar, canvas,
secondary views `?tab=`). The module's root opens on its **home** (`ModuleHome`, no `?tab=`):
an opaque page over the board, which stays mounted beneath it; the board is `?tab=board`
(the old `overview` and a `?doc=` link still open it). Under a child page (a Document, a
collection, a screen, a data source) no `?tab=` means the board behind that page, as before
(`effectiveTab` in `workspaceTabs.ts`); the topbar and the digit shortcuts go through
`useGoToWorkspaceTab`, where Home and Canvas leave a child page for the module's root. The
home is built from what is already declared — kinds (board counts), collections, the
module's screens (minus the one a collection shows on its page), its data sources, its
`command` Documents and the server's actions whose `moduleId` is the module — one block per
place, never a row per Document (the sidebar lists them). The order follows the content: a
board holding anything but commands comes first, two columns wide, with `BoardThumbnail`
(`features/canvas/`: an SVG of `projectBoard`'s arrangement, boxes in `kindAppearance` colours,
links and folder frames; `null` when the arrangement throws); a board of commands alone goes
after the lists and data sources, compact. A lone settings screen titles its block. The owner
module's own section (`FrontendModule.home`, SDK 1.18) sits between the header and the blocks,
behind an error boundary (`LeaveOutOnError`) that drops it alone. The rest is named: `WorkspaceGate` (auth hydration, login
redirect, load failure, skeleton — via `projectLoadStatus`), `useProjectDeepLinks` (`?doc=`,
canonical folder id, rename, opening a Document from the board),
`useActiveLangFallback`, `useWorkspaceDnd` (sensors + `DndContext` callbacks) on top of the pure
decoding in `workspaceDrop.ts` (`dragStartMaterial`, `decodeDragEnd` → `WorkspaceDrop`), and
`WorkspaceDragOverlay`.

## Tests and CI

The selection of an element is resolved in its owner menu before any lookup of a command, dialog or menu carrying the same ID. The nodes of these entities ignore a scoped selection for their highlight; a click on the node resets that scope. A scoped element that has disappeared stays unknown, without selecting another entity with the same name.

`vitest.config.ts` excludes all `**/e2e/**` folders so Playwright tests are not loaded into Vitest. Browser scenarios are still run by `playwright.config.ts` (`tests/e2e`) and `playwright.migration.config.ts` (`e2e/migration.spec.ts`). The editor CI must pass before the production deploy workflow starts.

> Editor implementation details + title rendering pipeline. Read when touching
> the title composer, the canvas / element editing.

## Menu YAML format — `title` field

Since SP3, `title` is an array of typed layers (`MenuTitleLayer[]`). The legacy format (raw string or `{i18n:key}`) is tolerated by the plugin parser for backward compatibility. Runtime YAML unchanged since v3: only the editor changes.

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
    color: "#FFAA00"     # optional
    font_asset_id: ...   # optional (SP4)
  - kind: textarea
    value:
      key: i18nKey_block
    x: 8
    y: 6
    width: 168
    line_height: 10
    alignment: left      # left | center | right
    font_asset_id: ...   # optional (SP4)
  - kind: external_glyph
    provider: oraxen     # nexo | oraxen | itemsadder
    glyph_name: my_glyph
    x: 50
    y: 5
```

The `textarea` kind (SP5) is a multi-line block: the i18n string is split on `\n` at runtime, then each line is word-wrapped to fit in `width` (px). Each sub-line is rendered at `(x, y + i * line_height)` with the shared `alignment`. The optional `font_asset_id` applies to all lines. Words wider than `width` overflow (soft constraint).

The plugin embeds `assets/artisan/asset-index.json` (schema **v2**) in the RP zip to map `asset_id → name + type + codepoint? + ascent + height + width + namespace? + slices?` and to declare the `offsets` table (hex codepoint → pixel advance).

## Title Composer — pixel offsets (spaces font)

To position each layer at its exact `x`, the pack (built by the editor) embeds in `assets/artisan/font/default.json` a `space` provider (MC 1.20+) mapping 18 codepoints (`U+F800..U+F811`) to pixel advances (powers of 2 ±1/±2/.../±256 → range ±511 px by greedy decomposition, **or more with reuse** of chars). We avoid `U+F900..U+FAFF` (CJK Compatibility Ideographs) where the vanilla font has glyphs that would prevent the `space` provider from applying.

Pipeline:

1. **Editor** — `editor/src/lib/pack/spaceOffsets.ts` = source of truth for the table (`fontJsonBuilder.ts`, `assetIndexBuilder.ts`). `buildDefaultFontJson` adds the `space` provider after the bitmaps. `buildAssetIndex` (v2) emits `offsets` (uppercase hex codepoint → advance) + a `width` per entry.
2. **Plugin** — `AssetCatalog` parses `offsets` on each RP update and builds an `OffsetEncoder` (`net.artisanmc.plugin.render.OffsetEncoder`). `TitleCompiler.compileTitle` tracks `currentX`, inserts `offsetEncoder.encode(targetX - currentX)` before each layer body, advances `currentX = targetX + estimateBodyWidth(layer)`.
3. **Width estimation** (best-effort): Image → `AssetEntry.width` (fallback 16); Text → `length * 6` (imprecise heuristic); ExternalGlyph → 8 px.

**x coordinates**: `layer.x` = pixels from the left edge of the chest (`chest-x 0`). The MC title is drawn at `titleLabelX = 8`. `TitleCompiler` initializes `currentX = TITLE_LABEL_X = 8` to absorb this shift: `x=8` → zero offset, `x=0` → offset `-8`.

The plugin encoder is **lenient**: never throws, returns `""` if the table is empty (catalog not loaded), best-effort outside the range. On the editor side, `encodeOffset` is **strict** (throws) to catch bugs at the source.

## Custom fonts (SP4)

Import MCFonts via "Import font" in the AssetsTab: drop a `.zip` (`font.json` + glyph PNGs). The editor parses/validates the font (`lib/pack/mcFontsParser.ts`), writes it to the draft then, on publish, under the Project's `assets/fonts/` (`lib/pack/assetDiskWrite.ts`). On RP regen: `assets/artisan/font/<name>.json` + `textures/font/<name>/*.png` embedded. Editor: `TitleRender` renders pixel-perfect via `McFontText` (Konva composition of the glyph PNGs).

Background = "big glyph": its height comes from the asset's ascent (`y = 13 - ascent`).

**Glyph layers = Y per layer.** `layer.y` is the top of the image in chest pixels. The plugin (`TitleCompiler`) renders a glyph whose `y == 13 - ascent` with `artisan:default`, otherwise via `<font:artisan:glyph_y{Y}>`. The pack builder (`lib/pack/buildServerPack.ts` → `glyphPlacementsFromMenus`) reads the `menus/*.yaml` of each Project and emits `assets/artisan/font/glyph_y{Y}.json` only for the (glyph, Y) pairs in use: each provider reloads its texture on the client, so no full matrix like `text_y`. Floor shared by the 3 layers: `y >= 13 - height` (MC rejects `ascent > height`). `LayerEditForm` exposes X/Y and "Align as chest background" (x=0, y=17); the `AssetPicker` receives `projectId` and offers upload (`AssetUploadDialog.onUploaded` → direct pick).

**HUD fonts.** Two families let a module draw in a slot of the screen (`api.getOverlay()`, `modules.md`); text drops below the line through the `text_y{Y}_h8` fonts of the menus (`Y = 6 - R`). `artisan:text_up{R}` (R = 0..128, always in the pack, `buildTextUpFontJson`): vanilla text R px higher. Minecraft rejects `ascent > height`, so a glyph cannot rise above its own cell: the providers point at `artisan:font/{ascii,accented,nonlatin_european}_up.png`, the vanilla textures with 128 transparent rows under each cell (`tools/minecraft-assets/gen-padded-fonts.ts`, committed in `editor/src/assets/minecraft/font/`), `height = vanilla + 128`, `ascent = vanilla + R`. `artisan:overlay/<sha256(asset)>_<R>` (`lib/pack/overlayImages.ts`): one font per (asset, rise) a kind's `pack.images` asks for (R = -166..128), `ascent = 7 + R`, the image padded under it to that height, cut into glyphs `\ue000…` of 256 columns (a larger glyph is dropped by the client's 256 px atlas); its index entry lists each slice's content width (`slices`), from which the plugin joins them, and the image's own height before the padding (`imageHeight`), which places an `image_slot` of a HUD layout by its bottom (`OverlayApi.imageHeight`). A request by bottom (`{asset, bottom}`, SDK 1.16) is resolved there to `rise = height - bottom` once the PNG is decoded (`buildOverlayImages`); `pack.images` gets a `file(path)` context parsing the project's other files lazily.

## Title Composer UX v3

- **In-place editing**: layers are edited **directly on the project canvas** via a 3rd column (`LayersPanel`, ~280 px, always visible). No more dedicated focus mode for the title.
- **3-column layout**: Project canvas | `MenuProperties` (rows/permission/actions) | `LayersPanel`. Rendered in the project's `board` tab (server-scoped route below; `project.$projectId.tsx` is now only a legacy redirect).
- **`LayersPanel`** = Header + `AddLayerControls` (`+ Image` / `+ Text`) + drag-reorderable list of `LayerListItem` + `LayerEditForm`.
- **Selection**: `uiStore.selectedLayerKey: { menuId, index } | null`; `uiStore.lastSelectedMenuId` sticky (the panel survives clicks on empty space).
- **UI types**: 2 visible — Image (collapses `background` + `glyph` with a `stretchToChest` flag) and Text. On save, Image splits at runtime into `background`/`glyph`. External glyphs: own branch, no dedicated button in v3.
- **Text** = inline MiniMessage tags (`<gold>`, `<bold>`…), live preview. No per-layer `color` (coloring 100% by tags).
- **Direct manipulation**: drag to reposition. No resizing of image layers (pixel-perfect assets; `ResizeHandles` removed 2026-10-21).
- **Resize semantics — IMPORTANT**: resizing a glyph mutates the **asset** (every menu that references it changes). For a per-menu size: **"Duplicate glyph"** button (`LayerEditForm`) → copies the asset (new codepoint + PNG) and repoints the layer.
- **Cursor-based attach**: drag from `+ Image`/`+ Text` → drop near a menu → attaches to the nearest one (200 px threshold). Click without drag → last-selected menu.
- **v3 files** under `editor/src/features/canvas/title/composer/`: `LayersPanel.tsx`, `LayerListItem.tsx`, `LayerEditForm.tsx`, `AddLayerControls.tsx`, `TitleRender.tsx`, `useTitleLayerDrag.ts`, `dragPlacement.ts`, `attachLayerAtCursor.ts`, `screenToCanvasCoords.ts`; `stageGeometry.ts` (in `features/canvas/`).

**Unified text in the composer**: `+ Text` creates a `textarea` (one or more lines), with width adjustable by field or right handle and left/center/right alignment. The old `text` and `textarea` stay readable; the common form converts an old `text` when it is edited, keeping its i18n key and properties. Merely selecting it does not modify the document.

The "Adjust line spacing" button sits next to the Line spacing label, with a tooltip explaining size + 2 px (max. 32). Horizontal alignment gets its own row.

**Fixed frame**: the displayed X is the left edge of the frame. The runtime format keeps its historical anchoring: text X on the left, center or right. `textFrame.ts` translates between the two (`xRuntime = xFrame + alignmentOffset`) when width/alignment change. `TitleRender` places the group at the left edge and the lines inside; the drag converts back to the runtime anchor. Width and line spacing are in MC pixels, independent of font size. Centering follows the integer rounding of `TitleCompiler`, with measurement of tags and bold.
- **Removed vs v2**: `FocusComposer.tsx`, `ComposerCanvas.tsx`, `AddLayerBar.tsx`, `LayerSidePanel.tsx`, `TitleThumbnail.tsx` (+ tests).

## Editing a Document — Properties panel (`EditorPane`)

The selected Document is edited in the right-hand panel. The old full-screen **focus mode** (forked, `features/element-editor/` + `FocusButton` + `useElementDblClickNav`) was removed 2026-06-06: duplicate of the Edit tab + routing bugs. On 2026-06-13, a deep-linkable **individual view** replaced it on sound foundations — a single rendering shared with the board, no forked editor (see the "Curated board" section below). The `.../document.$documentId` route is therefore back, but with a different implementation.

- **`features/inspector/EditorPane.tsx`** — **Properties** panel, no tabs, which directly renders `<SelectionInspector>`. A **YAML** button in its header replaces `<SelectionInspector>` with `<DocumentYamlView>` (verbatim writing) on the selected Document's file — the parent menu's file for an element; path via `documentRelPath`, shared with the `DocumentView` toggle. With no selection, project settings open, the button opens the module file (`artisan-module.yml`, or the name it has on disk: `moduleFileRelPath`). The Buttons panel is independent (see below). **The item set is created AT MENU LEVEL and exists only through the element that renders it** (ADR `item-templates-and-data-library`, revision 2026-07-31): `MenuDataSection` carries an "Item set" block per list; `createMenuSet` creates a self-sufficient element in `iterates` or `places` mode. In placement, `PlacementRowsPanel` lists the rows of the current preview context as draggable tiles (`placementRow` payload, drop handled by `MenuGroup`/`pinPlacementRow`).
- **Buttons** — `features/project/ProjectLibrary.tsx`: canvas panel with three tabs **Game items / Captured items / Images**, without graphic resource management. `ProjectLibraryWorkspace` wraps the board or the individual view under the same `DndContext`; what a drag carries (`material`, `imageButton`, `placementRow`) and the state target (`stateMaterial`) go through dnd-kit's `data`, typed by `features/canvas/dragPayload.ts` (`draggableProps` / `droppableProps` at the source, `readDrag` / `readDrop` in `onDragEnd`) — the id is only a unique key, never read back; panel on the left on desktop, under the stage on mobile. It loads items and assets even with no selection, independently of whether the panels are open. The open state is persisted and tied to the last opened project (`projectLibraryStore`), never to the selection. Escape closes Buttons before Document navigation; dialogs and fields keep their own Escape handling. The historical `graphics` category is migrated to `items`; `captured` is now a top-level category.
- **Resources** — central tab `?tab=resources` of the project to manage images and fonts (`AssetsTab`, detail views with return to the grid). It complements the menu's contextual pickers without duplicating files. Navigation order: Home / Canvas / Translations / Resources / History; numeric shortcuts 1-5 in that order.
- **`features/inspector/`** — the Properties panel feature: the frame (`EditorPane`, `FloatingEditorPane`), the `SelectionInspector.tsx` router, the per-type editors (`element/`: `ElementEditor` + state cards `StateCards.tsx`; `command/CommandEditor.tsx`; `dialog/DialogEditor.tsx`, also referenced as `component` by `modules/{commands,dialogs}`), `properties/` (`ProjectProperties`, `MenuProperties`, `ActionEditor`, `ConditionListEditor`…) and `chain/` (Action chain editor). The item sub-editors shared with the board (`AdvancedItemSection`, `ItemBindingEditor`, `ItemHeadField`) live in `features/canvas/item/`.
- **`features/inspector/SelectionInspector.tsx`** — unified editor of the current selection (`useSelectionStore`). Routes by type:
  - 0 selection → `ProjectProperties`
  - menu → `MenuProperties` (+ title `LayersPanel`)
  - element (slot) → state cards (material / title / lore / conditions + click handlers as pseudo-code)
  - command → identity + args + step tree
  - dialog → title / body / buttons + actions per button
  - Document of a module kind → the `component` of its contribution (section "Document kinds contributed by a module" below)
  - multi-selection → "select one item" (multi-edit out of V1)
- **Selection → Properties**: selecting a menu / slot / command / dialog directly shows its properties without changing the category or closing Buttons. The old `uiStore.editorTab` is removed and ignored on rehydration.
- **Custom heads (PLAYER_HEAD)**: choosing `PLAYER_HEAD` as a state's material reveals a "custom head" row under the material selector. A select chooses the source (`HeadDatabase` / `Base64` / `Player name`) and a value field appears next to it. Pasting `hdb:<id>` or a raw `eyJ…` string detects the source automatically. Choosing the `playerhead` source on an empty field directly writes `playerhead:{player.name}` — the context placeholder of the player who opens the menu, the common case — and a "Current player" button reinserts that placeholder when the value has been replaced by a literal player name (`VIEWER_HEAD` in `features/canvas/item/headField.ts`). `headPreviewUrl` converts base64 and literal names into a 3D mc-heads.net render; `useHeadPreviewUrl` adds HDB resolution via the active server (`GET …/head-texture?id=…`). In-memory cache per network/server/id, identical requests shared, success reusable for 10 min and failures retried after 30 s while the preview is mounted; old responses isolated on server change. HDB missing, unknown head or unresolved placeholder → generic icon. The hook feeds Konva slots, ghosts, overlays, state cards and material selectors.

- **Vanilla heads in 3D**: the head cubes of `mcModelRenderer.headDef` use `yFlip: false`: the skin slicing already puts the face to the south and the top up. Flipping them exposed an omitted face on top and the face at the back. The geometry test goes through `renderToCanvas` and checks the top surface and the face UVs by ray casting.

### Declaration-driven action form (`properties/ActionEditor.tsx`, since 2026-10-15)

A domain action is `{ name, value }` (`domain/types.ts`): the wire name and its canonical value, texts as `LText{key}` nodes at the `ltext` slots — core and module actions alike (ADR `extensible-document-kinds`, W4). Every reader goes through the declaration (`CORE_ACTIONS` imported from `testdata/core-actions.json` ∪ the server's `declared_actions`, `useDeclaredActionOf`) via `domain/actionArgs.ts`: `normalizeActionArgs` (wire value → argument map, server rule: `null` = none, a map whose keys are declared = the map, otherwise the primary), `canonicalActionValue` (map → shortest form: required always written — declared default if missing —, optional at its default omitted, primary alone bare, otherwise map; `null` if nothing), `actionArgs(action, decl).get/set`, `withActionArg`. Document refs are `document_ref(kind)` arguments (R3): `actionDocumentRefs` / `walkDocumentRefs` feed `deriveEdges`, the clipboard (`remapAction`), `setMenuId` and `previewCallContexts` — none of them knows `open_menu`.

- **`ActionEditor`** renders `DeclaredActionForm`: one row per declared argument, label `actionEditor.args.<action>.<arg>` (fallback: the argument name), help `actionEditor.help.<action>.<arg>`, hint `actionEditor.hints.<action>` for an action with no argument. `ArgInput` picks the widget by kind: `ltext` → `TextArgInput` (existing key or literal, removable if optional), `document_ref` → `MenuRefInput` (titled dropdown, other projects of the server qualified `project:id`) or `KindRefSelect` (select via `documentsOf(project, kind)`), `map(string)` next to a `document_ref` → `ContextMapInput` (context inputs of the target), `list(ltext|string)` → `ListArgInput`, `number`/`integer` → `NumberInput` (`NUMBER_BOUNDS`), `boolean` → checkbox, `enum` → segments (≤ 3 values) or select, `string` → `Input`. `ARG_WIDGETS` overrides by `"<action>.<arg>"`: `MaterialInput` (give/take_item), `SoundInput`, `IterableTargetSelect` (pagination), `ExpressionInput` (command, `set_arg.value`, cycle lists, `run_actions`). `module_command` gets `ModuleCommandInput` (select of the commands the server's modules declare, `useServerPlayerCommandsStore` ← `GET /api/v1/servers/:id/player-commands`) and `ModuleCommandArgsInput` (one row per argument the command declares, empty = the bound value of the same name; a key it does not declare is flagged; an undeclared command falls back to JSON). `CommandEditor` shows, on a node whose steps call `module_command`, that the module reads its arguments by name, and `domain/moduleCommands.ts` `argDrift` lists the declared ones missing (not mapped by the step), retyped, or apparently renamed. An undeclared action (module offline) is edited as raw JSON (`JsonValueInput`). Adding a core action to the form = declare it in `CoreActions.kt` (regenerated vector) + its `en.ts`/`fr.ts` labels; a module action needs nothing on the editor side.
- **Action chain editor** (`features/inspector/chain/`): a single `StepTree` (rows and `if` blocks in `StepRows.tsx`) for all chains. A project chain is addressed by `ChainAddress` (`domain/chainAddress.ts`: `element` {menu, element, state, click} | `command` | `dialogButton`); `ActionChainEditor` renders it and `storeChainOps` routes each edit to the reducers of its owner (no `if` on a dialog button, `chainAllowsIf`). `ControlledStepsEditor` (module data) passes the same tree with `controlledChainOps` (value + `onChange`, immer). Drag and drop: a single `DndContext` per chain (`StepTree`), each `Step[]` (`StepList`) is also a drop zone; a step can enter an `if`/`else if`/`else` branch, leave it or change branch. `ChainOps.move(from, to)` takes two `StepPath`s and the `move*Step` reducers apply `moveStepMut` (`domain/stepPath.ts`, refuses an `if` dropped into itself); the target is computed by `stepDrop.ts` (smallest zone under the pointer, before/after depending on the center). Action row: generic summary from the declaration (primary first, then `k=v`, `(k)` for a true flag; `ltext` rendered as MiniMessage); each row shows its family tile and the translated action name (`actionCatalog.names`, technical name on hover), `if` / `else` are in logic color with a rail per level; `AddStepLine` lists `ACTION_TYPES` (the names of `CORE_ACTIONS`) and seeds via `defaultDeclaredAction` (`features/inspector/chain/defaults.ts`: `CORE_SEEDS` + declared defaults + first menu for a required `document_ref`).
- **"Add step" menu** (`AddStepLine`, `StepRows.tsx`): a `DropdownMenuSearch` at the top live-filters the core actions, those of modules and the `If` block (label or name, case- and accent-insensitive: `matchesMenuSearch`); ↓ moves to the first item then arrows navigate, Enter in the field takes the first result, a keystroke on an item returns to the field instead of the menu's type-ahead. The field is cleared on close.
- **Legacy DSL**: `lib/actionDsl/ast.ts` keeps its typed AST (`DslAction`, locked by `testdata/action-dsl-conformance.json`); `domainSteps.ts` projects it to `{name, value}` and back. `lib/i18nMigration.ts` folds the typed form (`{type, menuId…}`) of a project persisted before W4 through the same adapter.

### Document kinds contributed by a module (`FrontendModule.documents`, batch 5, since 2026-10-15)

A module declares its Document kinds in its `FrontendModule` (`documents: DocumentKindContribution[]`, SDK): `kind`, `dir`, `schemaVersion`, `idPrefix`, `label` (host i18n key or label), `icon`, `component` (the Properties panel view, `{projectId, documentId, document, item?}`), `ownHeader` (SDK 1.13: the view draws the Document's header, so `SelectionInspector` leaves out its `DocumentHeader`; commands, dialogs and triggers set it), `wide` (SDK 1.15: `DocumentView` gives the view the whole width instead of its centred `64rem` column, `--page-max`), `title(doc, {project, lang})`, `listByTitle`, `create({id, projectId})`, `parse`/`serialize` (the file codec), `ltextSites(doc)` (its texts, for Translations, rekey at deploy and GC), `chainSlots(doc)` (its action chains: `{name, steps, prefix, label?}`, for edges and addressing of action texts), and `board` (`size`, `summary`, `render`, `items`). The core kinds (menus, commands, dialogs, triggers) are declared the same way (`src/modules/{menus,commands,dialogs,triggers}/*Kind.tsx`) — dogfooding; the SDK registry refuses a kind contributed by two modules. `board.accent` accepts a hex or a `var(--kind-…)` token, which `DocumentGroup` resolves (`useCssVar`) to follow the theme.

- **Host bridge** — `lib/moduleDocumentKinds.ts`: `registerEditorModule(mod)` is a module's only entry point (`main.tsx` for the core, `modulesStore` / `ConfigScreenPage` for Presence-gated modules): it registers the module in the SDK and pushes each contribution into the registries the host already reads — kinds table (`domain/documentKinds.ts`, rank after the core kinds, folder and schema checked if the kind is already known), file codecs (`schema/documentCodecs.ts`), visitors (`domain/documentKindVisitors.ts`). The domain knows nothing about React: the view, label and board overrides stay on the contribution, read by `documentKindContribution(kind)` (SDK) from the surfaces that render.
- **Properties panel via registry** — `selectionContext` returns `{ kind: "document", documentKind, id }` for a Document of a non-core kind; `SelectionInspector` resolves `documentKindContribution(kind).component` for menu / command / dialog / document and renders it in an `h-full min-h-0 overflow-y-auto` container; with no registered module (a surface rendered alone, a test), the built-in core editors still answer; without a view, `projectPanel.noEditor`. The YAML button follows: `documentRelPath` = `<kind dir>/<id>.yaml`.
- **Listings** — `buildProjectDocuments`: one group per registry kind (registry order) then the kinds present without a module; label = id, or the `title` if `listByTitle` (commands); `documentLabel` goes through the contribution's `title`. `ProjectDocumentTree` takes icon and label from the contribution (fallback `FileText`, `t(label, {defaultValue})`) and offers a "+" entry per module kind → `NewDocumentDialog` (id prefix, conflict via `hasDocument`, `createDocument`). The four "new Document" dialogs validate the id the same way (`features/canvas/newDocumentId.ts`, via `hasDocument`: unique across the whole project, module kinds included); menu, dialog and module kind share `NewPrefixedIdDialog`, the command derives its id from the name (`useUniqueDocumentId`, suffix `_1`, `_2`…). The search palette indexes one Document per kind (`group` = the kind); the sidebar counter and `liveDocumentIds` read the facade (`documentCount`, `documentIds`).
- **Store** — `state/projects/documentsSlice.ts`: `createDocument({projectId, kind, id, position})` (seed `create`, texts minted at their canonical keys by `mintLTexts` over `ltextSites`), `updateDocument` (whole replacement, for a module's view), `editDocumentChain({projectId, kind, id, slot, lang, edit})` (in-place edit of a `chainSlots`: GC of the texts of removed steps, minting of new ones under the slot's `prefix`; this is what the chain address `{kind: "document", docKind, docId, slot}` of `chainOps.ts` calls, so the `ActionChainEditor` works as is on a Trigger's chain), `setDocumentId({projectId, kind, oldId, newId})` (id, `rekeyDocument`, layout, edges, groups, **every `document_ref` of this kind** repointed via `walkDocumentRefs` over all `chainSlots`, `recordRename` of the file). Core kinds keep their dedicated reducers.
- **i18n and edges** — `visitProjectLTexts`, `visitProjectStepChains`, `rekeyProject` and `gcDocumentLTexts` iterate `allDocuments` × visitors: a module kind is translated, rekeyed and cleaned like a core kind. `deriveEdges` adds a trigger `{ kind: "chain", documentId, slot, label? }` per `document_ref` found in a chain slot of a non-core kind; `EdgeTooltip` displays it.
- **Triggers** (`src/modules/triggers/`, ADR `triggers-and-variables`) — the core Game events catalog is read from the `testdata/core-game-events.json` vector (written by the plugin), merged with the active server's `declared_game_events` (`state/serverGameEventsStore.ts`, `useGameEvents`): the picker works without a server and marks "module missing" what the active server does not declare. The page (`TriggerEditor.tsx`) wraps the chain in `ChainEventProvider` (the chosen event) and an `ActionScopeProvider` `{kind: "event", values}` (the `{event.…}` offered in texts). `cancel_event` / `set_event` (`lib/actions/eventActions.ts`) are never in the generic action list: `AddStepLine` offers them under "This event", based on the `cancellable` and `effects` of the chain's event. Kind color: `--kind-trigger` (raspberry). On the board a Trigger has its own node, `features/canvas/TriggerGroup.tsx` (not `DocumentGroup`), read as a rule: its id in the kind colour (the condition count on the right), a "WHEN" band naming the event (`eventShortLabel`), then its first `TRIGGER_ROWS.shown` top-level steps as rows (action family colour, `actionLabel`, the Document the step opens), then "+N steps"; height `triggerBox`, also returned by `documentBoxSize` for the `trigger` kind. Disabled: struck and faded, like a command. A link one of the shown steps draws leaves from its row (`triggerStepAnchors`, beside `subCommandAnchors` in `Edges`), and hovering it outlines that row (`triggerRowsOpening`); a link only a hidden step draws keeps the node's anchor. The page's header (`EditorHeader`) is titled by the id, as a command by `/name`; its `details` line gives the event as a full sentence and the conditions and delay as chips.
- **Board: preview only** — `DocumentGroup` (Konva) is the node of every non-core kind: host chrome (`board.size` box or `DOCUMENT_BOX` 140×48, id, `board.summary` line or the kind, selection, drag, double-click → individual view) around an optional `board.render` — a **react-konva** component, rendered in a `Group listening={false}`: nothing inside receives the pointer. `board.items(doc, ctx)` (SDK 1.2) lists the Document's parts under the header (`title` title, then `id · summary`), one `{id, label, detail?}` row each, drawn by the host: the node grows with the rows (`documentBoxSize`, `DOCUMENT_ITEMS`), a click selects the part like a menu element (`ids = {item}`, `menuId` = the Document's id) and `selectionContext` returns `{kind: "document", …, item}`, which the panel passes to `component` as `item`. SDK 1.5: a row can carry a `marker` (badge before the label: its rank when the parts chain; when all have one, a line links the badges) and a `hover` (`{title?, text?, lines?}`, MiniMessage) that `DocumentItemTooltip` displays on hover (`state/documentItemHoverStore.ts`, mounted by `Stage`); `board.accent` colors the node (border, header band). SDK 1.8: a row can carry an `icon` (item value as the Document holds it: material, captured `item:<id>`, map `{extends, title, lore…}`), resolved by `resolveItem` like a menu button and drawn 16 px before the label (`RowIcon`, head included; the first two letters of the material when there is no texture). Editing happens in the Properties panel. `nodeBox`, `Edges`, `serverGraph` (node + ref target) and `ServerCanvasPage` (filter chip labeled by the contribution) know the kind through the registry. SDK 1.9: a kind with `collection` has no node (`boardGraph`, applied by `projectBoard`, rearrangement and `ServerCanvasPage`); its Documents live in the page of their collection (`features/screens/CollectionView.tsx`) and the sidebar's `CollectionNode` entry, and never go into a folder (`moveToFolder`, `useCollectionsAtRoot`). **Core exception, not to be generalized**: in-place editing of menus on the board (slots, layers, item drops, `focus` branches of `Stage`) is specific to the menu kind and stays that way; a module kind never edits on the board.
- **Unsynced kind (W6)**: the server reports its kinds to Presence (`document_kinds`, `GET …/document-kinds`), loaded into `state/serverDocumentKindsStore.ts` from `__root.tsx`. `isKindSyncedOn(state, kind)` is false for a kind the active server answered without listing (never for a missing answer: older plugin); `DocumentGroups` then marks the group header (amber dot, `title`), `NewDocumentDialog` shows `canvas.kindNotSynced`. Core kinds are never marked.

### Module views loaded at runtime (since 2026-10-17, ADR `runtime-editor-modules`)

A module can serve its view from its jar instead of the copy compiled into the editor.

- **Loading** — `state/modulesStore.ts`: for each active module, the advertised bundle (`installed_modules[].editor_bundle`, `lib/api/modules.ts`) first goes through `distribution/runtimeBundle.ts`: version check (`sdkCompatibility`, refusal before download), `fetch` of `…/modules/:module/ui.js?v=<hash>`, rewrite of shared imports (`es-module-lexer/js`) to `blob:` modules that re-export the editor's instances (`distribution/sharedModules.ts`: `react`, `react-dom`, `react/jsx-runtime`, `@artisan/editor-sdk`), import of the bundle as `blob:`, check of the default export (`id` = served module, `sdk` compatible). Refusal or failure → entry of `modules.manifest.ts` if it exists; `origins` / `refused` report it. A bundle advertised `local: true` (read by the server from a file, `dev.editor-bundles` of environment.yml, `LocalEditorBundles.kt`) has the `local` origin, and `components/LocalBundlesNotice.tsx` flags it at the top of the page. A failing module does not block the others.
- **SDK host** — `lib/editorHost.ts`, installed in `main.tsx` before any module: `useProject`, `useContentLang` (`uiStore.activeLang`), `useUiLang` (`uiStore.editorLang`), `textValues` (SDK 1.17: a text's own value per language), `LocalizedField` (SDK 1.17, host component → `components/ui/localized-field`), `updateDocument` (`documentsSlice.updateDocument`, which accepts `texts`: Document and texts in a single undo step), `newTextKey`, `textValue`, `fieldText` (`schema/fieldText.ts`), `projectLangs`, `selectDocumentItem` (SDK 1.2: selects a `board.items` part of the Document, or the Document with `item: null`), `notify` (sonner), `useOpenDocument` (SDK 1.16: a hook returning the function that opens a Document's page, `projectDestination` with the route's `serverId`), and `components` (SDK 1.1, `distribution/hostComponents.tsx`, passed to `installHost` by `main.tsx`): `ActionChainEditor` → `features/data/ActionFieldEditor` (chain in file format, literal text), `MaterialInput` → `features/canvas/MaterialField` (also used by the `material` argument of actions), `ItemInput` (SDK 1.3) → `features/canvas/item/ItemSpecField`: the menu item form (`ItemEditor`) on a literal item spec (vanilla or custom `material`, or captured `item:<id>`, `title`, `lore` as lines, advanced fields) and, with `onMatchChange`, the comparison criteria (`domain/itemMatch.ts`, those of the plugin's `ItemComparison`) checked by default according to the item (`defaultItemMatch`, mirror of `defaultComparisons`); unchecking writes an explicit `match` list. The block (`MatchCriteria`) has two modes, "Exact copy" (`[exact]`, which covers everything) and "By criteria": these list what the item carries with the compared value (`itemMatchFacts`), the identity (`custom_item` for a custom item, otherwise `material`) locked once checked; criteria with no value to compare (no name, no lore…) are folded under "More criteria", open when one is checked. `match` format unchanged. `MiniMessageInput` (SDK 1.4) → `components/MiniMessageField`: the common MiniMessage field (`RevealField`: rendering, then source + live rendering below), also used by the `minimessage` arguments of actions and the literal text of a module chain. `SortableList` (SDK 1.10) → `components/ui/sortable-list`: the design system's handle-reordered list. `ConditionsEditor` (SDK 1.11) → `features/inspector/properties/ConditionsField`: `ConditionListEditor` (the one of `if` branches and Triggers) on an `if:` list in file format; only the entries `isDecodableCondition` (`lib/actions/structuredSteps.ts`) accepts whole are decoded, the others (a module's condition, a `{type: …}` form, a malformed group) are written back as they were after the edited conditions, and a line says so (`conditions.keptUnknown`). `DocumentRefInput` (SDK 1.11) → `features/inspector/properties/DocumentRefField`: the picker of the actions' `document_ref` argument (`ActionEditor` uses it too), a titled dropdown for `menu`, a `<select>` for any other kind, Documents of the server's other projects qualified `<namespace>:<id>`. `McText`, `McScreen` and `McScreenControls` (SDK 1.14) → `components/mc-preview/`. `OverlayComposer` (SDK 1.16) → `features/canvas/overlay/OverlayComposer`: a HUD layout on an `McScreen` (the SDK's `overlayPlan` places each draw, `overlayLayerBox` each hit area; the zone the pack cannot reach, above y = -128, hatched), a drag kept local and written once on release (client px over the screen's CSS zoom times the GUI scale), `clampY` keeping every row and the cursor of a layer within -128..166, `writeEntry` replacing only the layer's own keys; the hit areas stacked in drawing order, the selected one above them all. `OverlaySlotsComposer` (SDK 1.16) → `features/canvas/overlay/OverlaySlotsComposer`: the same `Stage` with only the `image_slot` layers `editable`, a drag that changes the module's offset (`{image, x, y}`, clamped to ±128 and the pack's reach) instead of the layout. `AssetInput` (SDK 1.16) → `features/assets/AssetInput`: thumbnail, name, size and the `AssetPicker`. Host functions (SDK 1.14): `useAssetImage` (asset store + `useAuthenticatedImageUrl`, by name or id in that Project; an image without a descriptor, a module's `assets/textures/<name>.png`, is listed at 0 × 0 and gets the size read from the image once loaded, `features/assets/measuredSize.ts`, as in `OverlayComposer` and `AssetInput`), `mcTextWidth` (`mcLineWidth`) and `mcWrap` (`wrapLore`), both `lib/loreWrap.ts`.
- **Subcommands of a command** — `CommandNode` (`domain/types.ts`) carries what a command and each of its subcommands have in common (name, aliases, permission, `LText` description, `enabled`, arguments, steps, `subcommands`, `wire`); `Command` extends it with its id. A node is addressed by its indexes from the root (`CommandNodePath`, `[]` = the root; `domain/commandNodes.ts`: `commandNodeAt`, `walkCommandNodes`). Each `commandsSlice` reducer takes an optional `sub?`, as does the chain address (`{kind: "command", commandId, sub}`) and the placeholder catalog (the node's arguments). A node's texts live under `commands.<id>.subcommands.<i>…`: by index, so two siblings with the same name never share a key; the readable path of the Translations tab keeps the typed words (`commands.ah sell.description`). `visitCommandLTexts` and `commandChainSlots` walk the whole tree, so rekey, GC, board links (`commandStepLists`) and menu rename do too. `CommandEditor`: a Subcommands panel (`SubcommandTree`, one row per fully typed node, `enabled` switch, add under the chosen node, delete with its texts) chooses the node that Settings, Arguments and Steps edit (the whole row is the click target; its switch and remove button keep their click); the id is only settable on the root.
- **Commands on the board** — `CommandGroup` draws a command and, below it, one row per subcommand (`walkCommandNodes`, indented by depth, struck through and faded when it or a parent is disabled; height `commandBox`, `COMMAND_ROWS`). A Document opened by a subcommand, and not by the root itself, starts from that subcommand's row (`commandRowRefs` → `subCommandAnchors`, default `from` anchor of `Edges`; a hand-placed anchor still takes priority). A module command is a `command/v1` Document of its folder like any other (system template `player_commands`, generated by the plugin): "modified" / "new version" asterisks and Reset of system elements, nothing specific to commands. A click on a subcommand row selects the command with the inspector on that subcommand: the node `CommandEditor` edits lives in `useCommandNodeStore` (`state/commandNodeStore.ts`, ephemeral), which the row sets before the selection opens the inspector; opening another command resets it to its root. Hovering a link the command draws outlines in green the rows whose steps open its target (`rowsOpening`, read from `useEdgeHoverStore`).
- **Kind label** — `contributionLabel` (`lib/moduleDocumentKinds.ts`): `labels[interface language]`, otherwise `label` read as a host i18n key or literal; used by the tree, the palette and `NewDocumentDialog`.
- **Late-arriving kind** — `adoptLateDocuments` (`schema/projectFromFiles.ts`, store action `adoptLateDocuments`) reads the `<dir>/<id>.yaml` files left in `moduleData[<dir>].__files` when a kind is registered after the Project was read; `__root.tsx` calls it on every open Project when `modulesStore` goes to `ready`, and `useProjectLoader` when a Project is installed (the kind may have arrived during its construction, after its files were read: typical case of a Project reopened from cache).
- **Building** — `@artisan/editor-sdk/bundle` (`artisanModuleBundle`) gives the Vite config of a bundle. A module outside the repo takes the SDK via `npm pack` of `packages/editor-sdk`; example: the quests view, in the MSQuests repo (`editor/`), not in the editor.

### Project URLs and identity (2026-09-14)

`projectUrlId` chooses exactly `externalId ?? diskId ?? id`;
`projectDestination` composes server, hosted and demo routes without a global
lookup. Document, search, add-on, import and copy links use it.
The loader passes Network + server to identity resolution, then uses
only the internal ID for content and drafts. The cache includes
the user, the Network, the server and the URL reference.
`ResolvedProjectContext` gives this anchor to the document view; the latter
never looks up a public name among the loaded projects. After resolution, an
old URL is replaced by the current ID, keeping document, query and hash.
The demo resolves `/demo/projects/demo` through its session and passes its anchor to the
same workspace. A rename changes the URL but keeps the buffers and their CAS base.
`onProjectRenamed` also updates the name in the account and the cached
identity when it matched the old folder ID. The labels of the
sidebar and the properties thus follow the rename; a distinct custom name
is kept and re-reading finds the same name in the database.
The ID field of `ProjectProperties` also shows `projectUrlId(project)`,
not the immutable internal anchor.

### Reconnecting a Project (since 2026-09-08)

`useProjectLoader` retries the read 15 seconds after each
`server_offline` / `network_error` response, without concurrent requests or repeated
rebuilding of the offline display. A successful read (including `unchanged`)
clears `offline` and `stale`; late responses and timers are ignored when
leaving the Project. A modified draft keeps its compare-and-swap base.
From 2026-09-13 to 2026-10-28, a first open waited for a successful server read,
even with a cache or local draft (see below). A disconnection preserves the already open buffer;
backend transport failures and `fetch_timeout` are also retried.
Since 2026-10-02, no more banner: the topbar's server badge carries the offline
state and its tooltip (`downHint` of `LinkedServersDropdown`) gives the exact
reason (date of the copy, draft, never published). The state stays local to the
topbar of the open Project.

Since 2026-10-16, the loader state is a pure reducer (`projectLoadState.ts`,
named events `started` / `located` / `opened` / `settled` / `connectionLost` /
`readFailed` / `loadFailed` / `validated`, tested without React); the read itself
(`readFromHub` → `readAndOpen`, `resumeDraft`, `settleOffline`) lives outside the hook.
`projectLoadStatus` says what the workspace shows (`loading | ready | error`).

### Opening from the known version (2026-10-28)

The 2026-09-13 rule (a first open waits for the server) is lifted: it dated from a
cache keyed without the player, shared by guest demos. The key now carries the
signed-in player and a sign-out empties it, so the known version shows nothing this
browser does not already hold. Measured: a switch cost five round trips in a row
(identity, files, drafts, models, actions), about 420 ms each through the tunnel.

- **Immediate display** (`showKnownVersion`, event `shownKnown`): with a cache entry,
  the Project shows on the first render, `stale`. It is the in-memory Project when
  it was built from the same fingerprint (`builtFrom`, edits included), else it is
  rebuilt from the cache (models and actions included, no network). A first visit of
  the session takes the cache's tree as its base until the server answers, so an
  edit made meanwhile reaches the draft. Deploy waits while `stale` (`checking` on
  `SaveControls`, tooltip `deploy.checking`); a refusal (`readFailed`) closes the
  version shown.
- **One round trip**: the files (`if_hash`), the drafts and the server's
  declarations are asked for together with the identity, on the cached identity's
  guess (`startReads`); a guess the hub contradicts is dropped and re-asked. An
  `unchanged` answer whose draft and declarations did not move rebuilds nothing.
- **Never-opened Projects**: the server index (`loadServerProjects`, already run in
  the background) keeps each raw read; `useKnownVersionsFromIndex` turns them into
  cache entries (`seedProjectCache`, one hub identity request per new Project, the
  open Project left to its loader). A reload announced by the plugin re-reads the
  index. The persisted cache drops its oldest entries when `localStorage` is full
  instead of failing the open.

### Advanced item settings (since 2026-07-29)

Under the lore of each state card, `features/canvas/item/AdvancedItemSection.tsx` folds behind a `<Collapsible>` everything beyond material/title/lore: **enchantments** (id + level, `datalist` on the vanilla catalog of `domain/itemAdvanced.ts` but **free input accepted** for modded), glint effect without enchant, custom model data, unbreakable, hidden tooltip sections, **color** (shown only if the material is dyeable — leather / potion / firework star), and **raw NBT**. A badge on the trigger counts the values set (`countAdvanced`) so a configured item does not hide its own configuration. Mutations go through the single store action `setAppearanceAdvanced` (partial patch; a key set to `undefined` clears the field).

The wire format of these fields and the conventions shared with the plugin are in `schemas-codegen.md` § "Advanced item details".

The `item` model fields use `ItemValueField`, an adapter of the `ItemEditor` component shared with the canvas properties. `ItemBindingEditor` chooses the source; text and quantity expose inheritance and reset. Inheritance notes appear only if the base provides a value for the field; if the base carries lore, a "Replace the base item lore" checkbox and the "Insert source lore" button (which writes `{base.lore}`) appear. `resolveItem` recursively resolves `extends` (ref or object), then applies the overrides with a `base` snapshot (title/lore/count/material). **The base lore is kept by default**: the explicit lore is appended below it, whatever the form of the source. It is discarded only on `lore_mode: replace` (the checkbox) or when `{base.lore}` appears in the text — the placeholder then positions it itself, without duplicates. An empty explicit lore therefore no longer erases anything without the checkbox. The plugin follows the same composition; circular references are bounded. Material fields preserve the case of refs and expressions.

The optional SDK hook `FrontendModule.migrateProject(project)` runs after template injection, in the project loader and the temporary copies of the config screens. Boutique moves the historical lore into `icon` and removes the field from the effective model, even without loaded menus. Linked templates replace `{alias.lore}` with `{base.lore}` — the placeholder is enough to position the lore, with no explicit replacement. After a catalog-only save, the TS/Kotlin resolvers still recognize this old placeholder when the row no longer has lore and its extended icon carries some: they insert the full lore once at this position. Live screens write item texts in the default language of their copy, because their save carries only the table's files.

`ItemEditor` keeps a compact card (resolved texture/head, title, count, three lore lines, enchantments) and opens its fields in the design system's shared `Dialog`. The body scrolls; "Done", the cross or Escape close the modal and return focus to the card, with no separate save. The catalog/menu adapters also share `HeadField`. Menu-specific actions go through the `details` slot, visible only while editing. A declared screen loads its module before building the form, to run its migrations even if the global presence loading has not finished.

The placeholders in scope (the same contextualized entries as the `ItemEditor` autocomplete, with the `base.*` fields) are browsed in the toolbar's Library (`PlaceholderLibrary`); the former `ItemContextSidebar` panel is removed (2026-10-28).

The text fields of actions (command, context passed to `open_menu`, value of `set_arg`, messages, titles) use the same `PlaceholderInput` and the same catalog (`lib/placeholderCatalog`) as the lore: "Type {" hint, autocompletion, no insertion bar. An element click passes its `FieldLocation` `action`; the steps of a command receive it through `ActionScopeProvider` (`{ kind: "command" }` → arguments + `{player}`); elsewhere, only `{player}` is offered. The catalog exposes the alias of an element in `iterates` **or** `places`, including on a server source (reported schema) or a direct `ns:id` ref. Only `ItemEditor` adds `base.*`, which exists only when rendering an item. The catalog offers only what the plugin provides: no `{slot}`, no `{material}`, no `{pagination.*}` (the canvas preview still binds `pagination`, not the runtime). It does, however, offer everywhere (menu, element, action, dialog) the navigation placeholders `{has_previous_menu}` (boolean, to condition a back button) and `{previous_menu}`, `{previous_menu.id}`, `{previous_menu.title}` — fed at render time by the player's navigation history.

The `ItemEditor` modal always takes `100dvh - 2rem`; its flexible body fills the remaining height between the title and the footer, while keeping independent scrolls.

On desktop, the form and the preview column scroll independently in a bounded grid; the form keeps a stable scrollbar gutter (`scrollbar-gutter: stable` + right padding) so its scrollbar never covers the fields.
The `ItemBindingEditor` block shows a compact Icon field (thumbnail + label). Bindings display their exact path (for example `item.icon`), without translation or interpretation of module-specific terms. Its picker groups Catalog (`Appearance.item` bindings) and Library (fixed items). `itemBindingOptions` follows the input models and the iteration/placement aliases; only `item` leaves are offered. Modules declare `dataSourceModels` to type their sources even without a server schema. Quantity and enchantments show the catalog values and a reset after customization; the expression stays in an advanced pane.
Before `FrontendModule.localPreviewRows`, the host resolves the `LText`s of the `dataSources` in the preview language and with the translations of the owning project. Boutique can thus assemble the lore without turning references into `[object Object]`; its rows include the formatted `price_display` and the nested items of the categories.

**Additive lore by default** (revision 2026-09-17, additive since 2026-08-06). The appearance's lines are appended under those of the item — `extends` included, which used to force replacement — and its explicit title replaces the base's (`MenuRendererCapturedLoreTest`, `MenuRendererItemValueTest`). Replacing requires `lore_mode: replace`; `{base.lore}` remains available to choose the position. `normalizeBaseLore` (called at the end of `projectFromFiles`) removes the LEADING `{base.lore}` written back when the base lore had to be claimed — in all languages of a site, and in the item values of rows, where a line is an LText node addressed by its position. A token elsewhere than at the head, or present in only one language, stays intact. An absent field always keeps the inherited value.

**Extracting a captured item.** Remains the escape hatch when you want to *edit* what the item carries. The "Extract the details" button (visible only on these refs) parses the `stackYaml` via `domain/capturedStack.ts` and **explodes the ref into real fields** — material, count, title, lore and the whole advanced block. The operation asks for confirmation because it is destructive in the sense of the link: the slot no longer follows the captured item if it is recaptured. This is the accepted trade-off: the ref is live but opaque, the fields are dead but editable.

**Glint.** `SlotItem` draws a purple halo + a `✦` star at the top left (the stack counter occupies the bottom right) when the appearance carries enchants or the flag, **or** when the captured ref carries some (`resolveDisplayRef` queries the serialized stack, not only the `.artisan/editor.yaml` descriptor — old captures and items written by a module have no descriptor). It is **not** a replica of the vanilla shader: tinting only the opaque pixels of the sprite would require a hidden Konva filter per slot, which a 54-slot menu cannot afford. The marker is unambiguous at this size, which is what the canvas needs. `ItemTooltip` additionally lists the enchantments between the name and the lore, with vanilla spelling (`Sharpness V`, no numeral for single-level enchants).

## Canvas component layout (refactor 2026-06-02)

`features/canvas/MenuGroup.tsx` (1066 → 591 lines) split: `SlotItem.tsx`, `PaginationControls.tsx`, `menuFanout.ts` (pure positional fanout, tested), `useMenuClick.ts` (armed-material tap-to-place), `useMenuDrag.ts` (cross-project via project-mini DOM walk), `useSlotDrag.ts` (selection drag + Alt).

`features/canvas/Stage.tsx` (528 → 351 lines) split: `ArmedBanner.tsx`, `useStageTouch.ts` (long-press → context menu), `useStageContextMenu.ts`.

Since 2026-10-16 (Stage had grown back to 791 lines): `useStageBoard` (board / focus `layout` table + group drag), `useStageFraming` (restored, persisted viewport, focus framing `refitFocus`, `centerRequest`; `useElementSize`), `useHeldPanKeys` (Space / Alt), `useStageDropTargets` (the three single-tenant registries + paste anchor), `StageContextMenu` (context menu wired to the canvas commands). What only the board owns lives in `BoardChrome.tsx`: `BoardChrome` (empty state, group controls, minimap), `BoardGroupsLayer`, `useBoardCreation` + `BoardCreationDialogs` (create "here"). Focus mounts none of it; `Stage` keeps only the common core (~400 lines).

Since 2026-10-16 (MenuGroup had grown back to 855 lines, a 772-line component): `menuSlots.ts` (pure, tested: `resolveMenuSlots` — content of each slot, paginated iteration, placements, fanout — `paginationContext`, `edgeTriggerPositions`), `useSlotPointer.ts` (click / tap on a slot: drop of the armed placement row or armed material, otherwise selection), `useMenuPreviewSnapshots.ts` (live snapshots of the menu's sources), `MenuBackground.tsx` (vanilla texture / transparent window), `SlotDragGhosts.tsx`. `MenuGroup`: 397 lines.

Note: target ≤250 for Stage not reached (399) — the common board / focus core stays there.

### Right-click and multi-selection (since 2026-10-05)

Konva emits `click` for **all** buttons: `usePrimaryButtonOnly` (wired on the `Stage` wrapper)
swallows non-primary `pointer/mouse down/up` in capture, otherwise right-click reduced the
selection before `contextmenu`. Ctrl/⌘/Shift+click on an item → `selectionStore.toggleElement(id,
menuId)`: selection of items of **a single** menu, never the menu itself (starts over if another menu).
`useStageContextMenu` keeps the selection (`entity` target) when the targeted slot carries a selected item
or a menu of a node selection. `deleteSelection` (`useCanvasKeyboard.ts`, context menu + Del)
deletes items and nodes, sparing the menu that contains the selected items.

**New** (since 2026-10-29): a right-click on the board background carries the clicked point in
world coordinates — the `empty` target, or the `entity` target's `world` when a selection stays
targeted (background hit, no Group ancestor). `ContextMenu` then shows a **New** submenu listing
`useBoardCreatableKinds(project)` (`BoardChrome.tsx`): the core kinds, then every module kind
with `kindCreatableIn`, collection kinds left out (no board node). The pick goes through
`useBoardCreation().createAt(kind, world)`: the core kinds open their own dialog, any other kind
`NewDocumentDialog`, all with the board `position`. Absent in focus view (no board).

### Pasting items into a slot (since 2026-10-04)

`pasteFromClipboard(projectId, onError, anchor?)` (`useCanvasKeyboard.ts`) accepts a `PasteAnchor`
`{ menuId, position }`. Ctrl/⌘+V computes it via `Stage.getPasteAnchor` (last cursor position
on the wrapper → `screenToWorld` → `hitTestSlot`); right-click on a slot offers "Paste here"
with the targeted slot. With an anchor: the targeted menu is the anchor's (taking priority over the selection), and the
copied group is shifted linearly so its smallest position lands on the anchor (relative layout
kept). Slot taken → first free group after it (`findFreePositions`); element that
would fall outside the grid → its copied positions. Without an anchor (cursor outside a slot): historical
behavior (`resolveTargetMenu` + original positions). Duplicate (⌘D) uses no anchor.

## Inventory types (Chest / Hopper / Dropper, since 2026-06-14)

A menu is a chest (default), a hopper (5×1) or a dropper (3×3). The **single source of truth** is the `INVENTORY_TYPES` table in `features/canvas/inventoryTypes.ts`: per type it carries `cols`, the fixed `rows` (`null` for chest = `menu.rows`), the origin of slot 0 in MC px (`firstSlotX/Y`), the box height (`null` = computed from the rows for chest), the texture key and the Bukkit type. Helpers: `colsFor`, `rowsFor`, `slotCount`, `slotMcXY` (constant stride `MC_SLOT_STRIDE = 18`).

**Title composer width-agnostic**: the three vanilla container GUIs are **176 MC px wide** with the title at `(8, 6)`. Only the **box height** and the **slot grid** vary by type — no width parameterization is needed in the title composer.

**Backgrounds (`MenuGroup`)**: chest uses the two-slice texture `generic_54.png` (header + repeated row slice). Hopper and dropper use a **full box image** (`hopper.png` / `dispenser.png`). `MenuGroup` branches via `usesSingleBackground(type)`.

**Hit-test + drag parameterized by type**: `hitTest.ts` and `useSlotDrag.ts` read cols / origin / rows from the table — no more hardcoding of the chest's 9 columns.

**Player inventory (`player_inventory`, 2026-09-25)**: `Menu.playerInventory` (absent = `visible`, stored only if `hidden`). When `hidden`, positions `size..size+35` (protocol rawSlot) are editable on the 4 vanilla rows under the menu: `slotMcXY(i, type, rows)` places positions `≥ slotCount` on these cells (`playerInvY` per type, `null` = after the chest rows; +4 px before the hotbar), `positionCount` gives the addressable count (`MenuGroup`, keyboard, `MenuProperties`), `hitTestSlot` returns them. Selection moves go through a visual grid (`positionToCell` / `cellToPosition`: menu rows then 4 rows of 9) instead of `% cols`. Resizing the menu or changing type **shifts** the player positions (`shiftPlayerPositions` in `projectsStore`) so each button stays on the same player slot; the refusal to shrink now concerns only the menu's positions. Image buttons stay limited to the menu grid.

**Default texture (`vanilla_texture`, 2026-09-25)**: in composed title mode, `VanillaTextureLayer` is the first fixed row of `LayersPanel` (not movable, not deletable) with a `Switch` (`components/ui/switch.tsx`, specimen `/design`) — the layers' eye remains a preview hide, the `Switch` a saved setting that changes the game. Disabled (all container types), `MenuGroup` no longer draws the texture but `transparentOutline(type, rows)`: dotted frame (keeps a hit shape for the drag) and slot cells in light strokes, menu **and** 36 player slots, according to the type's geometry. Going back to a vanilla title reactivates the texture.

**Type switch = keep+warn**: `MenuProperties` exposes a type selector (Chest / Hopper / Dropper); the rows selector appears only for chest. Switching to a smaller container **keeps** out-of-range elements and shows a warning chip — never silent deletion (`setMenuField` keep+warn).

## Canvas edges (links between nodes)

Menu/command/dialog links are derived from actions (`deriveEdges.ts`, unchanged) then
routed by `edgeRouting.ts` (pure, tested): exit/entry side chosen by `autoSide` —
two nodes side by side (horizontal gap) are always linked by their left/right sides,
two nodes stacked in a column by top/bottom, dominant axis otherwise. The auto anchors of the
same side are **centered** and spread symmetrically every `ANCHOR_GAP_PX` (24 px,
tightened if the side is too short, 10 px corner margin), in the order of the position of the
opposite node to avoid crossings (since 2026-09-25; before, each anchor aimed at the
projection of the opposite node, which stuck it to the corners). Cubic bezier path with tangents perpendicular
to the edge (length ∝ distance, clamp 24–160 px). Rendering: `Edges.tsx` as a Konva `Arrow`
(arrowhead on the target side), hover → `EdgeTooltip`, click → selection + 2 handles
draggable along the edge (perimeter snap via `closestAnchorOnBox`).

Manual overrides: `project.canvasEdges[edgeId] = { from?, to? }` with
`EdgeAnchor = { side, t∈[0,1] }` (ratio → survives resize). Edge id = `"source->target"`.
Overrides are exact pins: never pushed away by the auto separation — two manual
anchors can overlap; only auto anchors yield the minimum gap
`ANCHOR_SEP_PX` (16 px) to a forced anchor that is too close. "Rearrange" frees them all
(`releaseBoardPositions` keeps the anchors internal to groups and frees those of the board; `rearrangeCanvasGroup` frees only the internal anchors of the targeted group).
Store actions: `setEdgeAnchor` / `clearEdgeAnchor` (double-click handle = reset);
pruning on `deleteFromProject`, rekey on id rename (`setMenuId`/`setCommandId`/`setDialogId`).
**Document key (`docKey`, since 2026-10-24).** An id is unique only within its kind
(`project-files.md`): the board, selection, edges, Properties and deep links
designate a Document by `<kind>/<id>` (`domain/documents.ts`: `docKey`, `parseDocKey`,
`findDocumentByKey`, `resolveDocKey` for a bare id coming from a URL or a module). Keys of
`canvasLayout`, `CanvasGroup.nodeIds`, `Edge.source`/`target` (the target takes the kind that the
reference names), edge ids `source->target`, Konva id of nodes, selected ids when
`selection.menuId === null`. A menu element stays selected by its bare id, bounded by the bare id
of its menu; a part (`board.items`) of a module Document is bounded by its
Document's key. The focus view takes `?kind=` next to the path id (no encoded `/` in the path).
Reading `editor.yaml` (and an imported project): a bare key goes to **every** Document of that
id (`parseEditorLayout`), a bare edge end to the first; writing keeps only
keys. Two kinds sharing an id (a speaker and its conversation, a menu and its command) is
normal and says nothing on load. A new Document keeps an id that is free in all kinds (`newDocumentId`).

Persistence: `edges` + `layout` in **`.artisan/editor.yaml`** (hash-excluded
editor state file — moving a card no longer redeploys the
server; ADR `files-first-source-of-truth` #3). Legacy: `editor_layout` /
`editor_edges` in `manifest.yaml`, still read as a fallback by
`projectImport.ts`. The plugin never uploads `.artisan/*`; the backend
preserves its copies at both ingestion points (`local_push`, `POST
/bundles`).

## Curated board + panel + individual view (since 2026-06-13)

See `docs/archive/specs/2026-06-13-workspace-board-curation-design.md` (supersedes the focus mode of `2026-06-02`). The canvas is no longer a free canvas that forces everything into a grid: it is a **curated board**, backed by a source-of-truth panel and a deep-linkable individual view. **Invariant no. 1**: a single renderer/editor per Document type, shared between board and individual view — this is what removes the divergence that caused the revert of focus mode. **Extended 2026-09-05 to *hosts***: a single renderer per Document type, and as many hosts as there are distinct semantics, not one more. The board and focus did share `MenuGroup`, but had two stage hosts for identical semantics — hence the re-divergence (see "Focus mode").

### `canvasLayout` = pinned positions (derived board, since 2026-09-25)

**Revises the curation of 2026-06-13** (spec `docs/specs/server-registry-and-derived-canvas.md`, decision 5). The board shows **all** the project's Documents, arranged automatically; `canvasLayout` no longer lists the members, it only keeps the hand-placed positions (a drag-and-drop writes a pinned position). The old `canvasLayout` entries therefore become pinned positions, kept as is.

Positions and modifications are kept by `useDraftSync` in a local
copy, then saved automatically through the resolved storage (see below). After a save that clears the draft,
the first modification keeps as reference the previous state if it matches
the saved base exactly: adding a language must thus
enable Save from the very first change. Normalization on load
stays excluded from user modifications. After rehydration, the bases are compared by
content, never by object identity: reloading must not reclassify a
modified draft as clean and have it dropped on the next open.
Pending local writes are flushed on `pagehide`, when the page goes
hidden and on hook unmount. Writing to the server stays explicit.

**Persisted drafts (2026-09-13)**: `persistedDrafts.ts` loads private
drafts after validation of the open, restores the selection and syncs the tree with
the expected revision. The local copy is isolated per account; an old draft
without a backend identifier becomes a distinct copy. An acknowledgement
never overwrites keystrokes made during the request. A revision
conflict keeps the local work and blocks writing until a copy is created. **Errors are classified by the hub's code, never by HTTP status alone**
(`errorStatus`, 2026-10-14): `draft_migration_pending` → `migration_pending`; `draft_conflict`,
`draft_exists`, `draft_closed`, `conflict`, `operation_*` → `conflict`; 5xx, 401, 408, 429 and
network error → `offline` (replayed every 15 s, pending mutation kept); any other
4xx (`forbidden`, `unknown_project`, `invalid_draft`…) → `rejected`: the mutation is cleared,
the same snapshot is **not** resent (fingerprint kept in `session.rejected`), a modification
(`markDraftPending`) or the Save button (`syncPersistedDraft(id, true)`) resends it. Only
`draft_not_found` means "draft gone" (`gone`); `draft_closed` during a save
reloads the list (`loadPersistedDrafts`) instead of staying in `conflict`. `PersistedDraftControls` (large modal, list on the left, diffs on the right) offers
named copies, selection and base/tree comparison via `ChangeList`, from the Deploy
chevron, with no permanent block in the topbar.

**Save / Deploy (2026-09-18)**: two actions in `SaveControls`.
Save (visible with a drafts session) flushes the debounce then forces
`syncPersistedDraft`. Icon button (filled floppy disk `SaveFilledIcon`, `Spinner` during
saving): `Tooltip` according to the session status (`drafts.tooltip.*`), short label as
`aria-label`. Inactive via `aria-disabled` when `saved` or in progress, never `disabled`:
a `disabled` button does not receive hover and would not show its bubble. Deploy keeps
its label, preceded by a filled play icon. Draft autosave stays active. Deploy opens
`DeployReviewDialog`: server base against the live Project's `projectTree`,
renames and binaries included. Only confirmation calls `saveProjectToDisk`.
`projectTree` gives a YAML file whose value the editor left as the base holds it
(`keepEquivalentText`, `lib/yamlEquivalence.ts`: style, quotes, key order, comments and CRLF
do not count) the base's bytes: a hand-written or module-shipped file is neither listed nor
rewritten until it is really edited. An edited one is the base's text with only the changed
values rewritten (`patchYamlText`, `lib/yamlPatch.ts`, on the `yaml` CST: flow maps, quotes,
comments and key order stay; a new key takes its parent's style; a patch that does not read back
as the edited value falls back to the canonical form), in the base's line endings. The
other drafts listed in the review (`otherDrafts.ts`) go through the same rule: a snapshot
autosaved before it held every file reformatted.
Mutations carry an `operationId` and a snapshot frozen in the local rescue copy
isolated per owner: after a lost ACK, replay this operation before sending
the next keystrokes. A definitive 4xx rejection releases this operation; an uncertain
failure keeps it. The `binaryBaseline`/`binaryTree` references travel with
the text edits. `migration_pending` suspends saving without clearing the rescue copy.
When a Deploy click retrieves the result of an earlier publication after a
timeout, `saveProjectToDisk` advances the base to that result then publishes the remaining
draft if the requested version differs. The old receipt is not enough to announce
the success of the new modifications. A failure of this second publication
stays visible; modifications made during the upload stay in draft.
Generic ZIPs and trees exclude private drafts, transactions and rename
marker; `.artisan/editor.yaml` stays shared. Text import refuses
binaries, pending the full portable flow.

Save failures open a `Dialog` with a translated reason, the original code
and HTTP status when available, as well as the `message` field provided by the plugin.
`DraftApiError.detail` keeps this message without replacing the error code.
`saveProjectToDisk` keeps these draft publication diagnostics;
`writeProjectFiles` keeps them for direct writing.
`SaveControls` also intercepts preparation exceptions. The detail can be copied
and viewed in the chevron until the next success or the control's unmount.
The red dot stays reserved for the draft's `offline` / `conflict` states.
A stale draft listing does not replace a revision confirmed by an
autosave during its read. A blocked draft is re-read before syncing:
if its active remote snapshot is strictly identical to the local one, its revision is
reconciled without a write. A content difference or an edit during the read
maintains the conflict and preserves the local work.
A dot on the chevron signals only a conflict or an unconfirmed save.
**Conflicts on open (2026-09-26, cloud — the hub does not rebase)**: the backend returned the draft rebased onto the
Snapshot and its `conflicts`; `loadPersistedDrafts`/`selectPersistedDraft` put them
in `session.openConflicts`, and `ProjectTopBarControls` opens the same modal as for
a save conflict (`conflictSource: "open"`). Applying updates the draft's base
and marks it to be saved, **without publishing**; `consumeOpenConflicts` avoids
re-proposing the same conflicts.
**Draft resumed on a disk that moved (2026-10-22)**: since the hub no longer rebases, a
resumed draft showed (and republished) the disk state at its creation: a file
that a module removes at startup stayed in the editor. `useProjectLoader` passes the
draft through `followDisk` (`draftRebase.ts`) on each disk read: a file
that the disk changed, added or removed, and that the draft left as opened
(compared to `initialTree`, not to the bytes of the base that opening reformats), takes
the disk's version, base included. A file modified in the draft stays its own;
publishing will flag it. A file that the draft deleted (in its base, absent from
its tree) stays deleted, even when resumed in a later session where `initialTree` no
longer has it: otherwise a moved Document came back to its old path when the disk
rewrote it (`.yml` rename), and the same duplicate id hid both copies. A draft that holds a file under its
two spellings (`.yaml` and `.yml`, left by an earlier resume) is folded onto
the disk's (`spelledAsDisk`), with the text the draft modified: the two
formed a `duplicate_id` that each save kept.
**Conflict between two sessions (2026-09-29)**: a write refused with `409
draft_conflict` (the other session advanced the revision) no longer chains silent
re-reads. `persistedDrafts` rebases the local tree onto the remote snapshot
(`rebaseDraft`, module shared with the backend): files that the other session alone
touched are taken silently, diverging files become
`session.draftConflict`, and `ProjectTopBarControls` opens the conflict modal
(`conflictSource: "draft"`, "Take the other session's" button). No
write is attempted until the conflict is settled; `resolveDraftConflict`
applies the choices, advances the local revision and resyncs (without rewriting if everything
comes from the other session). Same detection on load when the listed revision differs
from the local one; a rebase with no diverging file is applied outright, without a modal.
The merge is three-way from the last acknowledged revision (`remote.base`, tree
memorized at each acknowledgement), not from the disk: a file already modified in the
shared draft is not a conflict. It **never** touches `baseline`, which stays the
published disk — putting the other session's unpublished work there would make it omitted at
publication and undone by the backend rebase against the Snapshot (fix 2026-10-02).
**Tabs (2026-09-29)**: a successful write is broadcast via `BroadcastChannel`
(`draftBroadcast`). Another tab of the same browser with no local work reloads
its draft and the Project tree by itself; a tab with modifications sees the
conflict presented immediately. Cross-device remains covered by the `409`.
**Server-only (2026-09-27, ADR `server-only-projects`)**: no more "hosted
projects" section, copy to Minecraft or ZIP import; the demo no longer has a claim,
its **Export** button (`runExportDraftZip`) downloads the current draft (editor
text, published or private images). `useProjectLoader` exposes `unpublished`;
the server badge's tooltip announces it when the server is not connected.
**Server off (2026-09-26, cloud — the hub never returns `offlineSince`)**: `readProjectFiles` returns `offlineSince`; `useProjectLoader` then opens the Project as `offline` + `stale`, exposes `offlineSince` and rechecks every 15 s; the server badge's tooltip shows the date of the copy. Since 2026-10-02, no more `ProjectStaleNotice` banner — the state is carried by the server badge and its tooltip (`downHint`).
**Versions (2026-09-26, tab since 2026-10-04; the hub returns an empty list)**: the workspace's `?tab=history` view
(`ProjectHistory`, 6th entry of the nav, hidden without `runtime.serverId` so in the demo) lists
the Versions — "Deployment" badge (author) or "Server edit" (author `null`). "See
changes" opens `VersionDiffDialog`: `ChangeList` of the Version against `previousId`
(binaries included). Restore (`restoreVersionIntoDraft`) replaces the editor's text tree
with the Version's (`adoptDiskIntoProject`), so the draft, **without publishing**; the
draft's images stay as they are. `FileHistory` shows the author
when the history comes from Versions.
Actions first flush the local debounce via `draftFlush`.
`saveProjectToDisk` publishes the saved revision via the drafts API;
creation/import without a session keeps the existing path. A modification during
publication remains new work based on the published files.
The MCP transport remains future; it will reuse the same operations and checks.

- `projectBoard(project)` (`features/canvas/autoLayout.ts`) returns the positions (`layout` / `allLayout`), frames (`groups`), representative identifiers of the Documents and gutter. `groupedBoard.ts` first arranges each folder frame, then the Project's frame with the Documents outside any folder; `serverBoard` then arranges the Project frames. `arrangeBoard` remains the dagre `LR` engine of each level, with exclusion of back-edges from the layer computation, alignment of commands and preservation of pinned positions. External entries guide the choice of a group's root. Memoization by graph shape, groups, name and positions: editing a slot without changing the links recomputes nothing.
- `groupedBoard` builds a Project root frame, which `Stage` hides in the Project's own view; only the folder frames remain visible. **A frame = a top-level thematic folder** (`domain/canvasGroups.ts` → `folderGroups`) that contains at least one Document, at any depth; there is no manual group anymore. Selecting one or more Documents → **File in a folder**: name (slug, existing folders suggested) and color; the folder is created if needed then the Documents are moved there (`moveToFolder`, their pinned positions are released to be rearranged within the frame). `BoardGroupControls` handles creation; `BoardGroupFrames` shares the rendering between boards. The whole background of a frame captures the mouse (except in hand mode, `interactive`): a click selects the folder (`useSelectionStore.selectFolder`, exclusive with `ids`, `folder` context of `selectionContext`) and the Properties panel shows `FolderProperties` (name applied on leaving the field, color, show only, rearrange, remove); a drag translates the frame and its members in a single undoable operation (`moveCanvasGroup`). A rectangular selection therefore no longer starts inside a frame. Renaming a folder renames the frame, removing it moves its content up one level. A Document dropped on another folder's frame is filed there (`commitNodeDrag`: pointer in `folderAt`, then `moveToFolder`); dropped elsewhere, it keeps its position and its folder. Nothing is filed from the focus view (no `groups` layer) nor for a system element. Color and position live in `Project.folders` (`FolderMeta`), serialized as `folders:` in `.artisan/editor.yaml`; the old `groups` key is ignored.
- **Show only this folder** (··· menu of a folder in the tree, or **Folders → name** on the board): `useUiStore.boardFolders[projectId]`, ephemeral. `boardForFolder` (`features/canvas/folderFilter.ts`) keeps in `layout` only the Documents of the folder and its subfolders, at the positions of the whole board; a top-level folder keeps its frame, a subfolder has none. `useFolderFraming` frames the view once per chosen folder; the **Folder: … · Show everything** chip removes the filter. A double-click on the background of a folder frame applies it to that folder (`BoardGroupFrames`); Escape with no selection removes it (`onIdleEscape` of `useCanvasKeyboard`, the selection, folder included, clears first). In the sidebar tree, a folder's icon takes the color of the frame of its top-level folder, none for an empty folder (no frame). A filter whose folder has disappeared is ignored.
- **Folder tree** (`features/project/ProjectDocumentTree.tsx`): recursive `FolderNode` (open by default) before the root categories; ··· menu of a folder: new subfolder (up to 3 levels), rename, delete (content moves up to the parent); **+ → New folder** at the root; ··· menu of a Document: **Move to** (root or any other folder). Dragging a Document row onto a folder files it there (the collapsed folder opens on hover), dropping it outside any folder puts it back at the root (`documentDrag.tsx`: dnd-kit `DndContext` specific to the tree, innermost zone under the pointer, ghost row in `DragOverlay`, `withDropPreview` already shows the Document in the target folder at its sorted place, `useGlidingRows` animates the shift of rows; the order stays type then label, only the folder changes): same `moveToFolder`, so the Document joins the frame of its new folder and the frame adjusts to its members; a system element cannot be dragged. `FolderNameDialog` dialog. Store actions in `state/projects/foldersSlice.ts` (`createFolder`, `moveToFolder`, `renameFolder`, `deleteFolder`, `setFolderColor`); each file move goes through `recordRename`, so publication moves the files instead of deleting and recreating. `FolderOperationError` errors: `invalid_name`, `too_deep`, `exists`. An empty folder exists only in `Project.folders`.
- Frames always stay open, including the old `project_collapsed` state, ignored and not re-exported. The optional `color` accepts only `#RRGGBB`; blue by default for a folder with no color. The background, banner included, is rendered at 15% opacity, the border at 65%, the title stays opaque; the background does not capture interactions. Creation and editing stay in the Project.
- Node sizes: **only** `menuBoxSize` / `COMMAND_BOX` / `DIALOG_BOX` (`menuLayout.ts`), the same as the rendering. Coordinates = top-left corners (dagre returns centers, converted).
- Fixed-size nodes (command, dialog, module Document) do not widen for their title: title and subtitle are cut with an ellipsis (`wrap="none"`, `ellipsis`), and the full title is shown in a native tooltip on hover (`showFullTitle`, `features/canvas/nodeTitle.ts`).
- `releaseBoardPositions({projectId})` action: rearranges only the outer level, each group being a block sized by its content and linked by its incoming/outgoing links. `rearrangeProjectLayout` captures the visible positions before computing to keep the internal relative positions exactly, even if not manually pinned. Without groups, keeps the historical reset behavior. **Rearrange** button of `CanvasToolbar`; undoable with Ctrl+Z (zundo).
- `rearrangeCanvasGroup({projectId, groupId})` action, reachable via **Folders → name → Rearrange contents**: releases only the members' positions, keeps the frame origin and all outside positions, adapts the frame size. Both actions save their result in the existing `canvasLayout` / `folders.<folder>.position` metadata, without changing the Documents; no migration. `deleteFromProject({projectId, nodeIds})` removes the Document from the project and its pinned position.
- Full recomputation on each graph change, with no local insertion or cache: the stability of the arrangement between two edits remains an open question of the spec.
- **A server's projects** — `useServerProjects` (`features/project/useServerProjects.tsx`, used by the Play mode): one `useProjectLoader` per project, draft included, then `useTextureInit` on the last opened project when it is one of them, else the first, for the item icons; what a server's views last saw — listing and loaded projects — is kept for the session per user and server, so coming back shows it at once while the listing and the loaders revalidate behind. Cross-project graph `deriveServerGraph(projects)` (`features/canvas/serverGraph.ts`, used by the server checks and the project layout) with lexical resolution of references (`domain/docRef.ts` → `resolveDocRef`, mirror of `DocumentTable` on the plugin side, locked by `testdata/doc-ref-conformance.json`): bare id looked up first in the source Document's project, then on the server if unique; `project:id` targets that project; a bare id absent from the project and carried by several others = ambiguous link. The server page no longer has a read-only general board (Board tab, removed: too slow with every project drawn at once).

### `Project.moduleData` — opaque per-module state

`Project.moduleData?: Record<string, unknown>` carries the state of a third-party module, keyed by module id (e.g. `"boutique"`) — the host never interprets it. Files-first round-trip: `projectFromFiles` seeds `moduleData[<dir>] = { __files: Record<relPath, content> }` for an unrecognized project folder; the editor module normalizes `__files` to its structured form on first read, and derives its `exportFiles()` from `moduleData`; `transform()` re-emits the `__files` verbatim of namespaces without a registered module. Store action: `setModuleData(projectId, moduleId, data)` (Immer `produce`, replaces the whole namespace, preserves the others).

Historical example (before disk-only storage; boutique module, V1.5 — `docs/architecture/modules.md` §15): the Boutique Add-on plugin (current ID boutique_addon; physical editor folder unchanged) bootstraps `plugins/Boutique/editor/boutique/shop.yaml` on disk; a `local_push` on this stub project seeds `moduleData.boutique.__files["shop.yaml"]` (the module folder prefix is removed from the `__files` keys). `@artisan/boutique-editor` (presence-gated `/m/boutique`) reads this state, normalizes it into a structured catalog (categories/items) on first access, exposes an editing form (no generic `<SchemaForm>`, §8), and its `exportFiles()` function regenerates `boutique/shop.yaml` from `moduleData.boutique` on each deploy — full round-trip without the `Project` host needing to know the shape of the catalog.

### Resizable Buttons panel

The Buttons panel uses `SplitPane` with `secondaryPosition="start"` on the left
(resizable right edge), or at the bottom on mobile/central space <600 px.
The `projectLibraryStore` store persists width/height under
`artisan-library-size`, as well as the open project (null if closed) and the category.
The canvas stays mounted during opening, closing, resizing and orientation changes.
The Buttons button is a rounded floating tool at the top right of the canvas, rendered by `ProjectLibraryWorkspace` in the split's main panel only if the panel is closed. Button and panel are visible only on the board and the individual menu views, never in command or dialog views nor secondary tabs. The open state is kept when returning to the canvas. The cross closes the panel and makes the tool reappear; no Buttons button in the topbar.
The header groups tabs and close without an extra title row; the catalog filters stay on a horizontally scrolling line, to preserve grid height.

### Copying between projects: texts follow (since 2026-10-18)

The clipboard (`features/canvas/clipboard.ts`) carries `texts` (key → language → value), read by
`collectTexts` in the source project (`visitMenuLTexts`, `visitCommandLTexts`, `visitElementLTexts`).
On paste, `pasteEntities` and `addElement` **lend** them to the target project for the keys it does not
have (`lendTexts`), clone under fresh keys as before, then take them back (`returnTexts`): a copy
from another project, or of a template's default version, keeps its texts without leaving an orphan key.

### Module templates (since 2026-10-18, ADR `module-templates`)

`ModuleTemplatesDialog` (`features/templates/`, "From a module…" entry of the `+` of `ProjectActions`,
present if the server advertises a template): the templates of `installed_modules[].templates`
(`modulesStore.active`), each file with its state (`templateStates.ts`: not added, project file,
identical, modified, removed, new version), computed from `.artisan/origins.yaml`
(`GET …/origins`) and the SHA-256 of the **published** files (`projectBaselineStore`), via
`useProjectTemplates` / `projectTemplatesStore`. Actions:
- **Add to project** / **Update** (intact copies of an older version) /
  **Reset to module version** (one file): `POST …/templates`, written by the server. A conflict (409)
  lists the files and offers to replace them. Disabled as long as the draft has unpublished
  changes: after the copy the project is re-read from disk (`requestReload`).
- **View / Compare** a file: the module's version read-only (`YamlCodeEditor readOnly`) or
  its diff with the published file (`FileDiff`), "Copy text".
- **Open default version**: the template read as a never-stored Project (`templateProject`, via
  `projectFromFiles`); you tick menus, items and commands, `templateClipboard` puts them on the clipboard
  with their texts, to paste on the board (Ctrl+V). No read-only board for now.

In the tree, a Document copied from a template carries a discreet mark (`DocumentRow`): a puzzle icon
when identical, an asterisk otherwise — brand colour (modified) or amber (the module ships a new
version). No text chip: the tooltip (above the row, clear of its `···`) says which, and names the module.
A copy whose published text has the shipped value (`sameAsShipped`: `sameYamlValue`, else the editor's
round trip; formatting and CRLF from a jar built on Windows do not count) is identical, system or
not. A copy that differs gets **Take {module}'s version** in its `···` menu, beside Delete: the
shipped file goes into the draft (`resetIntoDraft`), like Reset of a system element.


**System elements** (`system: true` template, API 2.12.0): absent from `ModuleTemplatesDialog`.
`lib/systemDocuments.ts` (pure) recognizes a system Document by the origin recorded at its path.
In the tree (`ProjectDocumentTree`, `templateOrigin`): puzzle piece with tooltip, dot only if modified
or new version, neither "Move" nor "Delete" but **Reset** (confirmed, `POST …/templates`
`replace` on that path, disabled as long as the draft has changes). Board: `SystemTag` above
the menu or dialog (`useSystemDocuments`); `deleteSelection` keeps them and says so (`canvas.systemDocumentKept`).
### Project registry — left bar (the right panel is removed)

**Since 2026-10-02**, the project's Documents live **only in the left bar**: `ProjectElementsSidebar`, `ProjectPanel`, the topbar's Elements button, `uiStore.projectPanelOpen` and the right mobile drawer are removed. Only the selection inspector remains on the right (`ProjectWorkspacePanels`).

- **`ProjectDocumentTree`** (`features/project/`): the Documents grouped by type (`buildProjectDocuments`), **one icon per category** in the header and none on the rows; `···` menu (edit, delete). `header="name"` adds a name + actions row (demo); `header="none"` when the project row already carries them.
- **`ProjectActions`**: two icon buttons, ⚙ (`openProjectSettings`) and + (create menu / command / dialog), placed **to the right of the name** on the row of the open project in "My projects" (and of module projects). No more "Project settings" row.
- **`ProjectSidebar`**: no more server selector or link to the network (the topbar breadcrumb replaces them, see UI shell). Under the logo sits the search field (`SidebarSearch`, shown on any `/servers/$serverId…` route), which opens the Cmd/Ctrl+K palette; switching servers goes through the project breadcrumb or the server page's name (2026-10-29, the former `ServerSelector` is gone). The sidebar still reads the state of each hub server (`useNetworkServersStatus`, re-read every 15 s) for its own filtering. `/` and `/servers` lead to the hub's server, and the resource pack is rebuilt for the published project's server (`requestResourcePackRebuild(serverId)`). The module list is re-read on each `projects_reloaded` of the active server, without going back through "loading": an add-on that registers its folder after startup appears there without reloading the page (a server's page does the same). The Documents counter follows the name directly: live for an open project, otherwise read from the server index (`useServerIndexStore`, published state); it counts the Documents of all kinds (a module's commands are among them: `command/v1` files of its folder). Before the index is loaded, a never-opened project has no counter. An open project absent from the visible list (unlisted project) is shown at the top with name, actions and Documents. The sidebar also owns the browser tab's title (`useDocumentTitle`, `lib/documentTitle.ts`): `Artisan | <server> - <project>`, each part dropped when unknown (`Artisan | <server>` outside a project, `Artisan` with no server), the project's name read live so a rename or a switch updates it.
- **Demo**: the root mounts `DemoSidebar` on `/demo/projects/…` (logo + `ProjectDocumentTree header="name"`), the demo having neither account nor server list.
- Bar width: **264 px** by default, resizable on desktop by dragging its right edge (220–520 px; arrows / Home / End on the focused handle, double-click resets). The width is persisted with `pinned` in `sidebarStore` (`artisan-navigation`, clamped on rehydrate); the reserved space follows it. Mobile keeps 264 px. The "Find every element" step of the guided tour targets `data-tour="elements"` (the tree), or the button that opens the bar if it is collapsed.

**Open project tree**: the left bar unfolds `ProjectDocumentTree` (`header="none"`) under the row of the **open** project, as soon as this project is loaded in the account; a click closes the mobile drawer and goes through `goToDocument`. The group is a `role="group"` named "Documents of …", not an ARIA `tree` (no tree keyboard navigation). The server's **other projects** carry a chevron (`aria-expanded`) as soon as the server index knows them: unfolded, they list their **published** Documents read-only (`DocumentGroups` without `editable`, so no `···` menu), and a click opens the Document in its project (by its folder).

- **Root row** (project name): click → `openProjectSettings()`, and a `+` next to it opens **creation** (Menu / Command / Dialog). Since 2026-09-05 it is the registry that creates, not the right panel — the latter appears only on selection, so it could no longer host "New menu". Dialogs gain an entry they did not have. Creation **without position**: the Document appears on the board at the place the arrangement gives it.

- Text search.
- No more add / remove from canvas button (removed 2026-09-25): every Document is on the board.
- **Click** on the label → opens the individual view. **`···` context menu**: edit / delete from the project.
- 3rd zone of the desktop overview layout (panel · board · `EditorPane`).
- Shared label helper `documentLabel(project, id, lang)` (`useProjectDocuments.ts`) — also used by the `DocumentView` breadcrumb level.

### The panel = selection inspector

Since 2026-09-05. The editing panel was **always** displayed and ate canvas space, whereas its content already depended entirely on the selection (`SelectionInspector`: nothing → `ProjectProperties`, menu → `MenuProperties`, item → `ElementEditor`…). Its **presence** now follows the same rule as its content.

> The panel exists **iff** something is selected — or if the user explicitly asked for the project settings.

- **`features/project/selectionContext.ts`** — pure function `selectionContext(project, ids, selectionMenuId)` → `none | multi | menu | element | command | dialog | unknown`. **A single** derivation of the nature of the selection, shared by the `SelectionInspector` dispatch **and** by tab gating; two separate dispatches would end up disagreeing. It also carries the scoped resolution of an element id (a `grid` can exist in two menus — see `selectionStore.menuId`).
- **`features/project/useInspector.ts`** — the opening rule, written once: `open = ids.size > 0 || projectSettingsOpen`.
- **Closing** — two exits, both `dismissInspector()` (`projectSettings.ts`: clears the selection **and** lowers `projectSettingsOpen`): a click on the canvas background (`Stage.onStageClick`, the gesture meaning "I'm done") and a **cross** in the panel header. The cross is not decorative: the project settings survive an empty selection **by construction** — that is what distinguishes them from a selection — so without an explicit exit they stayed open indefinitely.
- **`features/project/CanvasWithInspector.tsx`** — stage + inspector, mounted by the board **and** by the focus view. Desktop: the panel floats above the canvas, so hiding it reveals canvas **without reflow**. Mobile: it takes real height, the stage gets it back. (The component exists for the reason that cost `SoloMenuStage`: the rule must not be written in two places.)
- **Independent catalogs** — the items and button images belong to the Buttons panel, accessible without selection; shared files are managed in the Resources tab. Closing Properties does not close Buttons, and vice versa. The help button of an empty menu opens Game items directly; the material and image pickers stay accessible from their fields.
- **`ProjectProperties`** keeps only what is truly project-level — identity (id + source badge), name, description, asset count, deletion. The menu/command counters duplicated the tree and the creation buttons moved there.
- **Project settings** — they match no selection, so they are requested explicitly. Single gesture in `features/project/projectSettings.ts` (`openProjectSettings()`: clears the selection, raises `uiStore.projectSettingsOpen`, ephemeral and never persisted), with **three entry points**: the root row of `ProjectPanel` (project name + settings icon), the **right-click on the canvas background** (`empty` branch of `ContextMenu` — precisely the gesture that deselects, hence the one after which you look for them) and the **⋮ kebab of the topbar**. Selecting anything lowers the flag, otherwise deselecting to clear the canvas would reopen them.
- **No "Settings" entry on an ENTITY right-click**: `useStageContextMenu` **already selects** the targeted entity (`:85`), so right-clicking a menu opens the panel by itself — like left-click (`useMenuClick`: `set([menu.id])`, plus `setEditorTab("edit")`). The affordance already existed; it was just invisible as long as the panel was always there.

### Individual view (deep-linkable)

`features/project/DocumentView.tsx`, mounted by the child route `…/projects/$projectId/document.$documentId.tsx`. The overview route switches to it via `useChildMatches()` (`childMatches.length > 0 → <Outlet/>`) — so reload, browser back button and shareable link work.

- **Dispatch by type**: menu, and module Document whose kind declares `board.items`, → `<Stage projectId focus={documentId}>` (the **board's stage**, see "Focus mode" below) as `primary` of a `SplitPane` + `EditorPane` as `secondary`: the node alone, where a click on a row edits the part in the panel (`DocumentGroup` in `solo`: neither moved nor reopened; framed by `fitViewport` up to ×2, `FOCUS_NODE_MAX_SCALE`, the node being vector text); command / dialog / other kind → centered `SelectionInspector` (`max-w-3xl`).
- Selection set via `useSelectionStore.set([documentId])` on mount → `SelectionInspector` (keyed on the selection) and `MenuGroup` edit through the **same** path as the board. Not found → `EmptyState`.
- **INVARIANT**: `DocumentView` reimplements no editor — it mounts the same renderers as the board (`MenuGroup` in solo, `SelectionInspector`). No second editor (≠ focus mode 2026-06-02, forked then reverted).
- **Escape = back to board**: `DocumentView` sets a window `keydown` listener that calls `back()` on `Escape`, **unless** focus is in an `INPUT`/`TEXTAREA`/`contentEditable`, a modal/menu/list is open (`[role=dialog|menu|listbox]`), or the event is already `defaultPrevented`. `back()` leads to a collection's page for a collection's Document, to the board otherwise.
- **Pan/zoom memory**: the `Stage` restores its `viewport` from `uiStore.canvasViewports[projectId]` on mount and rewrites it on every change. The framing is **persisted in the browser per project**, including after closing or reloading. The inner component is remounted on project or mode change to restore the right framing. In **focus mode**, `uiStore.documentViewport` keeps a framing shared by all Documents.
- **Minimap**: `CanvasMinimap` shows the rectangles from `nodeBox(project, id, layout)` in an SVG overlaid on the board, without a second Konva Stage. The view rectangle follows pan/zoom; click outside the rectangle = recenter, drag = move without changing zoom. The bounds include the documents and the current view; their projection stays fixed during the drag. Keyboard arrows move the view when the minimap has focus. The button next to Buttons in `ProjectLibraryWorkspace` opens the minimap then disappears while it is shown; the minimap (148 px wide, 96 px below the `sm` breakpoint, 11:7 ratio) is anchored 8 px from the bottom-right corner and its cross closes it, making the button reappear; `uiStore.minimapVisible` persists this preference (visible by default). The minimap is reserved to the board.

- **Breadcrumb, no bar of its own**: `DocumentView` draws nothing over the stage. It hands its levels to the topbar through `state/documentTrailStore.ts` (set while mounted, `null` after): `ProjectBreadcrumb` then shows server › project (a link back to the board) › the collection (a collection's Document: a link back to its page) › the Document's label (`documentLabel`, MiniMessage), and `ProjectTopBarControls` puts the **YAML** switch right after it (`aria-pressed`, the file's path as its title).

### Focus mode (`<Stage focus={documentId}>`)

Since 2026-09-05, a menu's individual view no longer has a stage of its own: it mounts the board's `Stage` with a `focus` prop. `features/project/SoloMenuStage.tsx` is **removed** — it reimplemented only ~20% of the `Stage` chrome, and the document view lost there the item drop from the Library (silently: `setStageDropTarget` was never registered), the keyboard shortcuts, the selection, the alignment guides and the links.

The whole difference lies in the `layout` table:

```ts
const layout = focus ? { [focus]: { x: 0, y: 0 } } : projectBoard(project).layout;
```

- The board shows all Documents, arranged (`projectBoard`); focus builds a **synthetic one-Document board** placed at the origin, without consulting `canvasLayout`.
- Everything that consumes `layout` follows without knowing: `Edges` (no edge, the two ends are never both present), `GhostChips` (all the Document's links become chips), `useMarqueeSelection`, `hitTestSlot`, `setStageDropTarget`.
- `MenuGroup` receives `solo` → not draggable (no board position to write), no "open" double-click.
- Chrome removed in focus: the `EmptyState` and the "Create a menu / command / dialog **here**" entries of the `ContextMenu` (the three `onCreate*At` become optional — they set a board position). Copy / paste / duplicate / delete remain.
- Framing: `fitViewport` (`features/canvas/focusViewport.ts`, formerly `features/project/soloViewport.ts`) centers the menu on open, never enlarging it, then stops fighting the user (`touchedRef`); double-click on the background = reframe.
- **Deliberate behavior change**: the background behaves as on the board — dragging in select mode makes a marquee (new in focus), panning goes through the hand tool / Space / Alt. Before, in document view, dragging anywhere panned.

**INVARIANT not to break**: `setStageDropTarget` / `setStageSlotHitTest` / `setStageGeometryProvider` are **single-tenant** global registries. This holds because the overview route does `childMatches.length > 0 ? <Outlet/> : <Stage/>` — never two `Stage`s mounted at the same time. Focus **replaces** the board, it does not coexist with it.

### Ghost chips (off-board links)

`features/canvas/GhostChips.tsx` + `offBoardLinks.ts`. A node on the board that references a target **absent** from the board shows a `→ target` chip (the target's label rendered as MiniMessage in the vanilla MC font via `VanillaMcText`, like menu titles; `vanillaTextWidth` width of the raw text). Since the derived board (2026-09-25), every existing Document is on it: on the board, a chip now only signals a target absent from the project (dangling ref, or a menu of another project). `offBoardLinks(edges, layout)` returns the links (on-board source, off-board target), deduplicated. `visibleEdges(edges, layout)` (`Edges.tsx`) draws edges only between present nodes. Shared geometry helper `nodeBox(project, id, layout)` (`menuLayout.ts`) used by `Edges` **and** `GhostChips`.

The click depends on the mode, via the optional `onOpen` prop: on the **board**, none (there is nothing to place, and writing a position for a nonexistent Document would pollute `canvasLayout`); in **focus**, `dispatchOpenElement(target)` — there is no board to populate, the chip becomes the way to move from Document to Document, including to Documents never placed on the board.

### Go to a Document: `goToDocument` (since 2026-10-02)

`features/project/goToDocument.ts` is the **only** way to go to a Document from the tree (left and right), and the ⌘K palette. In the current project, it **stays on the board**: selection of the Document (the inspector opens), then `uiStore.requestCenter(projectId, docId)` and return to the board (leaving the focus view or a tab). The board's `Stage` consumes the request (`viewportForCenterRequest` → `centerViewport`, same framing as `fitViewport` but at the Document's position, never beyond 1:1) as soon as it has a size and the Document is placed, then clears it; the `nonce` makes a second click on the same Document recenter. `centerRequest` is ephemeral (outside `partialize`).

To another project (qualified reference `boutique:main`, tree of another project), navigation goes through the **deep link `?doc=<id>`** (`ProjectSearch.doc`): `ProjectCanvasPage` (hook `useProjectDeepLinks`) turns it into `goToDocument` once the project is loaded, which removes the parameter from the URL.

### Entries into the individual view

**Double-click** on a board node: `dispatchOpenElement(id)` (`features/canvas/canvasEvents.ts`) emits the CustomEvent `artisan:open_element` (`OPEN_ELEMENT_EVENT`), listened to by the overview route which `navigate`s to the Document route (`documentDestination`, which also follows a qualified reference). The link chips of the focus view go through the same event. A single click in the tree or the palette no longer opens it: it centers the board (`goToDocument`).

### Mobile (< lg)

The project's Documents are in the **navigation drawer** (left bar), as on desktop; there is no right drawer anymore. The canvas occupies the central area, the inspector stays below it.

## Interaction modes + alignment guides (since 2026-06-14)

See `docs/archive/specs/2026-06-14-canvas-modes-and-alignment-design.md`.

### `canvasMode` (select / hand) — toolbar + shortcuts

`uiStore.canvasMode: "select" | "hand"` (persisted via `partialize`, default `"select"`) + `setCanvasMode`.
**`hand` mode**: the `<KonvaStage>` is `draggable`, the cursor becomes `grab`/`grabbing`, clicks on empty space do not select (except `armedMaterial` placement, kept).
**`select` mode** (default): the stage is `non draggable` — dragging on empty space activates the marquee.

- **`CanvasToolbar.tsx`** (`features/canvas/`): DOM overlay `absolute bottom-4 left-1/2 -translate-x-1/2 z-20`, two buttons (lucide `MousePointer2` / `Hand` icons), active button highlighted via `--brand-soft`. i18n labels + tooltips (`canvas.modeSelect` / `canvas.modeHand`) with hotkey hint.
- **Keyboard shortcuts** (`features/canvas/useCanvasKeyboard.ts`): **V** → select, **H** → hand (ignored if an input is focused). Undo and redo (**Ctrl/⌘+Z**, **Ctrl/⌘+Shift+Z** or **Ctrl/⌘+Y**) are not the board's: `useUndoShortcuts` (`features/project/ProjectTopBarControls.tsx`) binds them with the top bar's undo buttons, so they work on every Document's page too (a module's HUD composer, its forms), never inside a text field. **Space held** (in `Stage.tsx`, reset on `window blur`) → temporary hand mode (`spaceHeld`); released → back to the current mode.

### Marquee (rectangle selection, select mode only)

- **`useMarqueeSelection.ts`** — handles `pointerdown/move/up` on the stage. `pointerdown` on empty space (`e.target === stage`) starts the rectangle; `pointermove` grows it (world coords via `screenToWorld`); `pointerup` runs the hit-test then removes the rect.
- **`marqueeHitTest.ts`** (pure) — `rectIntersectsBoxes(rect, boxes)`: normalized intersection (not full containment) between the selection rectangle and the `nodeBox`es of the nodes present in `layout`. Shift = add to the existing selection; without Shift = replace.
- **`MarqueeRect.tsx`** — Konva overlay on the `overlay` layer, reads the current rect state.
- Click without drag on empty space keeps the existing `clear`. The marquee's `pointerup` suppresses the follow-up click event so it does not empty the selection just set. Cancelled if the pointer is released outside the canvas.

### Alignment guides + snapping

- **`alignmentGuides.ts`** (pure) — `alignmentGuides(dragged, others, threshold) → { snapX?, snapY?, guides[] }`. Compares **left / centerX / right** and **top / centerY / bottom** of the dragged node with those of every other node; keeps the best candidate per axis within `threshold` (≈ 8 world px); emits `Guide { axis, pos, from, to }` covering the ends of the aligned nodes.
- **`useNodeAlignment.ts`** — hook wired into the `onDragMove` of the node groups (`MenuGroup` board, `CommandGroup`, `DialogGroup`, `TriggerGroup`). Guards on `e.target` so that child drags (slots) do not trigger snap/teleport. Repositions the Konva node (`node.x(snapX)` / `node.y(snapY)`) and publishes the active guides in `alignmentStore`.
- **`alignmentStore.ts`** — active guides (light state, not persisted). Cleared on `dragEnd` (final position persisted via the existing `setCanvasPosition`).
- **`AlignmentGuidesOverlay.tsx`** — overlay `<Layer>`, dotted brand (`--brand`) Konva `<Line>`s, `listening={false}`.
- **Alt held** during the drag → `alignmentGuides` short-circuited (free movement, no snap or guide).

## Search (Cmd+K palette) + toggleable panel (since 2026-06-14)

See `docs/archive/specs/2026-06-14-search-palette-and-sidebar-toggle-design.md`.

### Search module (`editor/src/features/search/`)

- **`searchIndex.ts`** — `buildSearchIndex(project, lang) → SearchEntry[]`: flat index covering the names of menus/commands/dialogs, the Documents of module kinds, the materials of menu items, and the i18n texts (item titles/lores, dialog bodies/button labels, and every text a module kind declares through `ltextSites` — the walk the Translations panel uses —, context `search.ctxInDocument`, pointing at the Document; a walk that throws costs that Document its texts, never the index). A Document is also found by its id (in the `haystack`, not shown). Each `SearchEntry` carries a structured context `{ key, owner }` (i18n translation key + owner id) translated in the palette via `t()` — no hardcoded string. `searchQuery(entries, query)` filters and ranks; `groupResultsForDisplay(results)` groups by category for display.
- **`SearchPalette.tsx`** — combobox/listbox overlay (a11y compliant). Keyboard navigation ↑/↓/Enter/Esc. On selection: navigates to the Document's individual view (`…/document.$documentId`); for menu item matches, sub-selects the corresponding slot. Opened via `useGlobalSearchShortcut` **or** the sidebar's search field (`components/SidebarSearch.tsx`; the topbar 🔍 button is gone). Mounted by the project page (`projectId`: the project in detail + the server's other projects) and by the server page frame for every non-project child (no `projectId`: the server's projects only, the server index read on the first open).
- **`useGlobalSearchShortcut.ts`** — listens for Cmd+K (Mac) / Ctrl+K (Windows/Linux); ignores Shift. Mounts/unmounts the listener cleanly.

### Server index (`editor/src/features/serverIndex/`, since 2026-10-02)

Reads **all of the server's projects**, outside the project being edited. Editing, drafts, conflicts and publication stay **per project**: the index is a read model, never a second editor.

- **`serverIndexLoader.ts`** — `loadServerProjects({networkId, serverId})` lists the projects on the server's disk then reads each **published** tree (`readProjectFiles`, in parallel). **No side effects**: it touches neither runtime, active server, draft nor account (unlike `useProjectLoader`, which opens ONE project to edit it). Hash cache: an `unchanged` reuses the already-parsed `Project`, unless a Document kind was registered since it was parsed (`documentKindsGeneration()`, `domain/documentKinds.ts`): a module's view arriving after the read, whose Documents `projectFromFiles` skipped; the cached files are then parsed again, nothing is transferred. An unreadable or unparsable project is returned in `failed`, without removing the others.
- **`serverIndexStore.ts`** — ephemeral state (`scope` = `<network>/<server>` as the URL names them). Changing server clears the previous one's projects; a result that arrived for another scope is ignored.
- **`useServerIndexLoader.ts`** — mounted by `ProjectCanvasPage`; loads in the background once the edited project is ready. Opening never waits for it. A newly registered Document kind (`subscribeDocumentKinds`) asks for a new read, like `rereads`.
- **`serverIndex.ts`** — pure. `indexProjectDocuments(project, lang, moduleCommands?)` gives the Documents (menus, commands, dialogs, module kinds, then the commands declared by its module) with their qualified identity `ref = <folder>:<id>` (the disk folder, `diskId ?? id`, is the **namespace**: the same id in two projects remains two Documents). `toSearchEntries` adapts them to the palette.
- **`serverChecks.ts`** — `checkServerIssues(edited, others)`: what deploying `edited` (working state) risks breaking **on the server**, against the published state of the other projects, because the plugin stores menus, dialogs and commands in single tables with no notion of project. Three families: `command_conflict` (same name or alias between two commands — `CommandRegistrar` leaves the label to the first loaded project, removes the alias or the whole command from the other and logs it as an error), `duplicate_id` (same menu or dialog id in two projects — the last loaded wins silently) and `broken_link` (link from the edited project to a missing target or one defined by several projects, via `deriveServerGraph`). Reports only what **involves** the edited project; these are warnings, never a block. `serverChecksFor(edited, indexState)` adds the state: while the index is loading (`pending`) or could not read (`unavailable`), the checks are **not** done and never read as a green light; unreadable projects make them `incomplete`.
- **Deploy review**: `DeployReviewDialog` shows these checks above the list of changes (`ServerChecksSection`, `deploy.checks.*` keys); `ProjectTopBarControls` computes them when the review opens, from `useServerIndexStore`.
- **Palette**: `SearchPalette` adds the Documents of the other projects (menus, commands, dialogs — not their content) after those of the edited project, with the project name as context (`search.ctxInProject`); the project name is searchable. The edited project never appears twice. Selecting a result navigates to the other project.

The index shows the **published** state: the draft of a non-edited project is not in it. It refreshes each time a project is opened (cheap: hash cache), not after a Deploy during the session.

### Topbar breadcrumb (since 2026-10-02)

`ProjectBreadcrumb` (`components/`) replaces the project name alone at the head of the topbar: **server › project**. The server is a `BreadcrumbSwitcher`: it opens the list of the network's servers (online/offline dot, search field beyond 7) and choosing one leads to its page. The network now appears only as the server's tooltip (2026-10-08), to leave room for the tabs; its page stays reachable from the `/networks` list and the account. The status dot before the server (`LinkedServersDropdown`) keeps its own menu. Outside a network (demo), only the project is shown. Rendered by `components/ui/breadcrumb.tsx` (`Breadcrumb`, `BreadcrumbCurrent`, `BreadcrumbSwitcher`, `breadcrumbLinkClass`; specimens on `/design`). The topbar tabs show only their icon (name in the tooltip with the shortcut).

## UI shell — Project + Settings (since 2026-05-27)

`features/onboarding/EditorTour` and `editorTourController` coordinate a welcome and six brief guided-tour steps in
the shared Project workspace: navigation/demo, canvas, Buttons/properties,
Elements, tabs, then Save or keeping the demo. Automatic presentation is claimed
once per player through `PATCH /auth/me` (the hub keeps it in `plugins/Artisan/editor-prefs/<uuid>.json`); anonymous demos keep browser state.
Later/close preserves progress without another automatic opening; the project
menu resumes an unfinished tour or replays a completed one. Guest progress is
transferred only on the matching return from explicit demo authentication, without
replacing account state; abandoning that flow discards its transfer intent.
Temporary panel overrides reveal the target without changing saved preferences
or project documents, then restore the previous view. Other dialogs suspend the
tour; unavailable targets are skipped after layout settles. Mobile Elements uses
its toggle to avoid opening another modal. The last step requires explicit completion.

Global navigation is wrapped by `NavigationSidebar` in `__root.tsx`:
on desktop, an invisible 8 px hover zone with no space reserved at rest;
floating button at the top left and a 216 px overlay, offset 8 px from the edges,
`PanelLeftOpen`/`PanelLeftClose` icons mirroring the Elements toggle on the right,
with rounded corners and content clipped to the same outline;
collapses after 300 ms outside the panel. Portaled menus and keyboard focus
keep it open; Escape closes the temporary panel and returns focus to the
button. The Menu button stays visible: click = fixed opening without border (216 px),
second click = close and return to hover. `sidebarStore.pinned` is persisted under `artisan-navigation`; reloading restores this choice. Temporary hover and the mobile drawer stay ephemeral. The mobile drawer
keeps an explicit opening with button and backdrop. Same shell for admin.

Project creation from the network (`NewProjectModal`) uses a form:
Enter in the name or description triggers the same submission as "Create".
An empty name or a creation already in progress blocks submission; "Cancel"
closes the modal without creating a project.

The logo is pixel art (sources and generator in the project's `branding/logo-pixel/`). `editor/public/logo.svg` is the 16×16 crafting-table block: the SVG favicon declared in `editor/index.html`, and a module's default icon (`DEFAULT_MODULE_ICON` of `components/ArtisanWordmark.tsx`). `ModuleIcon` and `ModuleRowIcon` draw it until the module's icon has loaded from the hub, and keep it if that load fails; a plugin module's row under "Installed modules" shows it when the module has no icon (none shipped, or its brand not announced yet), in place of the folder described below. Icon-only spots (the home link shown next to the breadcrumb when the navigation is collapsed) use `ArtisanSymbol`: the wordmark's A alone, `public/symbol-dark.svg` or `symbol-light.svg` (9×8 grid shown ×3, 27×24).
The brand of the sidebars, authentication and marketing pages is `ArtisanWordmark` alone (no icon next to it, the A of the wordmark is the symbol): `public/wordmark-dark.svg` or `wordmark-light.svg` depending on `useThemeStore`, a 39×8 grid shown ×3 (117×24) with `image-rendering: pixelated`.
A module's look (`lib/moduleBrand.ts`, `useModuleBrand` of `components/ArtisanWordmark.tsx`): the brand its jar announces at Presence (`installed_modules[].brand`, `ModuleBrandDeclaration`, API 2.23.0), as hub URLs pinned to its hash (`…/modules/:id/brand/:file.svg?v=<hash>`); for a jar that predates it, the editor's copy of a suite module (`public/brand/modules/<brand>/`, plugin ids aliased: `boutique` → `store`, `daily` → `daily-rewards`, `msquests` → `quests`…; to delete once every module ships its own); otherwise none. A brand file the module lacks stays empty, a single logo serves both themes (`themed`). While one of its folders is open the sidebar shows its wordmark in place of Artisan's, and `ModuleHome` heads its page with its icon (`ModuleIcon`, 16×16 ×3) and its full logo (`ModuleLogo`, "Artisan Auctions", grid ×3) in place of the tile and the name; its row under "Installed modules" shows its icon at 16 px (`ModuleRowIcon`) in place of the folder. A module with neither (a third party's, an old Conversations jar) keeps the Artisan wordmark, the tile and the folder.
Each suite module's icon is its own emblem on Artisan's crafting table, in the module's palette (generator `branding/logo-pixel/generer-icones-etabli.py` in the project files); the copies in `public/brand/modules/` stay identical to the jars', Conversations included. `ModuleHome` heads its page with the icon and the logo (or the name) alone, centred on each other, with no subtitle.
On mobile (<1024 px), the topbar uses a two-row grid, keeps the icon tabs and enforces 44 px touch targets. The Buttons panel temporarily hides the inspector without clearing the selection; a selection change closes Buttons. Panels stay independent on desktop.

The properties also enable `SplitPane.animatePresence` on desktop (`ProjectWorkspacePanels`) and mobile (`CanvasWithInspector`, split always mounted). Changing the selection does not replay the animation: only the panel's presence triggers it.

`usePanelPresence` keeps the content for 200 ms during exit and cancels the unmount on reopening. Elements animates translation/opacity; the menu also animates its reserved width. Buttons enables `SplitPane.animatePresence` (width/height), disabled during drag. Exiting panels are `inert` and `aria-hidden`; `prefers-reduced-motion` removes the wait and the CSS transitions.

The topbar's left margin reserves 48 px for the floating navigation button; it goes to 12 px on desktop when navigation is pinned and already occupies its own column.
On desktop, the topbar and the sidebars' brand link share a 48 px height and start 8 px from the top. The floating panel removes its internal top padding to compensate for its 8 px offset; its outline uses a ring without changing dimensions. The 36 px toggle is centered 32 px from the top.

The sidebar (`components/NewProjectDialog.tsx`, the only creation modal — the duplicate
`features/account/NewProjectDialog.tsx` was removed with the cloud-era code, issue #44)
follows the same native submission. Both modals stay open with the entered name if the
server refuses the creation; they display a translated error and the placeholder
`mon_projet` / `my_project`.
The success of `createProject` confirms the manifest write on the server disk,
then the list is re-read from that disk.

See `docs/archive/specs/2026-05-27-workspace-shell-and-settings-design.md`.

`/settings` has five sections: **Appearance**, **AI apps** (`features/mcp/McpAppsSection.tsx`,
`#ai`: the `/mcp` address to copy, the authorized MCP clients and their revocation; "disabled" when the
hub answers 404, without `web.mcp`) and, for `artisan.editor.config`, **Editor
address** (`features/settings/EditorAddressSection.tsx`, `/api/v1/editor-address`): name of the
address on the tunnel server, checked while typing, then connection link on the
new address. `#address` opens this section. Also for `artisan.editor.config`, **Sessions**
(`features/settings/EditorSessionsSection.tsx`, `/api/v1/editor-sessions`, `#sessions`): the open
editor sessions of the network, with "You", "Editor open", last activity (to the hour), origin
server and rights; **Close** revokes one, one's own after a confirmation, then
`authStore.sessionClosed()` sends the tab to `/login?expired=1`. Also for `artisan.editor.config`,
**Assistant** (`features/settings/AssistantSettingsSection.tsx`, `/api/v1/ai/config`, `#assistant`):
the assistant's API, address, model, key (write-only: a saved one shows as its last four characters
and stays when the field is left empty), effort and steps; saving applies at once and resets
`useAiStatus`'s cache. Read-only when environment.yml's `ai` section sets them. As long as the address has no name,
`EditorAddressBanner` offers it at the top of a server's page; "Later" hides it for
this browser (`localStorage`).

`/oauth/consent` (`features/mcp/ConsentPage.tsx`, ADR `mcp-server`): the page where `/oauth/authorize`
sends the player to approve an AI client. When not logged in, it says to type `/artisan editor` and
waits for the cookie (re-reads the session every 4 s, the link opens another tab); then it names
the client, what it will be able to do (read, write drafts) and will not be able to do (deploy), and
sends the browser back to the address the hub returns (`code` or `access_denied`). Without
`artisan.editor.edit`, Authorize is disabled. A draft that a client created (`source: "ai"`)
carries an AI badge in the Drafts list (`PersistedDraftControls`).

- **`ProjectSidebar`** (sticky, `routes/__root.tsx`) — clickable brand (→ `/servers`) at the top + `SidebarSearch` + one folder = one module (design `projets-en-modules`, 2026-10-19): **Installed modules** section first, one plugin module per row, sorted by name until the admin reorders them. With a single folder (add-on root or `moduleFolder`), the row is that folder under the module's name, its Config screens and its `/m/<id>` route below; otherwise the module's name sits above its folders. A module with no folder and nothing to configure does not appear. What a module manages (screens, `/m/<id>` route) collapses with it: nothing shows until its row is open (or the displayed page is one of these entries). Entries are neutral-tile rows, without header, like the Documents of a folder. A module's commands are `command/v1` Documents of its folder, listed and opened like the others; a module without a folder shows none (the plugin serves them from memory, nothing to edit). Then **My modules**: the admin's folders, filtered by active server, and "+ New module". Both lists reorder by dragging the folder's whole row, no handle (`SortableFolders`): 5 px of mouse movement or a 250 ms long press before a drag starts, so a click still opens/folds the folder and a swipe still scrolls; the click that ends a drag is swallowed so the link does not navigate. The order is a viewer preference kept in this browser, per server and per section (`state/sidebarOrderStore.ts`, localStorage `artisan-sidebar-order`, `applyOrder`: stored ids first, new folders after in their default order). A configuration root (`role: config`, `registerConfig`) appears in no list, it is opened through the module's screens. A screen whose table lives in one of the listed folders (the module's folder) opens **in that folder** (`/servers/$serverId/projects/$projectId/screen/$screenId`, `features/screens/ProjectScreenView.tsx`, link via `screenDestination` of `lib/projectNavigation.ts`): it edits the folder's working copy, so its draft, and goes to the server with Deploy, with no Save button or YAML tab; the folder remains the active project, open in the sidebar with its screens in its block. A screen of a configuration root keeps the standalone page `/servers/$serverId/screens/$screenId` (`ConfigScreenPage`, live writing). A screen that declares a `component` renders the module's `FrontendModule.screens[component]` view (`features/screens/ModuleScreenView.tsx`) in place of the generated form, on the same working copy. The split between plugin modules / admin modules lives in `features/projects/projectGroups.ts` (`buildModuleList`, pure, on top of `buildProjectGroups`) — **a server's page (`/servers/$serverId`, `$serverId` = server UUID) shows the same thing by reading the same function**, and reads its folders on the server's disk (`listServerProjects`) like the sidebar + sticky bottom ⚙ Settings. Since the slug routes (phase 4a), the URL params `networkId`/`serverId` may carry a slug: the sidebar resolves them to real ids (match `id` OR `slug` against `networksStore` / the fetched `serverKeys`) before any project filtering; `ServerSelector` likewise matches `serverId|serverSlug`. Creation flows outside the sidebar (`/networks` hub, network detail, setup wizard) call `networksStore.bumpRefresh()` after each create/delete — the sidebar listens to `refreshToken` and refetches networks + server entries (otherwise it would stay stale until reload). Accounts-only (Task 8): no more session mode, always user cookie + `listNetworks`.
- **Server page `/servers/$serverId`** (`routes/servers.$serverId.tsx`, 2026-10-29) — a one-row frame as tall as the sidebar's logo row, on the sidebar's surface with the content in the project page's inset panel (concave top-left corner, hairline) (server name, which is the server switcher (`BreadcrumbSwitcher`), online / offline / plugin to update badge, the tab strip `features/serverPage/ServerTabs.tsx` with `SERVER_TABS`, one route per tab, then the Minecraft and Artisan versions at the end of the row); the tabs' underline sits on the frame's bottom edge and the strip only scrolls sideways. The Overview lines up with the title instead of centring. Tabs: **Overview** (the route itself, `ServerOverview`: *My modules* then *Installed modules* as card grids, import), **Board** (`/canvas`), **Play** (`/play`), **Assistant** (`/assistant`, below), **Data** (`/data`), **Settings** (`/settings` → `ServerConfigSection`: group summary on the left, sticky "N settings changed · Discard · Save" bar). The frame shares the server through `ServerFrameContext` (`useServerFrame`) and subscribes to no editing state; tabs load their own data (`useServerProjectList` of the route file: the disk listing, renamed and reloaded projects). The tabs are composed in the route files, which may import any feature; `features/serverPage/` holds only the frame and the tab strip, so it adds no edge to `boundaries-baseline.json`. A child route that is not in `SERVER_TABS` (a project, a standalone screen) renders without the frame. Adding a server-level view = a route + its `SERVER_TABS` entry.
- **`/servers/$serverId/projects/$projectId`** — canonical server-scoped route (`$serverId` = server UUID, no more network level) (`/project/$projectId` redirects). Tabs via `?tab=`: `overview` (Konva canvas, default), `translations` (`TranslationPanelContent`), `resources` (`AssetsTab` — images and fonts), `assistant` (`AssistantBody`). **Since 2026-07-20**, the secondary views **replace the canvas** in the central area (they no longer float in a modal): each is a `WorkspaceView` (`components/ui/workspace-view.tsx`) — opaque `absolute inset-0` **keep-alive** panel (mounted on first activation, stays mounted `hidden` afterwards → filters/chat/selection survive the switch) that covers the `centerContent`. The canvas stays **mounted underneath** (never `display:none`, otherwise the `Stage`'s `ResizeObserver` would re-measure); it is only visually hidden. The inner `ProjectSidebar` (`ProjectPanel` tree, right column shared with the properties, `projectPanelOpen` toggle) is **persistent** across all views; only the center swaps between canvas, Document detail (`<Outlet/>` when `useChildMatches` is non-empty — mutually exclusive with the `Stage`) and secondary views. Escape / × return to the canvas (`exitToCanvas`, `?tab=undefined`). The former `data-sources` tab was removed on 2026-10-28: a Project's own data are rows of the sidebar tree (`DataSourceRows`) opening `…/projects/$projectId/data/$dataSourceId` (`DataSourceView`), the server's sources the **Data** tab of the server page (`ServerSourcesPanel`, `/servers/$serverId/data`); an old `?tab=data-sources` link falls back to the canvas.
- **Source picker (`SourcePickerOptions`, `MenuProperties.tsx`)** — now lists the live data sources of the connected server (`useServerDataSourcesStore`, endpoint `GET /api/v1/servers/:serverId/data-sources`, cookie auth, "On this server" section), in addition to project data; refs stay freely typeable (hermetic invariant). The YAML "connector import" flow was removed on 2026-07-17 (dead — replaced by server-reported sources).
- **`SourceShapingEditor` (`properties/SourceShapingEditor.tsx`)** — visual editor mounted under each `SourceRefInputRow`: equality filter (`filter: Record<field, value>`, literal value or `{arg}`), single-key sort (`sort.by`/`direction`), `limit`. No runtime change — edits the same opaque `ContextInput.sourceRef` fields (YAML round-trip unchanged). Autocompletion via `<datalist>`: fields from `serverSource.schema` (fallback to free input if `[]`), `{arg}` values from the menu's `primitive`-type `contextInputs`.
- **`MenuDataSection` (`properties/MenuDataSection.tsx`)** — "Menu data" section under `ContextInputsEditor`: one card per consumed `sourceRef` (ref, module badge, summary of active filters). Live preview via `previewDataSource` (`POST …/data-sources/preview`) with the menu's filters + a form of trial values for each detected `{arg}` token (`extractArgTokens`). `pack:*` refs (project data): no server preview; the data are edited from their row in the sidebar.
- **Top bar** (`ProjectTopBarControls.tsx`): compact rounded surface (`--r-lg`), groups spaced without separators. Project/server identity, capsule navigation (`--r-md`, soft active background), contextual tools then compact search, Save (draft) then Deploy, `⋯` menu and Elements at the far right. Buttons and undo/redo on Canvas; language on Canvas and Translations. Tab labels fold into icons before xl; groups can wrap below md. Numeric shortcuts in tooltips, routing and badges unchanged. Refresh stays in `⋯` via `RefreshProjectButton.renderTrigger`, with confirmation mounted outside the menu. Discarding changes stays in the Deploy chevron.
- **Right columns (`ProjectWorkspacePanels`)**: canvas, full-height `EditorPane`, then the 240 px `ProjectPanel` tree at the far right. Properties appear only with a selection on the canvas or a menu; individual commands/dialogs keep their central editor. The project settings are the exception: asked for from the left bar, they open the column beside a Document's editor or a collection too (`tabOpen` false); a tab keeps no inspector, so the gear and the kebab (`useOpenProjectSettings`) leave the tab first. A horizontal `SplitPane` sets the properties width (`editorPaneWidth`, persisted and capped according to available space). No vertical split of the properties. The Elements button is at the right of the topbar; closing the tree keeps the properties and vice versa. In the tree, `ArrowLeftToLine` adds to the canvas and `ArrowRightToLine` removes. `DockedInspectorContext` prevents a second floating inspector. The canvas keeps the same mounting when panels change. Mobile: stage/properties stay in a vertical split.
- **`/settings`** — sections sidebar (V1 = Appearance, hosts `EditorLangSwitcher`) + main content.

## Live data source rendering + placement mode (since 2026-07-15)

The canvas renders **real rows** of a data source (no longer just a static sample), and a menu `Element` has a 2nd display mode alongside `iterates`: **placement mode** (`el.places`), reserved for **static** sources. See ADR `data-source-stability-and-placement` + `CONTEXT.md` (Data source / Placement / Row key).

- **Live snapshots** — `state/serverSnapshotsStore.ts` (`rowsByRef`, `loadSnapshot` via `previewDataSource`, module-level dedupe, live wins). `menuPreviewScope.resolveSourceRef`/`buildPreviewScope` accept a `snapshots?` param: for a server `sourceRef`, resolution is **module local rows (`FrontendModule.localPreviewRows`, e.g. boutique, called with `{ serverRows: snapshots[ref] }` since SDK 1.12 so a `mixed` source joins the player's state to the draft) > live snapshot** (never for `pack:`); `resolveSourceRefWithOrigin` says which one answered (`draft`, `deployed`, `none`), and `SourceOriginBadge` shows it on each source input of a menu's properties: "Draft", "In-game state" for a `runtime` source, "Deployed version" (warning) for a `content`/`mixed` source the module cannot compute from the draft; the `importedConnectors.sample` fallback was removed (2026-07-17). `MenuGroup`/`ItemTooltip` load the menu's server refs and build the scope with them. A ref named directly by an element (`iterates.source: "ns:id"`, runtime sugar, no declared input) is loaded too (`directSourceRefs`) and put in the scope under its ref, as `MenuRenderer` does.
- **Placement rendering** (`features/canvas/placement.ts`, pure + tested) — `placementTotalPages` (= max(page)+1), `matchPlacementRow` (match by `keyField`, stringified), `resolvePlacementSlot` (live row > `cachedDisplay` > **dangling** = empty slot; no per-placement override — the appearance comes from the template), `capturePlacementCache` (name/material/lore snapshot for offline). `MenuGroup` branches `el.places` in the pagination pre-pass **and** in `elementsByPosition` (one entry per placement of the current page); `ItemTooltip` mirrors it (bind alias, title/lore override, cache fallback); `menuFanout` **skips** `places` like `iterates`. Placement mode reuses the existing in-menu pagination navigation (`PaginationControls`).
- **Authoring** — `features/flow/PlacementField.tsx`, sibling of `IterationField` in `SelectionInspector` (positions + iteration hidden when `places` is set, XOR). The toggle appears only if the menu binds a **static** source (`serverDataSourcesStore` `stability === "static"` + `keyField`). Row palette `RowChip` (`useDraggable` @dnd-kit, `id = row:<elementId>:<key>`, payload in `data`); list of placements (page/slot, remove — no per-placement override). `enable()` seeds `{ source: <1st static source>, alias: "item", keyField, placements: [] }`.
- **Drop → placement** — `placementDrop.ts`: `pinPlacementRow` (shared glue: reads the stores, captures `cachedDisplay`, preserves an existing override on re-pin, current page from `paginationStore`). Registry `stageDropTarget.setStageSlotHitTest`/`tryStageSlotHit` (returns the `SlotHit` without placing, registered by `Stage`). The project route's `onDragEnd` routes `row:` ids → hit-test → same menu → `pinPlacementRow`. **Mobile tap-to-place fallback**: `uiStore.armedPlacement` — tapping a row arms it, the targeted menu's slots become targets (even empty ones, highlighted) → `pinPlacementRow`.
- **Reducers** (`projectsStore`): `setElementPlaces` (clears iterates), `setElementIterates` (clears places — bidirectional XOR), `setElementPlacement` (upsert by `key`), `removeElementPlacement`. **Export** (`schema/menuV1FromDomain.ts`): `places:` sibling of `iterates`, `keyField`→snake `key_field`, title/lore override via `i18nRef`; `cachedDisplay` **never exported** (editor-only, offline fallback).

## Project sources & Data models (since 2026-07-20)

Manual project sources (`pack:<id>`) went from "free preview-only YAML" to **deployable content with a declared schema**. See ADR `project-sources-and-data-models` + `CONTEXT.md` (Data source / Data model).

At runtime, the lists/objects automatically loaded by `MenuRenderer` (inputs with `source` or direct refs in `iterates`/`places`) stay local to the menu, pagination included. `ExecutionContext.sourceArgs` keeps their original values: `open_menu` does not inherit them until they have been replaced. The target menu therefore reloads its sources with the new parameters, including after a category → main menu → other category round trip. Arguments supplied by the caller and values explicitly passed via `with`/`context` keep priority and keep their type. A dialog can read inherited sources; their provenance is kept until the next `open_menu`, unless explicitly passed.

**Navigation history** (`session/NavigationHistoryStore.kt`): one LIFO stack per player (menus **and** dialogs). `open_menu` / `open_dialog` push the screen being left onto it, `open_previous_menu` pops it and reopens it **without** re-pushing the current screen — the stack shrinks on each return, so `menu → wiki → item` returns to the menu in two returns (no `item ↔ wiki` back-and-forth). Empty stack = no-op. `SyncedMenuProvider.openMenu`/`openDialog` record the current screen and inject, as `sourceArgs` (so never inherited by an `open_menu`, each screen has its own previous), the placeholders `{has_previous_menu}` and `{previous_menu.id}` / `.title`. The stack is cleared on `PlayerQuitEvent` and when a menu closes **without** opening another screen (ESC, `close_menu`): `MenuListener.onClose` checks this on the next tick (current screen unchanged, no Artisan menu open), because each navigation also closes the previous inventory. A navigation to an unknown menu/dialog pushes nothing (`undoPushIfNotShown`); a navigation to the screen just before (same kind/id/project, args ignored) is folded into a return (`collapseReturn`).

- **Domain** (`domain/types.ts` + `domain/dataModels.ts`) — `DataModel` = named recursive schema (`ModelFieldType`: string/number/integer/boolean/**ltext**/**minimessage** (+ `_multiline`)/**item**/list/object/**model** ref, cycles forbidden via `wouldCreateModelCycle`; minimessage = stored string, editing affordance only), Row key declared on the model. `DataSource` = union `table` (`modelId` + `rows`) | `config` (inline `fields` + `value` object). `applyFieldEdit` = **one field edit rewrites schema + all owned values** (table rows of the model, nested occurrences via refs, configs) with ltext release/coercion — "data migrated, references dangled". Legacy sources (without `shape`) are **reset** on load (`normalizeDataSources`, `useProjectLoader`).
- **Row creation** -- the store chooses the first free positive integer for a number/integer Row key, otherwise the first free textual row_n identifier; gaps are reused.
- **i18n** — each ltext value of a row is a normal Key site (`visitDataSourceLTexts` in `domain/i18nSites.ts`), readable canonical key, fully lowercase `sources.<sourceName>.<rowKey>.<fieldPath>` (lists suffixed `_2`…, positional `row_n` fallback as long as the normalized Row key is empty or duplicated). Source names are stored lowercase and unique after `trim().toLowerCase()`; the UI refuses collisions with an inline error. Existing opaque keys are migrated on load; renaming the source, changing the Row key or changing the structure automatically rekeys the sites while keeping all translations. Mint on add (row/field/list element), release on remove, usages/Translations for free via the visitor.
- **Row-key invariant** -- a textual Row key is stored as trim().toLowerCase() and is unique case-insensitively within the source. An empty or duplicate manual edit is rejected inline without touching row data or translations; canonical ltext paths use that validated key: sources.<sourceName>.<rowKey>.<fieldPath> in lowercase. Positional row_n during visitation is defensive only for legacy/imported rows with invalid empty or duplicate keys; a generated row_n is instead a real stored Row-key value. Invalid imported rows are not silently renamed because their IDs may be externally referenced.
- **UI** (`features/data/`) — **form-only** editing (the YAML CodeMirror pane is dead): `ModelFieldsEditor` (rename blur-commit, retype with migration, nested kinds, cycle-guarded model refs, Row key selector, adding a field = draft behind a dashed button — always-visible inputs made it look like a field was already created), `SourceValueEditor` (`SourceRowsTable` = **scrollable sheet**: min-width columns + horizontal scroll, sticky header / 1st column / actions column; item cell → `ItemValueField`, ltext cell → active language via `setI18nValue`, minimessage cell → `RevealField` `MiniMessageInline` facade like the SchemaForm widgets, recursive list/object; `ConfigValueForm` for the config shape). `ConfigValueForm` has two layouts (`layout`): `settings` by default (a module's Config screens: one `panel` per top-level group, row with label + key + help on the left and control on the right beyond 36 rem, stacked below; nested object = indented group whose label column shrinks accordingly, to align all controls of a panel; boolean → `Switch`, scalar list → `TagInput`, enum list → toggle chips, map → key/value grid; a map whose values are objects of scalar fields → a table in its own panel, one row per entry, one column per field, and when every key is a number the add button appends the next number from a copy of the last entry; an untyped file infers such a map from numbered keys holding objects), and `compact` in `DataSourceEditor`, like the sheet's cells. Where: each own source (`ownDataSources`, `domain/projectData.ts`: a source typed by a module-declared model is left out, its module's screen edits it) is a row of its folder's tree after the Documents (`DataSourceRows`, tile `--kind-data`, `Table2` for a table, `Braces` for a config); the folder's **+** menu offers *New data table* / *New data sheet* (`addProjectDataSource` returns the new id, the page opens on it; a Table auto-creates its Data model); the folder's count includes them. The page `DataSourceView` (route `…/data/$dataSourceId`, Escape back to the board) hosts `DataSourceEditor`. Deleting a source: `window.confirm` before `removeProjectDataSource` (row `···` menu or the editor's button, which leaves the page). On disk nothing changed (`data/<id>.yaml`). The server's sources: `ServerSourcesPanel` in the server page's **Data** tab (`routes/servers.$serverId.data.tsx`) (grouped list `ServerSourcesSection` + `ServerSourceDetail`), reached from the source picker (`serverSourcesDestination`).
- **Export** (`schema/dataV1FromDomain.ts`, ADR `bare-data-files` since 2026-07-26) — `emitDataSources` writes **BARE** files: `data/<id>.yaml` = list of pure rows (table) or pure mapping (object/config), **never** inline `fields:`/`shape:`. The schema goes alongside: `models/<sourceId>.yaml` (full model/v1 doc for an *owned* model — single use, not referenced by a `model` kind — identity `id:` in the doc; otherwise a one-line `model:` ref), minimal `_source.yaml` (`name`/`model`/`model_version`/`order`) per row. ltext values → **default-language literal** inlined; other languages emitted in `lang/` by key-site **address** (`dataSourceI18n`), data keys excluded from the default language file. A mapping whose keys are all numbers is written with plain keys (`0:`, not `"0":`). The model's `help` hints → generated comment block (`# ──` marker, regenerated) + preserved main header block (`DataSource.headerComment`). Import (`projectFromFiles`): bare mapping/list detection, beside resolution (`modelRefs`/`modelFileDoc`, indexed by **file name** = source id, the doc's inner `id:` as fallback — same rule as `ProjectReader.readProjectModels`), reconnection of literals to the canonical address (`ltData` + rekey), `adoptBareLTexts` at post-injection of declared models (loader). Addresses key on the source's **id** (renaming does not re-address).
- **i18n modes `extract` / `inline`** (`Project.i18nMode`, 2026-08-03 → 2026-10-26) — **removed**. Superseded on 2026-09-30 by ADR `field-local-translations` (next bullet): since then, the writer (`schema/fieldText.ts`) ignored the mode, and the "On disk" segmented control (Keys / Plain text) of the Translations panel only changed `i18n_mode` in `.artisan/editor.yaml`, which the plugin does not read. The control, `setProjectI18nMode` and `Project.i18nMode` are removed; an `i18n_mode` still present in `editor.yaml` is ignored on read and disappears on the next save. Both former shapes stay readable on import.
- **Field-local structural texts** (ADR `field-local-translations`, since 2026-09-30) - menu titles, appearance `title`/`lore` and dialog `title`/`body`/labels carry their languages **in the document**: a text slot is a string (literal or `{i18n:key}`) or a map `{ <lang>: text }`. `schema/fieldText.ts` (`fieldTextOf`) writes the map from `project.i18nKeys[site.key]` - a bare string when only `defaultLang` has a value; import (`menuV1ToDomain` / `dialogV1ToDomain` / `projectFromFiles`, `isLangMap` helper) files the map under a minted key. `lang/` now carries only action texts (`@key` refs in the Action DSL), keys with no site and data sources. On the plugin side, `model/LocalizedText.kt` reads the map with fallback requested language → `defaultLang`. Positional addresses are no longer a rendering contract for documents (`testdata/i18n-address-conformance.json` vector removed).

- **Translatable field** (`components/ui/localized-field.tsx`, `LocalizedField`, since 2026-10-31) - the label of a text with languages, then the active language's editor (`renderEditor`, the owner's control; `onChange(lang, value)` writes). An active language with no text gets an empty editor and the default language's text as its placeholder, never as a value a keystroke would copy into it. With several languages, a translations toggle (lucide `Languages`, badge = `missingLangs`, the `isTranslationMissing` rule) unfolds every language in place, the active one first and the default marked `ref.`, each editor writing its own language: the top bar's language, and so the preview, does not change. An empty language offers "Use the reference" (`CopyPlus`): the default text written as is, so a text kept the same on purpose is no longer missing. With `translate` (`FieldTranslate`, `lib/aiTranslate.ts`: `useFieldTranslate`, defined only when `useAiStatus().canUse`), the unfolded rows end with "Translate the missing languages" (lucide `Sparkles`): one `POST /api/v1/ai/translate` for `missingLangs`, each translation written through `onChange`, a language that did not come back said in a line (ADR `editor-assistant`, decision 9). `LocalizedTextField` and the host mapping of `LocalizedField` (`distribution/hostComponents.tsx`, so module fields too) pass it. The Translations panel's "Translate the N missing ones" runs `translateMissing` over `missingTexts(project)` (every language, contexts from the panel's rows), progress in a toast. `inline` drops the label row (table cells, rows of controls): the toggle sits right of the editor. Unfolding is local state; one language = a plain field with no toggle. `components/LocalizedTextField.tsx` binds it to a Project text (`lt`, languages and active language from the stores, `setI18nValue` unless the owner passes `onChange`). Every translatable text goes through one of the two: item name and lore (`ItemEditor` `translations`, from `StateCards` and `ItemValueField`, where a literal is promoted to a node keeping its text as the default language's), image buttons, dialog title, body texts, input and button labels, command descriptions, action text arguments, data `ltext` cells, plain titles and title text layers; module views through SDK 1.17. **Language-neutral texts** (`isLanguageNeutral`, `lib/i18nUsages.ts`): a source with no letter outside `{…}` placeholders, MiniMessage tags and legacy codes (`{r.name}`) is never missing, in the field, the Translations panel and the top bar's count alike.
- **Unused keys** (`findUnusedI18nKeys`, `lib/i18nUsages.ts`, "Remove N unused" button) — a key can be removed only if (1) no Key site carries it, (2) it is at an address only the editor derives (`menus.`, `commands.`, `dialogs.`, `sources.<id>.` of a **deleted** source, or a minted `lt_…` key) and (3) no text of the project cites it (`{i18n:key}` or `@key`, scan of the whole project). The rest of `lang/` with no site (`Project.keptLangKeys`: an add-on's messages read by its code such as `auctions.messages.*`, `MessageBundle` `inFolder`, `artisan.duration.*`, admin keys) is shown as `(lang/ only)` and never bulk-removed. Before 2026-10-26, (2) and (3) were missing: the button removed the modules' messages.
- **i18n completeness** — an explicitly empty source value is valid, intentional content. The panel counts as missing only an empty secondary language when the source contains text . Export keeps the empty string so the runtime does not display the raw key.
- **`lang/` files** (`lib/langTree.ts`, since 2026-07-30) — `serializeLang` always produces a byte-order-sorted dotted-key map, then `nestLangTree` converts it to a **YAML tree** (each `.` = one level, each level re-sorted byte-order → deterministic file, hence hashable). The inverse `flattenLangTree` serves the three readers (`projectFromFiles` import, backend module mutation, YAML view of the Translations panel on "Apply") and tolerates tree / legacy flat / mixed. The YAML view of the Translations panel (`features/translations/translationsYaml.ts`) emits **the same tree**, comments carried by the leaves via `commentBefore` (context only if it is not the key word for word — prettified item sets, `(unused)`; then `# <defaultLang>: <source>` outside the default language). The tree structure replaces sorting by context as grouping. Keys that no site reads on import (add-on messages, admin keys) are kept: `Project.keptLangKeys`, rewritten by `keptLangEntries` (`langV1FromDomain.ts`), see `project-files.md`. Kotlin mirror `LangFlattener` (read-only — the plugin never writes `lang/`), equality locked by `testdata/lang-tree-conformance.json`. A key blocked by a leaf (`a.b` + `a.b.c`) stays dotted at the root; non-string values coerced, `null` → `""`, lists ignored.
- **Plugin runtime** — `ProjectReader` scans `data/*.yaml` (tolerant per file, bare + legacy forms) → `RuntimeDataSource`; it also reads `models/` on load (verbatim `{name, type}` docs flattened to the inline vocabulary) and the JAR declarations via the `declaredModels` supplier. The reserved `pack:` namespace is resolved at the renderer's **fetch seam** (`ProjectDataResolver`), with the rule of a bare Document reference id: the menu's Project first, then unique id on the server (ambiguous → the first loaded); ltexts are localized at bind: **explicit key > key-site address (`sources.<id>.<rowKey>.<field>`) > literal**; a config binds its whole object without shaping (`ContextBinder` accepts `Any?`).

### `actions` field & Action DSL (since 2026-07-21)

Project commands (`PackCommand`) initialize `ExecutionContext.lang`
via `LangManager.playerLang`, like `/artisan menu`. `open_menu` / `open_dialog`
keep this language; titles and lores, image buttons included, thus use
the player's language or the configured one if `per_player_language` is disabled.

`actions` field kind (`ModelFieldType`): an **Action chain** (`Step[]`) stored as an **Action DSL string** — the compact text serialization, hand-writable in the on-disk YAML. See ADR `action-dsl` + `CONTEXT.md` (Action chain / Action DSL).

- **Codec** (`editor/src/lib/actionDsl/`) — pure, no Project: `lexer.ts` (indentation-aware tokenizer, `#` comments), `parser.ts` (`parseActionDsl` → `DslStep[]`: `if`/`else if`/`else`, 20 verbs, typed conditions + `%ph% ==/matches` → `placeholder_equals`/`_match`, `expression` fallback, `and`/`or`/`not` + parentheses), `printer.ts` (`printActionDsl`, canonical). `ast.ts` = AST mirroring the domain with explicit text `DslText` (`{lit}` literal | `{ref}` i18n key `@key`). `fixtures/action-dsl-fixtures.json` = conformance vectors `{dsl, ast, canonicalDsl}`, **cross-stack contract** (future Kotlin mirror), enforced by `actionDsl.test.ts`.
- **Adapter** (`domainSteps.ts`) — `DslStep[]` ↔ domain `Step[]`. The domain carries text as `LText{key}`, which does not distinguish literal vs ref: reversible **`@` prefix** encoding in the key (`{ref:k}` ↔ `key:"@k"`, `{lit}` verbatim, `literalSteps` convention). Lets the existing `ControlledStepsEditor` round-trip losslessly (typing `@shop.vip` in a text field reads back a ref). Key-site i18n registration of refs is deferred (phase 1 = opaque DSL string).
- **UI** (`features/data/ActionFieldEditor.tsx`) — two modes on the **same** DSL string: **Visual** (`ControlledStepsEditor` pseudocode via the adapter) and **Code** (raw DSL textarea = the disk form). Parse error → textarea fallback. Wired in `SourceValueEditor` (`case "actions"`).
- **Export** — `serializeDataFieldType` emits `kind: "actions"` (the plugin will parse+execute it); `serializeDataValue` passes the string verbatim. `data/v1` schema: `actions` in the kinds enum.
- **Deferred**: Kotlin parser + sheet evaluator (against the same fixtures), runtime execution, list literals `[...]`, dynamic amounts, advanced tail of the expression DSL.

## Project export / import (.zip)

**Export** (`features/export/runExportZip.ts`) — the archive is the file tree
**as the server stores it**, not a regeneration from the domain: flush of
the auto-save (`persistProject`), `GET /api/v1/user/projects/:id` → `files`, `buildZip`
verbatim. Two intended consequences: the archive carries what the domain does not
model (`.artisan/editor.yaml`, the own files of an Add-on root), and **no
validation can block the output of the files** — recovering your config does not depend
on its validity (anti-lock-in promise, ADR `files-first-source-of-truth`).
Network required: with no reachable server the export fails, there is no fallback to
`projectToFiles()` (a fallback would produce an *almost* faithful archive without saying so).

**Import** (`features/export/runImportZip.ts`) — `zip → files → projectFromFiles`,
with no intermediate format. `normalizeProjectFiles` (`projectZip.ts`) re-routes
the entries onto `plugins/Artisan/projects/<id>/` whatever the received shape:
our export, a project folder zipped directly from the server, a module file
(`artisan-module.yml`, `manifest.yaml`) at the root, or one of the three wrapped in an
extra folder. The root is the folder of the **shallowest** module file; the id comes from the manifest's `project_id`,
otherwise from the folder name. Typed errors `not_a_zip` / `no_manifest`.

> The JSON export/import (`projectFileIo.ts`, `.artisan.json`) was removed on
> 2026-07-30: it serialized the in-memory domain, a second representation of the
> project next to the file tree — exactly what `editorJson` had already
> cost (P3a).

## The files ↔ domain codec (`editor/src/schema/`)

Both directions live side by side, one module per kind and per direction: `<kind>V1ToDomain.ts` reads, `<kind>V1FromDomain.ts` writes (`menu`, `command`, `dialog`); `dataV1FromDomain.ts` writes `data/` and `models/` (with `yamlHints.ts` for generated comments), `langV1FromDomain.ts` the `lang/` entries, `fieldText.ts` the shape of a site text (string or per-language map). `projectFromFiles.ts` and `projectToFiles.ts` assemble the complete tree; `documentCodecs.ts` is the per-kind facade that both walk. Disk saving, the source editor and config screens all write through `projectToFiles`; `features/export/` keeps only the zip and validation. Round trip locked by `codecRoundTrip.test.ts` (examples `docs/schema/*/v1/examples`) and the fixed point of `projectFromFiles.test.ts`.

### `menu/v1 → domain` import

`editor/src/schema/menuV1ToDomain.ts` is the pure inverse of `schema/menuV1FromDomain.ts`: it takes a canonical `menu/v1` object (wire, snake_case, what `validateMenuV1.ts` validates) and rebuilds a domain `Menu`. Signature `menuV1ToDomain(src, { projectId, lang, translations? }) → { menu, i18nKeys, unsupported }`. **Pure**: no project mutation — the allocated i18n keys are returned in `i18nKeys` (the caller merges them into `project.i18nKeys`).

- **i18n bridge**: a `menu/v1` text field is a `string`. Literal → new key (`newI18nKey`), value stored under `lang`. `{i18n:KEY}` → `LText{key:KEY}` ref; if `translations[KEY]` is provided, copied into `i18nKeys`. Title-layers already carry `value:{key}` → direct ref. `lore` (string[]) → a single `LText` (lines joined by `\n`).
- **Subset vocabulary**: only the actions/conditions representable on the domain side are explicitly mapped (un-snake + drop fields absent from the domain, e.g. `has_money.currency`). Any other type (`has_item`, `give_money`, `teleport`…) goes to `unsupported` rather than crashing.
- **Remaps**: `size`→`rows` (÷9), `pagination_next/prev`→`paginate{direction}`, `context_inputs`→`contextInputs` (`primitive` vs `sourceRef` depending on the presence of `ref`).
- **Round-trip**: the `menuV1ToDomain.roundtrip.test.ts` oracle exports a rich domain project then re-imports it. Note: an OR-joined appearance `if` does **not** round-trip structurally (the export wraps a pure-OR list into a composite condition `{type:"or", of:[…]}`) — the oracle therefore uses AND-joins.

## AI assistant (`features/project/assistant/`)

The old pipeline (`applyAssistant*`, SSE client, resumable zMenu migration) left with the backend
(issue #44); the `menuV1ToDomain` / `commandV1ToDomain` / `dialogV1ToDomain` converters remain for
the `menu/v1 → domain` import above. The current assistant (ADR `editor-assistant`) runs in the hub:
`AssistantButton` in the Project top bar shows only when `GET /api/v1/ai` says `enabled` and
`canUse`, and toggles `AssistantDock`. The dock is mounted once in `routes/__root.tsx`, after
`<main>`: on `lg` it sits beside the page (the canvas and the chat stay usable together), below it
covers the screen. Closed, it stays mounted and hidden, so the conversation survives closing it and
moving between Projects; a conversation keeps the server and the Project that were open when it
started. Its width is dragged from its left edge (`ResizeHandle`, 360–960 px, at most 60 vw); open
state and width are kept in `state/assistantPanelStore.ts`. The model's replies render through
`Markdown` (GFM tables, code, links; raw HTML stays text).

The conversations read live in one store (`useConversationsStore` in `useAssistant.ts`): events by
conversation, polled once (`followConversation`, one read at a time per conversation), and
`currentId`, the conversation the dock and the server's Assistant tab both show. `useAssistant(scope)`
talks in it and starts one in `scope` (`{project, server}`) when there is none. "Expand" in the dock
navigates to `/servers/$serverId/assistant` and closes the dock; the root does not mount the dock on
that route.

**Assistant tab** (`features/assistant/`, route `/servers/$serverId/assistant`, entry in
`SERVER_TABS`): `AssistantPage` — the player's conversations of this server on the left
(`GET /api/v1/ai/conversations`), the conversation in the middle (`EventLine` and `Composer` shared
with the dock), and on the right one `ArtifactCard` per file written (`artifactsOf(events)`: each
successful `write_document`, by Project, draft and path, the last written first). A card reads its
draft (`readDraft`, once per draft and per event that last wrote into it) and shows the file against
the draft's `baseline`: a menu (`<…>/menus/<id>.yml`, `menuIdOfPath`) as the game would by default —
`MenuPlayPreview` (`features/play/`), the Play engine over the server's Projects with this one
rebuilt from the draft's tree (`projectFromDraftTree`: `projectFromFiles` + the same migrations as a
load, without the server's declared models and actions) — or as YAML (`FileDiff`, whole file), the
only view of the other kinds. "Review and deploy" loads the player's drafts (`useOtherDrafts`) with
the conversation's picked and opens `DeployReviewDialog` in `othersOnly` mode; confirm goes through
`deployDraftsAndReport` (`publish/deployDrafts.ts`, shared with the Project's Deploy). The projects
load through `useServerProjects`, as for Play. `TitleRender` takes an optional `project`, so a menu
of a Project that is not the open one (a draft) draws its own title. Edges `assistant -> play` and
`assistant -> project` are in `boundaries-baseline.json`: the tab composes the Play engine and the
Project's deploy pieces, neither of which depends on it.

## Design system (tokens + components)

**Page spacing** (`globals.css`): every page of the content panel uses one inner margin,
`--page-pad` (16 px, 24 px from `md`). A page that keeps a centred column sets `--page-max`
(`DocumentView`: `64rem`, unset for a `wide` kind); a band spanning the page indents its content
to that column with `.page-inset-x` (`EditorHeader`, the scrolling bodies of the command, dialog
and trigger editors), a view that pads itself sits in `.page-column` (`SelectionInspector` wraps a
module view without `ownHeader` in it). So a Document's header starts at the panel's top edge
and spans its width, its title lined up with the body below. The editor pane beside the board
narrows the margin to 12 px (`.page-pane`). Collection pages, screens and the card pages (data
source, configuration screen) pad with the same token. A module's stylesheet reads it with its
old value as fallback (`padding: var(--page-pad, 12px)`), so its bundle looks the same on an
older editor. Specimen: `/design`.

`components/ui/markdown.tsx` exports `Markdown`: text written by a model or a person rendered with
the editor's type and tokens (`react-markdown` + `remark-gfm`; tables reuse `Table`/`TH`/`TD`,
links open in a new tab, raw HTML is never rendered). `components/ui/resize-handle.tsx` exports
`ResizeHandle`: the drag strip on a panel edge (`edge: "left" | "right"`, pointer, arrows with
Shift for 48 px steps, Home/End, double click to reset); the panel is `relative` and owns the
clamping and persistence.

`components/ui/sortable-list.tsx` exports `SortableList`: a vertical list reordered by a
handle (`GripVertical`, dnd-kit) that each row places wherever it wants (`children(index, handle)`),
moved by pointer (4 px threshold, vertical axis only) or keyboard (Space, ↑/↓, Space); the drop
calls `onMove(from, to)` once. Lists nest. Replaces every move up/down
arrow button; exposed to modules by SDK 1.10. Specimen: `/design`.

`components/ui/tag-input.tsx` exports `TagInput`: a short list of scalar values edited
as tags in a single field (Enter or comma adds, the cross removes). Specimen: `/design`.
`.input`, `.textarea` and `.select` marked `aria-invalid="true"` take a `--danger`
border (value flagged without being blocked, §7 of the Data models).

`components/ui/guided-tour.tsx` exports `GuidedTour`, using semantic tokens and a
Radix modal for keyboard focus, with responsive target highlighting. Escape defers
the tour and restores focus. Specimen: `/design`, section `guided-tour`.

`components/ui/file-diff.tsx` shows a unified server → editor comparison,
with line numbers, context, −/+ signs, `danger-soft`/`success-soft` tokens
and LF/CRLF/missing-final-newline markers. Like `git diff`, unchanged runs
fold into one expandable line, with three lines of context (`context`). The labels
of the two sides are configurable. `components/ui/change-list.tsx` lists the files
of a change (`listChanges`: new, deleted, modified, renamed, binary), with
a +/− summary and an expandable `FileDiff` per file. `components/ui/tooltip.tsx` (Radix,
version aligned with the primitives already installed): instant arrowed bubble on hover
and focus, inverted `--text`/`--surface` colors, to be preferred over the native `title`.
`components/ui/reset-button.tsx` (`ResetButton`): the small reset next to a field that starts from an original value (module command, system element), disabled as long as the field equals the original, which shows modified fields at a glance.
`components/ui/filled-icons.tsx` carries the filled icons that Lucide does not provide. In the list, `FileDiff wrap` folds
long lines and has no max height: a single container scrolls, the file
header stays stuck at the top. Nested scroll areas made the end of long diffs unreadable. Identical contents and missing files
are explicit. The LCS computation is bounded to one million cells; beyond that,
the differing portions appear as a complete replacement.
Specimen in `/design`. `SaveControls` keeps the tree of the refused
attempt and compares each `conflicts[].disk` content to that tree in a
`Collapsible` (first one open). Resolution choices stay explicit.

Visual source of truth of the editor, viewable live at **`/design`** (page `features/design-system/DesignSystemPage.tsx`; the route goes from `/admin/design` to `/design` with the removal of administration).

**Rule for any new UI development**: go through the design system first — the `components/ui/` components first (Button, Input, FormField, Badge, EmptyState, Card, Dialog, Sheet, Tabs, DropdownMenu and its filter field `DropdownMenuSearch`) or the utility classes of `styles/globals.css` (`.btn*`, `.input`, `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`, `.rule`, `.checker` behind a transparent image, `.hatch` over a zone out of reach…); if a component is missing, **create it in `components/ui/`** then add its specimen to the `/design` page in the same commit. Never hardcoded hex/rgba (always `var(--token)`) — exception: the Konva canvas, not themable by CSS.

Token structure (`styles/globals.css`) in 3 layers:
1. **Raw palette**: `--gray-*`, `--emerald-*`, `--red-*`, `--amber-*`, fonts (`--font-display` Spectral / `--font-body` Hanken Grotesque / `--font-mono` IBM Plex Mono), radii `--r-xs…--r-pill`.
2. **Semantic tokens** (themed dark default / light via `[data-theme]`): `--surface*`, `--text*`, `--border*`, `--brand*`, `--success/--warning/--danger` (+ `-soft` variants), `--shadow-sm/md/lg`.
3. **shadcn aliases** (`--background`, `--primary`, `--accent`…) mapped onto layer 2, + Tailwind `@theme` bridge.

Components reference **only** layer 2 (or the layer 3 aliases for the shadcn primitives).

The `globals.css` classes (`.btn*`, `.input`, `.card`, `.chip`…) live in `@layer components`: a Tailwind utility placed on the same element wins (`<Input className="h-8 font-mono">` is indeed 32 px in mono). Outside a layer, they silently beat all utilities.

**Semantic colors of forms.** `--kind-menu`, `--kind-command`, `--kind-dialog` and `--kind-module` (+ `-soft`, `-line`) carry the color of a document type outside the board, the same as on the board (green for a menu, amber for a command, purple for a dialog, blue for a module type without `board.accent`); `--kind-data` (slate) marks a Project's own data rows in the sidebar. `lib/documentKindAppearance.ts` (`kindAppearance(kind)`) gives the icon and colors of a type, a module's `accent` included; the sidebar document tree, search and `EditorHeader` read it. `EditorHeader` (`components/ui/editor-header.tsx`) opens a document's editor (command, dialog, menu and module documents in `SelectionInspector`, system command): type tile, colored overline, large title, meta on the right, and an optional full-width `details` line under them (a trigger's event sentence and chips). `Lane panel` puts an editor section in a panel (command, dialog, menu properties: General, Appearance, Inventory, Data). `Segmented` (`components/ui/segmented.tsx`) chooses among a few side-by-side values (inventory type, rows, title mode). In the sidebar, each document carries its type's tile, with no per-type header; the open project forms a block and the open document is highlighted in it in the color of its type. Labels: `.field-label` (12 px, normal case, first letter capitalized) above a field, `.section-label` above a group; small spaced capitals stay reserved for `.eyebrow`. `--fam-<family>` (+ `-soft`) colors the families of chain actions: `logic`, `message`, `effect`, `navigation`, `reward`, `world`, `module` (`lib/actions/actionFamily.ts`: family and Lucide icon per action, a module action falls into `module`). The color stays on small marks (icon tile `IconTile`, nesting rails `--fam-logic-line`, keywords), never on a large background. `.mc-text` puts a MiniMessage preview on `--mc-chat-bg`, the in-game chat background, so `<white>` stays readable in light theme. Light theme: neutral light-gray page (`--surface` #f3f4f6), white panels and fields (`--surface-raised`, `--surface-inset`) with borders; the type tint behind a header (`.editor-header-wash`) is not applied there. Board nodes (command, dialog, module document) read `--node-*` via `useNodeColors()` (`features/canvas/nodeColors.ts`), title and border in the color of their type. Specimens on `/design`.

### `Table` / `StatCard` / `HBar` primitives

Three new data presentation components, viewable live at **`/design`**:

- **`Table`** (`components/ui/Table.tsx`) — scrollable multi-row table, sortable by column, with a sticky header row. Headers `align-left/center/right`, aligned cells. shadcn wrapper.
- **`StatCard`** (`components/ui/StatCard.tsx`) — metric card (label + value + context, optional trending badge). Used in the usage dashboards (`/admin/ai/usage`).
- **`HBar`** (`components/ui/HBar.tsx`) — segmented horizontal bar (breakdown: colors per segment). Visualizes proportions (e.g. usage per model). Color tokens `--success` / `--warning` / `--danger` and `-soft` variants.
- **`Collapsible`** (`components/ui/collapsible.tsx`) — collapsible section (full-width trigger + chevron, `title` / `meta` for a badge or counter, controlled or not via `open`/`defaultOpen`). **The content is unmounted while the section is closed** — this is the component's reason for existing: heavy sections that most users never open (an item's advanced settings) cost nothing. Specimen on `/design`.
- **`DataTable`** (`components/ui/data-table.tsx`) — generic viewer of preview rows, used by the server source explorer and the menu's "Menu data" section. Two views: **Table** (columns = union of the rows' keys, order of first appearance) and **YAML**. Rows arrive as JSON over the WS, but a table cell can only flatten an object into a one-line blob — as soon as a source nests (`stages` → `objectives` of `msquests:quests`, `items` of `boutique:categories`), the YAML view is the only readable one: indented, colored, **foldable**. The toggle appears only if the caller passes `tableLabel` + `yamlLabel` (mute component, it does not translate); the Table view remains the default. Serialization with `lineWidth: 0` — a MiniMessage string must stay on one line to be copyable. Specimen on `/design`.
- **`YamlCodeEditor`** (`components/ui/yaml-code-editor.tsx`) — CodeMirror + `@codemirror/lang-yaml`. `readOnly` gives the **read mode**: same coloring, same gutters, same folding, non-editable content (`onChange` becomes optional), selection and copy kept. This is the mode used by `DataTable`'s YAML view. Known debt: `YAML_CM_THEME` hardcodes its colors in hex and forces `theme="dark"`, contrary to the "colors via `var(--token)`" rule — visible the day a YAML surface lands on a light background.
- **`Checkbox`** (`components/ui/checkbox.tsx`) — native checkbox tinted `accent-[var(--brand)]`, controlled (`checked` / `onCheckedChange`). For an explicitly confirmed form state (e.g. "keep this choice for all following files" in project import); a persistent setting that changes the in-game result keeps `<Switch>`. Specimen on `/design`.

- **`Popover`** (`components/ui/popover.tsx`) — small form anchored to its trigger (Radix Popover): unlike `DropdownMenu`, you can type in its fields. Used for the color, gradient, click and hover pickers of the MiniMessage bar. Specimen on `/design`.

## Rich MiniMessage editor (2026-10-24)

A single source of truth, the MiniMessage string; two CodeMirror views on it.

- **Layers.** `lib/mm/` is pure TypeScript, no React: `tree.ts` (**lossless** tree: `serialize(parseTree(s)) === s`, the markup being what the preview parser does not cover), `layout.ts` (styled ranges, markup to hide, visible units, "inherits the previous character" insertion point), `edit.ts` (toolbar operations: decorations, color, gradient, click, hover, palette style, clear; deletion that keeps tags; line break of a lore), `profiles.ts` (usage profiles + `diagnose`), `legacy.ts` (`§`/`&` → MiniMessage), `palettes.ts` (types, built-in palettes, `PaletteSource`). `lib/miniMessage.ts` exposes `parseMiniMessageSource` (segments with their source offsets, `perLine` for a lore); `parseMiniMessage` returns the same segments as before.
- **Fidelity guarantee.** An operation rebuilds only the nodes it touches, then checks that the displayed text (`plainTextFromMiniMessage`) is unchanged; otherwise it escapes bare `<` and retries, or gives up. A text opened then closed is never rewritten. A tag that the profile forbids (click in a lore) stays in the text, flagged.
- **Profiles** (`MmProfile`): `features`, `lines` (`single`, `joined`, `separate` = each line parsed alone like the entries of a lore), `maxLines`, `defaults` (what the game displays without a tag: white non-italic lore like `LenientText.loreLine` on the plugin side, gray MOTD…), `preview`. Built-in: `CHAT`, `ITEM_NAME`, `LORE`, `TITLE`, `ACTION_BAR`, `MOTD`; `registerMmProfile` for a module.
- **Components.** `components/minimessage/`: `MmEditor` (`MmToolbar` bar filtered by the profile, rich/code view, Ctrl+B/I/U, `{` autocompletion, diagnostics, legacy conversion), `MmPreview` (the preview the profile asks for), `MmTextField` (editor + preview, `layout` `inline` | `column` | `none` when the screen places the preview itself), `mmCodeMirror.ts` (rich view: markup as `atomicRanges`, transaction filter that touches only visible characters, Backspace/Delete on a visible unit). `components/mc-preview/`: `McText` (vanilla bitmap font, tint, bold, sheared italic, underline, strikethrough, animated obfuscated, shadow; HTML fallback until the `/api/v1/textures/1.21.4/font/*` atlases are loaded), `McTooltip`, `McChat`, `McTitle`, `McActionBar`, `McMotd`, `McScene`, and `McScreen` (the whole game screen at a window size and GUI scale, geometry from the SDK's `mcScreenLayout`; window-pixel layer zoomed to the container by a CSS `scale`, HUD sprites from `/api/v1/textures/…/gui/sprites/*` with flat `--mc-*` stand-ins while not served) with `McScreenControls` (window preset, GUI scale Auto/1…max, zoom). Presentational: the caller resolves placeholders and data. Game interface colors: `--mc-*` tokens of `globals.css`. The glyph tables live in `lib/mcFont/` (generated by `tools/minecraft-assets/gen-char-advances.ts`).
- **Tools page** `/tools/text` (`features/tools/TextToolPage.tsx`, user menu "Text workshop"): one text per profile, preview on the right.
- **"Edit item" dialog** (`features/canvas/ItemEditor.tsx`, shared by the states, source cells and `ItemSpecField`): title and lore in `MmEditor` (`ITEM_NAME`, `LORE`, context placeholders in autocompletion). Right column: `item/ItemPreviewColumn.tsx` (the item's slot, then `McTooltip` on the **resolved** preview, the project's `lore_max_width`, shrunk to the column width rather than cut), then the available context. The other forms keep `MiniMessageField`. The canvas hover tooltip (`features/canvas/ItemTooltip.tsx`) also draws with `McTooltip`: white non-italic lore by default as in game, wrapping at `lore_max_width` like `LoreWrap` on the plugin side.
- **Wrap marker.** `MmEditor` `wrapWidth` (the dialog passes the project's `lore_max_width` to the lore): a dotted line marks where each line will be cut (`loreWrapPoints`, same computation as `wrapLore`/`LoreWrap.kt`). Nothing is written into the text: wrapping happens at render, once placeholders are resolved, so the marker is indicative when the line contains some.
- **Expressions in the rich view (2026-10-27).** The rich view shows the logic, the preview shows the result, and there is one preview. A `{…}` is evaluated before MiniMessage: `richLayout` parses it as opaque filler (the tags in its strings are not the text's) and shows it whole as one atomic unit, `expr: "value"` for a plain placeholder (`{m.rank}`, `{m.joined.ago()}`), `"logic"` for the rest. `mmCodeMirror.ts` gives each one an `ExpressionWidget` that the owner draws (`ExpressionView.draw/erase`): `MmEditor` mounts a React root per widget (`updateDOM` redraws in place, so a text being typed keeps its focus; logic widgets ignore CodeMirror's events) rendering `ExpressionRules`. A placeholder is its name (`humanizePath(path)`, method in words: "time since Joined"), never its value; a computed text is its rules, read from the AST by `lib/expr/readable.ts` (`readExpression`): a `+` with a string or a ternary becomes a list, a ternary chain "If … → … / Else if … / Otherwise …" with the example player's case lit, `&&`/`||`/`!`/comparisons/methods in words, leading `\n` as "new line:"; texts are edited in place (`quoteText`, same quotes, dispatched with `mmInternal`), the rest in the Code view. The example player is `useSimulation(entries, base?)` (`lib/expr/sampleScope.ts`: the screen's preview data, then the placeholders' samples, then what the user set; `data` is the same as plain data; `sampleOf` falls back on the catalog's sample for a method path). `SimulationPanel` sets it: one control per variable the texts read (`variablesOf`, method targets and `base.*` aside: a switch for a boolean, a field for a number or one-line text). `MmTextField` puts it under its preview (`renderSample(value)`, a lore split on `\n` only, as `MenuRenderer` does); `ItemEditor` shares one simulation between the name, the lore and the item preview (`previewScope` + `previewFor`, given by `StateCards`), puts the panel under the preview. The `{` completion list wears the editor's surfaces (`.cm-tooltip` in `MM_THEME`, never the rich view's in-game colour or italic) and shows each placeholder's example value (yes/no for a boolean), else its type in words.
- **Library (2026-10-27).** The toolbar's "Library" button (`PlaceholderLibrary`, shown when the text has placeholders) opens two tabs. Variables: the entries grouped by origin, searchable, each named in words with its sample; a click inserts `{path}` at the caret (at the end when the editor was never focused). Expressions: the recipes of `lib/expr/recipes.ts` ("show a text if…", yes/no, by number, count, join, time since/left), each a small form (variable picked among those of its type, dates by their name, or "Another variable…" typed by hand; time since/left also take "A fixed date…", written as its epoch millis `{1767225600000.ago()}` and read back as a date in the rich view) with a live preview for the example player; Insert writes the built `{…}`, which the rich view then reads as rules.
- **Empty lore lines (2026-10-27).** As `MenuRenderer` does, `renderLore` (`lib/mm/loreLines.ts`) renders a lore line by line as written (a newline inside a `{…}` does not split) and drops a line whose `{…}`/`%…%` give no visible text; a line left empty as written stays. `resolveItem` and `MmTextField` (lore profile) go through it, so a rule sits on its own line instead of a single `{…}` glued with `"\n"`.
- **Splitting and editing a rule (2026-10-27).** A logic block offers "One rule per line" when `splitIntoLines` (`lib/expr/splitLines.ts`) finds a `{…}` glued with `"\n"` (a lore only): each `c ? "\nX" : ""` becomes `{c ? "X" : ""}` on its own line (left out in game when it gives nothing), a conditional bare break becomes a plain empty line, texts split on their breaks; the source is printed back by `printExpression` (`lib/expr/print.ts`). A block built by a recipe (`matchRecipe`) offers "Edit": the recipe's form (`RecipeForm`, exported by `PlaceholderLibrary`) opens in the block, prefilled, and Apply replaces the `{…}`. The Library is an icon (`Variable`, `{x}`) among the formatting tools. Radix packages share one `react-dismissable-layer` (dialog, popover, dropdown, tooltip bumped together): with two copies, a popover opened from a dialog counted as outside it and closed the dialog (`popover-in-dialog.test.tsx`).
- **Line limit.** `lineCount` counts the breaks seen by the player (`\n`, `<newline>`, `<br>`); the rich view refuses a modification that exceeds `lineCap(profile)` (Enter, paste, typed tag), the code view only flags it.

## Play mode (`features/play/`, since 2026-10-29)

The game's screen built from **every project of a server**, with no client and no server running
(spec `spec-mode-jeu-editeur.md`). Route `…/servers/$serverId/play` (`PlayPage`), the **Play** tab of the
server page (under its frame), and the project top bar's "Test in game" button (`?project=<diskId>`: that project first
in the launcher). Projects load through `useServerProjects`, as for the general board.

- **Engine** (`engine/`, no React): `PlaySession` holds the display state (chat, title, action bar,
  open menu + history, journal, forced conditions) behind `getState`/`subscribe`. Every project is
  live at once: commands match across all of them (`matchCommand`, name or alias, sub-commands,
  greedy last string), `open_menu` resolves a bare id in the chain's project and `<diskId>:<id>` in
  another (`projectByNamespace`); each chain carries its project (`RunSource.project`) for texts and
  references. Visual actions run (messages, titles with their ticks, menus, pages, `set_arg*`); world
  actions (give, money, xp, teleport, a command no project declares…) are journaled "→ …"; an action
  nobody declared visual is journaled with its value, never run; a module's action is named with its
  arguments (from the server's declarations, `serverActionsStore`) and flagged as running on the server.
  The journal groups the entries by source (a click, a command, a Trigger) and badges what is only noted.
  Depth capped at 16.
- **Test player** (`testPlayer.ts`): name, op, permissions (`*`, `prefix.*`), money, xp, level,
  world, placeholders; saved per server in `localStorage`. Conditions (`conditions.ts`) computed
  from it when possible, else forced (default true) and listed in the panel to flip. Joins left to
  right, no precedence, as the plugin.
- **Menus** (`menuSlots.ts`, `PlayMenu.tsx`): each slot's first matching state, iterations and
  placements, the canvas' Konva pieces at the GUI scale, centred as the game; a click runs exactly
  that click type's chain (no fallback, as the plugin).
- **View** (`PlayView.tsx`, `PlayPanels.tsx`): `McScreen` + controls, T or / open the chat, Esc/E close
  the menu. The sidebar has three tabs (Launch, Test player, Journal), and a new journal entry brings
  the Journal tab forward. The launcher has a search (commands, menus, Triggers, or a project's name)
  and one collapsible group per project: past three projects only the focused one starts open, and
  every group opens while searching.

## Public landing

`features/marketing` hosts the public `/` landing of artisanmc.net (`MarketingLayout`,
semantic tokens, EN/FR language selector). The pricing page, billing catalogue, credits
and demo links were removed with the cloud in phase F.
