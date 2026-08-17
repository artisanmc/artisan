# Editor & rendering internals

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

Pour positionner chaque layer à son `x` exact, le backend embarque dans `assets/artisan/font/default.json` un provider `space` (MC 1.20+) mappant 18 codepoints (`U+F800..U+F811`) à des advances en pixels (puissances de 2 ±1/±2/.../±256 → portée ±511 px par décomposition gourmande, **plus avec réutilisation** des chars). On évite `U+F900..U+FAFF` (CJK Compatibility Ideographs) où la font vanilla a des glyphes qui empêcheraient le provider `space` de s'appliquer.

Pipeline :

1. **Backend** — `backend/src/lib/spaceOffsets.ts` = source de vérité de la table. `buildDefaultFontJson` ajoute le provider `space` après les bitmaps. `buildAssetIndex` (v2) émet `offsets` (codepoint hex uppercase → advance) + un `width` par entrée.
2. **Plugin** — `AssetCatalog` parse `offsets` à chaque update RP et construit un `OffsetEncoder` (`net.artisanmc.plugin.render.OffsetEncoder`). `TitleCompiler.compileTitle` track `currentX`, insère `offsetEncoder.encode(targetX - currentX)` avant chaque body de layer, avance `currentX = targetX + estimateBodyWidth(layer)`.
3. **Estimation de largeur** (best-effort) : Image → `AssetEntry.width` (fallback 16) ; Text → `length * 6` (heuristique imprécise) ; ExternalGlyph → 8 px.

**Coordonnées x** : `layer.x` = pixels depuis le bord gauche du coffre (`chest-x 0`). Le titre MC est dessiné à `titleLabelX = 8`. `TitleCompiler` initialise `currentX = TITLE_LABEL_X = 8` pour absorber ce décalage : `x=8` → offset nul, `x=0` → offset `-8`.

L'encoder plugin est **lenient** : ne lève jamais d'exception, retourne `""` si table vide (catalog pas chargé), best-effort hors plage. Côté backend, `encodeOffset` est **strict** (throw) pour attraper les bugs à la source.

## Custom fonts (SP4)

Import MCFonts via "Import font" dans l'AssetsTab : drop d'un `.zip` (`font.json` + glyph PNGs). Le backend parse/valide/stocke (`data/assets/{projectId}/fonts/{asset_id}/`) et crée une row `Asset` `type=font` + `fontMeta = { namespace, glyphMap }`. À la régén RP : `assets/artisan/font/<name>.json` + `textures/font/<name>/*.png` embarqués. Éditeur : `TitleRender` rend pixel-perfect via `McFontText` (composition Konva des glyph PNGs).

Background = "gros glyph" : ascent calibré pour couvrir la zone. `LayerEditForm` (Background) expose "Calibrer pour coffre" → `ascent = -11` (zone des slots). Pour couvrir depuis le haut (y=0) : `ascent = 6`. Formule : `ascent = titleLabelY(6) - targetY`.

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
- **Supprimés vs v2** : `FocusComposer.tsx`, `ComposerCanvas.tsx`, `AddLayerBar.tsx`, `LayerSidePanel.tsx`, `TitleThumbnail.tsx` (+ tests).

## Édition d'un Document — onglet « Edit » du `EditorPane`

Le Document sélectionné s'édite dans le panneau de droite. L'ancien **mode focus** plein-écran (forké, `features/element-editor/` + `FocusButton` + `useElementDblClickNav`) a été retiré 2026-06-06 : doublon de l'onglet Edit + bugs de routing. Le 2026-06-13, une **vue individuelle** deep-linkable l'a remplacé sur des bases saines — un seul rendu partagé avec la planche, pas d'éditeur forké (cf. section « Planche curée » plus bas). La route `.../document.$documentId` est donc à nouveau présente, mais avec une implémentation différente.

- **`features/canvas/EditorPane.tsx`** — `Tabs` à 3 onglets : **Edit / Library / Assets** (`uiStore.editorTab`). L'onglet `edit` rend `<FlowCanvas>` ; l'onglet `library` a ses propres sous-onglets **Items / Capturés**. **Le set d'items se crée au NIVEAU DU MENU et n'existe qu'à travers l'élément qui le rend** (ADR `item-templates-and-data-library`, révision 2026-07-31 — plus d'`ItemTemplate` project-level, plus d'onglet « Sets », plus de `templates/`) : `MenuDataSection` (« Données du menu ») porte un bloc « Set d'items » par liste — `createMenuSet` (store) crée un élément **auto-suffisant** (display seedé icône/nom/prix) en mode `iterates` (plage par défaut) ou `places` ; en mode placement, `PlacementRowsPanel` liste les rows du **contexte d'aperçu courant** (`buildPreviewScope` + `menuPreviewArgs`) en tuiles draggables (`PLACEMENT_ROW_DRAG_PREFIX`, drop géré par `MenuGroup`/`pinPlacementRow`).
- **`features/flow/FlowCanvas.tsx`** — éditeur unifié de la sélection courante (`useSelectionStore`). Route par type :
  - 0 sélection → `ProjectProperties`
  - menu → `MenuProperties` (+ `LayersPanel` titre)
  - élément (slot) → state cards (material / title / lore / conditions + click handlers en pseudo-code)
  - command → identité + args + step tree
  - dialog → title / body / buttons + actions par bouton
  - multi-sélection → "select one item" (multi-edit hors V1)
- **Sélection → onglet Edit** (depuis 2026-06-06) : cliquer un menu / slot / command / dialog sur le canvas bascule `uiStore.editorTab` sur `"edit"` (dans `useMenuClick` + les handlers de slot de `MenuGroup` + l'`onClick` de `CommandGroup`/`DialogGroup`), pour que l'élément soit éditable sans changer d'onglet à la main. Le placement d'item « armé » et la multi-sélection (shift) ne basculent pas.
- **Têtes custom (PLAYER_HEAD)** : choisir `PLAYER_HEAD` comme material d'un state révèle une ligne « tête custom » sous le sélecteur de material. Un select choisit la source (`HeadDatabase` / `Base64` / `Player name`) et un champ de valeur apparaît à côté. Le coller d'une valeur entière est détecté automatiquement : `hdb:<id>` ou une chaîne brute `eyJ…` (base64) sont routés vers la bonne source sans action supplémentaire. Les aperçus sont résolus via `headPreviewUrl` (`editor/src/features/canvas/headTexture.ts`) : base64 et noms de joueur littéraux → rendu 3D mc-heads.net ; ids HeadDatabase et noms avec placeholder → icône de tête générique. Les aperçus s'affichent sur les slots Konva, les ghosts de drag, les overlays sibling et les icônes de la state card.

### Paramètres avancés d'un item (depuis 2026-07-29)

Sous le lore de chaque state card, `features/flow/AdvancedItemSection.tsx` replie derrière un `<Collapsible>` tout ce qui dépasse material/titre/lore : **enchantements** (id + niveau, `datalist` sur le catalogue vanilla de `domain/itemAdvanced.ts` mais **saisie libre acceptée** pour le moddé), effet brillant sans enchant, custom model data, incassable, sections de tooltip masquées, **couleur** (affichée uniquement si le material est teintable — cuir / potion / étoile de feu d'artifice), et **NBT brut**. Un badge sur le trigger compte les valeurs posées (`countAdvanced`) pour qu'un item configuré ne cache pas sa propre configuration. Les mutations passent par l'action de store unique `setAppearanceAdvanced` (patch partiel ; une clé à `undefined` efface le champ).

Le format wire de ces champs et les conventions partagées avec le plugin sont dans `schemas-codegen.md` § « Détails avancés d'item ».

**Une ref est additive, pas un remplacement** (2026-08-06). L'item référencé garde ce qu'il dit de lui-même et l'apparence se **superpose** : son lore s'ajoute **sous** celui de l'item, son titre gagne (deux noms ne se concatènent pas) et le nom de l'item tient quand l'apparence n'en déclare pas. C'est le runtime qui commande — `MenuRenderer.buildItem` part de la stack résolue puis appende (`MenuRendererCapturedLoreTest`) ; `ItemTooltip` lit `domain/capturedItems.ts` `capturedPresentation` pour dessiner exactement ça. Écraser le lore de l'item était le vrai coût de la ref : une icône de boutique perdait tout ce que l'item capturé disait.

**Extraction d'un item capturé.** Reste l'échappatoire quand on veut *éditer* ce que l'item porte. Le bouton « Extraire les détails » (visible seulement sur ces refs) parse le `stackYaml` via `domain/capturedStack.ts` et **éclate la ref en champs réels** — material, count, titre, lore et tout le bloc avancé. L'opération demande confirmation car elle est destructrice au sens du lien : le slot ne suit plus l'item capturé s'il est recapturé. C'est le compromis assumé : la ref est vivante mais opaque, les champs sont morts mais éditables.

**Glint.** `SlotItem` dessine un halo violet + une étoile `✦` en haut-gauche (le compteur de stack occupe le bas-droite) quand l'apparence porte des enchants ou le flag, **ou** quand la ref capturée en porte (`resolveDisplayRef` interroge le stack sérialisé, pas seulement le descripteur `.artisan/editor.yaml` — les vieilles captures et les items écrits par un module n'ont pas de descripteur). Ce n'est **pas** une réplique du shader vanilla : teinter uniquement les pixels opaques du sprite demanderait un filtre Konva caché par slot, ce qu'un menu à 54 slots ne peut pas payer. Le marqueur est sans ambiguïté à cette taille, ce qui est le besoin du canvas. `ItemTooltip` liste en plus les enchantements entre le nom et le lore, à l'orthographe vanilla (`Sharpness V`, pas de numéral pour les enchants mono-niveau).

## Canvas component layout (refactor 2026-06-02)

`features/canvas/MenuGroup.tsx` (1066 → 591 lignes) éclaté : `SlotItem.tsx`, `PaginationControls.tsx`, `menuFanout.ts` (fanout positionnel pur, testé), `useMenuClick.ts` (armed-material tap-to-place), `useMenuDrag.ts` (cross-project via project-mini DOM walk), `useSlotDrag.ts` (selection drag + Alt).

`features/canvas/Stage.tsx` (528 → 351 lignes) éclaté : `ArmedBanner.tsx`, `useStageTouch.ts` (long-press → context menu), `useStageContextMenu.ts`.

Note : cibles de taille (≤400/≤250) pas entièrement atteintes (MenuGroup 591, Stage 351) — split supplémentaire différé.

## Types d'inventaire (Chest / Hopper / Dropper, depuis 2026-06-14)

Un menu est un coffre (défaut), un hopper (5×1) ou un dropper (3×3). La **single source of truth** est la table `INVENTORY_TYPES` dans `features/canvas/inventoryTypes.ts` : par type elle porte `cols`, les `rows` fixes (`null` pour le chest = `menu.rows`), l'origine du slot 0 en px MC (`firstSlotX/Y`), la hauteur de box (`null` = calculée depuis les rows pour le chest), la clé texture et le type Bukkit. Helpers : `colsFor`, `rowsFor`, `slotCount`, `slotMcXY` (stride constant `MC_SLOT_STRIDE = 18`).

**Title composer width-agnostic** : les trois GUI conteneurs vanilla font **176 px MC de large** avec le titre à `(8, 6)`. Seules la **hauteur de box** et la **grille de slots** varient par type — aucune paramétrisation de largeur n'est nécessaire dans le title composer.

**Fonds (`MenuGroup`)** : le chest utilise la texture deux-tranches `generic_54.png` (header + slice de lignes répétée). Le hopper et le dropper utilisent une **image de box complète** (`hopper.png` / `dispenser.png`). `MenuGroup` branche via `usesSingleBackground(type)`.

**Hit-test + drag paramétrés par type** : `hitTest.ts` et `useSlotDrag.ts` lisent cols / origine / rows depuis la table — plus aucun hardcode des 9 colonnes du chest.

**Switch de type = keep+warn** : `MenuProperties` expose un sélecteur de type (Chest / Hopper / Dropper) ; le sélecteur de rows n'apparaît que pour le chest. Passer à un conteneur plus petit **conserve** les éléments hors-plage et affiche un chip d'avertissement — jamais de suppression silencieuse (`setMenuField` keep+warn).

## Canvas edges (liens entre nœuds)

Les liens menu/commande/dialog sont dérivés des actions (`deriveEdges.ts`, inchangé) puis
routés par `edgeRouting.ts` (pur, testé) : côté de sortie/entrée choisi par position
relative des nœuds (`autoSide`), endpoints d'un même côté regroupés vers leur position
naturelle (projection du nœud opposé) avec séparation minimale `ANCHOR_SEP_PX` (16 px,
marge coins 10 px), tracé bézier cubique à tangentes perpendiculaires
au bord (longueur ∝ distance, clamp 24–160 px). Rendu : `Edges.tsx` en Konva `Arrow`
(tête de flèche côté cible), hover → `EdgeTooltip`, clic → sélection + 2 poignées
draggables le long du bord (snap périmètre via `closestAnchorOnBox`).

Overrides manuels : `project.canvasEdges[edgeId] = { from?, to? }` avec
`EdgeAnchor = { side, t∈[0,1] }` (ratio → survit au resize). Edge id = `"source->target"`.
Les overrides sont des pins exacts : jamais écartés par la séparation auto — deux ancres
manuelles peuvent se superposer ; seules les ancres auto cèdent le gap minimal.
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

Cf. `docs/superpowers/specs/2026-06-13-workspace-board-curation-design.md` (supersède le focus mode de `2026-06-02`). Le canvas n'est plus un canvas libre qui force tout en grille : c'est une **planche curée**, doublée d'un panneau source-de-vérité et d'une vue individuelle deep-linkable. **Invariant n°1** : un seul rendu/éditeur par type de Document, partagé entre planche et vue individuelle — c'est ce qui supprime la divergence qui avait causé le revert du focus mode.

### `canvasLayout` = appartenance à la planche

Un Document est **sur la planche ssi** il a une entrée explicite `project.canvasLayout[id] = {x,y}` (présence = appartenance, plus seulement position sauvegardée).

- `autoLayout(project)` (`features/canvas/autoLayout.ts`) ne remplit **plus** la grille : il ne retourne que les entrées explicites de `canvasLayout`.
- `gridArrange(project)` (même fichier) construit une grille complète sur tous les Documents — appelé uniquement par le bouton « Tout arranger » via l'action store `arrangeAllOnBoard({projectId})`.
- Trois actions `accountStore` distinctes : `addToBoard({projectId, nodeId, x, y})` / `removeFromBoard({projectId, nodeId})` manipulent `canvasLayout` (le Document reste dans le project) ; `deleteFromProject({projectId, nodeIds})` (existant) retire le Document du project.

### `Project.moduleData` — état opaque par module

`Project.moduleData?: Record<string, unknown>` porte l'état d'un module tiers, keyé par id de module (ex. `"boutique"`) — le host ne l'interprète jamais. Round-trip files-first : `projectFromFiles` seed `moduleData[<dir>] = { __files: Record<relPath, content> }` pour un dossier de project non reconnu ; le module éditeur normalise `__files` à sa forme structurée à la première lecture, et dérive son `exportFiles()` depuis `moduleData` ; `transform()` ré-émet les `__files` verbatim des namespaces sans module registré. Action store : `setModuleData(projectId, moduleId, data)` (Immer `produce`, remplace tout le namespace, préserve les autres).

Exemple concret (module boutique, V1.5 — `docs/architecture/modules.md` §15) : le plugin Add-on Boutique bootstrappe `projects/boutique_shop/boutique/shop.yaml` sur disque ; un `local_push` sur ce project stub seed `moduleData.boutique.__files["shop.yaml"]` (le préfixe du dossier module est retiré des clés `__files`). `@artisan/boutique-editor` (presence-gated `/m/boutique`) lit ce state, le normalise en catalogue structuré (categories/items) au premier accès, expose un form d'édition (pas de `<SchemaForm>` générique, §8), et sa fonction `exportFiles()` régénère `boutique/shop.yaml` depuis `moduleData.boutique` à chaque deploy — round-trip complet sans que le host `Project` n'ait besoin de connaître la forme du catalogue.

### `ProjectPanel` — panneau gauche source de vérité

`features/project/ProjectPanel.tsx` : liste **tout** le project groupé par catégorie (Menus / Commandes / Dialogs), construite par `buildProjectDocuments(project, lang)` (`useProjectDocuments.ts`).

- Recherche texte.
- **Bouton toggle « canvas »** par ligne (remplace l'ancien drag-and-drop, retiré) : flèche entrante `title="Ajouter au canvas"` → `addToBoard` quand le Document est hors planche ; flèche sortante colorée `--brand` `title="Retirer du canvas"` → `removeFromBoard` quand il est présent. La couleur `--brand` du bouton « retirer » sert aussi d'indicateur d'état (remplace l'ancien badge texte « sur la planche »).
- **Clic** sur le label → ouvre la vue individuelle (n'ajoute pas à la planche). **Menu contextuel `···`** : éditer / supprimer du project (l'ajout/retrait passe par le bouton toggle).
- Terminologie user-facing : « canvas » (les actions/identifiants internes gardent `board` : `addToBoard`, `removeFromBoard`, `canvasLayout`).
- 3ᵉ zone du layout overview desktop (panneau · planche · `EditorPane`).
- Helper de label partagé `documentLabel(project, id, lang)` (`useProjectDocuments.ts`) — utilisé aussi par l'en-tête de `DocumentView`.

### Vue individuelle (deep-linkable)

`features/project/DocumentView.tsx`, monté par la route enfant `…/projects/$projectId/document.$documentId.tsx`. La route overview bascule dessus via `useChildMatches()` (`childMatches.length > 0 → <Outlet/>`) — donc rechargement, bouton retour navigateur et lien partageable fonctionnent.

- **Dispatch par type** : menu → `SoloMenuStage` (`features/project/SoloMenuStage.tsx`, hôte d'un `<MenuGroup>` en mode solo) en `primary` d'un `SplitPane` + `EditorPane` en `secondary` ; commande / dialog → `FlowCanvas` centré (`max-w-3xl`).
- Sélection posée via `useSelectionStore.set([documentId])` au montage → `FlowCanvas` (clé sur la sélection) et `MenuGroup` éditent par le **même** chemin que la planche. Introuvable → `EmptyState`.
- **INVARIANT** : `DocumentView` ne réimplémente aucun éditeur — il monte les mêmes renderers que la planche (`MenuGroup` en solo, `FlowCanvas`). Pas de second éditeur (≠ focus mode 2026-06-02, forké puis reverté).
- **Échap = retour planche** : `DocumentView` pose un listener `keydown` window qui rappelle `back()` sur `Escape`, **sauf** si le focus est dans un `INPUT`/`TEXTAREA`/`contentEditable`, si une modale/menu/liste est ouverte (`[role=dialog|menu|listbox]`), ou si l'événement est déjà `defaultPrevented`. Le bouton « Retour au canvas » affiche un badge clavier `<kbd>Esc</kbd>`.
- **Mémorisation pan/zoom** : le `Stage` de la planche restaure son `viewport` au montage depuis `uiStore.canvasViewports[projectId]` (lu non-réactivement via `getState()` ; passé en `initial` à `usePanZoom`) et le réécrit à chaque changement via un effet. Indexé par projectId, **session-only** (hors `partialize`) : quitter pour une vue de Document puis revenir garde la position + le zoom ; un reload repart de la vue par défaut.

### Chips fantômes (liens hors-planche)

`features/canvas/GhostChips.tsx` + `offBoardLinks.ts`. Un nœud sur la planche qui référence une cible **absente** de la planche affiche un chip cliquable `→ cible` (clic = `addToBoard`). `offBoardLinks(edges, layout)` retourne les liens (source on-board, cible off-board), dédupliqués. `visibleEdges(edges, layout)` (`Edges.tsx`) ne trace des edges qu'entre nœuds présents. Helper de géométrie partagé `nodeBox(project, id, layout)` (`menuLayout.ts`) utilisé par `Edges` **et** `GhostChips`.

### Entrées dans la vue individuelle

Clic dans le panneau, ou **double-clic** sur un nœud de la planche : `dispatchOpenElement(id)` (`features/canvas/canvasEvents.ts`) émet le CustomEvent `artisan:open_element` (`OPEN_ELEMENT_EVENT`), écouté par la route overview qui `navigate` vers la route Document.

### Mobile (< lg)

Le `ProjectPanel` vit dans un **drawer gauche** (`Sheet`, `side="left"`) ouvert par un bouton dédié ; les 3 zones desktop deviennent mono-panneau + drawers.

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

### Panneau toggleable

`uiStore.projectPanelOpen` (booléen, **persisté** via `partialize`) contrôle la visibilité du `ProjectPanel` sur desktop. Le bouton « Éléments » dans la topbar (`PanelLeftClose`/`PanelLeftOpen`, icône lucide-react, desktop-only) bascule cet état. En desktop (≥lg), la colonne de 240 px est rendue conditionnellement selon `projectPanelOpen`. En mobile (<lg), le panneau reste dans son **drawer Sheet** gauche, indépendant du toggle. La barre de recherche inline qui existait dans le `ProjectPanel` a été **supprimée** — la palette Cmd+K la remplace intégralement.

## UI shell — Project + Settings (depuis 2026-05-27)

Cf. `docs/superpowers/specs/2026-05-27-workspace-shell-and-settings-design.md`.

- **`ProjectSidebar`** (sticky, `routes/__root.tsx`) — brand cliquable (→ `/networks`) en haut + `ServerSelector` (label via `displayServerLabel`) + section Projects filtrée par server actif (drag-reorder via `account.projectOrder`) + section Modules (empty V1) + ⚙ Settings sticky bottom. Depuis les routes slugs (phase 4a), les params URL `networkId`/`serverId` peuvent porter un slug : la sidebar les résout en ids réels (match `id` OU `slug` contre `networksStore` / les `serverKeys` fetchés) avant tout filtrage de projects ; `ServerSelector` matche pareillement `serverId|serverSlug`. Les flows de création hors sidebar (hub `/networks`, network detail, setup wizard) appellent `networksStore.bumpRefresh()` après chaque create/delete — la sidebar écoute `refreshToken` et refetch networks + server entries (sinon elle resterait stale jusqu'au reload). Accounts-only (Task 8) : plus de session-mode, toujours cookie user + `listNetworks`.
- **`/networks/$networkId/servers/$serverId/projects/$projectId`** — route canonique server-scoped (`/project/$projectId` redirige). Onglets via `?tab=` : `overview` (canvas Konva, default), `translations` (`TranslationPanelContent`), `data-sources` (`DataSourcesPanelContent`), `history` (`HistoryTab` — liste des commits + Restore par commit), `assistant` (`AssistantBody`). **Depuis 2026-07-20**, les vues secondaires **remplacent le canvas** dans la zone centrale (elles ne flottent plus en modal) : chaque est un `WorkspaceView` (`components/ui/workspace-view.tsx`) — panneau opaque `absolute inset-0` **keep-alive** (monté à la 1ʳᵉ activation, reste monté `hidden` ensuite → filtres/chat/sélection survivent au switch) qui recouvre le `centerContent`. Le canvas reste **monté dessous** (jamais `display:none`, sinon le `ResizeObserver` du `Stage` re-mesurerait) ; il est juste caché visuellement. La `ProjectSidebar` interne (arbre `ProjectPanel`, colonne 240px gauche, toggle `projectPanelOpen`) est **persistante** across toutes les vues ; seul le centre swap entre canvas, détail Document (`<Outlet/>` quand `useChildMatches` non vide — mutuellement exclusif avec le `Stage`) et vues secondaires. Échap / × reviennent au canvas (`exitToCanvas`, `?tab=undefined`).
- **Source picker (`SourcePickerOptions`, `MenuProperties.tsx`)** — liste désormais les data sources live du serveur connecté (`useServerDataSourcesStore`, endpoint `GET /api/v1/networks/:networkId/servers/:serverId/data-sources`, cookie auth, section "On this server"), en plus des project data ; les refs restent librement saisissables (invariant hermétique). Le flow « import de connecteurs » YAML a été retiré le 2026-07-17 (mort — remplacé par les sources reportées serveur).
- **`SourceShapingEditor` (`properties/SourceShapingEditor.tsx`)** — éditeur visuel monté sous chaque `SourceRefInputRow` : filtre égalité (`filter: Record<field, value>`, valeur littérale ou `{arg}`), tri mono-clé (`sort.by`/`direction`), `limit`. Aucun changement runtime — édite les mêmes champs opaques `ContextInput.sourceRef` (round-trip YAML inchangé). Autocomplétion via `<datalist>` : champs depuis `serverSource.schema` (fallback saisie libre si `[]`), valeurs `{arg}` depuis les `contextInputs` de type `primitive` du menu.
- **`MenuDataSection` (`properties/MenuDataSection.tsx`)** — section « Données du menu » sous `ContextInputsEditor` : une carte par `sourceRef` consommé (ref, badge module, résumé des filtres actifs). Preview live via `previewDataSource` (`POST …/data-sources/preview`) avec les filtres du menu + un formulaire de valeurs d'essai pour chaque token `{arg}` détecté (`extractArgTokens`). Refs `pack:*` (project data) : pas de preview serveur, juste un hint renvoyant vers l'onglet Data.
- **Top bar** (`ProjectTopBarControls.tsx`) — de gauche à droite : toggle sidebar (icône), **`WorkspaceViewNav`** (switcher segmenté des vues : Canvas / Traductions / Sources / Historique / Assistant, item actif surligné via `--surface-raised`, badge « traductions manquantes » sur l'entrée Traductions ; l'entrée Canvas clear le `?tab`), project name, `LangSwitcher` (contenu project), `UndoRedoButtons`, `SearchButton`, `DeployButtons`, `TopBarKebabMenu ⋮` (Exporter le projet (.zip) / Importer un projet (.zip) / Patterns / ─── / Delete project). Le nav lit l'onglet actif via `useSearch({ strict: false })`. **Raccourcis hotbar** : les touches physiques 1-5 (Minecraft-style, `useWorkspaceTabShortcuts` monté dans la route) switchent les vues dans l'ordre de `WORKSPACE_VIEW_TABS` (`features/project/workspaceTabs.ts`, source unique consommée aussi par le nav) — via `e.code` (`Digit`/`Numpad`) donc AZERTY-safe sans Maj ; ignorés si focus dans un champ / modificateur tenu / palette de recherche ouverte. Chaque entrée du nav affiche un badge `<kbd>` avec son chiffre.
- **Pane properties droit — carte flottante (desktop)** : depuis 2026-07-20 le `EditorPane` n'est plus une colonne dockée. Le `Stage` est full-bleed (`absolute inset-0`) et `FloatingEditorPane` (`features/canvas/FloatingEditorPane.tsx`) flotte par-dessus, ancré à droite (`absolute top/right/bottom-3`, `z-20`) : carte arrondie, `--surface-raised/80` + `backdrop-blur-xl` + `--shadow-lg`, donc le canvas se voit derrière + à gauche. Poignée de resize sur le **bord gauche** (bord droit ancré, `width = paneRight - cursorX`, persistée dans `uiStore.editorPaneWidth`). `EditorPane` est redevenu un conteneur simple (le wrapper porte la surface). **Mobile (<lg)** : inchangé — `SplitPane` vertical Stage/Editor.
- **`/settings`** — sidebar de sections (V1 = Apparence, héberge `EditorLangSwitcher`) + main content.
- **`/admin`** — console super-admin. `routes/admin.tsx` est un **layout route** (gate admin + `<Outlet/>`) avec pages enfants `admin.index.tsx` (IA, `AssistantConfigForm`) et `admin.design.tsx` (`DesignSystemPage`). Pas d'onglets : sur `/admin*` (et user admin), `__root.tsx` remplace la `ProjectSidebar` par **`AdminSidebar`** (`components/AdminSidebar.tsx`) — même shell (brand top, `UserMenu` bottom, drawer mobile conservé), nav de sections IA / Design system + lien « Retour à l'éditeur » (→ `/networks`). **Gate côté composant** via `authStore` (mirror de `account.tsx`) : retourne `null` tant que `isLoading`, puis « admins only » si `!currentUser.isAdmin` (le `isAdmin` vient du `/me`). Le backend reste de toute façon gardé `requireAdmin` sur `/api/v1/admin/*`. Le client API (`lib/api/adminConfig.ts`) est en **cookie** (`credentials:"include"`). L'entrée « Console admin » sur `/account` n'apparaît que pour les admins. Clé API **write-only** : le GET ne renvoie jamais la clé (`keySet: boolean`), le champ vide laisse la clé inchangée.

## Rendu data source live + mode placement (depuis 2026-07-15)

Le canvas rend de **vraies lignes** de data source (plus juste un sample statique), et un `Element` de menu a un 2ᵉ mode d'affichage à côté de `iterates` : le **mode placement** (`el.places`), réservé aux sources **statiques**. Cf. ADR `data-source-stability-and-placement` + `CONTEXT.md` (Data source / Placement / Row key).

- **Snapshots live** — `state/serverSnapshotsStore.ts` (`rowsByRef`, `loadSnapshot` via `previewDataSource`, dedupe module-level, le live gagne). `menuPreviewScope.resolveSourceRef`/`buildPreviewScope` acceptent un param `snapshots?` : pour un `sourceRef` serveur, résolution **rows locales de module (`FrontendModule.localPreviewRows`, ex. boutique) > snapshot live** (jamais pour `pack:`) ; le fallback `importedConnectors.sample` a été retiré (2026-07-17). `MenuGroup`/`ItemTooltip` chargent les refs serveur de la menu et bâtissent le scope avec.
- **Rendu placement** (`features/canvas/placement.ts`, pur + testé) — `placementTotalPages` (= max(page)+1), `matchPlacementRow` (match par `keyField`, stringifié), `resolvePlacementSlot` (live row > `cachedDisplay` > **dangling** = slot vide ; pas d'override par-placement — l'apparence vient du template), `capturePlacementCache` (snapshot name/material/lore pour offline). `MenuGroup` branche `el.places` dans la pré-passe pagination **et** dans `elementsByPosition` (une entrée par placement de la page courante) ; `ItemTooltip` miroir (bind alias, override title/lore, fallback cache) ; `menuFanout` **skip** `places` comme `iterates`. Le mode placement réutilise la navigation de pagination in-menu existante (`PaginationControls`).
- **Authoring** — `features/flow/PlacementField.tsx`, frère de `IterationField` dans `FlowCanvas` (positions + itération masqués quand `places` est set, XOR). Le toggle n'apparaît que si la menu binde une source **statique** (`serverDataSourcesStore` `stability === "static"` + `keyField`). Palette de lignes `RowChip` (`useDraggable` @dnd-kit, `id = row:<elementId>:<key>`, payload dans `data`) ; liste des placements (page/slot, remove — pas d'override par-placement). `enable()` seed `{ source: <1ʳᵉ source statique>, alias: "item", keyField, placements: [] }`.
- **Drop → placement** — `placementDrop.ts` : `pinPlacementRow` (glue partagée : lit les stores, capture `cachedDisplay`, préserve un override existant au re-pin, page courante depuis `paginationStore`). Registre `stageDropTarget.setStageSlotHitTest`/`tryStageSlotHit` (renvoie le `SlotHit` sans placer, enregistré par `Stage`). Le `onDragEnd` du route projet route les ids `row:` → hit-test → même menu → `pinPlacementRow`. **Fallback tap-to-place mobile** : `uiStore.armedPlacement` — taper une ligne l'arme, les slots de la menu ciblée deviennent des cibles (même vides, surlignées) → `pinPlacementRow`.
- **Reducers** (`accountStore`) : `setElementPlaces` (clear iterates), `setElementIterates` (clear places — XOR bidirectionnel), `setElementPlacement` (upsert par `key`), `removeElementPlacement`. **Export** (`transform.ts`) : `places:` frère de `iterates`, `keyField`→`key_field` snake, override title/lore via `i18nRef` ; `cachedDisplay` **jamais exporté** (éditeur-only, fallback offline).

## Project sources & Data models (depuis 2026-07-20)

Les sources manuelles de projet (`pack:<id>`) sont passées de « YAML libre preview-only » à du **contenu déployable à schéma déclaré**. Cf. ADR `project-sources-and-data-models` + `CONTEXT.md` (Data source / Data model).

- **Domaine** (`domain/types.ts` + `domain/dataModels.ts`) — `DataModel` = schéma récursif nommé (`ModelFieldType` : string/number/integer/boolean/**ltext**/**minimessage** (+ `_multiline`)/**item**/list/object/**model** ref, cycles interdits via `wouldCreateModelCycle` ; minimessage = string stockée, affordance d'édition seulement), Row key déclaré sur le model. `DataSource` = union `table` (`modelId` + `rows`) | `config` (`fields` inline + `value` objet). `applyFieldEdit` = **un edit de champ réécrit schéma + toutes les valeurs possédées** (rows des tables du model, occurrences imbriquées via refs, configs) avec release/coercition ltext — « données migrées, références danglées ». Les sources legacy (sans `shape`) sont **reset** au load (`normalizeDataSources`, `useProjectLoader`).
- **Row creation** -- the store chooses the first free positive integer for a number/integer Row key, otherwise the first free textual row_n identifier; gaps are reused.
- **i18n** — chaque valeur ltext d'une row est un Key site normal (`visitDataSourceLTexts` dans `domain/i18nSites.ts`), clé canonique lisible et entièrement lowercase `sources.<sourceName>.<rowKey>.<fieldPath>` (listes suffixées `_2`…, fallback positionnel `row_n` tant que la Row key normalisée est vide ou dupliquée). Les noms de source sont stockés lowercase et uniques après `trim().toLowerCase()` ; l'UI refuse les collisions avec une erreur inline. Les clés opaques existantes sont migrées au chargement ; renommer la source, modifier la Row key ou changer la structure rekey automatiquement les sites en conservant toutes les traductions. Mint au add (row/champ/élément de liste), release au remove, usages/Traductions gratuits via le visiteur.
- **Row-key invariant** -- a textual Row key is stored as trim().toLowerCase() and is unique case-insensitively within the source. An empty or duplicate manual edit is rejected inline without touching row data or translations; canonical ltext paths use that validated key: sources.<sourceName>.<rowKey>.<fieldPath> in lowercase. Positional row_n during visitation is defensive only for legacy/imported rows with invalid empty or duplicate keys; a generated row_n is instead a real stored Row-key value. Invalid imported rows are not silently renamed because their IDs may be externally referenced.
- **UI** (`features/data/`) — édition **form-only** (le pane CodeMirror YAML est mort) : `ModelFieldsEditor` (rename blur-commit, retype avec migration, kinds imbriqués, refs de models cycle-guardées, sélecteur Row key, ajout de champ = draft derrière bouton dashed — les inputs toujours visibles faisaient croire à un champ déjà créé), `SourceValueEditor` (`SourceRowsTable` = **sheet scrollable** : colonnes min-width + scroll horizontal, header / 1ʳᵉ colonne / colonne actions sticky ; cellule item → `MaterialRefField`, cellule ltext → langue active via `setI18nValue`, cellule minimessage → `RevealField` façade `MiniMessageInline` comme les widgets SchemaForm, list/object récursifs ; `ConfigValueForm` pour la shape config). Sidebar : boutons `+ Table` / `+ Config` (une Table auto-crée son Data model). Delete d'une source : `window.confirm` avant `removeProjectDataSource`.
- **Export** (`features/export/transform.ts`, ADR `bare-data-files` depuis 2026-07-26) — `emitDataSources` écrit des fichiers **NUS** : `data/<id>.yaml` = liste de rows pures (table) ou mapping pur (objet/config), **jamais** de `fields:`/`shape:` inline. Le schéma part à côté : `models/<sourceId>.yaml` (doc model/v1 complet pour un model *possédé* — usage unique, pas référencé par un kind `model` — identité `id:` dans le doc ; sinon ref une-ligne `model:`), `_source.yaml` minimal (`name`/`model`/`model_version`/`order`) en per-row. Valeurs ltext → **littéral de la langue par défaut** inliné ; autres langues émises dans `lang/` par **adresse** key-site (`dataSourceI18n`), clés data exclues du fichier de langue par défaut. Hints `help` du model → bloc de commentaires généré (marqueur `# ──`, régénéré) + bloc d'en-tête main préservé (`DataSource.headerComment`). Import (`projectFromFiles`) : détection nue mapping/liste, résolution beside (`modelRefs`/`modelFileDoc`), reconnexion des littéraux à l'adresse canonique (`ltData` + rekey), `adoptBareLTexts` au post-injection des models déclarés (loader). Les adresses keyent sur l'**id** de la source (renommer ne re-adresse pas).
- **Modes i18n `extract` / `inline`** (`Project.i18nMode`, depuis 2026-08-03) — quelle forme prennent les textes sur le disque. `extract` (défaut, et ce que veut dire l'absence du champ) : `{i18n:key}` dans les documents, toutes les langues dans `lang/`, langue par défaut comprise. `inline` : le document porte le **littéral de la langue par défaut** (`textSerializer` dans `transform.ts` — titres de menu, title/lore d'apparence, labels de dialog ; `stepsToDsl` n'émet plus de `@key` mais des `"littéraux"`), les **autres** langues partent dans `lang/<code>.yaml` à l'**adresse canonique** du site, et **aucun** `lang/<défaut>.yaml` n'est écrit. Généralise aux menus/commandes/dialogs ce que les fichiers data font déjà (ADR `bare-data-files` ④). L'adresse d'un site = la clé canonique que `rekeyProject` assigne juste avant l'export ; le plugin la redérive de la structure du fichier (`engine/I18nAddresses.kt`), égalité verrouillée par `testdata/i18n-address-conformance.json` (23 cas, mêmes deux côtés). Import (`projectFromFiles`) : un littéral mint une clé comme avant, puis `adoptAddressedTranslations` (`domain/i18nSites.ts`) recolle les entrées `lang/` adressées au site — sans ça les autres langues flotteraient, listées mais rattachées à rien, perdues à l'export suivant. Le mode est persisté dans `.artisan/editor.yaml` (`i18n_mode: inline`, hash-exclu, écrit seulement s'il s'écarte du défaut) : c'est une forme de fichier, pas du contenu. Round-trip point fixe (`transformInline.test.ts`). **UI** : segmented control « Sur le disque » (Clés / Texte en clair) dans la barre de stats du panneau Traductions (`features/translations/TranslationPanel.tsx`, `ShapeTab`), action `setProjectI18nMode` ; bascule derrière un `window.confirm` (elle réécrit tout l'arbre au prochain save, donc change le hash du bundle), no-op silencieux si on reclique le mode courant. Doc user : `docs-site/.../editor/translations.md`.
- **Fichiers `lang/`** (`lib/langTree.ts`, depuis 2026-07-30) — `serializeLang` produit toujours une map de clés pointées triée byte-order, puis `nestLangTree` la convertit en **arborescence YAML** (chaque `.` = un niveau, chaque niveau retrié byte-order → fichier déterministe, donc hashable). L'inverse `flattenLangTree` sert aux trois readers (import `projectFromFiles`, mutation module backend, vue YAML du panneau Traductions à l'« Appliquer ») et tolère arbre / plat legacy / mélange. La vue YAML du panneau Traductions (`features/translations/translationsYaml.ts`) émet **la même arborescence**, commentaires portés par les feuilles via `commentBefore` (contexte seulement s'il n'est pas la clé mot pour mot — sets d'items prettifiés, `(unused)` ; puis `# <defaultLang>: <source>` hors langue par défaut). La structure de l'arbre remplace le tri par contexte comme regroupement. Miroir Kotlin `LangFlattener` (lecture seule — le plugin n'écrit jamais de `lang/`), égalité verrouillée par `testdata/lang-tree-conformance.json`. Une clé bloquée par une feuille (`a.b` + `a.b.c`) reste pointée à la racine ; valeurs non-string coercées, `null` → `""`, listes ignorées.
- **Runtime plugin** — `ProjectReader` scanne `data/*.yaml` (tolérant par fichier, formes nue + legacy) → `BundleDataSource` ; il lit aussi `models/` au load (docs verbatim `{name, type}` aplatis vers le vocabulaire inline) et les déclarations JAR via le supplier `declaredModels`. Le namespace réservé `pack:` est résolu au **fetch seam** du renderer (`ProjectDataResolver`) ; les ltext se localisent au bind : **clé explicite > adresse key-site (`sources.<id>.<rowKey>.<champ>`) > littéral** ; une config binde son objet entier sans shaping (`ContextBinder` accepte `Any?`).

### Champ `actions` & Action DSL (depuis 2026-07-21)

Kind de champ `actions` (`ModelFieldType`) : une **Action chain** (`Step[]`) stockée comme **chaîne Action DSL** — la sérialisation texte compacte, écrivable à la main dans le YAML disque. Cf. ADR `action-dsl` + `CONTEXT.md` (Action chain / Action DSL).

- **Codec** (`editor/src/lib/actionDsl/`) — pur, sans Project : `lexer.ts` (tokenizer indentation-aware, `#` commentaires), `parser.ts` (`parseActionDsl` → `DslStep[]` : `if`/`else if`/`else`, 20 verbes, conditions typées + `%ph% ==/matches` → `placeholder_equals`/`_match`, fallback `expression`, `and`/`or`/`not` + parenthèses), `printer.ts` (`printActionDsl`, canonique). `ast.ts` = AST miroir du domaine avec texte explicite `DslText` (`{lit}` littéral | `{ref}` clé i18n `@key`). `fixtures/action-dsl-fixtures.json` = vecteurs de conformité `{dsl, ast, canonicalDsl}`, **contrat cross-stack** (futur miroir Kotlin), asservis par `actionDsl.test.ts`.
- **Adaptateur** (`domainSteps.ts`) — `DslStep[]` ↔ domaine `Step[]`. Le domaine porte le texte en `LText{key}` qui ne distingue pas littéral vs ref : encodage réversible **préfixe `@`** dans la clé (`{ref:k}` ↔ `key:"@k"`, `{lit}` verbatim, convention `literalSteps`). Permet au `ControlledStepsEditor` existant de round-tripper sans perte (taper `@shop.vip` dans un champ texte relit un ref). L'enregistrement i18n Key-site des refs est différé (phase 1 = chaîne DSL opaque).
- **UI** (`features/data/ActionFieldEditor.tsx`) — deux modes sur la **même** chaîne DSL : **Visuel** (`ControlledStepsEditor` pseudocode via l'adaptateur) et **Code** (textarea DSL brut = la forme disque). Erreur de parse → fallback textarea. Câblé dans `SourceValueEditor` (`case "actions"`).
- **Export** — `serializeDataFieldType` émet `kind: "actions"` (le plugin le parsera+exécutera) ; `serializeDataValue` passe la chaîne verbatim. Schéma `data/v1` : `actions` dans l'enum des kinds.
- **Différé** : parseur + évaluateur de feuille Kotlin (contre les mêmes fixtures), exécution runtime, litéraux de liste `[...]`, montants dynamiques, queue avancée du DSL d'expressions.

## Export / import de project (.zip)

**Export** (`features/export/runExportZip.ts`) — l'archive est l'arbre de fichiers
**tel que le backend le stocke**, pas une régénération depuis le domaine : flush de
l'auto-save (`persistProject`), `GET /api/v1/user/projects/:id` → `files`, `buildZip`
verbatim. Deux conséquences voulues : l'archive porte ce que le domaine ne modélise
pas (`.artisan/editor.yaml`, les fichiers propres d'une racine Add-on), et **aucune
validation ne peut bloquer la sortie des fichiers** — récupérer sa config ne dépend
pas de sa validité (promesse anti-lock-in, ADR `files-first-source-of-truth`).
Réseau requis : sans backend joignable l'export échoue, il n'y a pas de repli sur
`transform()` (un repli produirait une archive *presque* fidèle sans le dire).

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

## Import `menu/v1 → domain` (inverse de l'export)

`editor/src/schema/menuV1ToDomain.ts` est l'inverse pur de `features/export/transform.ts` : il prend un objet `menu/v1` canonique (wire, snake_case, ce que valide `validateMenuV1.ts`) et reconstruit un `Menu` domain. Signature `menuV1ToDomain(src, { projectId, lang, translations? }) → { menu, i18nKeys, unsupported }`. **Pur** : aucune mutation de project — les clés i18n allouées sont retournées dans `i18nKeys` (l'appelant les merge dans `project.i18nKeys`).

- **Pont i18n** : un champ texte `menu/v1` est une `string`. Littéral → nouvelle clé (`newI18nKey`), valeur rangée sous `lang`. `{i18n:KEY}` → réf `LText{key:KEY}` ; si `translations[KEY]` fourni, copié dans `i18nKeys`. Les title-layers portent déjà `value:{key}` → réf directe. `lore` (string[]) → un seul `LText` (lignes jointes par `\n`).
- **Vocab sous-ensemble** : seules les actions/conditions représentables côté domain sont mappées explicitement (un-snake + drop des champs absents du domain, p.ex. `has_money.currency`). Tout autre type (`has_item`, `give_money`, `teleport`…) part dans `unsupported` plutôt que de crasher.
- **Remaps** : `size`→`rows` (÷9), `pagination_next/prev`→`paginate{direction}`, `context_inputs`→`contextInputs` (`primitive` vs `sourceRef` selon présence de `ref`).
- **Round-trip** : l'oracle `menuV1ToDomain.roundtrip.test.ts` exporte un project domain riche puis le ré-importe. Note : un `if` d'appearance OR-joiné ne round-trip **pas** structurellement (l'export enrobe une liste pure-OR en une condition composite `{type:"or", of:[…]}`) — l'oracle utilise donc des AND-joins.

## Pipeline d'application IA (panel assistant — sous-plan 4a)

La logique qui relie le moteur backend SSE à l'éditeur (avant l'UI 4b) tient en trois morceaux découplés :

- **Seed** (`features/export/transform.ts`) : `packToMenuV1(project)` → `serializeMenuToV1(menu, project)[]` produit les objets canoniques `menu/v1` qui seedent une conversation (`openConversation`). Même fonction que l'export fichier (`transform()` l'appelle) → la forme wire envoyée à l'IA est identique à celle déployée.
- **Client SSE** (`lib/api/assistant.ts`) : l'endpoint étant **POST** (avec corps + auth Bearer), `EventSource` est inutilisable. `streamAssistant(token, conversationId, body)` est un async generator qui `fetch`, lit `response.body` via un reader, bufferise et découpe les frames sur `\n\n`, parsant chaque `event:`/`data:` en `{ type, ...payload }`.
- **Apply** (`state/accountStore.ts` → `applyAssistantMenu`) : à réception d'un event `menu_written`, l'UI appelle l'action qui convertit le `menu/v1` via `menuV1ToDomain`, merge les clés i18n retournées dans `project.i18nKeys`, et insert/replace le menu par id. La suppression (`menu_deleted`) réutilise `deleteFromProject` existant — pas de nouvelle action.

Chaîne complète : `packToMenuV1` (seed) → backend → SSE → `streamAssistant` → `menuV1ToDomain` → `applyAssistantMenu`.

## Panel chat de l'assistant (sous-plan 4b — l'UI)

**Depuis 2026-07-19/07-20**, l'assistant n'a plus de pane docké ni de drawer (`AssistantPane`/`AssistantPanel`/`assistantPanelOpen` supprimés). C'est une **vue secondaire comme les autres** : `?tab=assistant` ouvre `features/assistant/AssistantBody.tsx` dans un `WorkspaceView` qui remplace le canvas (cf. section « UI shell »). Corps `AssistantChat` :

- **Ouverture** : entrée `Sparkles` du `WorkspaceViewNav` (topbar) → `?tab=assistant`. Monté keep-alive dans la zone centrale de la route project (le chat en cours survit au retour au canvas).
- **Composer** : `<textarea>` (Enter = envoyer, Shift+Enter = nouvelle ligne) + bouton Envoyer (désactivé tant que vide / pendant le stream). Drag-drop de fichiers sur le panel → `file.text()` est stocké dans l'état `attachments` (`{ [filename]: contenu }`), un compteur s'affiche. Les `attachments` sont ré-envoyés à chaque message.
- **Boucle SSE** : `send()` résout le project via `useAccountStore.getState()`, calcule `menus = packToMenuV1(project)` + `lang = project.defaultLang`, ouvre la conversation au premier message (`convId` mémorisé dans un `useRef`), puis itère `streamAssistant`. Événements : `text` → coalescé dans la bulle assistant courante (`appendAssistant`) ; `menu_written` → `applyAssistantMenu` + carte « créé/modifié » ; `menu_deleted` → `deleteFromProject` + carte « supprimé » ; `error` → toast. Toutes les strings passent par `t("assistant.*")` (namespace en + fr).

Le re-seed (`menus` + `attachments`) à **chaque** message garantit que la working-copy backend reste alignée sur l'état éditeur (last-writer), même si l'admin a édité le project entre deux messages.

### Sélection de modèle + solde de crédits (plan 4 de `2026-07-02-ai-model-system-design.md`)

Le sélecteur de modèle `ModelSelector` rend les tiers (`cheap` / `balanced` / `premium`) en badges cliquables avec estimation de coût (`~50 credits`), choix mémorisé dans l'action store. Chaque message SSE reçoit le `modelId` dans le header ; une soumission `send()` inclut le modèle choisi. Le solde de crédits s'affiche dans la barre top du panel via `BalanceChip` ; à la réception de l'event SSE final `credits {debited, balance}`, le composant met à jour le compte. Erreur 402 (`insufficient_credits`) → toast + CTA `/credits` (placeholder).

## Design system (tokens + composants)

Source de vérité visuelle de l'éditeur, visualisable en live sur **`/admin/design`** (route `admin_.design.tsx`, gate admin, page `features/design-system/DesignSystemPage.tsx`).

**Règle pour tout nouveau développement UI** : passer en priorité par le design system — d'abord les composants `components/ui/` (Button, Input, FormField, Badge, EmptyState, Card, Dialog, Sheet, Tabs, DropdownMenu) ou les classes utilitaires de `styles/globals.css` (`.btn*`, `.input`, `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`, `.rule`…) ; si un composant manque, le **créer dans `components/ui/`** puis ajouter son spécimen à la page `/admin/design` dans le même commit. Jamais de hex/rgba en dur (toujours `var(--token)`) — exception : le canvas Konva, non thémable par CSS.

Structure des tokens (`styles/globals.css`) en 3 couches :
1. **Palette brute** : `--gray-*`, `--emerald-*`, `--red-*`, `--amber-*`, fonts (`--font-display` Spectral / `--font-body` Hanken Grotesque / `--font-mono` IBM Plex Mono), radii `--r-xs…--r-pill`.
2. **Tokens sémantiques** (théméd dark défaut / light via `[data-theme]`) : `--surface*`, `--text*`, `--border*`, `--brand*`, `--success/--warning/--danger` (+ variantes `-soft`), `--shadow-sm/md/lg`.
3. **Aliases shadcn** (`--background`, `--primary`, `--accent`…) mappés sur la couche 2, + bridge Tailwind `@theme`.

Les composants ne référencent **que** la couche 2 (ou les aliases couche 3 pour les primitives shadcn).

### Primitives `Table` / `StatCard` / `HBar`

Trois nouveaux composants de présentation de données, visualisables en live sur **`/admin/design`** :

- **`Table`** (`components/ui/Table.tsx`) — tableau multi-ligne scrollable, sortable par colonne, avec ligne d'en-tête collante. Headers `align-left/center/right`, cells alignées. Wrapper shadcn.
- **`StatCard`** (`components/ui/StatCard.tsx`) — carte de métrique (label + valeur + contexte, optionnel badge trending). Utilisé dans les dashboards d'usage (`/admin/ai/usage`).
- **`HBar`** (`components/ui/HBar.tsx`) — barre horizontale segmentée (répartition : couleurs par segment). Visualise les proportions (ex. usage par modèle). Tokens de couleur `--success` / `--warning` / `--danger` et variantes `-soft`.
- **`Collapsible`** (`components/ui/collapsible.tsx`) — section repliable (trigger pleine largeur + chevron, `title` / `meta` pour un badge ou compteur, contrôlé ou non via `open`/`defaultOpen`). **Le contenu est démonté tant que la section est fermée** — c'est la raison d'être du composant : les sections lourdes que la plupart des utilisateurs n'ouvrent jamais (les paramètres avancés d'un item) ne coûtent rien. Spécimen sur `/admin/design`.
- **`DataTable`** (`components/ui/data-table.tsx`) — visualiseur générique de lignes de preview, utilisé par l'explorateur de sources du serveur et la section « Données du menu » du menu. Deux vues : **Tableau** (colonnes = union des clés des lignes, ordre de première apparition) et **YAML**. Les lignes arrivent en JSON sur le WS, mais une cellule de tableau ne sait qu'aplatir un objet en blob d'une ligne — dès qu'une source imbrique (`stages` → `objectives` de `msquests:quests`, `items` de `boutique:categories`), la vue YAML est la seule lisible : indentée, colorée, **pliable**. Le toggle n'apparaît que si l'appelant passe `tableLabel` + `yamlLabel` (composant muet, il ne traduit pas) ; la vue Tableau reste le défaut. Sérialisation en `lineWidth: 0` — une string MiniMessage doit rester sur une ligne pour être copiable. Spécimen sur `/admin/design`.
- **`YamlCodeEditor`** (`components/ui/yaml-code-editor.tsx`) — CodeMirror + `@codemirror/lang-yaml`. `readOnly` donne le **mode lecture** : même coloration, mêmes gouttières, même pliage, contenu non éditable (`onChange` devient optionnel), sélection et copie conservées. C'est ce mode qu'utilise la vue YAML de `DataTable`. Dette connue : `YAML_CM_THEME` code ses couleurs en hex et force `theme="dark"`, contrairement à la règle « couleurs via `var(--token)` » — visible le jour où une surface YAML atterrit sur un fond clair.

### Admin AI

Panel admin système de modèles IA, accessible à `/admin` (gate super-admin côté composant) :

- **`/admin/ai`** — catalogue + configuration
  - Table `Table` des modèles (`GET /api/v1/admin/ai/models`) : id, provider, base model, status (activé/test).
  - Actions : éditer champs (nom, prix, status), supprimer, tester.
  - Sections « Providers » et « Settings » : configuration provider OpenAI-compatible (`GET/PUT /api/v1/admin/ai/providers`) et settings globaux (`GET/PUT /api/v1/admin/ai/settings`).
  - Client API : `editor/src/lib/api/adminModels.ts` (`getModels`, `updateModel`, `deleteModel`, `testConnection`, etc.).

- **`/admin/ai/usage`** — dashboards agrégés
  - Cartes `StatCard` : crédits utilisés (total, ce mois), marge estimée (prix vs coût provider).
  - Graphiques `HBar` : répartition usage par modèle, par user.
  - `GET /api/v1/admin/ai/usage/summary` (résumés) + `GET /api/v1/admin/ai/usage/logs` (détails).
  - Client API : `editor/src/lib/api/adminAiUsage.ts` (`getUsageSummary`, `getUsageLogs`).

- **`/admin/ai/usage/logs`** — événements détaillés
  - Table avec filtres (user, date, model, status).
  - Export CSV via bouton.
  - `GET /api/v1/admin/ai/usage/logs?q=&format=csv` (backend `adminRoutes.ts`).

- **Profil utilisateur — onglet AI** (`/account`, tab `"ai"`)
  - Vue consommation utilisateur (total, dernière utilisation).
  - Formulaire grant de crédits (bouton « Ajouter des crédits » → modal `POST /api/v1/admin/ai/credits/grant`).
  - Client API : shared `adminAiUsage.ts` (lectu résumé user) + endpoint spécifique grant.
