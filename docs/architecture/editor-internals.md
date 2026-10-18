# Editor & rendering internals

> **Phase F (2026-10)** : plus de backend. L'éditeur est servi par le plugin (build
> `npm run build`, même origine que l'API du hub ; ADR
> `editor-web-server`) et ne garde que ce mode. Démo, comptes, facturation, administration,
> pages publiques de tarifs, projets hébergés et copie vers Minecraft sont supprimés
> (sections retirées de ce fichier) ; l'assistant reste dans le dépôt, hors du build. Les
> entrées datées ci-dessous qui citent « le backend » décrivent le comportement cloud : la
> même route est désormais servie par le hub (cf. `rest-endpoints.md`), sans miroir
> d'instantané, sans Versions (liste vide) et sans rebase de brouillon côté serveur.

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

Un seul transport vers le hub : `apiFetch(path, init)` (réponse JSON) et `apiRequest(path,
init)` (la `Response`, pour les binaires et les routes dont le statut fait partie du contrat,
comme le 202 de `rename`). `API_URL` est déclaré là et nulle part ailleurs ; le cookie de
session part avec chaque appel ; `init.json` encode le corps, `init.timeoutMs` pose un
délai local. Tout `lib/api/*` et chaque appel ponctuel (textures de tête, placeholders PAPI,
images authentifiées, rendu de modèles, pack de ressources) passent par là : plus de `fetch`
brut dans `src/`.

Une seule classe d'erreur, `ApiError { code, status, body, detail }` : `code` est l'`error` du
hub (`http_<statut>` s'il n'en envoie pas, `hasCode` le dit), `status` le statut HTTP ;
une panne de transport est `network_error` (statut 0), un délai local `fetch_timeout` (504,
comme le hub pour un plugin muet), une annulation `aborted`. `ApiError.from(e)` normalise
n'importe quelle exception. Les modules qui rendent un résultat `{ok:false, error}` classent
par `code` (jamais par statut seul), `network_error` à part. `DraftApiError` est le cas des
routes de brouillon (`draft`, `conflicts`, `diskFiles` lus dans le corps) ;
`AuthUnreachableError` et `ServerConfigError` ont disparu : `getMe` rejette une `ApiError`
pour tout ce qui n'est pas un 401, `patchServerConfig` rejette l'`ApiError` du hub (`detail`
porte l'explication du plugin). Tests : `src/lib/api/client.test.ts`.

## Store des Projects ouverts (`state/projectsStore.ts`, `state/projects/*Slice.ts`, issue #46)

`useProjectsStore` reste le point d'entrée des importeurs (70 modules de production), mais son
code vit par domaine dans `state/projects/` : une tranche par fichier (`projectsSlice`,
`dialogsSlice`, `commandsSlice`, `menusSlice`, `elementsSlice`, `canvasSlice`, `i18nSlice`,
`dataSlice`), chacune exportant son interface et `createXSlice(context)`, et `helpers.ts` pour
ce que plusieurs tranches partagent (les `gc*LTexts`, `shiftPlayerPositions`…). `ProjectsState`
(`types.ts`) est l'intersection des tranches plus `openProjects` (`{ projects, projectOrder }`, type `OpenProjects` ; l'ancien `Account` et son `id` toujours vide ont disparu, il n'y a pas de comptes) ; `ProjectsSliceContext` est ce
qu'une tranche reçoit : `set`, `get`, `clearTemporal` et les mutateurs de `mutate.ts`
(`mutateProject`, `mutateMenu`, `mutateElement`, `mutateAppearance`, `mutateClickHandler`,
`mutateCommand`, `mutateDialog`). Une action interne au Project passe par l'un d'eux : un seul
`produce`, la recherche de la cible, **rien du tout** si elle manque, le corps, puis `updatedAt`
estampillé — sauf si le corps renvoie `false` (sortie anticipée) ou avec `{ touch: false }`
(board, sources : ces actions n'ont jamais estampillé). Le store compose les tranches sous
`temporal` (zundo, `partialize` sur `account`) : mêmes actions, même historique d'annulation,
rien ne change pour l'éditeur.

Étapes suivantes, store par store, à côté et non à la place : donner à une tranche son propre
store (`useDialogsStore`…) et migrer ses importeurs, puis limiter zundo à ce qui est annulable ;
la bascule des données (`account` scindé) en dernier.

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

## Page du workspace (`features/project/ProjectCanvasPage.tsx`)

La page ne garde que le chargement (`useProjectLoader`) et la mise en page (topbar, canvas,
vues secondaires `?tab=`). Le reste est nommé : `WorkspaceGate` (hydratation auth, redirection
login, échec de chargement, squelette — via `projectLoadStatus`), `useProjectDeepLinks` (`?doc=`,
id canonique du dossier, renommage, ouverture d'un Document depuis la planche),
`useActiveLangFallback`, `useWorkspaceDnd` (capteurs + callbacks du `DndContext`) au-dessus du
décodage pur `workspaceDrop.ts` (`dragStartMaterial`, `decodeDragEnd` → `WorkspaceDrop`), et
`WorkspaceDragOverlay`.

## Tests et CI

La sélection d'un élément est résolue dans son menu propriétaire avant toute recherche de commande, dialogue ou menu portant le même ID. Les nœuds de ces entités ignorent une sélection scoped pour leur surbrillance ; un clic sur le nœud réinitialise ce scope. Un élément scoped disparu reste inconnu, sans sélectionner une autre entité homonyme.

`vitest.config.ts` exclut tous les dossiers `**/e2e/**` pour ne pas charger les tests Playwright dans Vitest. Les scénarios navigateur restent exécutés par `playwright.config.ts` (`tests/e2e`) et `playwright.migration.config.ts` (`e2e/migration.spec.ts`). La CI éditeur doit réussir avant que le workflow de déploiement production démarre.

> Détails d'implémentation éditeur + pipeline de rendu du titre. Consulté quand on touche
> au title composer, au canvas / à l'édition d'élément, ou au `<SchemaForm>`.

## `<SchemaForm>` — générateur de formulaires depuis JSON Schema

`editor/src/components/SchemaForm/` génère des formulaires React depuis un JSON Schema. Couvre `string` (texte / textarea via `format: "long"` / select via `enum`), `number`/`integer`, `boolean`, `object` (nesting), `array` (avec + / −).

**Pour ajouter un widget custom** (color picker, asset picker, MiniMessage editor, etc.) :

```ts
import { SchemaForm } from "@/components/SchemaForm/SchemaForm";
import { ColorPicker } from "@/components/widgets/ColorPicker";

<SchemaForm schema={schema} value={value} onChange={setValue} widgets={{ color: ColorPicker }} />
```

Le widget est routé via le champ `format` du schema (e.g. `{ type: "string", format: "color" }`).

**Hors scope V1 :** `oneOf` / `anyOf` / `if/then/else` / `$ref` resolution. À ajouter quand un module en a besoin.

## Format menu YAML — champ `title`

Depuis SP3, `title` est un tableau de couches typées (`MenuTitleLayer[]`). Format legacy (chaîne brute ou `{i18n:key}`) toléré au parsing plugin pour rétro-compat. Runtime YAML inchangé depuis v3 : seul l'éditeur évolue.

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
    color: "#FFAA00"     # optionnel
    font_asset_id: ...   # optionnel (SP4)
  - kind: textarea
    value:
      key: i18nKey_block
    x: 8
    y: 6
    width: 168
    line_height: 10
    alignment: left      # left | center | right
    font_asset_id: ...   # optionnel (SP4)
  - kind: external_glyph
    provider: oraxen     # nexo | oraxen | itemsadder
    glyph_name: my_glyph
    x: 50
    y: 5
```

Le kind `textarea` (SP5) est un bloc multi-ligne : la string i18n est split sur `\n` au runtime, puis chaque ligne word-wrappée pour tenir dans `width` (px). Chaque sous-ligne rendue à `(x, y + i * line_height)` avec l'`alignment` partagé. `font_asset_id` optionnel s'applique à toutes les lignes. Mots plus larges que `width` débordent (soft constraint).

Le plugin embarque `assets/artisan/asset-index.json` (schéma **v2**) dans le zip RP pour mapper `asset_id → name + type + codepoint? + ascent + height + width + namespace?` et déclarer la table `offsets` (codepoint hex → pixel advance).

## Title Composer — pixel offsets (spaces font)

Pour positionner chaque layer à son `x` exact, le pack (construit par l'éditeur) embarque dans `assets/artisan/font/default.json` un provider `space` (MC 1.20+) mappant 18 codepoints (`U+F800..U+F811`) à des advances en pixels (puissances de 2 ±1/±2/.../±256 → portée ±511 px par décomposition gourmande, **plus avec réutilisation** des chars). On évite `U+F900..U+FAFF` (CJK Compatibility Ideographs) où la font vanilla a des glyphes qui empêcheraient le provider `space` de s'appliquer.

Pipeline :

1. **Éditeur** — `editor/src/lib/pack/spaceOffsets.ts` = source de vérité de la table (`fontJsonBuilder.ts`, `assetIndexBuilder.ts`). `buildDefaultFontJson` ajoute le provider `space` après les bitmaps. `buildAssetIndex` (v2) émet `offsets` (codepoint hex uppercase → advance) + un `width` par entrée.
2. **Plugin** — `AssetCatalog` parse `offsets` à chaque update RP et construit un `OffsetEncoder` (`net.artisanmc.plugin.render.OffsetEncoder`). `TitleCompiler.compileTitle` track `currentX`, insère `offsetEncoder.encode(targetX - currentX)` avant chaque body de layer, avance `currentX = targetX + estimateBodyWidth(layer)`.
3. **Estimation de largeur** (best-effort) : Image → `AssetEntry.width` (fallback 16) ; Text → `length * 6` (heuristique imprécise) ; ExternalGlyph → 8 px.

**Coordonnées x** : `layer.x` = pixels depuis le bord gauche du coffre (`chest-x 0`). Le titre MC est dessiné à `titleLabelX = 8`. `TitleCompiler` initialise `currentX = TITLE_LABEL_X = 8` pour absorber ce décalage : `x=8` → offset nul, `x=0` → offset `-8`.

L'encoder plugin est **lenient** : ne lève jamais d'exception, retourne `""` si table vide (catalog pas chargé), best-effort hors plage. Côté éditeur, `encodeOffset` est **strict** (throw) pour attraper les bugs à la source.

## Custom fonts (SP4)

Import MCFonts via "Import font" dans l'AssetsTab : drop d'un `.zip` (`font.json` + glyph PNGs). L'éditeur parse/valide la police (`lib/pack/mcFontsParser.ts`), l'écrit dans le brouillon puis, à la publication, sous `assets/fonts/` du Project (`lib/pack/assetDiskWrite.ts`). À la régén RP : `assets/artisan/font/<name>.json` + `textures/font/<name>/*.png` embarqués. Éditeur : `TitleRender` rend pixel-perfect via `McFontText` (composition Konva des glyph PNGs).

Background = "gros glyph" : sa hauteur vient de l'ascent de l'asset (`y = 13 - ascent`).

**Glyph layers = Y par calque.** `layer.y` est le haut de l'image en pixels coffre. Le plugin (`TitleCompiler`) rend un glyph dont `y == 13 - ascent` avec `artisan:default`, sinon via `<font:artisan:glyph_y{Y}>`. Le constructeur du pack (`lib/pack/buildServerPack.ts` → `glyphPlacementsFromMenus`) lit les `menus/*.yaml` de chaque Project et émet `assets/artisan/font/glyph_y{Y}.json` pour les seuls couples (glyph, Y) utilisés : chaque provider recharge sa texture côté client, donc pas de matrice complète comme `text_y`. Plancher partagé par les 3 couches : `y >= 13 - height` (MC refuse `ascent > height`). `LayerEditForm` expose X/Y et "Caler en fond de coffre" (x=0, y=17) ; l'`AssetPicker` reçoit `projectId` et propose l'upload (`AssetUploadDialog.onUploaded` → pick direct).

## Title Composer UX v3

- **Édition in-place** : les layers sont édités **directement sur le project canvas** via une 3ᵉ colonne (`LayersPanel`, ~280 px, toujours visible). Plus de focus mode dédié au titre.
- **Layout 3 colonnes** : Project canvas | `MenuProperties` (rows/permission/actions) | `LayersPanel`. Rendu dans l'onglet `overview` du project (route server-scoped ci-dessous ; `project.$projectId.tsx` n'est plus qu'un redirect legacy).
- **`LayersPanel`** = Header + `AddLayerControls` (`+ Image` / `+ Text`) + liste drag-reorderable de `LayerListItem` + `LayerEditForm`.
- **Sélection** : `uiStore.selectedLayerKey: { menuId, index } | null` ; `uiStore.lastSelectedMenuId` sticky (le panel survit aux clics dans le vide).
- **Types UI** : 2 visibles — Image (collapse `background` + `glyph` avec flag `stretchToChest`) et Text. Au save, Image se split runtime en `background`/`glyph`. Glyphs externes : branche propre, pas de bouton dédié en v3.
- **Texte** = MiniMessage tags inline (`<gold>`, `<bold>`…), preview live. Pas de `color` per-layer (coloring 100% par tags).
- **Manipulation directe** : drag pour repositionner ; corner-drag (`ResizeHandles`) pour redimensionner (aspect-locked ; shift = no-op en v3).
- **Sémantique resize — IMPORTANT** : redimensionner un glyph mute l'**asset** (tous les menus qui le référencent changent). Pour une taille per-menu : bouton **"Duplicate glyph"** (`LayerEditForm`) → copie l'asset (nouveau codepoint + PNG) et repointe le layer.
- **Cursor-based attach** : drag depuis `+ Image`/`+ Text` → drop près d'un menu → attache au plus proche (seuil 200 px). Click sans drag → last-selected menu.
- **Fichiers v3** sous `editor/src/features/canvas/title/composer/` : `LayersPanel.tsx`, `LayerListItem.tsx`, `LayerEditForm.tsx`, `AddLayerControls.tsx`, `ResizeHandles.tsx`, `TitleRender.tsx`, `useTitleLayerDrag.ts`, `dragPlacement.ts`, `attachLayerAtCursor.ts`, `screenToCanvasCoords.ts` ; `stageGeometry.ts` (dans `features/canvas/`).

**Texte unifié dans le composer** : `+ Texte` crée un `textarea` (une ou plusieurs lignes), avec largeur réglable par champ ou poignée droite et alignement gauche/centre/droite. Les anciens `text` et `textarea` restent lisibles ; le formulaire commun convertit un ancien `text` lors de son édition, en conservant sa clé i18n et ses propriétés. La simple sélection ne modifie pas le document.

Le bouton « Ajuster l’interligne » est placé à côté du libellé Interligne, avec une infobulle explicitant taille + 2 px (max. 32). L’alignement horizontal occupe une ligne distincte.

**Cadre fixe** : le X affiché est le bord gauche du cadre. Le format runtime conserve son ancrage historique : X du texte à gauche, au centre ou à droite. `textFrame.ts` traduit entre les deux (`xRuntime = xCadre + offsetAlignement`) lors des changements de largeur/alignement. `TitleRender` place le groupe au bord gauche et les lignes à l'intérieur ; le drag reconvertit vers l'ancrage runtime. Largeur et interligne sont en pixels MC, indépendants de la taille de police. Le centrage suit les arrondis entiers de `TitleCompiler`, avec mesure des balises et du gras.
- **Supprimés vs v2** : `FocusComposer.tsx`, `ComposerCanvas.tsx`, `AddLayerBar.tsx`, `LayerSidePanel.tsx`, `TitleThumbnail.tsx` (+ tests).

## Édition d'un Document — panneau Propriétés (`EditorPane`)

Le Document sélectionné s'édite dans le panneau de droite. L'ancien **mode focus** plein-écran (forké, `features/element-editor/` + `FocusButton` + `useElementDblClickNav`) a été retiré 2026-06-06 : doublon de l'onglet Edit + bugs de routing. Le 2026-06-13, une **vue individuelle** deep-linkable l'a remplacé sur des bases saines — un seul rendu partagé avec la planche, pas d'éditeur forké (cf. section « Planche curée » plus bas). La route `.../document.$documentId` est donc à nouveau présente, mais avec une implémentation différente.

- **`features/inspector/EditorPane.tsx`** — panneau **Propriétés**, sans onglets, qui rend directement `<SelectionInspector>`. Un bouton **YAML** dans son en-tête remplace `<SelectionInspector>` par `<DocumentYamlView>` (écriture verbatim) sur le fichier du Document sélectionné — celui du menu parent pour un élément ; chemin via `documentRelPath`, partagé avec la bascule de `DocumentView`. Sans sélection, les paramètres du projet ouverts, le bouton ouvre `manifest.yaml`. Le panneau Boutons est indépendant (voir ci-dessous). **Le set d'items se crée au NIVEAU DU MENU et n'existe qu'à travers l'élément qui le rend** (ADR `item-templates-and-data-library`, révision 2026-07-31) : `MenuDataSection` porte un bloc « Set d'items » par liste ; `createMenuSet` crée un élément auto-suffisant en mode `iterates` ou `places`. En placement, `PlacementRowsPanel` liste les rows du contexte d'aperçu courant en tuiles draggables (charge `placementRow`, dépôt géré par `MenuGroup`/`pinPlacementRow`).
- **Boutons** — `features/project/ProjectLibrary.tsx` : panneau du canvas avec trois onglets **Items du jeu / Items capturés / Images**, sans gestion des ressources graphiques. `ProjectLibraryWorkspace` enveloppe la planche ou la vue individuelle sous le même `DndContext` ; ce qu'un drag porte (`material`, `imageButton`, `placementRow`) et la cible d'état (`stateMaterial`) passent dans le `data` de dnd-kit, typés par `features/canvas/dragPayload.ts` (`draggableProps` / `droppableProps` à la source, `readDrag` / `readDrop` dans `onDragEnd`) — l'id n'est qu'une clé unique, jamais relue ; panneau à gauche sur desktop, sous la scène sur mobile. Il charge items et assets même sans sélection, indépendamment de l'ouverture des panneaux. L'ouverture est persistée et liée au dernier projet ouvert (`projectLibraryStore`), jamais à la sélection. Échap ferme Boutons avant la navigation de Document ; les dialogues et champs conservent leur propre gestion d'Échap. La catégorie historique `graphics` est migrée vers `items` ; `captured` est désormais une catégorie de premier niveau.
- **Ressources** — onglet central `?tab=resources` du projet pour gérer les images et polices (`AssetsTab`, détails avec retour à la grille). Il complète les sélecteurs contextuels du menu sans dupliquer les fichiers. Ordre de navigation : Canvas / Traductions / Données / Ressources / Assistant ; raccourcis numériques 4 pour Ressources, 5 pour Assistant.
- **`features/inspector/`** — la feature du panneau Propriétés : le cadre (`EditorPane`, `FloatingEditorPane`), le routeur `SelectionInspector.tsx`, les éditeurs par type (`element/` : `ElementEditor` + state cards `StateCards.tsx` ; `command/CommandEditor.tsx` ; `dialog/DialogEditor.tsx`, référencés aussi comme `component` par `modules/{commands,dialogs}`), `properties/` (`ProjectProperties`, `MenuProperties`, `ActionEditor`, `ConditionListEditor`…) et `chain/` (éditeur d'Action chain). Les sous-éditeurs d'item partagés avec la planche (`AdvancedItemSection`, `ItemBindingEditor`, `ItemHeadField`) vivent dans `features/canvas/item/`.
- **`features/inspector/SelectionInspector.tsx`** — éditeur unifié de la sélection courante (`useSelectionStore`). Route par type :
  - 0 sélection → `ProjectProperties`
  - menu → `MenuProperties` (+ `LayersPanel` titre)
  - élément (slot) → state cards (material / title / lore / conditions + click handlers en pseudo-code)
  - command → identité + args + step tree
  - dialog → title / body / buttons + actions par bouton
  - Document d'un kind de module → le `component` de sa contribution (section « Kinds de Document contribués » ci-dessous)
  - multi-sélection → "select one item" (multi-edit hors V1)
- **Sélection → Propriétés** : sélectionner un menu / slot / commande / dialogue affiche directement ses propriétés sans changer la catégorie ni fermer Boutons. L'ancien `uiStore.editorTab` est supprimé et ignoré à la réhydratation.
- **Têtes custom (PLAYER_HEAD)** : choisir `PLAYER_HEAD` comme material d'un state révèle une ligne « tête custom » sous le sélecteur de material. Un select choisit la source (`HeadDatabase` / `Base64` / `Player name`) et un champ de valeur apparaît à côté. Coller `hdb:<id>` ou une chaîne brute `eyJ…` détecte la source automatiquement. Choisir la source `playerhead` sur un champ vide écrit directement `playerhead:{player.name}` — le placeholder de contexte du joueur qui ouvre le menu, le cas courant — et un bouton « Joueur actuel » réinsère ce placeholder quand la valeur a été remplacée par un pseudo littéral (`VIEWER_HEAD` dans `features/canvas/item/headField.ts`). `headPreviewUrl` convertit base64 et noms littéraux en rendu 3D mc-heads.net ; `useHeadPreviewUrl` ajoute la résolution HDB via le serveur actif (`GET …/head-texture?id=…`). Cache mémoire par network/serveur/id, demandes identiques mutualisées, succès réutilisable 10 min et échecs retentés après 30 s tant que l'aperçu est monté ; anciennes réponses isolées lors d'un changement de serveur. HDB absent, tête inconnue ou placeholder non résolu → icône générique. Le hook alimente slots Konva, ghosts, overlays, cartes de state et sélecteurs de material.

- **Têtes vanilla en 3D** : les cubes de tête de `mcModelRenderer.headDef` utilisent `yFlip: false` : le découpage du skin place déjà le visage au sud et le dessus en haut. Les retourner exposait une face omise au-dessus et le visage à l'arrière. Le test de géométrie passe par `renderToCanvas` et vérifie par rayons la surface supérieure et les UV du visage.

### Formulaire d'action piloté par les déclarations (`properties/ActionEditor.tsx`, depuis 2026-10-15)

Une action du domaine est `{ name, value }` (`domain/types.ts`) : le nom du wire et sa valeur canonique, textes en nœuds `LText{key}` aux emplacements `ltext` — actions core et de module sans distinction (ADR `extensible-document-kinds`, W4). Tout lecteur passe par la déclaration (`CORE_ACTIONS` importé de `testdata/core-actions.json` ∪ `declared_actions` du serveur, `useDeclaredActionOf`) via `domain/actionArgs.ts` : `normalizeActionArgs` (valeur wire → map d'arguments, règle du serveur : `null` = aucun, map dont les clés sont déclarées = la map, sinon le primaire), `canonicalActionValue` (map → forme la plus courte : requis toujours écrit — défaut déclaré s'il manque —, optionnel à son défaut omis, primaire seul nu, sinon map ; `null` si rien), `actionArgs(action, decl).get/set`, `withActionArg`. Les refs de Document sont des arguments `document_ref(kind)` (R3) : `actionDocumentRefs` / `walkDocumentRefs` alimentent `deriveEdges`, le presse-papiers (`remapAction`), `setMenuId` et `previewCallContexts` — aucun d'eux ne connaît `open_menu`.

- **`ActionEditor`** rend `DeclaredActionForm` : une ligne par argument déclaré, libellé `actionEditor.args.<action>.<arg>` (repli : nom de l'argument), aide `actionEditor.help.<action>.<arg>`, hint `actionEditor.hints.<action>` pour une action sans argument. `ArgInput` choisit le widget par kind : `ltext` → `TextArgInput` (clé existante ou littéral, retirable si optionnel), `document_ref` → `MenuRefInput` (dropdown titré, autres projets du serveur qualifiés `project:id`) ou `KindRefSelect` (select par `documentsOf(project, kind)`), `map(string)` à côté d'un `document_ref` → `ContextMapInput` (inputs de contexte de la cible), `list(ltext|string)` → `ListArgInput`, `number`/`integer` → `NumberInput` (`NUMBER_BOUNDS`), `boolean` → case, `enum` → segments (≤ 3 valeurs) ou select, `string` → `Input`. `ARG_WIDGETS` surcharge par `"<action>.<arg>"` : `MaterialInput` (give/take_item), `SoundInput`, `IterableTargetSelect` (pagination), `ExpressionInput` (commande, `set_arg.value`, listes de cycle, `run_actions`). Une action non déclarée (module hors ligne) s'édite en JSON brut (`JsonValueInput`). Ajouter une action core au formulaire = la déclarer dans `CoreActions.kt` (vecteur régénéré) + ses libellés `en.ts`/`fr.ts` ; une action de module n'a rien à ajouter côté éditeur.
- **Éditeur d'Action chain** (`features/inspector/chain/`) : un seul `StepTree` (lignes et blocs `if` dans `StepRows.tsx`) pour toutes les chaînes. Une chaîne du projet est adressée par `ChainAddress` (`domain/chainAddress.ts` : `element` {menu, élément, state, clic} | `command` | `dialogButton`) ; `ActionChainEditor` la rend et `storeChainOps` route chaque édition vers les reducers de son propriétaire (pas d'`if` sur un bouton de dialog, `chainAllowsIf`). `ControlledStepsEditor` (données de module) passe le même arbre avec `controlledChainOps` (valeur + `onChange`, immer). Ligne d'action : résumé générique depuis la déclaration (primaire d'abord, puis `k=v`, `(k)` pour un drapeau vrai ; `ltext` rendu en MiniMessage) ; `AddStepLine` liste `ACTION_TYPES` (les noms de `CORE_ACTIONS`) et seed par `defaultDeclaredAction` (`features/inspector/chain/defaults.ts` : `CORE_SEEDS` + défauts déclarés + premier menu pour un `document_ref` requis).
- **DSL legacy** : `lib/actionDsl/ast.ts` garde son AST typé (`DslAction`, verrouillé par `testdata/action-dsl-conformance.json`) ; `domainSteps.ts` le projette vers `{name, value}` et inversement. `lib/i18nMigration.ts` replie la forme typée (`{type, menuId…}`) d'un projet persisté avant W4 par le même adaptateur.

### Kinds de Document contribués par un module (`FrontendModule.documents`, lot 5, depuis 2026-10-15)

Un module déclare ses kinds de Document dans sa `FrontendModule` (`documents: DocumentKindContribution[]`, SDK) : `kind`, `dir`, `schemaVersion`, `idPrefix`, `label` (clé i18n de l'hôte ou libellé), `icon`, `component` (la vue du panneau Propriétés, `{projectId, documentId, document, item?}`), `title(doc, {project, lang})`, `listByTitle`, `create({id, projectId})`, `parse`/`serialize` (le codec du fichier), `ltextSites(doc)` (ses textes, pour Traductions, le rekey au déploiement et le GC), `chainSlots(doc)` (ses chaînes d'actions : `{name, steps, prefix, label?}`, pour les arêtes et l'adressage des textes d'action), et `board` (`size`, `summary`, `render`, `items`). Les kinds core (menus, commands, dialogs) sont déclarés de la même façon (`src/modules/{menus,commands,dialogs}/*Kind.tsx`) — dogfood ; le registre SDK refuse un kind contribué par deux modules.

- **Pont hôte** — `lib/moduleDocumentKinds.ts` : `registerEditorModule(mod)` est la seule porte d'entrée d'un module (`main.tsx` pour le core, `modulesStore` / `ConfigScreenPage` pour les modules gated par la Presence) : il enregistre le module dans le SDK et pousse chaque contribution dans les registres que l'hôte lit déjà — table des kinds (`domain/documentKinds.ts`, rang après les kinds core, dossier et schéma vérifiés si le kind est déjà connu), codecs de fichier (`schema/documentCodecs.ts`), visiteurs (`domain/documentKindVisitors.ts`). Le domaine ne connaît pas React : la vue, le libellé et les surcharges de planche restent sur la contribution, lues par `documentKindContribution(kind)` (SDK) depuis les surfaces qui rendent.
- **Panneau Propriétés par registre** — `selectionContext` renvoie `{ kind: "document", documentKind, id }` pour un Document d'un kind non-core ; `SelectionInspector` résout `documentKindContribution(kind).component` pour menu / command / dialog / document et le rend dans un conteneur `h-full min-h-0 overflow-y-auto` ; sans module enregistré (une surface rendue seule, un test), les éditeurs core intégrés répondent encore ; sans vue, `projectPanel.noEditor`. Le bouton YAML suit : `documentRelPath` = `<dir du kind>/<id>.yaml`.
- **Listings** — `buildProjectDocuments` : un groupe par kind du registre (ordre du registre) puis les kinds présents sans module ; libellé = id, ou le `title` si `listByTitle` (les commandes) ; `documentLabel` passe par le `title` de la contribution. `ProjectDocumentTree` prend icône et libellé de la contribution (repli `FileText`, `t(label, {defaultValue})`) et offre une entrée « + » par kind de module → `NewDocumentDialog` (préfixe d'id, conflit via `hasDocument`, `createDocument`). Les quatre dialogs « nouveau Document » valident l'id de la même façon (`features/canvas/newDocumentId.ts`, via `hasDocument` : unique dans tout le projet, kinds de module compris) ; menu, dialog et kind de module partagent `NewPrefixedIdDialog`, la commande dérive son id du nom (`useUniqueDocumentId`, suffixe `_1`, `_2`…). La palette de recherche indexe un Document par kind (`group` = le kind) ; le compteur de la barre latérale et `liveDocumentIds` lisent la façade (`documentCount`, `documentIds`).
- **Store** — `state/projects/documentsSlice.ts` : `createDocument({projectId, kind, id, position})` (seed `create`, textes frappés à leurs clés canoniques par `mintLTexts` sur `ltextSites`), `updateDocument` (remplacement entier, pour la vue d'un module), `setDocumentId({projectId, kind, oldId, newId})` (id, `rekeyDocument`, layout, arêtes, groupes, **chaque `document_ref` de ce kind** repointé via `walkDocumentRefs` sur tous les `chainSlots`, `recordRename` du fichier). Les kinds core gardent leurs reducers dédiés.
- **i18n et arêtes** — `visitProjectLTexts`, `visitProjectStepChains`, `rekeyProject` et `gcDocumentLTexts` itèrent `allDocuments` × visiteurs : un kind de module est traduit, re-clé et nettoyé comme un kind core. `deriveEdges` ajoute un trigger `{ kind: "chain", documentId, slot, label? }` par `document_ref` trouvé dans un slot de chaîne d'un kind non-core ; `EdgeTooltip` l'affiche.
- **Planche : aperçu seulement** — `DocumentGroup` (Konva) est le nœud de tout kind non-core : chrome de l'hôte (boîte `board.size` ou `DOCUMENT_BOX` 140×48, id, ligne `board.summary` ou le kind, sélection, drag, double-clic → vue individuelle) autour d'un `board.render` optionnel — un composant **react-konva**, rendu dans un `Group listening={false}` : rien dedans ne reçoit de pointeur. `board.items(doc, ctx)` (SDK 1.2) liste les parties du Document sous l'en-tête (titre `title`, puis `id · summary`), une ligne `{id, label, detail?}` chacune, dessinée par l'hôte : le nœud grandit avec les lignes (`documentBoxSize`, `DOCUMENT_ITEMS`), un clic sélectionne la partie comme un élément de menu (`ids = {item}`, `menuId` = id du Document) et `selectionContext` rend `{kind: "document", …, item}`, que le panneau passe à `component` en `item`. SDK 1.5 : une ligne peut porter un `marker` (pastille avant le libellé : son rang quand les parties s'enchaînent ; quand toutes en ont un, une ligne relie les pastilles) et un `hover` (`{title?, text?, lines?}`, MiniMessage) que `DocumentItemTooltip` affiche au survol (`state/documentItemHoverStore.ts`, monté par `Stage`) ; `board.accent` colore le nœud (bordure, bandeau d'en-tête). L'édition se fait dans le panneau Propriétés. `nodeBox`, `Edges`, `serverGraph` (nœud + cible de ref) et `ServerCanvasPage` (chip de filtre libellé par la contribution) connaissent le kind par le registre. **Exception core, à ne pas généraliser** : l'édition en place des menus sur la planche (slots, calques, dépôts d'items, branches `focus` de `Stage`) est propre au kind menu et le reste ; un kind de module n'édite jamais sur la planche.
- **Kind non synchronisé (W6)** : le serveur rapporte ses kinds à la Presence (`document_kinds`, `GET …/document-kinds`), chargés dans `state/serverDocumentKindsStore.ts` depuis `__root.tsx`. `isKindSyncedOn(state, kind)` vaut faux pour un kind que le serveur actif a répondu sans lister (jamais pour une réponse absente : plugin antérieur) ; `DocumentGroups` marque alors l'en-tête du groupe (point ambre, `title`), `NewDocumentDialog` affiche `canvas.kindNotSynced`. Les kinds core ne sont jamais marqués.

### Vues de module chargées à l'exécution (depuis 2026-10-17, ADR `runtime-editor-modules`)

Un module peut servir sa vue depuis son jar au lieu de la copie compilée dans l'éditeur.

- **Chargement** — `state/modulesStore.ts` : pour chaque module actif, le bundle annoncé (`installed_modules[].editor_bundle`, `lib/api/modules.ts`) passe d'abord par `distribution/runtimeBundle.ts` : contrôle de version (`sdkCompatibility`, refus avant téléchargement), `fetch` de `…/modules/:module/ui.js?v=<hash>`, réécriture des imports partagés (`es-module-lexer/js`) vers des modules `blob:` qui réexportent les instances de l'éditeur (`distribution/sharedModules.ts` : `react`, `react-dom`, `react/jsx-runtime`, `@artisan/editor-sdk`), import du bundle en `blob:`, vérification de l'export par défaut (`id` = module servi, `sdk` compatible). Refus ou échec → entrée de `modules.manifest.ts` si elle existe ; `origins` / `refused` le disent. Un bundle annoncé `local: true` (lu par le serveur depuis un fichier, `dev.editor-bundles` d'environment.yml, `LocalEditorBundles.kt`) a l'origine `local`, et `components/LocalBundlesNotice.tsx` le signale en haut de la page. Un module en échec ne bloque pas les autres.
- **Hôte du SDK** — `lib/editorHost.ts`, installé dans `main.tsx` avant tout module : `useProject`, `useContentLang` (`uiStore.activeLang`), `useUiLang` (`uiStore.editorLang`), `updateDocument` (`documentsSlice.updateDocument`, qui accepte `texts` : Document et textes en un pas d'annulation), `newTextKey`, `textValue`, `fieldText` (`schema/fieldText.ts`), `projectLangs`, `selectDocumentItem` (SDK 1.2 : sélectionne une partie `board.items` du Document, ou le Document avec `item: null`), `notify` (sonner), et `components` (SDK 1.1, `distribution/hostComponents.tsx`, passé à `installHost` par `main.tsx`) : `ActionChainEditor` → `features/data/ActionFieldEditor` (chaîne au format fichier, texte littéral), `MaterialInput` → `features/canvas/MaterialField` (aussi utilisé par l'argument `material` des actions), `ItemInput` (SDK 1.3) → `features/canvas/item/ItemSpecField` : le formulaire d'item des menus (`ItemEditor`) sur une spec d'item littérale (`material` vanilla, custom ou `item:<id>` capturé, `title`, `lore` en lignes, champs avancés) et, avec `onMatchChange`, les critères de comparaison (`domain/itemMatch.ts`, ceux d'`ItemComparison` côté plugin) cochés par défaut d'après l'item (`defaultItemMatch`, miroir de `defaultComparisons`) ; décocher écrit une liste `match` explicite. Le bloc (`MatchCriteria`) a deux modes, « Copie exacte » (`[exact]`, qui englobe tout) et « Selon les critères » : ceux-ci listent ce que porte l'item avec la valeur comparée (`itemMatchFacts`), l'identité (`custom_item` pour un item custom, sinon `material`) verrouillée une fois cochée ; les critères sans valeur à comparer (sans nom, sans lore…) sont repliés sous « Plus de critères », ouverts quand l'un est coché. Format `match` inchangé. `MiniMessageInput` (SDK 1.4) → `components/MiniMessageField` : le champ MiniMessage commun (`RevealField` : rendu, puis source + rendu en direct dessous), aussi utilisé par les arguments `minimessage` des actions et le texte littéral d'une chaîne de module.
- **Libellé d'un kind** — `contributionLabel` (`lib/moduleDocumentKinds.ts`) : `labels[langue de l'interface]`, sinon `label` lu comme clé i18n de l'hôte ou littéral ; utilisé par l'arbre, la palette, la planche serveur et `NewDocumentDialog`.
- **Kind arrivé tard** — `adoptLateDocuments` (`schema/projectFromFiles.ts`, action `adoptLateDocuments` du store) lit les `<dir>/<id>.yaml` restés dans `moduleData[<dir>].__files` quand un kind est enregistré après la lecture du Project ; `__root.tsx` l'appelle sur chaque Project ouvert quand `modulesStore` passe à `ready`, et `useProjectLoader` à l'installation d'un Project (le kind a pu arriver pendant sa construction, après la lecture de ses fichiers : cas typique d'un Project rouvert depuis le cache).
- **Construire** — `@artisan/editor-sdk/bundle` (`artisanModuleBundle`) donne la config Vite d'un bundle. Un module hors du dépôt prend le SDK par `npm pack` de `packages/editor-sdk` ; exemple : la vue des quêtes, dans le dépôt MSQuests (`editor/`), pas dans l'éditeur.

### URLs et identité des projets (2026-09-14)

`projectUrlId` choisit exactement `externalId ?? diskId ?? id` ;
`projectDestination` compose les routes serveur, hébergées et démo sans lookup
global. Les liens de documents, recherche, add-ons, import et copie l’utilisent.
Le loader transmet Network + serveur à la résolution d’identité, puis utilise
uniquement l’ID interne pour le contenu et les brouillons. Le cache inclut
l’utilisateur, le Network, le serveur et la référence URL.
`ResolvedProjectContext` donne cette ancre à la vue de document ; celle-ci ne
cherche jamais un nom public parmi les projets chargés. Après résolution, une
ancienne URL est remplacée par l’ID courant en conservant document, query et hash.
La démo résout `/demo/projects/demo` via sa session et transmet son ancre au
même workspace. Un renommage modifie l’URL mais garde les buffers et leur base CAS.
`onProjectRenamed` actualise également le nom dans le compte et l’identité en
cache lorsqu’il correspondait à l’ancien ID de dossier. Les libellés de la
sidebar et des propriétés suivent ainsi le renommage ; un nom personnalisé
distinct est conservé et la relecture retrouve le même nom en base.
Le champ ID de `ProjectProperties` affiche lui aussi `projectUrlId(project)`,
pas l’ancre interne immuable.

### Reconnexion d'un Project (depuis 2026-09-08)

`useProjectLoader` retente la lecture 15 secondes après chaque réponse
`server_offline` / `network_error`, sans requêtes concurrentes ni reconstruction
répétée de l'affichage hors ligne. Une lecture réussie (y compris `unchanged`)
efface `offline` et `stale` ; les réponses tardives et timers sont ignorés à la
sortie du Project. Un brouillon modifié conserve sa base de compare-and-swap.
Depuis le 2026-09-13, une première ouverture attend une lecture serveur réussie,
même avec cache ou brouillon local. Une coupure préserve le buffer déjà ouvert ;
les échecs de transport backend et `fetch_timeout` sont également retentés.
Depuis le 2026-10-02, plus de bandeau : le badge serveur de la topbar porte l'état
hors-ligne et son infobulle (`downHint` de `LinkedServersDropdown`) en donne la
raison exacte (date de la copie, brouillon, jamais publié). L'état reste local à
la topbar du Project ouvert.

Depuis le 2026-10-16, l'état du loader est un reducer pur (`projectLoadState.ts`,
événements nommés `started` / `located` / `opened` / `settled` / `connectionLost` /
`readFailed` / `loadFailed` / `validated`, testé sans React) ; la lecture elle-même
(`readFromHub` → `readAndOpen`, `resumeDraft`, `settleOffline`) vit hors du hook.
`projectLoadStatus` dit ce que le workspace montre (`loading | ready | error`).

### Paramètres avancés d'un item (depuis 2026-07-29)

Sous le lore de chaque state card, `features/canvas/item/AdvancedItemSection.tsx` replie derrière un `<Collapsible>` tout ce qui dépasse material/titre/lore : **enchantements** (id + niveau, `datalist` sur le catalogue vanilla de `domain/itemAdvanced.ts` mais **saisie libre acceptée** pour le moddé), effet brillant sans enchant, custom model data, incassable, sections de tooltip masquées, **couleur** (affichée uniquement si le material est teintable — cuir / potion / étoile de feu d'artifice), et **NBT brut**. Un badge sur le trigger compte les valeurs posées (`countAdvanced`) pour qu'un item configuré ne cache pas sa propre configuration. Les mutations passent par l'action de store unique `setAppearanceAdvanced` (patch partiel ; une clé à `undefined` efface le champ).

Le format wire de ces champs et les conventions partagées avec le plugin sont dans `schemas-codegen.md` § « Détails avancés d'item ».

Les champs de modèle `item` utilisent `ItemValueField`, adaptateur du composant `ItemEditor` partagé avec les propriétés canvas. `ItemBindingEditor` choisit la source ; texte et quantité exposent héritage et réinitialisation. Les mentions d'héritage apparaissent uniquement si la base fournit une valeur pour le champ ; si la base porte du lore, une case « Remplacer le lore de l'item de base » et le bouton « Insérer le lore source » (qui écrit `{base.lore}`) apparaissent. `resolveItem` résout récursivement `extends` (ref ou objet), puis applique les surcharges avec un snapshot `base` (titre/lore/count/material). **Le lore de base est conservé par défaut** : le lore explicite s'ajoute dessous, quelle que soit la forme de la source. Il n'est écarté que sur `lore_mode: replace` (la case) ou quand `{base.lore}` figure dans le texte — le placeholder le positionne alors lui-même, sans doublon. Un lore explicite vide n'efface donc plus rien sans la case. Le plugin suit la même composition ; les références circulaires sont bornées. Les champs Material préservent la casse des refs et expressions.

Le hook SDK optionnel `FrontendModule.migrateProject(project)` s'exécute après injection des modèles, dans le loader projet et les copies temporaires des écrans de configuration. Boutique déplace le lore historique dans `icon` et retire le champ du modèle effectif, même sans menus chargés. Les templates liés remplacent `{alias.lore}` par `{base.lore}` — le placeholder suffit à positionner le lore, sans remplacement explicite. Après une sauvegarde catalogue seule, les resolveurs TS/Kotlin reconnaissent encore cet ancien placeholder lorsque la row n'a plus de lore et que son icône étendue en porte : ils insèrent le lore complet une fois à cette position. Les écrans live écrivent les textes d'item dans la langue par défaut de leur copie, car leur sauvegarde transporte uniquement les fichiers de la table.

`ItemEditor` garde une carte compacte (texture/tête résolue, titre, count, trois lignes de lore, enchantements) et ouvre ses champs dans le `Dialog` partagé du design system. Le corps défile ; « Terminé », la croix ou Échap ferment la modale et restituent le focus à la carte, sans sauvegarde distincte. Les adaptateurs catalogue/menu partagent aussi `HeadField`. Les actions propres au menu passent par le slot `details`, visible seulement pendant l'édition. Un écran déclaré charge son module avant de construire le formulaire, pour exécuter ses migrations même si le chargement global de présence n'a pas fini.

`ItemContextSidebar` affiche les mêmes entrées contextualisées que l’autocomplétion de `ItemEditor`, avec les champs `base.*`, regroupement par origine, recherche et copie entre accolades (erreur explicite si le presse-papiers échoue). Le panneau passe sous le formulaire sur écran étroit et reste repliable. Il ouvre `PatternsGallery` dans une Sheet imbriquée : fermer l’aide conserve la modale et les champs montés.

Les champs texte des actions (commande, contexte passé à `open_menu`, valeur de `set_arg`, messages, titres) utilisent le même `PlaceholderInput` et le même catalogue (`lib/placeholderCatalog`) que le lore : indication « Tape { », autocomplétion, pas de barre d'insertion. Un clic d'élément passe sa `FieldLocation` `action` ; les étapes d'une commande la reçoivent par `ActionScopeProvider` (`{ kind: "command" }` → arguments + `{player}`) ; ailleurs, seul `{player}` est proposé. Le catalogue expose l'alias d'un élément en `iterates` **ou** `places`, y compris sur une source serveur (schéma rapporté) ou une ref directe `ns:id`. Seul `ItemEditor` ajoute `base.*`, qui n'existe qu'au rendu d'un item. Le catalogue ne propose que ce que le plugin fournit : ni `{slot}`, ni `{material}`, ni `{pagination.*}` (l'aperçu canvas lie encore `pagination`, pas le runtime). Il propose en revanche partout (menu, élément, action, dialog) les placeholders de navigation `{has_previous_menu}` (booléen, pour conditionner un bouton retour) et `{previous_menu}`, `{previous_menu.id}`, `{previous_menu.title}` — alimentés au rendu par l'historique de navigation du joueur.

La modale `ItemEditor` occupe toujours `100dvh - 2rem` ; son corps flexible remplit la hauteur restante entre le titre et le footer, tout en conservant les scrolls indépendants.

Sur desktop, le formulaire et `ItemContextSidebar` défilent indépendamment dans une grille bornée ; `contain:size` empêche le catalogue de déterminer la hauteur de la modale. Sur mobile, le panneau reste sous les champs avec une hauteur maximale de 20 rem et son propre scroll.

La copie d’un placeholder affiche une coche sur le bouton concerné pendant 1,5 s, sans message de succès séparé ; le timer est nettoyé au démontage.
Le bloc `ItemBindingEditor` affiche un champ Icône compact (miniature + libellé). Les liaisons affichent leur chemin exact (par exemple `item.icon`), sans traduction ni interprétation des termes propres aux modules. Son picker regroupe Catalogue (liaisons `Appearance.item`) et Bibliothèque (items fixes). `itemBindingOptions` suit les modèles des inputs et les alias d'itération/placement ; seules les feuilles `item` sont proposées. Les modules déclarent `dataSourceModels` pour typer leurs sources même sans schéma serveur. Quantité et enchantements affichent les valeurs du catalogue et un reset après personnalisation ; l'expression reste dans un volet avancé.
Avant `FrontendModule.localPreviewRows`, l'hôte résout les `LText` des `dataSources` dans la langue d'aperçu et avec les traductions du projet propriétaire. Boutique peut ainsi assembler le lore sans convertir les références en `[object Object]` ; ses rows incluent `price_display` formaté et les items imbriqués des catégories.

**Lore additif par défaut** (révision 2026-09-17, additif depuis 2026-08-06). Les lignes de l'apparence s'ajoutent sous celles de l'item — `extends` compris, qui imposait le remplacement — et son titre explicite remplace celui de la base (`MenuRendererCapturedLoreTest`, `MenuRendererItemValueTest`). Remplacer demande `lore_mode: replace` ; `{base.lore}` reste disponible pour choisir la position. `normalizeBaseLore` (appelé en fin de `projectFromFiles`) retire les `{base.lore}` de TÊTE écrits du temps où il fallait réclamer le lore de base — dans toutes les langues d'un site, et dans les valeurs d'item des rows, où une ligne est un nœud LText adressé par sa position. Un token ailleurs qu'en tête, ou présent dans une seule langue, reste intact. Un champ absent conserve toujours la valeur héritée.

**Extraction d'un item capturé.** Reste l'échappatoire quand on veut *éditer* ce que l'item porte. Le bouton « Extraire les détails » (visible seulement sur ces refs) parse le `stackYaml` via `domain/capturedStack.ts` et **éclate la ref en champs réels** — material, count, titre, lore et tout le bloc avancé. L'opération demande confirmation car elle est destructrice au sens du lien : le slot ne suit plus l'item capturé s'il est recapturé. C'est le compromis assumé : la ref est vivante mais opaque, les champs sont morts mais éditables.

**Glint.** `SlotItem` dessine un halo violet + une étoile `✦` en haut-gauche (le compteur de stack occupe le bas-droite) quand l'apparence porte des enchants ou le flag, **ou** quand la ref capturée en porte (`resolveDisplayRef` interroge le stack sérialisé, pas seulement le descripteur `.artisan/editor.yaml` — les vieilles captures et les items écrits par un module n'ont pas de descripteur). Ce n'est **pas** une réplique du shader vanilla : teinter uniquement les pixels opaques du sprite demanderait un filtre Konva caché par slot, ce qu'un menu à 54 slots ne peut pas payer. Le marqueur est sans ambiguïté à cette taille, ce qui est le besoin du canvas. `ItemTooltip` liste en plus les enchantements entre le nom et le lore, à l'orthographe vanilla (`Sharpness V`, pas de numéral pour les enchants mono-niveau).

## Canvas component layout (refactor 2026-06-02)

`features/canvas/MenuGroup.tsx` (1066 → 591 lignes) éclaté : `SlotItem.tsx`, `PaginationControls.tsx`, `menuFanout.ts` (fanout positionnel pur, testé), `useMenuClick.ts` (armed-material tap-to-place), `useMenuDrag.ts` (cross-project via project-mini DOM walk), `useSlotDrag.ts` (selection drag + Alt).

`features/canvas/Stage.tsx` (528 → 351 lignes) éclaté : `ArmedBanner.tsx`, `useStageTouch.ts` (long-press → context menu), `useStageContextMenu.ts`.

Depuis le 2026-10-16 (Stage était remonté à 791 lignes) : `useStageBoard` (table `layout` planche / focus + glissement de groupe), `useStageFraming` (viewport restauré, persisté, cadrage focus `refitFocus`, `centerRequest` ; `useElementSize`), `useHeldPanKeys` (Espace / Alt), `useStageDropTargets` (les trois registres mono-locataires + ancre de collage), `StageContextMenu` (menu contextuel branché sur les commandes canvas). Ce que seule la planche possède vit dans `BoardChrome.tsx` : `BoardChrome` (état vide, contrôles de groupe, minimap), `BoardGroupsLayer`, `useBoardCreation` + `BoardCreationDialogs` (créer « ici »). Le focus n'en monte rien ; `Stage` ne garde que le noyau commun (~400 lignes).

Depuis le 2026-10-16 (MenuGroup était remonté à 855 lignes, un composant de 772) : `menuSlots.ts` (pur, testé : `resolveMenuSlots` — contenu de chaque slot, itération paginée, placements, fanout — `paginationContext`, `edgeTriggerPositions`), `useSlotPointer.ts` (clic / tap sur un slot : dépôt de la ligne de placement armée ou du matériau armé, sinon sélection), `useMenuPreviewSnapshots.ts` (snapshots live des sources du menu), `MenuBackground.tsx` (texture vanilla / fenêtre transparente), `SlotDragGhosts.tsx`. `MenuGroup` : 397 lignes.

Note : cible ≤250 pour Stage non atteinte (399) — le noyau commun planche / focus y reste.

### Clic droit et sélection multiple (depuis 2026-10-05)

Konva émet `click` pour **tous** les boutons : `usePrimaryButtonOnly` (branché sur le wrapper du
`Stage`) avale en capture les `pointer/mouse down/up` non primaires, sinon le clic droit réduisait la
sélection avant `contextmenu`. Ctrl/⌘/Shift+clic sur un item → `selectionStore.toggleElement(id,
menuId)` : sélection d'items d'**un seul** menu, jamais le menu lui-même (repart à zéro si autre menu).
`useStageContextMenu` garde la sélection (cible `entity`) quand le slot visé porte un item sélectionné
ou un menu d'une sélection de nœuds. `deleteSelection` (`useCanvasKeyboard.ts`, menu contextuel + Suppr)
supprime items et nœuds, en épargnant le menu qui contient les items sélectionnés.

### Coller des items à un slot (depuis 2026-10-04)

`pasteFromClipboard(projectId, onError, anchor?)` (`useCanvasKeyboard.ts`) accepte un `PasteAnchor`
`{ menuId, position }`. Ctrl/⌘+V le calcule via `Stage.getPasteAnchor` (dernière position du curseur
sur le wrapper → `screenToWorld` → `hitTestSlot`) ; le clic droit sur un slot propose « Coller ici »
avec le slot visé. Avec ancre : le menu ciblé est celui de l'ancre (prioritaire sur la sélection), et le
groupe copié est décalé linéairement pour que sa plus petite position tombe sur l'ancre (disposition
relative conservée). Slot pris → premier groupe libre après lui (`findFreePositions`) ; élément qui
sortirait de la grille → ses positions copiées. Sans ancre (curseur hors d'un slot) : comportement
historique (`resolveTargetMenu` + positions d'origine). Duplicate (⌘D) n'utilise pas d'ancre.

## Types d'inventaire (Chest / Hopper / Dropper, depuis 2026-06-14)

Un menu est un coffre (défaut), un hopper (5×1) ou un dropper (3×3). La **single source of truth** est la table `INVENTORY_TYPES` dans `features/canvas/inventoryTypes.ts` : par type elle porte `cols`, les `rows` fixes (`null` pour le chest = `menu.rows`), l'origine du slot 0 en px MC (`firstSlotX/Y`), la hauteur de box (`null` = calculée depuis les rows pour le chest), la clé texture et le type Bukkit. Helpers : `colsFor`, `rowsFor`, `slotCount`, `slotMcXY` (stride constant `MC_SLOT_STRIDE = 18`).

**Title composer width-agnostic** : les trois GUI conteneurs vanilla font **176 px MC de large** avec le titre à `(8, 6)`. Seules la **hauteur de box** et la **grille de slots** varient par type — aucune paramétrisation de largeur n'est nécessaire dans le title composer.

**Fonds (`MenuGroup`)** : le chest utilise la texture deux-tranches `generic_54.png` (header + slice de lignes répétée). Le hopper et le dropper utilisent une **image de box complète** (`hopper.png` / `dispenser.png`). `MenuGroup` branche via `usesSingleBackground(type)`.

**Hit-test + drag paramétrés par type** : `hitTest.ts` et `useSlotDrag.ts` lisent cols / origine / rows depuis la table — plus aucun hardcode des 9 colonnes du chest.

**Inventaire du joueur (`player_inventory`, 2026-09-25)** : `Menu.playerInventory` (absent = `visible`, stocké seulement si `hidden`). En `hidden`, les positions `size..size+35` (rawSlot protocole) sont éditables sur les 4 lignes vanilla sous le menu : `slotMcXY(i, type, rows)` place les positions `≥ slotCount` sur ces cellules (`playerInvY` par type, `null` = après les lignes du coffre ; +4 px avant la barre rapide), `positionCount` donne le nombre adressable (`MenuGroup`, clavier, `MenuProperties`), `hitTestSlot` les retourne. Les déplacements de sélection passent par une grille visuelle (`positionToCell` / `cellToPosition` : lignes du menu puis 4 lignes de 9) au lieu de `% cols`. Redimensionner le menu ou changer de type **décale** les positions joueur (`shiftPlayerPositions` dans `projectsStore`) pour que chaque bouton reste sur le même slot joueur ; le refus de rétrécissement ne porte plus que sur les positions du menu. Les image buttons restent limités à la grille du menu.

**Texture par défaut (`vanilla_texture`, 2026-09-25)** : en mode titre composé, `VanillaTextureLayer` est la première ligne fixe de `LayersPanel` (non déplaçable, non supprimable) avec un `Switch` (`components/ui/switch.tsx`, spécimen `/design`) — l'œil des layers reste un masquage d'aperçu, le `Switch` un réglage enregistré qui change le jeu. Désactivée (tous types de conteneur), `MenuGroup` ne dessine plus la texture mais `transparentOutline(type, rows)` : cadre pointillé (garde une forme de hit pour le drag) et cellules de slot en traits légers, menu **et** 36 slots joueur, selon la géométrie du type. Repasser en titre vanilla réactive la texture.

**Switch de type = keep+warn** : `MenuProperties` expose un sélecteur de type (Chest / Hopper / Dropper) ; le sélecteur de rows n'apparaît que pour le chest. Passer à un conteneur plus petit **conserve** les éléments hors-plage et affiche un chip d'avertissement — jamais de suppression silencieuse (`setMenuField` keep+warn).

## Canvas edges (liens entre nœuds)

Les liens menu/commande/dialog sont dérivés des actions (`deriveEdges.ts`, inchangé) puis
routés par `edgeRouting.ts` (pur, testé) : côté de sortie/entrée choisi par `autoSide` —
deux nœuds côte à côte (écart horizontal) se relient toujours par leurs côtés gauche/droit,
deux nœuds empilés dans une colonne par haut/bas, axe dominant sinon. Les ancres auto d'un
même côté sont **centrées** et réparties symétriquement tous les `ANCHOR_GAP_PX` (24 px,
resserré si le côté est trop court, marge coins 10 px), dans l'ordre de la position du nœud
opposé pour éviter les croisements (depuis 2026-09-25 ; avant, chaque ancre visait la
projection du nœud opposé, ce qui la collait aux coins). Tracé bézier cubique à tangentes perpendiculaires
au bord (longueur ∝ distance, clamp 24–160 px). Rendu : `Edges.tsx` en Konva `Arrow`
(tête de flèche côté cible), hover → `EdgeTooltip`, clic → sélection + 2 poignées
draggables le long du bord (snap périmètre via `closestAnchorOnBox`).

Overrides manuels : `project.canvasEdges[edgeId] = { from?, to? }` avec
`EdgeAnchor = { side, t∈[0,1] }` (ratio → survit au resize). Edge id = `"source->target"`.
Les overrides sont des pins exacts : jamais écartés par la séparation auto — deux ancres
manuelles peuvent se superposer ; seules les ancres auto cèdent le gap minimal
`ANCHOR_SEP_PX` (16 px) à une ancre forcée trop proche. « Réarranger » les libère toutes
(`releaseBoardPositions` conserve les ancres internes aux groupes et libère celles de la planche ; `rearrangeCanvasGroup` libère seulement les ancres internes du groupe visé).
Actions store : `setEdgeAnchor` / `clearEdgeAnchor` (double-clic poignée = reset) ;
pruning sur `deleteFromProject`, rekey sur rename d'id (`setMenuId`/`setCommandId`/`setDialogId`).
Persistance : `edges` + `layout` dans **`.artisan/editor.yaml`** (fichier
d'état éditeur hash-exclu — un déplacement de carte ne redéploie plus le
serveur ; ADR `files-first-source-of-truth` #3). Legacy : `editor_layout` /
`editor_edges` dans `manifest.yaml`, toujours lus en fallback par
`projectImport.ts`. Le plugin n'uploade jamais `.artisan/*` ; le backend
préserve ses copies aux deux points d'ingestion (`local_push`, `POST
/bundles`).

## Planche curée + panneau + vue individuelle (depuis 2026-06-13)

Cf. `docs/superpowers/specs/2026-06-13-workspace-board-curation-design.md` (supersède le focus mode de `2026-06-02`). Le canvas n'est plus un canvas libre qui force tout en grille : c'est une **planche curée**, doublée d'un panneau source-de-vérité et d'une vue individuelle deep-linkable. **Invariant n°1** : un seul rendu/éditeur par type de Document, partagé entre planche et vue individuelle — c'est ce qui supprime la divergence qui avait causé le revert du focus mode. **Étendu 2026-09-05 aux *hôtes*** : un seul rendu par type de Document, et autant d'hôtes que de sémantiques distinctes, pas un de plus. La planche et le focus partageaient bien `MenuGroup`, mais avaient deux hôtes de stage pour une sémantique identique — d'où la re-divergence (cf. « Mode focus »).

### `canvasLayout` = positions fixées (planche dérivée, depuis 2026-09-25)

**Révise la curation du 2026-06-13** (spec `docs/specs/server-registry-and-derived-canvas.md`, décision 5). La planche montre **tous** les Documents du project, arrangés automatiquement ; `canvasLayout` ne liste plus les membres, il garde seulement les positions posées à la main (un glisser-déposer écrit une position fixée). Les anciennes entrées de `canvasLayout` deviennent donc des positions fixées, conservées à l'identique.

Les positions et modifications sont conservées par `useDraftSync` dans une copie
locale, puis sauvegardées automatiquement via le stockage résolu (voir ci-dessous). Après un enregistrement qui efface le brouillon,
la première modification conserve comme référence l'état précédent s'il correspond
exactement à la base enregistrée : la bascule Clés / Texte en clair doit ainsi
activer Enregistrer dès le premier changement. La normalisation au chargement
reste exclue des modifications utilisateur. Après réhydratation, les bases sont comparées par
contenu, jamais par identité d'objet : le rechargement ne doit pas reclasser un
brouillon modifié comme propre et le faire abandonner à l'ouverture suivante.
Les écritures locales en attente sont vidées sur `pagehide`, passage de la page
à l'état caché et démontage du hook. L'écriture sur le serveur reste explicite.

**Brouillons persistés (2026-09-13)** : `persistedDrafts.ts` charge les brouillons
privés après validation de l'ouverture, restaure la sélection et synchronise l'arbre avec
révision attendue. La copie locale est isolée par compte ; un ancien brouillon
sans identifiant backend devient une copie distincte. Un accusé de réception
ne remplace jamais les frappes effectuées pendant la requête. Un conflit de
révision conserve le travail local et bloque l'écriture jusqu'à création d'une
copie. **Les erreurs sont classées par le code du hub, jamais par le statut HTTP seul**
(`errorStatus`, 2026-10-14) : `draft_migration_pending` → `migration_pending` ; `draft_conflict`,
`draft_exists`, `draft_closed`, `conflict`, `operation_*` → `conflict` ; 5xx, 401, 408, 429 et
erreur réseau → `offline` (rejoué toutes les 15 s, mutation en attente conservée) ; tout autre
4xx (`forbidden`, `unknown_project`, `invalid_draft`…) → `rejected` : la mutation est effacée,
le même snapshot n'est **pas** renvoyé (empreinte gardée dans `session.rejected`), une modification
(`markDraftPending`) ou le bouton Enregistrer (`syncPersistedDraft(id, true)`) le renvoie. Seul
`draft_not_found` vaut « brouillon disparu » (`gone`) ; `draft_closed` pendant une sauvegarde
recharge la liste (`loadPersistedDrafts`) au lieu de rester en `conflict`. `PersistedDraftControls` (modale large, liste à gauche, diffs à droite) propose
copies nommées, sélection et comparaison base/arbre via `ChangeList`, depuis le chevron
de Déployer, sans bloc permanent dans la topbar.

**Enregistrer / Déployer (2026-09-18)** : deux gestes dans `SaveControls`.
Enregistrer (visible avec une session de brouillons) vide le debounce puis force
`syncPersistedDraft`. Bouton icône (disquette pleine `SaveFilledIcon`, `Spinner` pendant la
sauvegarde) : `Tooltip` selon le statut de session (`drafts.tooltip.*`), libellé court en
`aria-label`. Inactif via `aria-disabled` quand `saved` ou en cours, jamais `disabled` :
un bouton `disabled` ne reçoit pas le survol et n’afficherait pas sa bulle. Déployer garde
son libellé, précédé d’une icône lecture pleine. L'autosauvegarde du brouillon reste active. Déployer ouvre
`DeployReviewDialog` : base du serveur contre `projectTree` du Project vivant,
renommages et binaires compris. Seule la confirmation appelle `saveProjectToDisk`.
Les mutations portent un `operationId` et un snapshot figés dans le secours local
isolé par propriétaire : après ACK perdu, rejouer cette opération avant d'envoyer
les frappes suivantes. Un rejet définitif 4xx libère cette opération ; un échec
incertain la conserve. Les références `binaryBaseline`/`binaryTree` voyagent avec
les edits texte. `migration_pending` suspend la sauvegarde sans effacer le secours.
Lorsqu'un clic Déployer récupère le résultat d'une publication antérieure après
timeout, `saveProjectToDisk` avance la base vers ce résultat puis publie le brouillon
restant si la version demandée diffère. Le reçu ancien ne suffit pas à annoncer
la réussite des nouvelles modifications. Un échec de cette seconde publication
reste visible ; les modifications effectuées pendant l'envoi restent en brouillon.
Les ZIPs et arbres génériques excluent brouillons, transactions et marqueur de
renommage privés ; `.artisan/editor.yaml` reste partagé. L'import texte refuse
les binaires, dans l'attente du parcours portable complet.

Les échecs d'enregistrement ouvrent un `Dialog` avec raison traduite, code d'origine
et statut HTTP disponible, ainsi que le champ `message` fourni par le plugin.
`DraftApiError.detail` conserve ce message sans remplacer le code d'erreur.
`saveProjectToDisk` conserve ces diagnostics de publication
du brouillon ; `writeProjectFiles` les conserve pour l'écriture directe.
`SaveControls` intercepte aussi les exceptions de préparation. Le détail est copiable
et consultable dans le chevron jusqu'au prochain succès ou au démontage du contrôle.
La pastille rouge reste réservée aux états `offline` / `conflict` du brouillon.
Un listing de brouillons périmé ne remplace pas une révision confirmée par une
autosauvegarde pendant sa lecture. Un brouillon bloqué est relu avant synchronisation :
si son snapshot distant actif est strictement identique au local, sa révision est
réconciliée sans écriture. Une différence de contenu ou une édition pendant la lecture
maintient le conflit et préserve le travail local.
Un point sur le chevron signale seulement un conflit ou une sauvegarde non confirmée.
**Conflits à l'ouverture (2026-09-26, cloud — le hub ne rebase pas)** : le backend rendait le brouillon rebasé sur le
Snapshot et ses `conflicts` ; `loadPersistedDrafts`/`selectPersistedDraft` les posent
dans `session.openConflicts`, et `ProjectTopBarControls` ouvre la même modale que pour
un conflit d'enregistrement (`conflictSource: "open"`). Appliquer met à jour la base du
brouillon et le marque à sauvegarder, **sans publier** ; `consumeOpenConflicts` évite de
reproposer les mêmes conflits.
**Conflit entre deux sessions (2026-09-29)** : une écriture refusée en `409
draft_conflict` (l'autre session a avancé la révision) n'enchaîne plus des relectures
silencieuses. `persistedDrafts` rebase l'arbre local sur le snapshot distant
(`rebaseDraft`, module partagé avec le backend) : les fichiers que l'autre session a
seuls touchés sont repris en silence, les fichiers divergents deviennent
`session.draftConflict`, et `ProjectTopBarControls` ouvre la modale de conflit
(`conflictSource: "draft"`, bouton « Prendre celle de l'autre session »). Aucune
écriture n'est tentée tant que le conflit n'est pas tranché ; `resolveDraftConflict`
applique les choix, avance la révision locale et resynchronise (sans réécriture si tout
vient de l'autre session). Même détection au chargement quand la révision listée diffère
de la locale ; un rebase sans fichier divergent est appliqué d'office, sans modale.
La fusion est à trois voies depuis la dernière révision acquittée (`remote.base`, arbre
mémorisé à chaque acquittement), pas depuis le disque : un fichier déjà modifié dans le
brouillon partagé n'est pas un conflit. Elle ne touche **jamais** `baseline`, qui reste le
disque publié — y mettre le travail non publié de l'autre session le ferait omettre à la
publication et annuler par le rebase backend contre le Snapshot (correctif 2026-10-02).
**Onglets (2026-09-29)** : une écriture réussie est diffusée par `BroadcastChannel`
(`draftBroadcast`). Un autre onglet du même navigateur sans travail local recharge son
brouillon et l'arbre du Project tout seul ; un onglet avec des modifications voit le
conflit se présenter immédiatement. Le cross-appareil reste couvert par le `409`.
**Server-only (2026-09-27, ADR `server-only-projects`)** : plus de section « projets
hébergés », de copie vers Minecraft ni d'import ZIP ; la démo n'a plus de réclamation,
son bouton **Exporter** (`runExportDraftZip`) télécharge le brouillon courant (texte de
l'éditeur, images publiées ou privées). `useProjectLoader` expose `unpublished` ;
l'infobulle du badge serveur l'annonce quand le serveur n'est pas connecté.
**Serveur éteint (2026-09-26, cloud — le hub ne rend jamais `offlineSince`)** : `readProjectFiles` rend `offlineSince` ; `useProjectLoader` ouvre alors le Project en `offline` + `stale`, expose `offlineSince` et revérifie toutes les 15 s ; l'infobulle du badge serveur affiche la date de la copie. Depuis le 2026-10-02, plus de bandeau `ProjectStaleNotice` — l'état est porté par le badge serveur et son infobulle (`downHint`).
**Versions (2026-09-26, onglet depuis 2026-10-04 ; le hub rend une liste vide)** : la vue `?tab=history` du workspace
(`ProjectHistory`, 6ᵉ entrée de la nav, masquée sans `runtime.serverId` donc en démo) liste
les Versions — badge « Déploiement » (auteur) ou « Modif. serveur » (auteur `null`). « Voir les
changements » ouvre `VersionDiffDialog` : `ChangeList` de la Version contre `previousId`
(binaires compris). Restaurer (`restoreVersionIntoDraft`) remplace l'arbre texte de l'éditeur
par celui de la Version (`adoptDiskIntoProject`), donc le brouillon, **sans publier** ; les
images du brouillon restent telles quelles. `FileHistory` affiche l'auteur
quand l'historique vient des Versions.
Les actions vident d'abord le debounce local via `draftFlush`.
`saveProjectToDisk` publie la révision sauvegardée via l'API de brouillons ;
création/import sans session garde le chemin existant. Une modification pendant
la publication reste un nouveau travail basé sur les fichiers publiés.
Le transport MCP reste futur ; il réutilisera les mêmes opérations et contrôles.

- `projectBoard(project)` (`features/canvas/autoLayout.ts`) renvoie les positions (`layout` / `allLayout`), cadres (`groups`), identifiants représentants des Documents et gouttière. `groupedBoard.ts` arrange d'abord chaque groupe manuel, puis son cadre avec les Documents non groupés ; `serverBoard` arrange ensuite les cadres de Projects. `arrangeBoard` reste le moteur dagre `LR` de chaque niveau, avec exclusion des retours du calcul des couches, alignement des commandes et conservation des positions fixées. Les entrées externes guident le choix de la racine d'un groupe. Mémoïsation par forme du graphe, groupes, nom et positions : éditer un slot sans changer les liens ne recalcule rien.
- Un Project forme le cadre racine sur la planche serveur uniquement. Dans sa propre vue, `Stage` masque ce cadre ; seuls les groupes manuels restent visibles. Sélection de ≥2 Documents (Menus, Commandes ou Dialogs, éventuellement mêlés) → **Grouper la sélection** (barre flottante ou menu contextuel), puis nom et couleur ; un seul niveau manuel, appartenance exclusive. `BoardGroupControls` gère nom/couleur/dissociation ; `BoardGroupFrames` partage le rendu entre planches. Déplacer l'en-tête translate les membres en une opération annulable ; dissocier conserve les Documents. Les changements sont dans `canvasGroups` (`nodeIds`), sérialisés comme `groups` dans `.artisan/editor.yaml`, jamais dans les fichiers des Documents. Renommer/supprimer un Document (ou déplacer un Menu) maintient les appartenances ; les imports ignorent les groupes invalides ou vides, et lisent encore l'ancien champ `menuIds`.
- Les groupes restent toujours ouverts, y compris les anciens états `collapsed` / `project_collapsed`, désormais ignorés et non réexportés. La couleur optionnelle `color` accepte uniquement `#RRGGBB` ; bleu par défaut pour un groupe manuel sans couleur. Le fond, bandeau inclus, est rendu à 15 % d'opacité, la bordure à 65 %, le titre reste opaque ; le fond ne capture pas les interactions. Création et édition restent dans le Project ; la planche serveur réutilise les couleurs sauvegardées.
- Tailles des nœuds : **uniquement** `menuBoxSize` / `COMMAND_BOX` / `DIALOG_BOX` (`menuLayout.ts`), les mêmes que le rendu. Coordonnées = coins haut-gauche (dagre renvoie des centres, convertis).
- Les nœuds à taille fixe (commande, dialog, Document de module) ne s'élargissent pas pour leur titre : titre et sous-titre sont coupés par une ellipse (`wrap="none"`, `ellipsis`), et le titre complet s'affiche en infobulle native au survol (`showFullTitle`, `features/canvas/nodeTitle.ts`).
- Action `releaseBoardPositions({projectId})` : réarrange uniquement le niveau extérieur, chaque groupe étant un bloc dimensionné selon son contenu et relié par ses liens entrants/sortants. `rearrangeProjectLayout` capture les positions visibles avant calcul pour conserver exactement les positions relatives internes, même non fixées manuellement. Sans groupe, conserve le comportement historique de remise à zéro. Bouton **Réarranger** de `CanvasToolbar` ; annulable par Ctrl+Z (zundo).
- Action `rearrangeCanvasGroup({projectId, groupId})`, accessible par **Groupes → nom → Réarranger le contenu** : libère uniquement les positions des membres, garde l'origine du cadre et toutes les positions extérieures, adapte la taille du cadre. Les deux actions sauvegardent leur résultat dans les métadonnées existantes `canvasLayout` / `canvasGroups.position`, sans changer les Documents ; aucune migration. `deleteFromProject({projectId, nodeIds})` retire le Document du project et sa position fixée.
- Recalcul complet à chaque changement de graphe, sans insertion locale ni cache : la stabilité de l'arrangement entre deux éditions reste une question ouverte de la spec.
- **Planche générale** (lecture seule) : route `…/servers/$serverId/canvas` (`features/serverCanvas/ServerCanvasPage.tsx`), lien « Planche générale » sur la page du serveur. Charge chaque project du serveur par `useProjectLoader` (brouillon compris), graphe `deriveServerGraph(projects)` avec la résolution lexicale des références (`domain/docRef.ts` → `resolveDocRef`, miroir de `DocumentTable` côté plugin, verrouillé par `testdata/doc-ref-conformance.json`) : id nu cherché d'abord dans le project du Document source, puis sur le serveur s'il est unique ; `project:id` vise ce project ; id nu absent du project et porté par plusieurs autres = lien ambigu, non dessiné, filtres project / type / id dans l'URL. Rendu par les mêmes `MenuGroup` / `CommandGroup` / `DialogGroup`, dans un calque `listening={false}` : aucun geste d'édition possible ; un calque de zones cliquables ouvre le Document dans son project.

### `Project.moduleData` — état opaque par module

`Project.moduleData?: Record<string, unknown>` porte l'état d'un module tiers, keyé par id de module (ex. `"boutique"`) — le host ne l'interprète jamais. Round-trip files-first : `projectFromFiles` seed `moduleData[<dir>] = { __files: Record<relPath, content> }` pour un dossier de project non reconnu ; le module éditeur normalise `__files` à sa forme structurée à la première lecture, et dérive son `exportFiles()` depuis `moduleData` ; `transform()` ré-émet les `__files` verbatim des namespaces sans module registré. Action store : `setModuleData(projectId, moduleId, data)` (Immer `produce`, remplace tout le namespace, préserve les autres).

Exemple historique (avant le stockage disk-only ; module boutique, V1.5 — `docs/architecture/modules.md` §15) : le plugin Add-on Boutique (ID actuel boutique_addon ; dossier physique editor inchangé) bootstrappe `plugins/Boutique/editor/boutique/shop.yaml` sur disque ; un `local_push` sur ce project stub seed `moduleData.boutique.__files["shop.yaml"]` (le préfixe du dossier module est retiré des clés `__files`). `@artisan/boutique-editor` (presence-gated `/m/boutique`) lit ce state, le normalise en catalogue structuré (categories/items) au premier accès, expose un form d'édition (pas de `<SchemaForm>` générique, §8), et sa fonction `exportFiles()` régénère `boutique/shop.yaml` depuis `moduleData.boutique` à chaque deploy — round-trip complet sans que le host `Project` n'ait besoin de connaître la forme du catalogue.

### Panneau Boutons redimensionnable

Le panneau Boutons utilise `SplitPane` avec `secondaryPosition="start"` à gauche
(bord droit redimensionnable), ou en bas si mobile/espace central <600 px.
Le store `projectLibraryStore` persiste largeur/hauteur sous
`artisan-library-size`, ainsi que le projet ouvert (null si fermé) et la catégorie.
Le canvas reste monté pendant ouverture, fermeture, resize et changement d'orientation.
Le bouton Boutons est un outil flottant arrondi en haut à droite du canvas, rendu par `ProjectLibraryWorkspace` dans le panneau principal du split uniquement si le panneau est fermé. Bouton et panneau sont visibles uniquement sur la planche et les vues individuelles de menus, jamais dans les vues commande ou dialogue ni les onglets secondaires. L'état d'ouverture est conservé au retour au canvas. La croix ferme le panneau et fait réapparaître l’outil ; aucun bouton Boutons dans la topbar.
L’en-tête regroupe onglets et fermeture sans ligne de titre supplémentaire ; les filtres du catalogue restent sur une ligne défilante horizontalement, pour préserver la hauteur de grille.

### Registre du project — barre de gauche (le panneau de droite est retiré)

**Depuis 2026-10-02**, les Documents du project vivent **uniquement dans la barre de gauche** : `ProjectElementsSidebar`, `ProjectPanel`, le bouton Éléments de la topbar, `uiStore.projectPanelOpen` et le drawer mobile droit sont supprimés. À droite ne reste que l'inspecteur de la sélection (`ProjectWorkspacePanels`).

- **`ProjectDocumentTree`** (`features/project/`) : les Documents groupés par type (`buildProjectDocuments`), **une icône par catégorie** dans l'en-tête et aucune sur les lignes ; menu `···` (éditer, supprimer). `header="name"` ajoute une ligne nom + actions (démo) ; `header="none"` quand la ligne du project les porte déjà.
- **`ProjectActions`** : deux boutons icône, ⚙ (`openProjectSettings`) et + (créer menu / commande / dialogue), posés **à droite du nom** sur la ligne du project ouvert de « Mes projets » (et des projects de module). Plus de ligne « Paramètres du projet ».
- **`ProjectSidebar`** : plus de sélecteur de serveur ni de lien vers le network (le fil d'Ariane de la topbar les remplace, voir UI shell). Exception : l'éditeur servi par le plugin (`SELF_HOSTED`) monte `ServerSelector` sous le logo (→ `/`), avec l'état de chaque serveur du hub (`useNetworkServersStatus`, relu toutes les 15 s : en ligne, hors ligne, « mise à jour requise » si `updateRequired`) ; un serveur connecté au hub après le chargement y apparaît (`withServersStatus`). `/` et `/servers` mènent au serveur du hub, et le resource pack est reconstruit pour le serveur du project publié (`requestResourcePackRebuild(serverId)`). Le compteur de Documents suit directement le nom. Un project ouvert absent de la liste visible (project non listé) s'affiche en tête avec nom, actions et Documents.
- **Démo** : la racine monte `DemoSidebar` sur `/demo/projects/…` (logo + `ProjectDocumentTree header="name"`), la démo n'ayant ni compte ni liste de serveur.
- Largeur de la barre : **264 px** (`NavigationSidebar`). L'étape « Retrouvez chaque élément » de la visite guidée vise `data-tour="elements"` (l'arbre), ou le bouton qui ouvre la barre si elle est repliée.

**Arbre du project ouvert** : la barre de gauche déplie `ProjectDocumentTree` (`header="none"`) sous la ligne du project **ouvert**, dès que ce project est chargé dans le compte ; un clic ferme le drawer mobile et passe par `goToDocument`. Le groupe est un `role="group"` nommé « Documents de … », pas un `tree` ARIA (pas de navigation clavier d'arbre). Les **autres projects** du serveur portent un chevron (`aria-expanded`) dès que l'index serveur les connaît : dépliés, ils listent leurs Documents **publiés** en lecture (`DocumentGroups` sans `editable`, donc sans menu `···`), et un clic ouvre le Document dans son project (par son dossier).

- **Ligne racine** (nom du project) : clic → `openProjectSettings()`, et un `+` à côté ouvre la **création** (Menu / Commande / Dialogue). Depuis 2026-09-05 c'est le registre qui crée, pas le panneau de droite — celui-ci n'apparaît qu'à la sélection, donc il ne pouvait plus héberger « Nouveau menu ». Les dialogues y gagnent une entrée qu'ils n'avaient pas. Création **sans position** : le Document apparaît sur la planche à la place que lui donne l'arrangement.

- Recherche texte.
- Plus de bouton ajouter / retirer du canvas (retiré le 2026-09-25) : tout Document est sur la planche.
- **Clic** sur le label → ouvre la vue individuelle. **Menu contextuel `···`** : éditer / supprimer du project.
- 3ᵉ zone du layout overview desktop (panneau · planche · `EditorPane`).
- Helper de label partagé `documentLabel(project, id, lang)` (`useProjectDocuments.ts`) — utilisé aussi par l'en-tête de `DocumentView`.

### Le panneau = inspecteur de la sélection

Depuis 2026-09-05. Le panneau d'édition était **toujours** affiché et mangeait de la place sur le canvas, alors que son contenu dépendait déjà entièrement de la sélection (`SelectionInspector` : rien → `ProjectProperties`, menu → `MenuProperties`, item → `ElementEditor`…). Sa **présence** suit désormais la même règle que son contenu.

> Le panneau existe **ssi** quelque chose est sélectionné — ou si l'utilisateur a explicitement demandé les paramètres du project.

- **`features/project/selectionContext.ts`** — fonction pure `selectionContext(project, ids, selectionMenuId)` → `none | multi | menu | element | command | dialog | unknown`. **Une seule** dérivation de la nature de la sélection, partagée par le dispatch de `SelectionInspector` **et** par le gating des onglets ; deux dispatches séparés finiraient par ne plus être d'accord. Elle porte aussi la résolution scopée d'un id d'élément (un `grid` peut exister dans deux menus — cf. `selectionStore.menuId`).
- **`features/project/useInspector.ts`** — la règle d'ouverture, écrite une fois : `open = ids.size > 0 || projectSettingsOpen`.
- **Fermer** — deux sorties, toutes deux `dismissInspector()` (`projectSettings.ts` : vide la sélection **et** rabaisse `projectSettingsOpen`) : le clic sur le fond du canvas (`Stage.onStageClick`, le geste qui veut dire « j'ai fini ») et une **croix** dans l'en-tête du panneau. La croix n'est pas décorative : les paramètres du project survivent à une sélection vide **par construction** — c'est ce qui les distingue d'une sélection — donc sans sortie explicite ils restaient ouverts indéfiniment.
- **`features/project/CanvasWithInspector.tsx`** — scène + inspecteur, monté par la planche **et** par la vue focus. Desktop : le panneau flotte au-dessus du canvas, donc le masquer découvre du canvas **sans reflow**. Mobile : il occupe une vraie hauteur, la scène la récupère. (Le composant existe pour la raison qui a coûté `SoloMenuStage` : la règle ne doit pas être écrite à deux endroits.)
- **Catalogues indépendants** — les items et images de boutons appartiennent au panneau Boutons, accessible sans sélection ; les fichiers partagés sont gérés dans l'onglet Ressources. Fermer Propriétés ne ferme pas Boutons, et réciproquement. Le bouton d'aide d'un menu vide ouvre directement Items du jeu ; les sélecteurs de matériau et d'image restent accessibles depuis leurs champs.
- **`ProjectProperties`** ne garde que ce qui est vraiment du project — identité (id + badge de source), nom, description, compte d'assets, suppression. Les compteurs menus/commandes doublonnaient l'arbre et les boutons de création y ont déménagé.
- **Paramètres du project** — ils ne correspondent à aucune sélection, donc ils se demandent explicitement. Geste unique dans `features/project/projectSettings.ts` (`openProjectSettings()` : vide la sélection, lève `uiStore.projectSettingsOpen`, éphémère et jamais persisté), avec **trois portes d'entrée** : la ligne racine du `ProjectPanel` (nom du project + icône réglages), le **clic droit sur le fond du canvas** (branche `empty` du `ContextMenu` — c'est justement le geste qui désélectionne, donc celui après lequel on les cherche) et le **kebab ⋮ de la topbar**. Sélectionner quoi que ce soit rabaisse le drapeau, sinon désélectionner pour dégager le canvas les rouvrirait.
- **Pas d'entrée « Paramètres » sur une ENTITÉ au clic droit** : `useStageContextMenu` **sélectionne déjà** l'entité visée (`:85`), donc le clic droit sur un menu ouvre le panneau tout seul — comme le clic gauche (`useMenuClick` : `set([menu.id])`, plus `setEditorTab("edit")`). L'affordance existait déjà ; elle était juste invisible tant que le panneau était toujours là.

### Vue individuelle (deep-linkable)

`features/project/DocumentView.tsx`, monté par la route enfant `…/projects/$projectId/document.$documentId.tsx`. La route overview bascule dessus via `useChildMatches()` (`childMatches.length > 0 → <Outlet/>`) — donc rechargement, bouton retour navigateur et lien partageable fonctionnent.

- **Dispatch par type** : menu, et Document de module dont le kind déclare `board.items`, → `<Stage projectId focus={documentId}>` (le **stage de la planche**, cf. « Mode focus » ci-dessous) en `primary` d'un `SplitPane` + `EditorPane` en `secondary` : le nœud seul, dont un clic sur une ligne édite la partie dans le panneau (`DocumentGroup` en `solo` : ni déplacé ni rouvert ; cadré par `fitViewport` jusqu'à ×2, `FOCUS_NODE_MAX_SCALE`, le nœud étant du texte vectoriel) ; commande / dialog / autre kind → `SelectionInspector` centré (`max-w-3xl`).
- Sélection posée via `useSelectionStore.set([documentId])` au montage → `SelectionInspector` (clé sur la sélection) et `MenuGroup` éditent par le **même** chemin que la planche. Introuvable → `EmptyState`.
- **INVARIANT** : `DocumentView` ne réimplémente aucun éditeur — il monte les mêmes renderers que la planche (`MenuGroup` en solo, `SelectionInspector`). Pas de second éditeur (≠ focus mode 2026-06-02, forké puis reverté).
- **Échap = retour planche** : `DocumentView` pose un listener `keydown` window qui rappelle `back()` sur `Escape`, **sauf** si le focus est dans un `INPUT`/`TEXTAREA`/`contentEditable`, si une modale/menu/liste est ouverte (`[role=dialog|menu|listbox]`), ou si l'événement est déjà `defaultPrevented`. Le bouton « Retour au canvas » affiche un badge clavier `<kbd>Esc</kbd>`.
- **Mémorisation pan/zoom** : le `Stage` restaure son `viewport` depuis `uiStore.canvasViewports[projectId]` au montage et le réécrit à chaque changement. Le cadrage est **persisté dans le navigateur par projet**, y compris après fermeture ou rechargement. Le composant interne est remonté au changement de projet ou de mode pour restaurer le bon cadrage. En **mode focus**, `uiStore.documentViewport` conserve un cadrage partagé par tous les Documents.
- **Minimap** : `CanvasMinimap` affiche les rectangles issus de `nodeBox(project, id, layout)` dans un SVG superposé à la planche, sans second Stage Konva. Le rectangle de vue suit le pan/zoom ; clic hors du rectangle = recentrage, glissement = déplacement sans changer le zoom. Les bornes incluent les documents et la vue courante ; leur projection reste fixe pendant le glissement. Les flèches du clavier déplacent la vue quand la minimap a le focus. Le bouton à côté de Boutons dans `ProjectLibraryWorkspace` ouvre la minimap puis disparaît pendant son affichage ; la minimap est ancrée à 8 px du coin inférieur droit et sa croix la ferme en faisant réapparaître le bouton ; `uiStore.minimapVisible` persiste cette préférence (visible par défaut). La minimap est réservée à la planche.

- **Bulle de navigation** : le bouton « Retour au canvas » garde sa largeur et son libellé sur une seule ligne (`shrink-0`, `whitespace-nowrap`) ; le titre du Document est tronqué quand les sidebars réduisent l'espace disponible.

### Mode focus (`<Stage focus={documentId}>`)

Depuis 2026-09-05, la vue individuelle d'un menu n'a plus de stage à elle : elle monte le `Stage` de la planche avec une prop `focus`. `features/project/SoloMenuStage.tsx` est **supprimé** — il ne réimplémentait que ~20 % de la chrome du `Stage`, et la vue document y perdait le dépôt d'items depuis la Bibliothèque (silencieusement : `setStageDropTarget` n'était jamais enregistré), les raccourcis clavier, la sélection, les guides d'alignement et les liens.

Toute la différence tient dans la table `layout` :

```ts
const layout = focus ? { [focus]: { x: 0, y: 0 } } : projectBoard(project).layout;
```

- La planche montre tous les Documents, arrangés (`projectBoard`) ; le focus fabrique une **planche synthétique d'un seul Document** posé à l'origine, sans consulter `canvasLayout`.
- Tout ce qui consomme `layout` suit sans le savoir : `Edges` (aucune arête, les deux bouts ne sont jamais tous deux présents), `GhostChips` (tous les liens du Document deviennent des pastilles), `useMarqueeSelection`, `hitTestSlot`, `setStageDropTarget`.
- `MenuGroup` reçoit `solo` → non déplaçable (aucune position de planche à écrire), pas de double-clic « ouvrir ».
- Chrome retirée en focus : l'`EmptyState` et les entrées « Créer un menu / une commande / un dialogue **ici** » du `ContextMenu` (les trois `onCreate*At` deviennent optionnelles — elles posent une position de planche). Copier / coller / dupliquer / supprimer restent.
- Cadrage : `fitViewport` (`features/canvas/focusViewport.ts`, ex-`features/project/soloViewport.ts`) centre le menu à l'ouverture, sans jamais l'agrandir, puis ne se bat plus avec l'utilisateur (`touchedRef`) ; double-clic sur le fond = recadrer.
- **Changement de comportement assumé** : le fond se comporte comme sur la planche — glisser en mode select fait un marquee (nouveau en focus), le pan passe par l'outil main / Espace / Alt. Avant, en vue document, glisser n'importe où pannait.

**INVARIANT à ne pas casser** : `setStageDropTarget` / `setStageSlotHitTest` / `setStageGeometryProvider` sont des registres globaux **mono-locataire**. Ça tient parce que la route overview fait `childMatches.length > 0 ? <Outlet/> : <Stage/>` — jamais deux `Stage` montés en même temps. Le focus **remplace** la planche, il ne coexiste pas avec elle.

### Chips fantômes (liens hors-planche)

`features/canvas/GhostChips.tsx` + `offBoardLinks.ts`. Un nœud sur la planche qui référence une cible **absente** de la planche affiche un chip `→ cible` (libellé de la cible rendu en MiniMessage dans la police vanilla MC via `VanillaMcText`, comme les titres de menu ; largeur `vanillaTextWidth` du texte brut). Depuis la planche dérivée (2026-09-25), tout Document existant y figure : sur la planche, une pastille ne signale plus qu'une cible absente du project (ref qui pendouille, ou menu d'un autre project). `offBoardLinks(edges, layout)` retourne les liens (source on-board, cible off-board), dédupliqués. `visibleEdges(edges, layout)` (`Edges.tsx`) ne trace des edges qu'entre nœuds présents. Helper de géométrie partagé `nodeBox(project, id, layout)` (`menuLayout.ts`) utilisé par `Edges` **et** `GhostChips`.

Le clic dépend du mode, via la prop optionnelle `onOpen` : sur la **planche**, aucun (il n'y a rien à poser, et écrire une position pour un Document inexistant polluerait `canvasLayout`) ; en **focus**, `dispatchOpenElement(target)` — il n'y a pas de planche à peupler, la pastille devient le moyen de circuler de Document en Document, y compris vers des Documents jamais posés sur la planche.

### Aller à un Document : `goToDocument` (depuis 2026-10-02)

`features/project/goToDocument.ts` est la **seule** façon d'aller à un Document depuis l'arbre (gauche et droite), la palette ⌘K et la planche générale. Dans le project courant, il **reste sur la planche** : sélection du Document (l'inspecteur s'ouvre), puis `uiStore.requestCenter(projectId, docId)` et retour à la planche (on quitte la vue focus ou un onglet). Le `Stage` de la planche consomme la demande (`viewportForCenterRequest` → `centerViewport`, même cadrage que `fitViewport` mais à la position du Document, jamais au-delà de 1:1) dès qu'il a une taille et que le Document est placé, puis l'efface ; le `nonce` fait qu'un second clic sur le même Document recentre. `centerRequest` est éphémère (hors `partialize`).

Vers un autre project (référence qualifiée `boutique:main`, arbre d'un autre project, planche générale), la navigation passe par le **lien profond `?doc=<id>`** (`ProjectSearch.doc`) : `ProjectCanvasPage` (hook `useProjectDeepLinks`) le transforme en `goToDocument` une fois le project chargé, ce qui retire le paramètre de l'URL.

### Entrées dans la vue individuelle

**Double-clic** sur un nœud de la planche : `dispatchOpenElement(id)` (`features/canvas/canvasEvents.ts`) émet le CustomEvent `artisan:open_element` (`OPEN_ELEMENT_EVENT`), écouté par la route overview qui `navigate` vers la route Document (`documentDestination`, qui suit aussi une référence qualifiée). Les pastilles de lien de la vue focus passent par le même événement. Un clic simple dans l'arbre ou la palette ne l'ouvre plus : il centre la planche (`goToDocument`).

### Mobile (< lg)

Les Documents du project sont dans le **drawer de navigation** (barre de gauche), comme sur desktop ; il n'y a plus de drawer droit. Le canvas occupe la zone centrale, l'inspecteur reste sous lui.

## Modes d'interaction + guides d'alignement (depuis 2026-06-14)

Cf. `docs/superpowers/specs/2026-06-14-canvas-modes-and-alignment-design.md`.

### `canvasMode` (select / hand) — toolbar + raccourcis

`uiStore.canvasMode: "select" | "hand"` (persisté via `partialize`, défaut `"select"`) + `setCanvasMode`.
**Mode `hand`** : le `<KonvaStage>` est `draggable`, le curseur passe en `grab`/`grabbing`, les clics sur le vide ne sélectionnent pas (sauf placement d'`armedMaterial`, conservé).
**Mode `select`** (défaut) : le stage est `non draggable` — le drag sur le vide active le marquee.

- **`CanvasToolbar.tsx`** (`features/canvas/`) : overlay DOM `absolute bottom-4 left-1/2 -translate-x-1/2 z-20`, deux boutons (icônes `MousePointer2` / `Hand` lucide), bouton actif mis en avant via `--brand-soft`. Labels + tooltips i18n (`canvas.modeSelect` / `canvas.modeHand`) avec hint hotkey.
- **Raccourcis clavier** (`features/canvas/useCanvasKeyboard.ts`) : **V** → select, **H** → hand (ignorés si un input est focusé). **Espace maintenu** (dans `Stage.tsx`, reset sur `window blur`) → mode main temporaire (`spaceHeld`) ; relâché → retour au mode courant.

### Marquee (sélection rectangle, mode select uniquement)

- **`useMarqueeSelection.ts`** — gère `pointerdown/move/up` sur le stage. `pointerdown` sur le vide (`e.target === stage`) démarre le rectangle ; `pointermove` l'agrandit (coords monde via `screenToWorld`) ; `pointerup` lance le hit-test puis supprime le rect.
- **`marqueeHitTest.ts`** (pur) — `rectIntersectsBoxes(rect, boxes)` : intersection normalisée (pas inclusion totale) entre le rectangle de sélection et les `nodeBox` des nœuds présents dans le `layout`. Shift = ajout à la sélection existante ; sans Shift = remplacement.
- **`MarqueeRect.tsx`** — overlay Konva sur le layer `overlay`, lit l'état du rect courant.
- Clic sans drag sur le vide conserve le `clear` existant. Le `pointerup` du marquee supprime l'event de clic de suivi pour ne pas vider la sélection juste posée. Annulation si le pointer relâché hors du canvas.

### Guides d'alignement + snapping

- **`alignmentGuides.ts`** (pur) — `alignmentGuides(dragged, others, threshold) → { snapX?, snapY?, guides[] }`. Compare **left / centerX / right** et **top / centerY / bottom** du nœud déplacé avec ceux de chaque autre nœud ; retient le meilleur candidat par axe dans le `threshold` (≈ 8 px monde) ; émet des `Guide { axis, pos, from, to }` couvrant les extrémités des nœuds alignés.
- **`useNodeAlignment.ts`** — hook câblé dans le `onDragMove` des groupes de nœuds (`MenuGroup` board, `CommandGroup`, `DialogGroup`). Guarde sur `e.target` pour que les drags d'enfants (slots) ne déclenchent pas le snap/téléportation. Repositionne le nœud Konva (`node.x(snapX)` / `node.y(snapY)`) et publie les guides actifs dans `alignmentStore`.
- **`alignmentStore.ts`** — guides actifs (état léger, non persisté). Vidé à `dragEnd` (position finale persistée via `setCanvasPosition` existant).
- **`AlignmentGuidesOverlay.tsx`** — `<Layer>` overlay, lignes Konva `<Line>` brand (`--brand`) en pointillé, `listening={false}`.
- **Alt maintenu** pendant le drag → `alignmentGuides` court-circuité (déplacement libre, sans snap ni guide).

## Recherche (palette Cmd+K) + panneau toggleable (depuis 2026-06-14)

Cf. `docs/superpowers/specs/2026-06-14-search-palette-and-sidebar-toggle-design.md`.

### Module de recherche (`editor/src/features/search/`)

- **`searchIndex.ts`** — `buildSearchIndex(project, lang) → SearchEntry[]` : index plat couvrant les noms de menus/commandes/dialogs, les matériaux des items de menu, et les textes i18n (titres/lores d'items, corps/labels de boutons de dialogs). Chaque `SearchEntry` porte un contexte structuré `{ key, owner }` (clé de traduction i18n + id du propriétaire) traduit dans la palette via `t()` — aucune string en dur. `searchQuery(entries, query)` filtre et ranke ; `groupResultsForDisplay(results)` regroupe par catégorie pour l'affichage.
- **`SearchPalette.tsx`** — overlay combobox/listbox (conforme a11y). Navigation clavier ↑/↓/Enter/Esc. Sur sélection : navigue vers la vue individuelle du Document (`…/document.$documentId`) ; pour les matches d'items de menu, sous-sélectionne le slot correspondant. Ouverte via `useGlobalSearchShortcut` **ou** le bouton 🔍 de la topbar.
- **`useGlobalSearchShortcut.ts`** — écoute Cmd+K (Mac) / Ctrl+K (Windows/Linux) ; ignore Shift. Monte/démonte le listener de façon propre.

### Index serveur (`editor/src/features/serverIndex/`, depuis 2026-10-02)

Lecture de **tous les projects du serveur**, en dehors du project édité. L'édition, le brouillon, les conflits et la publication restent **par project** : l'index est un modèle de lecture, jamais un second éditeur.

- **`serverIndexLoader.ts`** — `loadServerProjects({networkId, serverId})` liste les projects du disque du serveur puis lit chaque arbre **publié** (`readProjectFiles`, en parallèle). **Aucun effet de bord** : il ne touche ni runtime, ni serveur actif, ni brouillon, ni compte (contrairement à `useProjectLoader`, qui ouvre UN project pour l'éditer). Cache par hash : un `unchanged` réutilise le `Project` déjà parsé. Un project illisible ou inparsable est rendu dans `failed`, sans retirer les autres.
- **`serverIndexStore.ts`** — état éphémère (`scope` = `<network>/<server>` tels que l'URL les nomme). Changer de serveur vide les projects du précédent ; un résultat arrivé pour un autre scope est ignoré.
- **`useServerIndexLoader.ts`** — monté par `ProjectCanvasPage` ; charge en arrière-plan une fois le project édité prêt. L'ouverture ne l'attend jamais.
- **`serverIndex.ts`** — pur. `indexProjectDocuments(project, lang)` donne les Documents avec leur identité qualifiée `ref = <dossier>:<id>` (le dossier disque, `diskId ?? id`, est le **namespace** : le même id dans deux projects reste deux Documents). `toSearchEntries` les adapte à la palette.
- **`serverChecks.ts`** — `checkServerIssues(edited, others)` : ce que déployer `edited` (état de travail) risque de casser **sur le serveur**, face à l'état publié des autres projects, parce que le plugin range menus, dialogs et commandes dans des tables uniques sans notion de project. Trois familles : `command_conflict` (même nom ou alias entre deux commandes — le plugin n'en enregistre qu'une, `CommandRegistrar`), `duplicate_id` (même id de menu ou de dialog dans deux projects — le dernier chargé gagne en silence) et `broken_link` (lien du project édité vers une cible absente ou définie par plusieurs projects, via `deriveServerGraph`). Ne rapporte que ce qui **implique** le project édité ; ce sont des avertissements, jamais un blocage. `serverChecksFor(edited, indexState)` ajoute l'état : tant que l'index charge (`pending`) ou n'a pas pu lire (`unavailable`), les contrôles ne sont **pas** faits et ne se lisent jamais comme un feu vert ; des projects illisibles les rendent `incomplets`.
- **Revue de déploiement** : `DeployReviewDialog` affiche ces contrôles au-dessus de la liste des changements (`ServerChecksSection`, clés `deploy.checks.*`) ; `ProjectTopBarControls` les calcule à l'ouverture de la revue, depuis `useServerIndexStore`.
- **Palette** : `SearchPalette` ajoute les Documents des autres projects (menus, commandes, dialogs — pas leur contenu) après ceux du project édité, avec le nom du project en contexte (`search.ctxInProject`) ; le nom du project est cherchable. Le project édité n'y figure jamais en double. Sélectionner un résultat navigue vers l'autre project.

L'index montre l'état **publié** : le brouillon d'un project non édité n'y est pas. Il se rafraîchit à chaque ouverture d'un project (peu coûteux : cache par hash), pas à la suite d'un Déployer en cours de session.

### Fil d'Ariane de la topbar (depuis 2026-10-02)

`ProjectBreadcrumb` (`components/`) remplace le nom seul du project en tête de la topbar : **serveur › project**. Le serveur est un `BreadcrumbSwitcher` : il ouvre la liste des serveurs du network (pastille en ligne/hors ligne, champ de recherche au-delà de 7) et en choisir un mène à sa page. Le network n'apparaît plus qu'en infobulle du serveur (2026-10-08), pour laisser la place aux onglets ; sa page reste accessible depuis la liste `/networks` et le compte. La pastille d'état devant le serveur (`LinkedServersDropdown`) garde son propre menu. Hors network (démo), seul le project s'affiche. Rendu par `components/ui/breadcrumb.tsx` (`Breadcrumb`, `BreadcrumbCurrent`, `BreadcrumbSwitcher`, `breadcrumbLinkClass` ; spécimens sur `/design`). Les onglets de la topbar n'affichent que leur icône (nom en infobulle avec le raccourci).

## UI shell — Project + Settings (depuis 2026-05-27)

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

La navigation globale est enveloppée par `NavigationSidebar` dans `__root.tsx` :
sur desktop, zone de survol invisible de 8 px sans espace réservé au repos ;
bouton flottant en haut à gauche et overlay de 216 px, décalé de 8 px des bords,
icônes `PanelLeftOpen`/`PanelLeftClose` en miroir du toggle Éléments à droite,
avec coins arrondis et contenu découpé dans le même contour ;
repli après 300 ms hors du panneau. Les menus portallés et le focus clavier
retiennent l'ouverture ; Échap ferme le panneau temporaire et rend le focus au
bouton. Le bouton Menu reste visible : clic = ouverture fixe sans bordure (216 px),
second clic = fermeture et retour au survol. `sidebarStore.pinned` est persisté sous `artisan-navigation` ; le rechargement restaure ce choix. Le survol temporaire et le drawer mobile restent éphémères. Le drawer mobile
conserve une ouverture explicite avec bouton et backdrop. Même shell pour l'admin.

La création de projet depuis le réseau (`NewProjectModal`) utilise un formulaire :
Entrée dans le nom ou la description déclenche la même soumission que « Créer ».
Un nom vide ou une création déjà en cours bloque la soumission ; « Annuler »
ferme la modal sans créer de projet.

Le logo géométrique fourni est conservé dans `editor/public/logo.svg`, partagé entre les marques des sidebars, les écrans d’authentification/setup/accueil et le favicon SVG déclaré dans `editor/index.html`.
Le texte de marque des sidebars et de l’authentification utilise `ArtisanWordmark`, une version inline du SVG fourni : Inter 700, approche -8, couleur héritée du thème. Le SVG inline permet de réutiliser la police chargée via Bunny Fonts.
Sur mobile (<1024 px), la topbar utilise une grille de deux lignes, conserve les onglets à icônes et impose des cibles tactiles de 44 px. Le panneau Boutons masque temporairement l’inspecteur sans vider la sélection ; un changement de sélection ferme Boutons. Les panneaux restent indépendants sur desktop.

Les propriétés activent aussi `SplitPane.animatePresence` sur desktop (`ProjectWorkspacePanels`) et mobile (`CanvasWithInspector`, split toujours monté). Changer la sélection ne relance pas l’animation : seule la présence du panneau la déclenche.

`usePanelPresence` conserve le contenu 200 ms pendant la sortie et annule le démontage à la réouverture. Éléments anime translation/opacité ; le menu anime aussi sa largeur réservée. Boutons active `SplitPane.animatePresence` (largeur/hauteur), désactivé pendant le drag. Les panneaux sortants sont `inert` et `aria-hidden` ; `prefers-reduced-motion` supprime l’attente et les transitions CSS.

La marge gauche de la topbar réserve 48 px au bouton de navigation flottant ; elle passe à 12 px sur desktop lorsque la navigation est fixe et occupe déjà sa propre colonne.
Sur desktop, la topbar et le lien de marque des sidebars partagent une hauteur de 48 px et commencent à 8 px du haut. Le panneau flottant retire son padding supérieur interne pour compenser son décalage de 8 px ; son contour utilise un ring sans modifier les dimensions. Le toggle de 36 px est centré à 32 px du haut.

La sidebar (`components/NewProjectDialog.tsx`, la seule modale de création — le doublon
`features/account/NewProjectDialog.tsx` a été supprimé avec le code de l'ère cloud, issue #44)
suit la même soumission native. Les deux modals restent ouvertes avec le nom saisi si le
serveur refuse la création ; elles affichent une erreur traduite et le placeholder
`mon_projet` / `my_project`.
Le succès de `createProject` confirme l'écriture du manifeste sur le disque serveur,
puis la liste est relue depuis ce disque.

Cf. `docs/superpowers/specs/2026-05-27-workspace-shell-and-settings-design.md`.

- **`ProjectSidebar`** (sticky, `routes/__root.tsx`) — brand cliquable (→ `/servers`) en haut + `ServerSelector` (label via `displayServerLabel`) + section Projects filtrée par server actif (drag-reorder via `account.projectOrder`) + section **Modules installés** (un groupe par module : son canvas « Éditeur », ses Config screens, sa route `/m/<id>`). Le découpage projects plats / groupes de modules vit dans `features/projects/projectGroups.ts` (`buildProjectGroups`, pur) — **la page d'un serveur (`/servers/$serverId`, `$serverId` = UUID du serveur) affiche la même chose en lisant la même fonction**, et lit ses Projects sur le disque du serveur (`listServerProjects`) comme la sidebar + ⚙ Settings sticky bottom. Depuis les routes slugs (phase 4a), les params URL `networkId`/`serverId` peuvent porter un slug : la sidebar les résout en ids réels (match `id` OU `slug` contre `networksStore` / les `serverKeys` fetchés) avant tout filtrage de projects ; `ServerSelector` matche pareillement `serverId|serverSlug`. Les flows de création hors sidebar (hub `/networks`, network detail, setup wizard) appellent `networksStore.bumpRefresh()` après chaque create/delete — la sidebar écoute `refreshToken` et refetch networks + server entries (sinon elle resterait stale jusqu'au reload). Accounts-only (Task 8) : plus de session-mode, toujours cookie user + `listNetworks`.
- **`/servers/$serverId/projects/$projectId`** — route canonique server-scoped (`$serverId` = UUID du serveur, plus de niveau network) (`/project/$projectId` redirige). Onglets via `?tab=` : `overview` (canvas Konva, default), `translations` (`TranslationPanelContent`), `data-sources` (`DataSourcesPanelContent`), `resources` (`AssetsTab` — images et polices), `assistant` (`AssistantBody`). **Depuis 2026-07-20**, les vues secondaires **remplacent le canvas** dans la zone centrale (elles ne flottent plus en modal) : chaque est un `WorkspaceView` (`components/ui/workspace-view.tsx`) — panneau opaque `absolute inset-0` **keep-alive** (monté à la 1ʳᵉ activation, reste monté `hidden` ensuite → filtres/chat/sélection survivent au switch) qui recouvre le `centerContent`. Le canvas reste **monté dessous** (jamais `display:none`, sinon le `ResizeObserver` du `Stage` re-mesurerait) ; il est juste caché visuellement. La `ProjectSidebar` interne (arbre `ProjectPanel`, colonne droite partagée avec les propriétés, toggle `projectPanelOpen`) est **persistante** across toutes les vues ; seul le centre swap entre canvas, détail Document (`<Outlet/>` quand `useChildMatches` non vide — mutuellement exclusif avec le `Stage`) et vues secondaires. Échap / × reviennent au canvas (`exitToCanvas`, `?tab=undefined`).
- **Source picker (`SourcePickerOptions`, `MenuProperties.tsx`)** — liste désormais les data sources live du serveur connecté (`useServerDataSourcesStore`, endpoint `GET /api/v1/servers/:serverId/data-sources`, cookie auth, section "On this server"), en plus des project data ; les refs restent librement saisissables (invariant hermétique). Le flow « import de connecteurs » YAML a été retiré le 2026-07-17 (mort — remplacé par les sources reportées serveur).
- **`SourceShapingEditor` (`properties/SourceShapingEditor.tsx`)** — éditeur visuel monté sous chaque `SourceRefInputRow` : filtre égalité (`filter: Record<field, value>`, valeur littérale ou `{arg}`), tri mono-clé (`sort.by`/`direction`), `limit`. Aucun changement runtime — édite les mêmes champs opaques `ContextInput.sourceRef` (round-trip YAML inchangé). Autocomplétion via `<datalist>` : champs depuis `serverSource.schema` (fallback saisie libre si `[]`), valeurs `{arg}` depuis les `contextInputs` de type `primitive` du menu.
- **`MenuDataSection` (`properties/MenuDataSection.tsx`)** — section « Données du menu » sous `ContextInputsEditor` : une carte par `sourceRef` consommé (ref, badge module, résumé des filtres actifs). Preview live via `previewDataSource` (`POST …/data-sources/preview`) avec les filtres du menu + un formulaire de valeurs d'essai pour chaque token `{arg}` détecté (`extractArgTokens`). Refs `pack:*` (project data) : pas de preview serveur, juste un hint renvoyant vers l'onglet Data.
- **Top bar** (`ProjectTopBarControls.tsx`) : surface compacte arrondie (`--r-lg`), groupes espacés sans séparateurs. Identité projet/serveur, navigation en capsules (`--r-md`, fond doux actif), outils contextuels puis recherche compacte, Enregistrer (brouillon) puis Déployer, menu `⋯` et Éléments tout à droite. Boutons et annuler/rétablir sur Canvas ; langue sur Canvas et Traductions. Les libellés des onglets se replient en icônes avant xl ; les groupes peuvent revenir à la ligne sous md. Raccourcis numériques en infobulles, routage et badges inchangés. Actualiser reste dans `⋯` via `RefreshProjectButton.renderTrigger`, avec confirmation montée hors menu. Abandonner les modifications reste dans le chevron de Déployer.
- **Colonnes droites (`ProjectWorkspacePanels`)** : canvas, `EditorPane` pleine hauteur, puis arbre `ProjectPanel` de 240 px tout à droite. Les propriétés apparaissent uniquement avec sélection/paramètres projet sur le canvas ou un menu ; commandes/dialogues individuels gardent leur éditeur central. Un `SplitPane` horizontal règle la largeur des propriétés (`editorPaneWidth`, persistée et plafonnée selon la place disponible). Aucune division verticale des propriétés. Le bouton Éléments est à droite de la topbar ; fermer l’arbre conserve les propriétés et inversement. Dans l’arbre, `ArrowLeftToLine` ajoute au canvas et `ArrowRightToLine` en retire. `DockedInspectorContext` empêche un second inspecteur flottant. Le canvas garde le même montage quand les panneaux changent. Mobile : scène/propriétés restent en split vertical.
- **`/settings`** — sidebar de sections (V1 = Apparence, héberge `EditorLangSwitcher`) + main content.

## Rendu data source live + mode placement (depuis 2026-07-15)

Le canvas rend de **vraies lignes** de data source (plus juste un sample statique), et un `Element` de menu a un 2ᵉ mode d'affichage à côté de `iterates` : le **mode placement** (`el.places`), réservé aux sources **statiques**. Cf. ADR `data-source-stability-and-placement` + `CONTEXT.md` (Data source / Placement / Row key).

- **Snapshots live** — `state/serverSnapshotsStore.ts` (`rowsByRef`, `loadSnapshot` via `previewDataSource`, dedupe module-level, le live gagne). `menuPreviewScope.resolveSourceRef`/`buildPreviewScope` acceptent un param `snapshots?` : pour un `sourceRef` serveur, résolution **rows locales de module (`FrontendModule.localPreviewRows`, ex. boutique) > snapshot live** (jamais pour `pack:`) ; le fallback `importedConnectors.sample` a été retiré (2026-07-17). `MenuGroup`/`ItemTooltip` chargent les refs serveur de la menu et bâtissent le scope avec.
- **Rendu placement** (`features/canvas/placement.ts`, pur + testé) — `placementTotalPages` (= max(page)+1), `matchPlacementRow` (match par `keyField`, stringifié), `resolvePlacementSlot` (live row > `cachedDisplay` > **dangling** = slot vide ; pas d'override par-placement — l'apparence vient du template), `capturePlacementCache` (snapshot name/material/lore pour offline). `MenuGroup` branche `el.places` dans la pré-passe pagination **et** dans `elementsByPosition` (une entrée par placement de la page courante) ; `ItemTooltip` miroir (bind alias, override title/lore, fallback cache) ; `menuFanout` **skip** `places` comme `iterates`. Le mode placement réutilise la navigation de pagination in-menu existante (`PaginationControls`).
- **Authoring** — `features/flow/PlacementField.tsx`, frère de `IterationField` dans `SelectionInspector` (positions + itération masqués quand `places` est set, XOR). Le toggle n'apparaît que si la menu binde une source **statique** (`serverDataSourcesStore` `stability === "static"` + `keyField`). Palette de lignes `RowChip` (`useDraggable` @dnd-kit, `id = row:<elementId>:<key>`, payload dans `data`) ; liste des placements (page/slot, remove — pas d'override par-placement). `enable()` seed `{ source: <1ʳᵉ source statique>, alias: "item", keyField, placements: [] }`.
- **Drop → placement** — `placementDrop.ts` : `pinPlacementRow` (glue partagée : lit les stores, capture `cachedDisplay`, préserve un override existant au re-pin, page courante depuis `paginationStore`). Registre `stageDropTarget.setStageSlotHitTest`/`tryStageSlotHit` (renvoie le `SlotHit` sans placer, enregistré par `Stage`). Le `onDragEnd` du route projet route les ids `row:` → hit-test → même menu → `pinPlacementRow`. **Fallback tap-to-place mobile** : `uiStore.armedPlacement` — taper une ligne l'arme, les slots de la menu ciblée deviennent des cibles (même vides, surlignées) → `pinPlacementRow`.
- **Reducers** (`projectsStore`) : `setElementPlaces` (clear iterates), `setElementIterates` (clear places — XOR bidirectionnel), `setElementPlacement` (upsert par `key`), `removeElementPlacement`. **Export** (`schema/menuV1FromDomain.ts`) : `places:` frère de `iterates`, `keyField`→`key_field` snake, override title/lore via `i18nRef` ; `cachedDisplay` **jamais exporté** (éditeur-only, fallback offline).

## Project sources & Data models (depuis 2026-07-20)

Les sources manuelles de projet (`pack:<id>`) sont passées de « YAML libre preview-only » à du **contenu déployable à schéma déclaré**. Cf. ADR `project-sources-and-data-models` + `CONTEXT.md` (Data source / Data model).

Au runtime, les listes/objets chargés automatiquement par `MenuRenderer` (inputs avec `source` ou refs directes dans `iterates`/`places`) restent locaux au menu, pagination comprise. `ExecutionContext.sourceArgs` conserve leurs valeurs d'origine : `open_menu` ne les hérite pas tant qu'elles n'ont pas été remplacées. Le menu cible recharge donc ses sources avec les nouveaux paramètres, y compris après un aller-retour catégorie → menu principal → autre catégorie. Les arguments fournis par l'appelant et les valeurs explicitement transmises via `with`/`context` restent prioritaires et conservent leur type. Un dialogue peut lire les sources héritées ; leur provenance est conservée jusqu'au prochain `open_menu`, sauf transmission explicite.

**Historique de navigation** (`session/NavigationHistoryStore.kt`) : une pile LIFO par joueur (menus **et** dialogs). `open_menu` / `open_dialog` y empilent l'écran quitté, `open_previous_menu` le dépile et le rouvre **sans** ré-empiler l'écran courant — la pile décroît à chaque retour, donc `menu → wiki → item` revient au menu en deux retours (pas de va-et-vient `item ↔ wiki`). Pile vide = no-op. `SyncedMenuProvider.openMenu`/`openDialog` enregistrent l'écran courant et injectent, en `sourceArgs` (donc jamais hérités par un `open_menu`, chaque écran a son propre précédent), les placeholders `{has_previous_menu}` et `{previous_menu.id}` / `.title`. La pile est vidée au `PlayerQuitEvent` et quand un menu se ferme **sans** ouvrir d'autre écran (ESC, `close_menu`) : `MenuListener.onClose` le vérifie au tick suivant (écran courant inchangé, aucun menu Artisan ouvert), car chaque navigation ferme aussi l'inventaire précédent. Une navigation vers un menu/dialog introuvable n'empile rien (`undoPushIfNotShown`) ; une navigation vers l'écran juste avant (même kind/id/project, args ignorés) est repliée en retour (`collapseReturn`).

- **Domaine** (`domain/types.ts` + `domain/dataModels.ts`) — `DataModel` = schéma récursif nommé (`ModelFieldType` : string/number/integer/boolean/**ltext**/**minimessage** (+ `_multiline`)/**item**/list/object/**model** ref, cycles interdits via `wouldCreateModelCycle` ; minimessage = string stockée, affordance d'édition seulement), Row key déclaré sur le model. `DataSource` = union `table` (`modelId` + `rows`) | `config` (`fields` inline + `value` objet). `applyFieldEdit` = **un edit de champ réécrit schéma + toutes les valeurs possédées** (rows des tables du model, occurrences imbriquées via refs, configs) avec release/coercition ltext — « données migrées, références danglées ». Les sources legacy (sans `shape`) sont **reset** au load (`normalizeDataSources`, `useProjectLoader`).
- **Row creation** -- the store chooses the first free positive integer for a number/integer Row key, otherwise the first free textual row_n identifier; gaps are reused.
- **i18n** — chaque valeur ltext d'une row est un Key site normal (`visitDataSourceLTexts` dans `domain/i18nSites.ts`), clé canonique lisible et entièrement lowercase `sources.<sourceName>.<rowKey>.<fieldPath>` (listes suffixées `_2`…, fallback positionnel `row_n` tant que la Row key normalisée est vide ou dupliquée). Les noms de source sont stockés lowercase et uniques après `trim().toLowerCase()` ; l'UI refuse les collisions avec une erreur inline. Les clés opaques existantes sont migrées au chargement ; renommer la source, modifier la Row key ou changer la structure rekey automatiquement les sites en conservant toutes les traductions. Mint au add (row/champ/élément de liste), release au remove, usages/Traductions gratuits via le visiteur.
- **Row-key invariant** -- a textual Row key is stored as trim().toLowerCase() and is unique case-insensitively within the source. An empty or duplicate manual edit is rejected inline without touching row data or translations; canonical ltext paths use that validated key: sources.<sourceName>.<rowKey>.<fieldPath> in lowercase. Positional row_n during visitation is defensive only for legacy/imported rows with invalid empty or duplicate keys; a generated row_n is instead a real stored Row-key value. Invalid imported rows are not silently renamed because their IDs may be externally referenced.
- **UI** (`features/data/`) — édition **form-only** (le pane CodeMirror YAML est mort) : `ModelFieldsEditor` (rename blur-commit, retype avec migration, kinds imbriqués, refs de models cycle-guardées, sélecteur Row key, ajout de champ = draft derrière bouton dashed — les inputs toujours visibles faisaient croire à un champ déjà créé), `SourceValueEditor` (`SourceRowsTable` = **sheet scrollable** : colonnes min-width + scroll horizontal, header / 1ʳᵉ colonne / colonne actions sticky ; cellule item → `ItemValueField`, cellule ltext → langue active via `setI18nValue`, cellule minimessage → `RevealField` façade `MiniMessageInline` comme les widgets SchemaForm, list/object récursifs ; `ConfigValueForm` pour la shape config). Sidebar : boutons `+ Table` / `+ Config` (une Table auto-crée son Data model). Delete d'une source : `window.confirm` avant `removeProjectDataSource`.
- **Export** (`schema/dataV1FromDomain.ts`, ADR `bare-data-files` depuis 2026-07-26) — `emitDataSources` écrit des fichiers **NUS** : `data/<id>.yaml` = liste de rows pures (table) ou mapping pur (objet/config), **jamais** de `fields:`/`shape:` inline. Le schéma part à côté : `models/<sourceId>.yaml` (doc model/v1 complet pour un model *possédé* — usage unique, pas référencé par un kind `model` — identité `id:` dans le doc ; sinon ref une-ligne `model:`), `_source.yaml` minimal (`name`/`model`/`model_version`/`order`) en per-row. Valeurs ltext → **littéral de la langue par défaut** inliné ; autres langues émises dans `lang/` par **adresse** key-site (`dataSourceI18n`), clés data exclues du fichier de langue par défaut. Hints `help` du model → bloc de commentaires généré (marqueur `# ──`, régénéré) + bloc d'en-tête main préservé (`DataSource.headerComment`). Import (`projectFromFiles`) : détection nue mapping/liste, résolution beside (`modelRefs`/`modelFileDoc`, indexés par **nom de fichier** = id de la source, l'`id:` interne du doc en repli — même règle que `ProjectReader.readProjectModels`), reconnexion des littéraux à l'adresse canonique (`ltData` + rekey), `adoptBareLTexts` au post-injection des models déclarés (loader). Les adresses keyent sur l'**id** de la source (renommer ne re-adresse pas).
- **Modes i18n `extract` / `inline`** (`Project.i18nMode`, depuis 2026-08-03) — quelle forme prennent les textes sur le disque (**superseded le 2026-09-30** par l'ADR `field-local-translations`, cf. bullet suivant). `extract` (défaut, et ce que veut dire l'absence du champ) : `{i18n:key}` dans les documents, toutes les langues dans `lang/`, langue par défaut comprise. `inline` : le document porte le **littéral de la langue par défaut** (`textSerializer`, alors dans `features/export/transform.ts` — titres de menu, title/lore d'apparence, labels de dialog ; `stepsToDsl` n'émet plus de `@key` mais des `"littéraux"`), les **autres** langues partent dans `lang/<code>.yaml` à l'**adresse canonique** du site, et **aucun** `lang/<défaut>.yaml` n'est écrit. Généralise aux menus/commandes/dialogs ce que les fichiers data font déjà (ADR `bare-data-files` ④). L'adresse d'un site = la clé canonique que `rekeyProject` assigne juste avant l'export ; le plugin la redérive de la structure du fichier (`engine/I18nAddresses.kt`), égalité verrouillée par `testdata/i18n-address-conformance.json` (23 cas, mêmes deux côtés). Import (`projectFromFiles`) : un littéral mint une clé comme avant, puis `adoptAddressedTranslations` (`domain/i18nSites.ts`) recolle les entrées `lang/` adressées au site — sans ça les autres langues flotteraient, listées mais rattachées à rien, perdues à l'export suivant. Le mode est persisté dans `.artisan/editor.yaml` (`i18n_mode: inline`, hash-exclu, écrit seulement s'il s'écarte du défaut) : c'est une forme de fichier, pas du contenu. Round-trip point fixe (`transformInline.test.ts`). **UI** : segmented control « Sur le disque » (Clés / Texte en clair) dans la barre de stats du panneau Traductions (`features/translations/TranslationPanel.tsx`, `ShapeTab`), action `setProjectI18nMode` ; bascule derrière un `window.confirm` (elle réécrit tout l'arbre au prochain save, donc change le hash du bundle), no-op silencieux si on reclique le mode courant. Doc user : `docs-site/.../editor/translations.md`.
- **Textes structurels field-local** (ADR `field-local-translations`, depuis 2026-09-30) - les titres de menu, `title`/`lore` d'apparence et `title`/`body`/labels de dialog portent leurs langues **dans le document** : un slot texte est une string (littéral ou `{i18n:key}`) ou une map `{ <lang>: texte }`. `schema/fieldText.ts` (`fieldTextOf`) écrit la map depuis `project.i18nKeys[site.key]` - une string seule quand seul le `defaultLang` a une valeur ; l'import (`menuV1ToDomain` / `dialogV1ToDomain` / `projectFromFiles`, helper `isLangMap`) range la map sous une clé mintée. `lang/` ne porte plus que les textes d'action (refs `@key` dans l'Action DSL), les clés sans site et les data sources. Côté plugin, `model/LocalizedText.kt` lit la map avec repli langue demandée → `defaultLang`. Les adresses positionnelles ne sont plus un contrat de rendu pour les documents (vecteur `testdata/i18n-address-conformance.json` retiré).

- **Complétude i18n** — une valeur source explicitement vide est un contenu valide et volontaire. Le panneau ne compte comme manquante qu'une langue secondaire vide lorsque la source contient du texte ; `validate.ts` exige toujours que l'entrée source existe, mais accepte `""`. L'export conserve la chaîne vide pour que le runtime n'affiche pas la clé brute.
- **Fichiers `lang/`** (`lib/langTree.ts`, depuis 2026-07-30) — `serializeLang` produit toujours une map de clés pointées triée byte-order, puis `nestLangTree` la convertit en **arborescence YAML** (chaque `.` = un niveau, chaque niveau retrié byte-order → fichier déterministe, donc hashable). L'inverse `flattenLangTree` sert aux trois readers (import `projectFromFiles`, mutation module backend, vue YAML du panneau Traductions à l'« Appliquer ») et tolère arbre / plat legacy / mélange. La vue YAML du panneau Traductions (`features/translations/translationsYaml.ts`) émet **la même arborescence**, commentaires portés par les feuilles via `commentBefore` (contexte seulement s'il n'est pas la clé mot pour mot — sets d'items prettifiés, `(unused)` ; puis `# <defaultLang>: <source>` hors langue par défaut). La structure de l'arbre remplace le tri par contexte comme regroupement. Miroir Kotlin `LangFlattener` (lecture seule — le plugin n'écrit jamais de `lang/`), égalité verrouillée par `testdata/lang-tree-conformance.json`. Une clé bloquée par une feuille (`a.b` + `a.b.c`) reste pointée à la racine ; valeurs non-string coercées, `null` → `""`, listes ignorées.
- **Runtime plugin** — `ProjectReader` scanne `data/*.yaml` (tolérant par fichier, formes nue + legacy) → `RuntimeDataSource` ; il lit aussi `models/` au load (docs verbatim `{name, type}` aplatis vers le vocabulaire inline) et les déclarations JAR via le supplier `declaredModels`. Le namespace réservé `pack:` est résolu au **fetch seam** du renderer (`ProjectDataResolver`), avec la règle d'un id nu de Document reference : Project du menu d'abord, puis id unique sur le serveur (ambigu → le premier chargé) ; les ltext se localisent au bind : **clé explicite > adresse key-site (`sources.<id>.<rowKey>.<champ>`) > littéral** ; une config binde son objet entier sans shaping (`ContextBinder` accepte `Any?`).

### Champ `actions` & Action DSL (depuis 2026-07-21)

Les commandes de Project (`PackCommand`) initialisent `ExecutionContext.lang`
via `LangManager.playerLang`, comme `/artisan menu`. `open_menu` / `open_dialog`
conservent cette langue ; les titres et lores, boutons image compris, utilisent
donc la langue du joueur ou celle configurée si `per_player_language` est désactivé.

Kind de champ `actions` (`ModelFieldType`) : une **Action chain** (`Step[]`) stockée comme **chaîne Action DSL** — la sérialisation texte compacte, écrivable à la main dans le YAML disque. Cf. ADR `action-dsl` + `CONTEXT.md` (Action chain / Action DSL).

- **Codec** (`editor/src/lib/actionDsl/`) — pur, sans Project : `lexer.ts` (tokenizer indentation-aware, `#` commentaires), `parser.ts` (`parseActionDsl` → `DslStep[]` : `if`/`else if`/`else`, 20 verbes, conditions typées + `%ph% ==/matches` → `placeholder_equals`/`_match`, fallback `expression`, `and`/`or`/`not` + parenthèses), `printer.ts` (`printActionDsl`, canonique). `ast.ts` = AST miroir du domaine avec texte explicite `DslText` (`{lit}` littéral | `{ref}` clé i18n `@key`). `fixtures/action-dsl-fixtures.json` = vecteurs de conformité `{dsl, ast, canonicalDsl}`, **contrat cross-stack** (futur miroir Kotlin), asservis par `actionDsl.test.ts`.
- **Adaptateur** (`domainSteps.ts`) — `DslStep[]` ↔ domaine `Step[]`. Le domaine porte le texte en `LText{key}` qui ne distingue pas littéral vs ref : encodage réversible **préfixe `@`** dans la clé (`{ref:k}` ↔ `key:"@k"`, `{lit}` verbatim, convention `literalSteps`). Permet au `ControlledStepsEditor` existant de round-tripper sans perte (taper `@shop.vip` dans un champ texte relit un ref). L'enregistrement i18n Key-site des refs est différé (phase 1 = chaîne DSL opaque).
- **UI** (`features/data/ActionFieldEditor.tsx`) — deux modes sur la **même** chaîne DSL : **Visuel** (`ControlledStepsEditor` pseudocode via l'adaptateur) et **Code** (textarea DSL brut = la forme disque). Erreur de parse → fallback textarea. Câblé dans `SourceValueEditor` (`case "actions"`).
- **Export** — `serializeDataFieldType` émet `kind: "actions"` (le plugin le parsera+exécutera) ; `serializeDataValue` passe la chaîne verbatim. Schéma `data/v1` : `actions` dans l'enum des kinds.
- **Différé** : parseur + évaluateur de feuille Kotlin (contre les mêmes fixtures), exécution runtime, litéraux de liste `[...]`, montants dynamiques, queue avancée du DSL d'expressions.

## Export / import de project (.zip)

**Export** (`features/export/runExportZip.ts`) — l'archive est l'arbre de fichiers
**tel que le serveur le stocke**, pas une régénération depuis le domaine : flush de
l'auto-save (`persistProject`), `GET /api/v1/user/projects/:id` → `files`, `buildZip`
verbatim. Deux conséquences voulues : l'archive porte ce que le domaine ne modélise
pas (`.artisan/editor.yaml`, les fichiers propres d'une racine Add-on), et **aucune
validation ne peut bloquer la sortie des fichiers** — récupérer sa config ne dépend
pas de sa validité (promesse anti-lock-in, ADR `files-first-source-of-truth`).
Réseau requis : sans serveur joignable l'export échoue, il n'y a pas de repli sur
`projectToFiles()` (un repli produirait une archive *presque* fidèle sans le dire).

**Import** (`features/export/runImportZip.ts`) — `zip → files → projectFromFiles`,
sans format intermédiaire. `normalizeProjectFiles` (`projectZip.ts`) re-route les
entrées sur `plugins/Artisan/projects/<id>/` quelle que soit la forme reçue : notre
export, un dossier de project zippé directement depuis le serveur, un `manifest.yaml`
à la racine, ou l'un des trois emballé dans un dossier supplémentaire. La racine est
le dossier du `manifest.yaml` le **moins profond** ; l'id vient du `project_id` du
manifest, sinon du nom de dossier. Erreurs typées `not_a_zip` / `no_manifest`.

> L'export/import JSON (`projectFileIo.ts`, `.artisan.json`) a été supprimé le
> 2026-07-30 : il sérialisait le domaine en mémoire, une seconde représentation du
> project à côté de l'arbre de fichiers — exactement ce que `editorJson` avait déjà
> coûté (P3a).

## Le codec fichiers ↔ domaine (`editor/src/schema/`)

Les deux sens vivent côte à côte, un module par kind et par sens : `<kind>V1ToDomain.ts` lit, `<kind>V1FromDomain.ts` écrit (`menu`, `command`, `dialog`) ; `dataV1FromDomain.ts` écrit `data/` et `models/` (avec `yamlHints.ts` pour les commentaires générés), `langV1FromDomain.ts` les entrées de `lang/`, `fieldText.ts` la forme d'un texte de site (string ou map par langue). `projectFromFiles.ts` et `projectToFiles.ts` assemblent l'arbre complet ; `documentCodecs.ts` est la façade par kind que les deux parcourent. La sauvegarde disque, l'éditeur de sources et les écrans de config écrivent tous par `projectToFiles` ; `features/export/` ne garde que le zip et la validation. Aller-retour verrouillé par `codecRoundTrip.test.ts` (exemples `docs/schema/*/v1/examples`) et le point fixe de `projectFromFiles.test.ts`.

### Import `menu/v1 → domain`

`editor/src/schema/menuV1ToDomain.ts` est l'inverse pur de `schema/menuV1FromDomain.ts` : il prend un objet `menu/v1` canonique (wire, snake_case, ce que valide `validateMenuV1.ts`) et reconstruit un `Menu` domain. Signature `menuV1ToDomain(src, { projectId, lang, translations? }) → { menu, i18nKeys, unsupported }`. **Pur** : aucune mutation de project — les clés i18n allouées sont retournées dans `i18nKeys` (l'appelant les merge dans `project.i18nKeys`).

- **Pont i18n** : un champ texte `menu/v1` est une `string`. Littéral → nouvelle clé (`newI18nKey`), valeur rangée sous `lang`. `{i18n:KEY}` → réf `LText{key:KEY}` ; si `translations[KEY]` fourni, copié dans `i18nKeys`. Les title-layers portent déjà `value:{key}` → réf directe. `lore` (string[]) → un seul `LText` (lignes jointes par `\n`).
- **Vocab sous-ensemble** : seules les actions/conditions représentables côté domain sont mappées explicitement (un-snake + drop des champs absents du domain, p.ex. `has_money.currency`). Tout autre type (`has_item`, `give_money`, `teleport`…) part dans `unsupported` plutôt que de crasher.
- **Remaps** : `size`→`rows` (÷9), `pagination_next/prev`→`paginate{direction}`, `context_inputs`→`contextInputs` (`primitive` vs `sourceRef` selon présence de `ref`).
- **Round-trip** : l'oracle `menuV1ToDomain.roundtrip.test.ts` exporte un project domain riche puis le ré-importe. Note : un `if` d'appearance OR-joiné ne round-trip **pas** structurellement (l'export enrobe une liste pure-OR en une condition composite `{type:"or", of:[…]}`) — l'oracle utilise donc des AND-joins.

## Assistant IA (supprimé)

Le pipeline d'application IA (`applyAssistant*` dans l'ancien `accountStore`, client SSE, panel chat, migration zMenu reprenable) a été retiré avec le backend : il n'existe plus dans l'éditeur (issue #44). Les convertisseurs `menuV1ToDomain` / `commandV1ToDomain` / `dialogV1ToDomain` restent pour l'import `menu/v1 → domain` ci-dessus.

## Design system (tokens + composants)

`components/ui/guided-tour.tsx` exports `GuidedTour`, using semantic tokens and a
Radix modal for keyboard focus, with responsive target highlighting. Escape defers
the tour and restores focus. Specimen: `/design`, section `guided-tour`.

`components/ui/file-diff.tsx` affiche une comparaison unifiée serveur → éditeur,
avec numéros de ligne, contexte, signes −/+, tokens `danger-soft`/`success-soft`
et marqueurs LF/CRLF/saut final absent. Comme `git diff`, les suites inchangées se
replient en une ligne dépliable, avec trois lignes de contexte (`context`). Les libellés
des deux côtés sont configurables. `components/ui/change-list.tsx` liste les fichiers
d'un changement (`listChanges` : nouveau, supprimé, modifié, renommé, binaire), avec
un résumé +/− et un `FileDiff` dépliable par fichier. `components/ui/tooltip.tsx` (Radix,
version alignée sur les primitives déjà installées) : bulle fléchée instantanée au survol
et au focus, couleurs inversées `--text`/`--surface`, à préférer au `title` natif.
`components/ui/filled-icons.tsx` porte les icônes pleines que Lucide ne fournit pas. Dans la liste, `FileDiff wrap` replie
les longues lignes et n’a pas de hauteur max : un seul conteneur défile, l’en-tête du
fichier reste collé en haut. Des zones de défilement imbriquées rendaient la fin des longs diffs illisible. Les contenus identiques et fichiers absents
sont explicites. Le calcul LCS est borné à un million de cellules ; au-delà,
les portions différentes apparaissent comme un remplacement complet.
Spécimen dans `/design`. `SaveControls` conserve l'arbre de la tentative
refusée et compare chaque contenu `conflicts[].disk` à cet arbre dans un
`Collapsible` (premier ouvert). Les choix de résolution restent explicites.

Source de vérité visuelle de l'éditeur, visualisable en live sur **`/design`** (page `features/design-system/DesignSystemPage.tsx` ; la route passe de `/admin/design` à `/design` avec la suppression de l'administration).

**Règle pour tout nouveau développement UI** : passer en priorité par le design system — d'abord les composants `components/ui/` (Button, Input, FormField, Badge, EmptyState, Card, Dialog, Sheet, Tabs, DropdownMenu) ou les classes utilitaires de `styles/globals.css` (`.btn*`, `.input`, `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`, `.rule`…) ; si un composant manque, le **créer dans `components/ui/`** puis ajouter son spécimen à la page `/design` dans le même commit. Jamais de hex/rgba en dur (toujours `var(--token)`) — exception : le canvas Konva, non thémable par CSS.

Structure des tokens (`styles/globals.css`) en 3 couches :
1. **Palette brute** : `--gray-*`, `--emerald-*`, `--red-*`, `--amber-*`, fonts (`--font-display` Spectral / `--font-body` Hanken Grotesque / `--font-mono` IBM Plex Mono), radii `--r-xs…--r-pill`.
2. **Tokens sémantiques** (théméd dark défaut / light via `[data-theme]`) : `--surface*`, `--text*`, `--border*`, `--brand*`, `--success/--warning/--danger` (+ variantes `-soft`), `--shadow-sm/md/lg`.
3. **Aliases shadcn** (`--background`, `--primary`, `--accent`…) mappés sur la couche 2, + bridge Tailwind `@theme`.

Les composants ne référencent **que** la couche 2 (ou les aliases couche 3 pour les primitives shadcn).

### Primitives `Table` / `StatCard` / `HBar`

Trois nouveaux composants de présentation de données, visualisables en live sur **`/design`** :

- **`Table`** (`components/ui/Table.tsx`) — tableau multi-ligne scrollable, sortable par colonne, avec ligne d'en-tête collante. Headers `align-left/center/right`, cells alignées. Wrapper shadcn.
- **`StatCard`** (`components/ui/StatCard.tsx`) — carte de métrique (label + valeur + contexte, optionnel badge trending). Utilisé dans les dashboards d'usage (`/admin/ai/usage`).
- **`HBar`** (`components/ui/HBar.tsx`) — barre horizontale segmentée (répartition : couleurs par segment). Visualise les proportions (ex. usage par modèle). Tokens de couleur `--success` / `--warning` / `--danger` et variantes `-soft`.
- **`Collapsible`** (`components/ui/collapsible.tsx`) — section repliable (trigger pleine largeur + chevron, `title` / `meta` pour un badge ou compteur, contrôlé ou non via `open`/`defaultOpen`). **Le contenu est démonté tant que la section est fermée** — c'est la raison d'être du composant : les sections lourdes que la plupart des utilisateurs n'ouvrent jamais (les paramètres avancés d'un item) ne coûtent rien. Spécimen sur `/design`.
- **`DataTable`** (`components/ui/data-table.tsx`) — visualiseur générique de lignes de preview, utilisé par l'explorateur de sources du serveur et la section « Données du menu » du menu. Deux vues : **Tableau** (colonnes = union des clés des lignes, ordre de première apparition) et **YAML**. Les lignes arrivent en JSON sur le WS, mais une cellule de tableau ne sait qu'aplatir un objet en blob d'une ligne — dès qu'une source imbrique (`stages` → `objectives` de `msquests:quests`, `items` de `boutique:categories`), la vue YAML est la seule lisible : indentée, colorée, **pliable**. Le toggle n'apparaît que si l'appelant passe `tableLabel` + `yamlLabel` (composant muet, il ne traduit pas) ; la vue Tableau reste le défaut. Sérialisation en `lineWidth: 0` — une string MiniMessage doit rester sur une ligne pour être copiable. Spécimen sur `/design`.
- **`YamlCodeEditor`** (`components/ui/yaml-code-editor.tsx`) — CodeMirror + `@codemirror/lang-yaml`. `readOnly` donne le **mode lecture** : même coloration, mêmes gouttières, même pliage, contenu non éditable (`onChange` devient optionnel), sélection et copie conservées. C'est ce mode qu'utilise la vue YAML de `DataTable`. Dette connue : `YAML_CM_THEME` code ses couleurs en hex et force `theme="dark"`, contrairement à la règle « couleurs via `var(--token)` » — visible le jour où une surface YAML atterrit sur un fond clair.
- **`Checkbox`** (`components/ui/checkbox.tsx`) — case à cocher native teintée `accent-[var(--brand)]`, contrôlée (`checked` / `onCheckedChange`). Pour un état de formulaire confirmé explicitement (ex. « garder ce choix pour tous les fichiers suivants » dans l'import de projet) ; un réglage persistant qui change le résultat en jeu garde `<Switch>`. Spécimen sur `/design`.

## Public landing

`features/marketing` hosts the public `/` landing of artisanmc.net (`MarketingLayout`,
semantic tokens, EN/FR language selector). The pricing page, billing catalogue, credits
and demo links were removed with the cloud in phase F.
