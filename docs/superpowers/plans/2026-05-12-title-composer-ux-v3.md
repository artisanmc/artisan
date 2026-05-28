# Title Composer UX v3 — in-place sur le pack canvas + resize fidèle

**Status** : ready
**Date** : 2026-05-12
**Supersedes** : `2026-05-11-title-composer-ux-v2.md`

## Pourquoi

La v2 a introduit un **focus mode** (écran dédié) avec MiniMessage + preview live. Iban veut une UX plus visuelle, sans switch de vue :

- Tout se passe sur le **pack canvas principal** (plusieurs menus visibles simultanément).
- Les layers sont **manipulables à la souris directement** sur la title bar de leur menu (drag pour positionner, corner-drag pour resize).
- Un panel **toujours visible à droite** (3e colonne) liste les layers du menu sélectionné, permet la création, le hide temporaire, le reorder.
- L'ajout d'un layer peut se faire de deux manières : click rapide (attache au menu sélectionné) ou drag depuis le bouton (placement avec highlight du menu le plus proche).
- Le resize d'une image layer **modifie l'asset glyph lui-même** : tous les menus qui référencent ce glyph adoptent la nouvelle taille. Pour avoir une taille spécifique à un menu, l'utilisateur duplique le glyph.

## Décisions architecturales

### Layout

Pack canvas | MenuProperties | **LayersPanel** (3e colonne, ~280px).

LayersPanel est **toujours visible**. Au démarrage : empty state. Quand un menu est sélectionné, il affiche les layers de ce menu et mémorise `lastSelectedMenuId` (cette mémoire survit à un clic dans le vide). Quand l'utilisateur sélectionne un autre menu, le panel switch.

### Sémantique du resize

**Resize = mutation de l'asset glyph** (pas du layer).

- L'asset glyph porte `fontMeta = { codepoint, namespace, ascent, height, ... }`.
- Resize aspect-locked → modifie `height` (et `ascent` proportionnellement) via `PATCH /api/.../assets/:id`. Le ratio width/height est automatique côté Minecraft (le client crop la texture par transparence à droite).
- Resize libre (shift) → modifie aussi la taille de la texture PNG sur disque via re-sampling (sharp). Hors scope v3 si trop coûteux — fallback à aspect-locked silencieux. *Décision : ship aspect-locked en v3, shift = no-op pour l'instant, à raffiner si besoin.*
- À chaque mutation : rebuild du resource pack + broadcast `resource_pack_updated` (mécanique existante).

**Pour avoir un glyph à une autre taille sur un menu spécifique** : bouton "Duplicate glyph" dans le panel d'édition de la layer → crée une copie de l'asset (nouveau codepoint, PNG dupliqué sur disque) → la layer courante repointée vers le nouveau. Les autres menus continuent d'utiliser l'asset original.

### Drag-to-attach pour nouveau layer

- Click sur `+ Image`/`+ Text` → ajoute directement au menu sélectionné (au centre de sa title bar).
- Mousedown + drag depuis `+ Image`/`+ Text` → entre en mode placement : ghost à la souris, on calcule la distance du curseur au centre de la title bar de chaque menu du pack, le menu le plus proche reçoit un highlight. Mouseup = attache au menu highlight.

### Positionnement libre hors menu

Une fois attachée, la layer est positionnée en coordonnées relatives au menu (`{x, y}` en px MC), mais Konva ne clip pas — donc la layer peut visuellement s'étendre au-delà des bounds du menu (jusqu'à la zone des autres menus voire au-delà). Le plugin n'a pas de notion de "bounds" non plus, c'est juste un offset MiniMessage.

### Hide/show layer

État **éphémère** (uiStore.hiddenLayerKeys, Set, non persisté). Pas de champ dans le YAML. Sert juste à isoler visuellement une layer pendant l'édition.

### Reorder (z-order)

Drag-handle dans LayerListItem → réordonne le tableau `menu.title: MenuTitleLayer[]`. L'ordre dans le tableau = ordre de composition MiniMessage = ordre de rendu Konva.

### Plugin : aucun changement

L'asset-index.json continue de mapper `asset_id → codepoint + ascent`. Le `TitleCompiler.kt` et `AssetCatalog.kt` ne touchent rien. La sémantique "1 asset = 1 codepoint = 1 taille globale" colle déjà à leur état actuel.

## Tasks

### Phase 1 — Editor refactor (UX in-place)

| # | Description | Files | Test |
|---|---|---|---|
| 1 | uiStore : remplace `titleComposerOpen` par `selectedLayerKey {menuId, index} \| null`, ajoute `hiddenLayerKeys: Set<string>` (key = `${menuId}:${index}`), ajoute `draggingNewLayer: { kind, x, y } \| null`. Drop tous les usages de titleComposerOpen. | `editor/src/state/uiStore.ts` | `uiStore.test.ts` |
| 2 | `dragPlacement.ts` util : `findNearestMenu(menus: { id, x, y, w, h }[], cursor: { x, y }): string \| null`. Distance au centre de la title bar. Retourne null si plus loin que threshold (200 px). | `editor/src/features/canvas/title/composer/dragPlacement.ts` | `dragPlacement.test.ts` |
| 3 | `ResizeHandles.tsx` Konva : 4 corner anchors qui appellent `onResize({width, height})`. Aspect-locked par défaut. Shift = no-op visible mais non-bloquant (TODO commenté pour PNG resample). | `editor/src/features/canvas/title/composer/ResizeHandles.tsx` | `ResizeHandles.test.tsx` |
| 4 | `useTitleLayerDrag` hook : retourne `{onDragStart, onDragMove, onDragEnd, onResize}`. Position = mutate `layer.x/y` dans packStore. Resize = call `PATCH /api/.../assets/:id {height}` via assetStore, attendre la résolution avant de relâcher (loading state). | `editor/src/features/canvas/title/composer/useTitleLayerDrag.ts` | `useTitleLayerDrag.test.ts` |
| 5 | `TitleRender.tsx` refactor : drop le split compact/edit, devient un seul rendu interactif. Selection visible (outline jaune + ResizeHandles si image), respect `hiddenLayerKeys`. Drag-handler + dispatch via useTitleLayerDrag. | `editor/src/features/canvas/title/composer/TitleRender.tsx` + test | maj `TitleRender.test.tsx` |
| 6 | `LayerListItem.tsx` : 1 ligne dans la liste droite — eye toggle (icon button), drag-handle (icon, lance reorder), nom (auto-généré : "Image • shop_bg" ou "Text • Shop"), bouton delete. Highlight si `selectedLayerKey` match. Click = sélectionne. | `editor/src/features/canvas/title/composer/LayerListItem.tsx` | `LayerListItem.test.tsx` |
| 7 | `AddLayerControls.tsx` : 2 boutons `+ Image`, `+ Text`. Click = `packStore.addLayerToMenu(selectedMenuId, kind)`. Mousedown + drag = entre en mode placement (setDraggingNewLayer), au mouseup utilise `findNearestMenu` pour attacher. | `editor/src/features/canvas/title/composer/AddLayerControls.tsx` | `AddLayerControls.test.tsx` |
| 8 | `LayerEditForm.tsx` : panel d'édition d'une layer sélectionnée. Image → asset picker + bouton "Duplicate glyph". Text → mm textarea + live preview. Externe glyph → provider + name. Extrait de l'ancien LayerSidePanel. | `editor/src/features/canvas/title/composer/LayerEditForm.tsx` | `LayerEditForm.test.tsx` |
| 9 | `LayersPanel.tsx` : compose Header + AddLayerControls + liste LayerListItem (avec dnd-kit ou natif HTML5 drag pour reorder) + LayerEditForm si selected. Empty state si pas de menu sélectionné dans la session. | `editor/src/features/canvas/title/composer/LayersPanel.tsx` | `LayersPanel.test.tsx` |
| 10 | `MenuGroup.tsx` : utilise TitleRender en mode interactif (pas de clip). Drop dblclick handler (plus de focus mode). Title bar capture click → sélectionne le menu. | `editor/src/features/canvas/MenuGroup.tsx` | maj test |
| 11 | `pack.$packId.tsx` : layout 3 colonnes (canvas, MenuProperties, LayersPanel). LayersPanel always-on. Mémorise `lastSelectedMenuId` dans uiStore. Drop FocusComposer mount. | `editor/src/routes/pack.$packId.tsx` | maj test |
| 12 | Delete v2 files : `FocusComposer.tsx`, `ComposerCanvas.tsx`, `AddLayerBar.tsx`, `LayerSidePanel.tsx`, `TitleThumbnail.tsx` + leurs tests. Vérifier qu'aucun import résiduel ne casse le build. | delete | full `vitest run` |

### Phase 2 — Backend asset resize + duplicate

| # | Description | Files | Test |
|---|---|---|---|
| 13 | `PATCH /api/editor-session/:token/assets/:id` accepte `{height?: number}` (en plus de `name?, ascent?`). Si height fourni, update `fontMeta.height` puis trigger rebuild RP + broadcast `resource_pack_updated`. Validation : 1 ≤ height ≤ 256. | `backend/src/routes/assets.ts` | `assets.test.ts` |
| 14 | `POST /api/editor-session/:token/assets/:id/duplicate` : copie row DB (alloue un nouveau codepoint via codepointAllocator), copie le fichier PNG sur disque (`{sk}/{newAssetId}.png`), retourne `{ asset }`. Trigger rebuild RP + broadcast. | `backend/src/routes/assets.ts` (handler) + tests | `assets.test.ts` (test bloc duplicate) |

### Phase 3 — Docs

| # | Description | Files |
|---|---|---|
| 15 | CLAUDE.md : remplace la section "Title Composer UX v2" par "UX v3", documente la sémantique resize global + workflow Duplicate, list les endpoints PATCH width/height et POST duplicate, met à jour les test counts (editor / backend / plugin). | `CLAUDE.md` |
| 16 | (buffer pour ajustements de dernière minute) | — |

## Hors scope (v3.5+)

- **Shift = stretch libre** : nécessite un re-sample PNG côté backend (sharp). Aspect-locked seul ship en v3.
- **External glyphs (Oraxen/Nexo/ItemsAdder)** : le LayerEditForm garde la branche `external_glyph` mais sans resize.
- **Reorder cross-menu** : drag une layer du menu A vers la liste du menu B ne marche pas (out of scope).

## Files unstaged à préserver (cf. mémoire `feedback_git_add_explicit`)

`backend/src/db/schema.ts`, `editor/package.json`, `editor/package-lock.json`, `editor/tests/setup.ts`, `editor/src/features/export/transform.ts`, `editor/src/features/export/transform.test.ts`, `plugin/src/main/kotlin/net/artisanmc/plugin/engine/{BundleCompiler,ConditionParser,SoftDepRegistry}.kt`, `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`, `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`, `plugin/src/test/kotlin/net/artisanmc/plugin/{BundleCompilerTest,ConditionParserTest}.kt`.

Si une task doit toucher un de ces fichiers (ne devrait pas), stash propre avant + restore après.

## Verification finale (avant merge)

- `cd editor && npx vitest run` → tous tests pass, count > 531
- `cd backend && bun test` → tous tests pass (1 pre-existing failure sur `link_codes schema` tolérée)
- `cd plugin && ./gradlew test` → 241 pass (rien à toucher)
- `cd plugin && ./gradlew deploy` → JAR ok, container redémarre proprement
- Test manuel : ouvrir pack, ajouter image layer, drag-resize → en jeu le glyph adopte la nouvelle taille. Dupliquer → resize le clone sans affecter l'original.
