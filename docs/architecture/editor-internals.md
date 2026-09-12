# Editor & rendering internals

The profile's `DeleteAccountSection` requests an email after a Dialog confirmation. Public `/delete-account` renders `DeleteAccountConfirmation` and submits only on an explicit click. `accountDeletionToken.ts` reads the fragment into memory and removes it before analytics initializes; reloading requires reopening the email link. Successful deletion clears local auth and invalidates pending profile hydration so a late `/me` cannot restore the removed identity.

Les titres de l’interface (`h1`–`h6`, `.display`, `.font-display`) utilisent `--font-display: "Inter", sans-serif` en graisse 700, chargé depuis Bunny Fonts dans `editor/index.html`. Le texte courant et le monospace gardent leurs polices ; les polices de rendu Minecraft restent indépendantes. Spécimen dans `/admin/design`.

## Tests et CI

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

## Édition d'un Document — panneau Propriétés (`EditorPane`)

Le Document sélectionné s'édite dans le panneau de droite. L'ancien **mode focus** plein-écran (forké, `features/element-editor/` + `FocusButton` + `useElementDblClickNav`) a été retiré 2026-06-06 : doublon de l'onglet Edit + bugs de routing. Le 2026-06-13, une **vue individuelle** deep-linkable l'a remplacé sur des bases saines — un seul rendu partagé avec la planche, pas d'éditeur forké (cf. section « Planche curée » plus bas). La route `.../document.$documentId` est donc à nouveau présente, mais avec une implémentation différente.

- **`features/canvas/EditorPane.tsx`** — panneau **Propriétés**, sans onglets, qui rend directement `<FlowCanvas>`. La Bibliothèque est indépendante (voir ci-dessous). **Le set d'items se crée au NIVEAU DU MENU et n'existe qu'à travers l'élément qui le rend** (ADR `item-templates-and-data-library`, révision 2026-07-31) : `MenuDataSection` porte un bloc « Set d'items » par liste ; `createMenuSet` crée un élément auto-suffisant en mode `iterates` ou `places`. En placement, `PlacementRowsPanel` liste les rows du contexte d'aperçu courant en tuiles draggables (`PLACEMENT_ROW_DRAG_PREFIX`, dépôt géré par `MenuGroup`/`pinPlacementRow`).
- **Bibliothèque du projet** — `features/project/ProjectLibrary.tsx` : outil en haut à gauche du canvas, masqué quand la bibliothèque est ouverte, catégories **Items** (Catalogue / Capturés) et **Ressources graphiques** (`AssetsTab`, détails avec retour à la grille). `ProjectLibraryWorkspace` enveloppe la planche ou la vue individuelle sous le même `DndContext` ; panneau à gauche sur desktop, sous la scène sur mobile. Il charge items et assets même sans sélection, indépendamment de l'ouverture des panneaux. L'ouverture est persistée et liée au dernier projet ouvert (`projectLibraryStore`), jamais à la sélection. Échap ferme la bibliothèque avant la navigation de Document ; les dialogues et champs conservent leur propre gestion d'Échap.
- **`features/flow/FlowCanvas.tsx`** — éditeur unifié de la sélection courante (`useSelectionStore`). Route par type :
  - 0 sélection → `ProjectProperties`
  - menu → `MenuProperties` (+ `LayersPanel` titre)
  - élément (slot) → state cards (material / title / lore / conditions + click handlers en pseudo-code)
  - command → identité + args + step tree
  - dialog → title / body / buttons + actions par bouton
  - multi-sélection → "select one item" (multi-edit hors V1)
- **Sélection → Propriétés** : sélectionner un menu / slot / commande / dialogue affiche directement ses propriétés sans changer la catégorie ni fermer la Bibliothèque. L'ancien `uiStore.editorTab` est supprimé et ignoré à la réhydratation.
- **Têtes custom (PLAYER_HEAD)** : choisir `PLAYER_HEAD` comme material d'un state révèle une ligne « tête custom » sous le sélecteur de material. Un select choisit la source (`HeadDatabase` / `Base64` / `Player name`) et un champ de valeur apparaît à côté. Coller `hdb:<id>` ou une chaîne brute `eyJ…` détecte la source automatiquement. `headPreviewUrl` convertit base64 et noms littéraux en rendu 3D mc-heads.net ; `useHeadPreviewUrl` ajoute la résolution HDB via le serveur actif (`GET …/head-texture?id=…`). Cache mémoire par network/serveur/id, demandes identiques mutualisées, succès réutilisable 10 min et échecs retentés après 30 s tant que l'aperçu est monté ; anciennes réponses isolées lors d'un changement de serveur. HDB absent, tête inconnue ou placeholder non résolu → icône générique. Le hook alimente slots Konva, ghosts, overlays, cartes de state et sélecteurs de material.

- **Têtes vanilla en 3D** : les cubes de tête de `mcModelRenderer.headDef` utilisent `yFlip: false` : le découpage du skin place déjà le visage au sud et le dessus en haut. Les retourner exposait une face omise au-dessus et le visage à l'arrière. Le test de géométrie passe par `renderToCanvas` et vérifie par rayons la surface supérieure et les UV du visage.

### Reconnexion d'un Project (depuis 2026-09-08)

`useProjectLoader` retente la lecture 15 secondes après chaque réponse
`server_offline` / `network_error`, sans requêtes concurrentes ni reconstruction
répétée de l'affichage hors ligne. Une lecture réussie (y compris `unchanged`)
efface `offline` et `stale` ; les réponses tardives et timers sont ignorés à la
sortie du Project. Un brouillon modifié conserve sa base de compare-and-swap.

### Paramètres avancés d'un item (depuis 2026-07-29)

Sous le lore de chaque state card, `features/flow/AdvancedItemSection.tsx` replie derrière un `<Collapsible>` tout ce qui dépasse material/titre/lore : **enchantements** (id + niveau, `datalist` sur le catalogue vanilla de `domain/itemAdvanced.ts` mais **saisie libre acceptée** pour le moddé), effet brillant sans enchant, custom model data, incassable, sections de tooltip masquées, **couleur** (affichée uniquement si le material est teintable — cuir / potion / étoile de feu d'artifice), et **NBT brut**. Un badge sur le trigger compte les valeurs posées (`countAdvanced`) pour qu'un item configuré ne cache pas sa propre configuration. Les mutations passent par l'action de store unique `setAppearanceAdvanced` (patch partiel ; une clé à `undefined` efface le champ).

Le format wire de ces champs et les conventions partagées avec le plugin sont dans `schemas-codegen.md` § « Détails avancés d'item ».

Les champs de modèle `item` utilisent `ItemValueField` : ref simple ou objet `{ material, count?, ... }` avec les mêmes attributs wire que l'apparence. Le catalogue réutilise `AdvancedItemSection` ; `previewItem` résout la valeur entière avant les surcharges du template (quantité explicite prioritaire, enchantements par id, titre remplacé, lore ajouté). Le plugin suit la même composition. Les champs Material préservent la casse des refs et expressions.
Le bloc `ItemBindingEditor` affiche un champ Icône compact (miniature + libellé). Son picker regroupe Catalogue (liaisons `Appearance.item`) et Bibliothèque (items fixes). `itemBindingOptions` suit les modèles des inputs et les alias d'itération/placement ; seules les feuilles `item` sont proposées. Les modules déclarent `dataSourceModels` pour typer leurs sources même sans schéma serveur. Quantité et enchantements affichent les valeurs du catalogue et un reset après personnalisation ; l'expression reste dans un volet avancé.
Avant `FrontendModule.localPreviewRows`, l'hôte résout les `LText` des `dataSources` dans la langue d'aperçu et avec les traductions du projet propriétaire. Boutique peut ainsi assembler le lore sans convertir les références en `[object Object]` ; ses rows incluent `price_display` formaté et les items imbriqués des catégories.

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

Cf. `docs/superpowers/specs/2026-06-13-workspace-board-curation-design.md` (supersède le focus mode de `2026-06-02`). Le canvas n'est plus un canvas libre qui force tout en grille : c'est une **planche curée**, doublée d'un panneau source-de-vérité et d'une vue individuelle deep-linkable. **Invariant n°1** : un seul rendu/éditeur par type de Document, partagé entre planche et vue individuelle — c'est ce qui supprime la divergence qui avait causé le revert du focus mode. **Étendu 2026-09-05 aux *hôtes*** : un seul rendu par type de Document, et autant d'hôtes que de sémantiques distinctes, pas un de plus. La planche et le focus partageaient bien `MenuGroup`, mais avaient deux hôtes de stage pour une sémantique identique — d'où la re-divergence (cf. « Mode focus »).

### `canvasLayout` = appartenance à la planche

Un Document est **sur la planche ssi** il a une entrée explicite `project.canvasLayout[id] = {x,y}` (présence = appartenance, plus seulement position sauvegardée).

Les positions et modifications sont conservées par `useDraftSync` dans une copie
locale, puis sauvegardées automatiquement côté backend (voir ci-dessous). Après un enregistrement qui efface le brouillon,
la première modification conserve comme référence l'état précédent s'il correspond
exactement à la base enregistrée : la bascule Clés / Texte en clair doit ainsi
activer Enregistrer dès le premier changement. La normalisation au chargement
reste exclue des modifications utilisateur. Après réhydratation, les bases sont comparées par
contenu, jamais par identité d'objet : le rechargement ne doit pas reclasser un
brouillon modifié comme propre et le faire abandonner à l'ouverture suivante.
Les écritures locales en attente sont vidées sur `pagehide`, passage de la page
à l'état caché et démontage du hook. L'écriture sur le serveur reste explicite.

**Brouillons backend (2026-09-11)** : `backendDrafts.ts` charge les brouillons
privés avant la lecture disque, restaure la sélection et synchronise l'arbre avec
révision attendue. La copie locale est isolée par compte ; un ancien brouillon
sans identifiant backend devient une copie distincte. Un accusé de réception
ne remplace jamais les frappes effectuées pendant la requête. Un conflit de
révision conserve le travail local et bloque l'écriture jusqu'à création d'une
copie. `BackendDraftControls` propose copies nommées, sélection et comparaison
base/arbre depuis le menu d'Enregistrer, sans bloc permanent dans la topbar.
Un point sur le chevron signale seulement un conflit ou une sauvegarde non confirmée.
Les actions vident d'abord le debounce local via `draftFlush`.
`saveProjectToDisk` publie la révision sauvegardée via l'API de brouillons ;
création/import sans session garde le chemin existant. Une modification pendant
la publication reste un nouveau travail basé sur les fichiers publiés.
Le transport MCP reste futur ; il réutilisera les mêmes opérations et contrôles.

- `autoLayout(project)` (`features/canvas/autoLayout.ts`) ne remplit **plus** la grille : il ne retourne que les entrées explicites de `canvasLayout`.
- `gridArrange(project)` (même fichier) construit une grille complète sur tous les Documents — appelé uniquement par le bouton « Tout arranger » via l'action store `arrangeAllOnBoard({projectId})`.
- Trois actions `accountStore` distinctes : `addToBoard({projectId, nodeId, x, y})` / `removeFromBoard({projectId, nodeId})` manipulent `canvasLayout` (le Document reste dans le project) ; `deleteFromProject({projectId, nodeIds})` (existant) retire le Document du project.

### `Project.moduleData` — état opaque par module

`Project.moduleData?: Record<string, unknown>` porte l'état d'un module tiers, keyé par id de module (ex. `"boutique"`) — le host ne l'interprète jamais. Round-trip files-first : `projectFromFiles` seed `moduleData[<dir>] = { __files: Record<relPath, content> }` pour un dossier de project non reconnu ; le module éditeur normalise `__files` à sa forme structurée à la première lecture, et dérive son `exportFiles()` depuis `moduleData` ; `transform()` ré-émet les `__files` verbatim des namespaces sans module registré. Action store : `setModuleData(projectId, moduleId, data)` (Immer `produce`, remplace tout le namespace, préserve les autres).

Exemple concret (module boutique, V1.5 — `docs/architecture/modules.md` §15) : le plugin Add-on Boutique bootstrappe `projects/boutique_shop/boutique/shop.yaml` sur disque ; un `local_push` sur ce project stub seed `moduleData.boutique.__files["shop.yaml"]` (le préfixe du dossier module est retiré des clés `__files`). `@artisan/boutique-editor` (presence-gated `/m/boutique`) lit ce state, le normalise en catalogue structuré (categories/items) au premier accès, expose un form d'édition (pas de `<SchemaForm>` générique, §8), et sa fonction `exportFiles()` régénère `boutique/shop.yaml` depuis `moduleData.boutique` à chaque deploy — round-trip complet sans que le host `Project` n'ait besoin de connaître la forme du catalogue.

### Bibliothèque redimensionnable

La bibliothèque utilise `SplitPane` avec `secondaryPosition="start"` à gauche
(bord droit redimensionnable), ou en bas si mobile/espace central <600 px.
Le store `projectLibraryStore` persiste largeur/hauteur sous
`artisan-library-size`, ainsi que le projet ouvert (null si fermé) et la catégorie.
Le canvas reste monté pendant ouverture, fermeture, resize et changement d'orientation.
Le bouton Bibliothèque est un outil flottant arrondi en haut à droite du canvas, rendu par `ProjectLibraryWorkspace` dans le panneau principal du split uniquement si le panneau est fermé. Bouton et panneau sont visibles uniquement sur la planche et les vues individuelles de menus, jamais dans les vues commande ou dialogue ni les onglets secondaires. L'état d'ouverture est conservé au retour au canvas. La croix ferme le panneau et fait réapparaître l’outil ; aucun bouton Bibliothèque dans la topbar.
L’en-tête regroupe onglets et fermeture sans ligne de titre supplémentaire ; les filtres du catalogue restent sur une ligne défilante horizontalement, pour préserver la hauteur de grille.

### `ProjectPanel` — arborescence du projet à droite

`features/project/ProjectPanel.tsx` : liste **tout** le project groupé par catégorie (Menus / Commandes / Dialogs), construite par `buildProjectDocuments(project, lang)` (`useProjectDocuments.ts`).

- **Ligne racine** (nom du project) : clic → `openProjectSettings()`, et un `+` à côté ouvre la **création** (Menu / Commande / Dialogue). Depuis 2026-09-05 c'est le registre qui crée, pas le panneau de droite — celui-ci n'apparaît qu'à la sélection, donc il ne pouvait plus héberger « Nouveau menu ». Les dialogues y gagnent une entrée qu'ils n'avaient pas. Création **sans position** : le Document naît hors planche, l'y poser reste un geste explicite (curation).

- Recherche texte.
- **Bouton toggle « canvas »** par ligne (remplace l'ancien drag-and-drop, retiré) : flèche entrante `title="Ajouter au canvas"` → `addToBoard` quand le Document est hors planche ; flèche sortante colorée `--brand` `title="Retirer du canvas"` → `removeFromBoard` quand il est présent. La couleur `--brand` du bouton « retirer » sert aussi d'indicateur d'état (remplace l'ancien badge texte « sur la planche »).
- **Clic** sur le label → ouvre la vue individuelle (n'ajoute pas à la planche). **Menu contextuel `···`** : éditer / supprimer du project (l'ajout/retrait passe par le bouton toggle).
- Terminologie user-facing : « canvas » (les actions/identifiants internes gardent `board` : `addToBoard`, `removeFromBoard`, `canvasLayout`).
- 3ᵉ zone du layout overview desktop (panneau · planche · `EditorPane`).
- Helper de label partagé `documentLabel(project, id, lang)` (`useProjectDocuments.ts`) — utilisé aussi par l'en-tête de `DocumentView`.

### Le panneau = inspecteur de la sélection

Depuis 2026-09-05. Le panneau d'édition était **toujours** affiché et mangeait de la place sur le canvas, alors que son contenu dépendait déjà entièrement de la sélection (`FlowCanvas` : rien → `ProjectProperties`, menu → `MenuProperties`, item → `ElementEditor`…). Sa **présence** suit désormais la même règle que son contenu.

> Le panneau existe **ssi** quelque chose est sélectionné — ou si l'utilisateur a explicitement demandé les paramètres du project.

- **`features/project/selectionContext.ts`** — fonction pure `selectionContext(project, ids, selectionMenuId)` → `none | multi | menu | element | command | dialog | unknown`. **Une seule** dérivation de la nature de la sélection, partagée par le dispatch de `FlowCanvas` **et** par le gating des onglets ; deux dispatches séparés finiraient par ne plus être d'accord. Elle porte aussi la résolution scopée d'un id d'élément (un `grid` peut exister dans deux menus — cf. `selectionStore.menuId`).
- **`features/project/useInspector.ts`** — la règle d'ouverture, écrite une fois : `open = ids.size > 0 || projectSettingsOpen`.
- **Fermer** — deux sorties, toutes deux `dismissInspector()` (`projectSettings.ts` : vide la sélection **et** rabaisse `projectSettingsOpen`) : le clic sur le fond du canvas (`Stage.onStageClick`, le geste qui veut dire « j'ai fini ») et une **croix** dans l'en-tête du panneau. La croix n'est pas décorative : les paramètres du project survivent à une sélection vide **par construction** — c'est ce qui les distingue d'une sélection — donc sans sortie explicite ils restaient ouverts indéfiniment.
- **`features/project/CanvasWithInspector.tsx`** — scène + inspecteur, monté par la planche **et** par la vue focus. Desktop : le panneau flotte au-dessus du canvas, donc le masquer découvre du canvas **sans reflow**. Mobile : il occupe une vraie hauteur, la scène la récupère. (Le composant existe pour la raison qui a coûté `SoloMenuStage` : la règle ne doit pas être écrite à deux endroits.)
- **Catalogues indépendants** — Items et Ressources graphiques appartiennent à la Bibliothèque du projet, accessible sans sélection. Fermer Propriétés ne ferme pas la Bibliothèque, et réciproquement. Le bouton d'aide d'un menu vide ouvre directement la catégorie Items ; les sélecteurs de matériau et d'image restent accessibles depuis leurs champs.
- **`ProjectProperties`** ne garde que ce qui est vraiment du project — identité (id + badge de source), nom, description, compte d'assets, suppression. Les compteurs menus/commandes doublonnaient l'arbre et les boutons de création y ont déménagé.
- **Paramètres du project** — ils ne correspondent à aucune sélection, donc ils se demandent explicitement. Geste unique dans `features/project/projectSettings.ts` (`openProjectSettings()` : vide la sélection, lève `uiStore.projectSettingsOpen`, éphémère et jamais persisté), avec **trois portes d'entrée** : la ligne racine du `ProjectPanel` (nom du project + icône réglages), le **clic droit sur le fond du canvas** (branche `empty` du `ContextMenu` — c'est justement le geste qui désélectionne, donc celui après lequel on les cherche) et le **kebab ⋮ de la topbar**. Sélectionner quoi que ce soit rabaisse le drapeau, sinon désélectionner pour dégager le canvas les rouvrirait.
- **Pas d'entrée « Paramètres » sur une ENTITÉ au clic droit** : `useStageContextMenu` **sélectionne déjà** l'entité visée (`:85`), donc le clic droit sur un menu ouvre le panneau tout seul — comme le clic gauche (`useMenuClick` : `set([menu.id])`, plus `setEditorTab("edit")`). L'affordance existait déjà ; elle était juste invisible tant que le panneau était toujours là.

### Vue individuelle (deep-linkable)

`features/project/DocumentView.tsx`, monté par la route enfant `…/projects/$projectId/document.$documentId.tsx`. La route overview bascule dessus via `useChildMatches()` (`childMatches.length > 0 → <Outlet/>`) — donc rechargement, bouton retour navigateur et lien partageable fonctionnent.

- **Dispatch par type** : menu → `<Stage projectId focus={documentId}>` (le **stage de la planche**, cf. « Mode focus » ci-dessous) en `primary` d'un `SplitPane` + `EditorPane` en `secondary` ; commande / dialog → `FlowCanvas` centré (`max-w-3xl`).
- Sélection posée via `useSelectionStore.set([documentId])` au montage → `FlowCanvas` (clé sur la sélection) et `MenuGroup` éditent par le **même** chemin que la planche. Introuvable → `EmptyState`.
- **INVARIANT** : `DocumentView` ne réimplémente aucun éditeur — il monte les mêmes renderers que la planche (`MenuGroup` en solo, `FlowCanvas`). Pas de second éditeur (≠ focus mode 2026-06-02, forké puis reverté).
- **Échap = retour planche** : `DocumentView` pose un listener `keydown` window qui rappelle `back()` sur `Escape`, **sauf** si le focus est dans un `INPUT`/`TEXTAREA`/`contentEditable`, si une modale/menu/liste est ouverte (`[role=dialog|menu|listbox]`), ou si l'événement est déjà `defaultPrevented`. Le bouton « Retour au canvas » affiche un badge clavier `<kbd>Esc</kbd>`.
- **Mémorisation pan/zoom** : le `Stage` restaure son `viewport` depuis `uiStore.canvasViewports[projectId]` au montage et le réécrit à chaque changement. Le cadrage est **persisté dans le navigateur par projet**, y compris après fermeture ou rechargement. Le composant interne est remonté au changement de projet ou de mode pour restaurer le bon cadrage. En **mode focus**, `uiStore.documentViewport` conserve un cadrage partagé par tous les Documents.
- **Minimap** : `CanvasMinimap` affiche les rectangles issus de `nodeBox(project, id, layout)` dans un SVG superposé à la planche, sans second Stage Konva. Le rectangle de vue suit le pan/zoom ; clic hors du rectangle = recentrage, glissement = déplacement sans changer le zoom. Les bornes incluent les documents et la vue courante ; leur projection reste fixe pendant le glissement. Les flèches du clavier déplacent la vue quand la minimap a le focus. Le bouton à côté de Bibliothèque dans `ProjectLibraryWorkspace` ouvre la minimap puis disparaît pendant son affichage ; la minimap est ancrée à 8 px du coin inférieur droit et sa croix la ferme en faisant réapparaître le bouton ; `uiStore.minimapVisible` persiste cette préférence (visible par défaut). La minimap est réservée à la planche.

- **Bulle de navigation** : le bouton « Retour au canvas » garde sa largeur et son libellé sur une seule ligne (`shrink-0`, `whitespace-nowrap`) ; le titre du Document est tronqué quand les sidebars réduisent l'espace disponible.

### Mode focus (`<Stage focus={documentId}>`)

Depuis 2026-09-05, la vue individuelle d'un menu n'a plus de stage à elle : elle monte le `Stage` de la planche avec une prop `focus`. `features/project/SoloMenuStage.tsx` est **supprimé** — il ne réimplémentait que ~20 % de la chrome du `Stage`, et la vue document y perdait le dépôt d'items depuis la Bibliothèque (silencieusement : `setStageDropTarget` n'était jamais enregistré), les raccourcis clavier, la sélection, les guides d'alignement et les liens.

Toute la différence tient dans la table `layout` :

```ts
const layout = focus ? { [focus]: { x: 0, y: 0 } } : autoLayout(project);
```

- La planche lit l'appartenance réelle (`canvasLayout` via `autoLayout`) ; le focus fabrique une **planche synthétique d'un seul Document** posé à l'origine. Il ne consulte donc jamais `canvasLayout` : **un Document jamais posé sur la planche est pleinement éditable en focus**.
- Tout ce qui consomme `layout` suit sans le savoir : `Edges` (aucune arête, les deux bouts ne sont jamais tous deux présents), `GhostChips` (tous les liens du Document deviennent des pastilles), `useMarqueeSelection`, `hitTestSlot`, `setStageDropTarget`.
- `MenuGroup` reçoit `solo` → non déplaçable (aucune position de planche à écrire), pas de double-clic « ouvrir ».
- Chrome retirée en focus : l'`EmptyState` et les entrées « Créer un menu / une commande / un dialogue **ici** » du `ContextMenu` (les trois `onCreate*At` deviennent optionnelles — elles posent une position de planche). Copier / coller / dupliquer / supprimer restent.
- Cadrage : `fitViewport` (`features/canvas/focusViewport.ts`, ex-`features/project/soloViewport.ts`) centre le menu à l'ouverture, sans jamais l'agrandir, puis ne se bat plus avec l'utilisateur (`touchedRef`) ; double-clic sur le fond = recadrer.
- **Changement de comportement assumé** : le fond se comporte comme sur la planche — glisser en mode select fait un marquee (nouveau en focus), le pan passe par l'outil main / Espace / Alt. Avant, en vue document, glisser n'importe où pannait.

**INVARIANT à ne pas casser** : `setStageDropTarget` / `setStageSlotHitTest` / `setStageGeometryProvider` sont des registres globaux **mono-locataire**. Ça tient parce que la route overview fait `childMatches.length > 0 ? <Outlet/> : <Stage/>` — jamais deux `Stage` montés en même temps. Le focus **remplace** la planche, il ne coexiste pas avec elle.

### Chips fantômes (liens hors-planche)

`features/canvas/GhostChips.tsx` + `offBoardLinks.ts`. Un nœud sur la planche qui référence une cible **absente** de la planche affiche un chip cliquable `→ cible`. `offBoardLinks(edges, layout)` retourne les liens (source on-board, cible off-board), dédupliqués. `visibleEdges(edges, layout)` (`Edges.tsx`) ne trace des edges qu'entre nœuds présents. Helper de géométrie partagé `nodeBox(project, id, layout)` (`menuLayout.ts`) utilisé par `Edges` **et** `GhostChips`.

Le clic dépend du mode, via la prop optionnelle `onOpen` : sur la **planche**, `addToBoard` (poser la cible) ; en **focus**, `dispatchOpenElement(target)` — il n'y a pas de planche à peupler, la pastille devient le moyen de circuler de Document en Document, y compris vers des Documents jamais posés sur la planche.

### Entrées dans la vue individuelle

Clic dans le panneau, ou **double-clic** sur un nœud de la planche : `dispatchOpenElement(id)` (`features/canvas/canvasEvents.ts`) émet le CustomEvent `artisan:open_element` (`OPEN_ELEMENT_EVENT`), écouté par la route overview qui `navigate` vers la route Document.

### Mobile (< lg)

Le `ProjectPanel` vit dans un **drawer droit** (`Sheet`, `side="right"`) ouvert par un bouton dédié ; les 3 zones desktop deviennent mono-panneau + drawers.

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

`ProjectElementsSidebar` révèle l’arbre au survol des 8 px du bord droit, en overlay arrondi de 240 px sans redimensionner les propriétés. Sortir ferme après 300 ms, sauf menu/dialogue ouvert ou focus clavier dans le panneau ; Échap referme l’overlay et rend le focus au bouton. `uiStore.projectPanelOpen`, persisté et faux par défaut, réserve une colonne fixe au clic sur Éléments (`PanelRightClose`/`PanelRightOpen`) ; un second clic referme. Le drawer mobile ouvre à droite. Cmd+K reste la recherche globale.

## UI shell — Project + Settings (depuis 2026-05-27)

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
Sur mobile (<1024 px), la topbar utilise une grille de deux lignes, conserve les onglets à icônes et impose des cibles tactiles de 44 px. La bibliothèque masque temporairement l’inspecteur sans vider la sélection ; un changement de sélection ferme la bibliothèque. Les panneaux restent indépendants sur desktop.

Les propriétés activent aussi `SplitPane.animatePresence` sur desktop (`ProjectWorkspacePanels`) et mobile (`CanvasWithInspector`, split toujours monté). Changer la sélection ne relance pas l’animation : seule la présence du panneau la déclenche.

`usePanelPresence` conserve le contenu 200 ms pendant la sortie et annule le démontage à la réouverture. Éléments anime translation/opacité ; le menu anime aussi sa largeur réservée. La bibliothèque active `SplitPane.animatePresence` (largeur/hauteur), désactivé pendant le drag. Les panneaux sortants sont `inert` et `aria-hidden` ; `prefers-reduced-motion` supprime l’attente et les transitions CSS.

La marge gauche de la topbar réserve 48 px au bouton de navigation flottant ; elle passe à 12 px sur desktop lorsque la navigation est fixe et occupe déjà sa propre colonne.
Sur desktop, la topbar et le lien de marque des sidebars partagent une hauteur de 48 px et commencent à 8 px du haut. Le panneau flottant retire son padding supérieur interne pour compenser son décalage de 8 px ; son contour utilise un ring sans modifier les dimensions. Le toggle de 36 px est centré à 32 px du haut.

La sidebar (`components/NewProjectDialog`) suit la même soumission native. Les deux
modals restent ouvertes avec le nom saisi si le serveur refuse la création ; elles
affichent une erreur traduite et le placeholder `mon_projet` / `my_project`.
Le succès de `createProject` confirme l'écriture du manifeste sur le disque serveur,
puis la liste est relue depuis ce disque.

Cf. `docs/superpowers/specs/2026-05-27-workspace-shell-and-settings-design.md`.

- **`ProjectSidebar`** (sticky, `routes/__root.tsx`) — brand cliquable (→ `/networks`) en haut + `ServerSelector` (label via `displayServerLabel`) + section Projects filtrée par server actif (drag-reorder via `account.projectOrder`) + section **Modules installés** (un groupe par module : son canvas « Éditeur », ses Config screens, sa route `/m/<id>`). Le découpage projects plats / groupes de modules vit dans `features/projects/projectGroups.ts` (`buildProjectGroups`, pur) — **la page d'un serveur (`/networks/$networkId/servers/$serverId`) affiche la même chose en lisant la même fonction**, et lit ses Projects sur le disque du serveur (`listServerProjects`) comme la sidebar + ⚙ Settings sticky bottom. Depuis les routes slugs (phase 4a), les params URL `networkId`/`serverId` peuvent porter un slug : la sidebar les résout en ids réels (match `id` OU `slug` contre `networksStore` / les `serverKeys` fetchés) avant tout filtrage de projects ; `ServerSelector` matche pareillement `serverId|serverSlug`. Les flows de création hors sidebar (hub `/networks`, network detail, setup wizard) appellent `networksStore.bumpRefresh()` après chaque create/delete — la sidebar écoute `refreshToken` et refetch networks + server entries (sinon elle resterait stale jusqu'au reload). Accounts-only (Task 8) : plus de session-mode, toujours cookie user + `listNetworks`.
- **`/networks/$networkId/servers/$serverId/projects/$projectId`** — route canonique server-scoped (`/project/$projectId` redirige). Onglets via `?tab=` : `overview` (canvas Konva, default), `translations` (`TranslationPanelContent`), `data-sources` (`DataSourcesPanelContent`), `history` (`HistoryTab` — liste des commits + Restore par commit), `assistant` (`AssistantBody`). **Depuis 2026-07-20**, les vues secondaires **remplacent le canvas** dans la zone centrale (elles ne flottent plus en modal) : chaque est un `WorkspaceView` (`components/ui/workspace-view.tsx`) — panneau opaque `absolute inset-0` **keep-alive** (monté à la 1ʳᵉ activation, reste monté `hidden` ensuite → filtres/chat/sélection survivent au switch) qui recouvre le `centerContent`. Le canvas reste **monté dessous** (jamais `display:none`, sinon le `ResizeObserver` du `Stage` re-mesurerait) ; il est juste caché visuellement. La `ProjectSidebar` interne (arbre `ProjectPanel`, colonne droite partagée avec les propriétés, toggle `projectPanelOpen`) est **persistante** across toutes les vues ; seul le centre swap entre canvas, détail Document (`<Outlet/>` quand `useChildMatches` non vide — mutuellement exclusif avec le `Stage`) et vues secondaires. Échap / × reviennent au canvas (`exitToCanvas`, `?tab=undefined`).
- **Source picker (`SourcePickerOptions`, `MenuProperties.tsx`)** — liste désormais les data sources live du serveur connecté (`useServerDataSourcesStore`, endpoint `GET /api/v1/networks/:networkId/servers/:serverId/data-sources`, cookie auth, section "On this server"), en plus des project data ; les refs restent librement saisissables (invariant hermétique). Le flow « import de connecteurs » YAML a été retiré le 2026-07-17 (mort — remplacé par les sources reportées serveur).
- **`SourceShapingEditor` (`properties/SourceShapingEditor.tsx`)** — éditeur visuel monté sous chaque `SourceRefInputRow` : filtre égalité (`filter: Record<field, value>`, valeur littérale ou `{arg}`), tri mono-clé (`sort.by`/`direction`), `limit`. Aucun changement runtime — édite les mêmes champs opaques `ContextInput.sourceRef` (round-trip YAML inchangé). Autocomplétion via `<datalist>` : champs depuis `serverSource.schema` (fallback saisie libre si `[]`), valeurs `{arg}` depuis les `contextInputs` de type `primitive` du menu.
- **`MenuDataSection` (`properties/MenuDataSection.tsx`)** — section « Données du menu » sous `ContextInputsEditor` : une carte par `sourceRef` consommé (ref, badge module, résumé des filtres actifs). Preview live via `previewDataSource` (`POST …/data-sources/preview`) avec les filtres du menu + un formulaire de valeurs d'essai pour chaque token `{arg}` détecté (`extractArgTokens`). Refs `pack:*` (project data) : pas de preview serveur, juste un hint renvoyant vers l'onglet Data.
- **Top bar** (`ProjectTopBarControls.tsx`) : surface compacte arrondie (`--r-lg`), groupes espacés sans séparateurs. Identité projet/serveur, navigation en capsules (`--r-md`, fond doux actif), outils contextuels puis recherche compacte, Enregistrer, menu `⋯` et Éléments tout à droite. Bibliothèque et annuler/rétablir sur Canvas ; langue sur Canvas et Traductions. Les libellés des onglets se replient en icônes avant xl ; les groupes peuvent revenir à la ligne sous md. Raccourcis numériques en infobulles, routage et badges inchangés. Actualiser reste dans `⋯` via `RefreshProjectButton.renderTrigger`, avec confirmation montée hors menu. Abandonner les modifications reste adjacent à Enregistrer.
- **Colonnes droites (`ProjectWorkspacePanels`)** : canvas, `EditorPane` pleine hauteur, puis arbre `ProjectPanel` de 240 px tout à droite. Les propriétés apparaissent uniquement avec sélection/paramètres projet sur le canvas ou un menu ; commandes/dialogues individuels gardent leur éditeur central. Un `SplitPane` horizontal règle la largeur des propriétés (`editorPaneWidth`, persistée et plafonnée selon la place disponible). Aucune division verticale des propriétés. Le bouton Éléments est à droite de la topbar ; fermer l’arbre conserve les propriétés et inversement. Dans l’arbre, `ArrowLeftToLine` ajoute au canvas et `ArrowRightToLine` en retire. `DockedInspectorContext` empêche un second inspecteur flottant. Le canvas garde le même montage quand les panneaux changent. Mobile : scène/propriétés restent en split vertical.
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

**Depuis le 2026-09-09 :** le chat envoie `background:true` et un `requestId` idempotent. `TaskTimeline` suit les tâches persistées via GET, restaure leurs résultats après rechargement et n'appelle Stop que sur clic explicite. Le temps écoulé, l'activité réelle et la présence du worker sont distincts ; le raisonnement reçu du fournisseur est dépliable. `taskProposals.ts` applique uniquement sur clic et après comparaison du hash de base avec le brouillon courant. `start_migration` rend le moteur de migration accessible au chat ; `MigrationPanel` montre ses résultats et reprises, sans mode à choisir. Les descriptions SSE/application immédiate ci-dessous documentent seulement le chemin historique de compatibilité.

La logique qui relie le moteur backend SSE à l'éditeur (avant l'UI 4b) tient en trois morceaux découplés :

- **Seed** (`features/export/transform.ts`) : `packToMenuV1(project)` → `serializeMenuToV1(menu, project)[]` produit les objets canoniques `menu/v1` qui seedent une conversation (`openConversation`). Même fonction que l'export fichier (`transform()` l'appelle) → la forme wire envoyée à l'IA est identique à celle déployée.
- **Client SSE** (`lib/api/assistant.ts`) : l'endpoint étant **POST** (avec corps + auth Bearer), `EventSource` est inutilisable. `streamAssistant(token, conversationId, body)` est un async generator qui `fetch`, lit `response.body` via un reader, bufferise et découpe les frames sur `\n\n`, parsant chaque `event:`/`data:` en `{ type, ...payload }`.
- **Apply** (`state/accountStore.ts` → `applyAssistantMenu`) : à réception d'un event `menu_written`, l'UI appelle l'action qui convertit le `menu/v1` via `menuV1ToDomain`, merge les clés i18n retournées dans `project.i18nKeys`, et insert/replace le menu par id. La suppression (`menu_deleted`) réutilise `deleteFromProject` existant — pas de nouvelle action.

Chaîne complète : `packToMenuV1` (seed) → backend → SSE → `streamAssistant` → `menuV1ToDomain` → `applyAssistantMenu`.

## Panel chat de l'assistant (sous-plan 4b — l'UI)

Les réponses du chat et les réponses/raisonnements de `TaskTimeline` utilisent
`features/assistant/AssistantMarkdown.tsx` : `react-markdown` + `remark-gfm`
rendent titres, listes, liens, tableaux et code (inline ou blocs). Les fragments
de réponse sont concaténés avant le rendu, y compris pendant une tâche en cours.
Le HTML brut est ignoré et les URL utilisent le filtrage par défaut de
`react-markdown`. Le style utilise les tokens du thème ; tableaux et blocs de
code disposent d'un défilement horizontal. Les messages utilisateur restent du texte.

**Depuis 2026-07-19/07-20**, l'assistant n'a plus de pane docké ni de drawer (`AssistantPane`/`AssistantPanel`/`assistantPanelOpen` supprimés). C'est une **vue secondaire comme les autres** : `?tab=assistant` ouvre `features/assistant/AssistantBody.tsx` dans un `WorkspaceView` qui remplace le canvas (cf. section « UI shell »). Corps `AssistantChat` :

- **Ouverture** : entrée `Sparkles` du `WorkspaceViewNav` (topbar) → `?tab=assistant`. Monté keep-alive dans la zone centrale de la route project (le chat en cours survit au retour au canvas).
- **Composer** : `<textarea>` (Enter = envoyer, Shift+Enter = nouvelle ligne) + bouton Envoyer (désactivé tant que vide / pendant le stream). Drag-drop de fichiers sur le panel → `file.text()` est stocké dans l'état `attachments` (`{ [filename]: contenu }`), un compteur s'affiche. Les `attachments` sont ré-envoyés à chaque message.
- **Boucle SSE** : `send()` résout le project via `useAccountStore.getState()`, calcule `menus = packToMenuV1(project)` + `lang = project.defaultLang`, ouvre la conversation au premier message (`convId` mémorisé dans un `useRef`), puis itère `streamAssistant`. Événements : `text` → coalescé dans la bulle assistant courante (`appendAssistant`) ; `menu_written` → `applyAssistantMenu` + carte « créé/modifié » ; `menu_deleted` → `deleteFromProject` + carte « supprimé » ; `error` → toast. Toutes les strings passent par `t("assistant.*")` (namespace en + fr).

Le re-seed (`menus` + `attachments`) à **chaque** message garantit que la working-copy backend reste alignée sur l'état éditeur (last-writer), même si l'admin a édité le project entre deux messages.

### Sélection de modèle + solde de crédits (plan 4 de `2026-07-02-ai-model-system-design.md`)
### Migration zMenu reprenable (2026-09-07)

`MigrationPanel` et `lib/api/assistantMigration.ts` proposent un flux explicite
distinct du chat SSE : analyse de la sélection serveur, information sur les crédits, démarrage,
pause/reprise et lecture des propositions. La reconnexion utilise des GET de suivi,
jamais un nouveau démarrage payant. Les réponses tardives sont filtrées par portée
Project/conversation ; généré, appliqué au brouillon et à vérifier restent distincts.

Depuis le 2026-09-08, aucun plafond de crédits propre à la migration n'est demandé ;
seule la consommation s'affiche. `source_analysis_incomplete` est un avertissement :
l'IA lit le fichier brut même si le parseur YAML échoue, sans expansion d'alias.
`lib/analytics.ts` initialise PostHog et capture les pages uniquement si le token est renseigné.

`features/assistant/migrationProposal.ts` vérifie le SHA-256 du JSON canonique sur
un snapshot immuable, puis recontrôle la portée et le store courant après le calcul
asynchrone, sans autre attente avant la mutation synchrone. V1 crée uniquement des
cibles absentes (`baseHash: null`) : résultat sémantiquement identique déjà appliqué,
cible différente en conflit, jamais de remplacement. La comparaison normalise le
round-trip domain/wire et les clés i18n aléatoires, avec les valeurs de toutes les
langues référencées. Les constructions non représentables et les changements de
traductions séparés sont bloqués plutôt que perdus silencieusement.

L'application passe par `applyAssistantMenu` et ne modifie que le brouillon local ;
**Enregistrer** reste explicite. Le backend ne stocke pas un état « appliqué » global :
il est dérivé du brouillon présent. La sonde de stockage écrit puis retire une petite
clé temporaire ; son succès ne garantit pas la place nécessaire au brouillon entier.
En cas d'indisponibilité, l'UI avertit sans masquer une application déjà réussie.


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

### Placement tray and slot dragging

Preview context changes (canvas banner, board edges and properties selector) apply
all call arguments through `uiStore.setMenuPreviewArgs` in one store update.
Writing arguments separately exposes a partial context to the canvas reconciler,
which can trigger the banner's first-context fallback and undo the selection.
Single-field input edits continue to use `setMenuPreviewArg`.

Item tooltips resolve the hovered element within its menu (`hoverStore.menuId` +
`elementId`), since element IDs such as `player` can repeat across menus.
`MenuGroup` supplies the menu on hover; leaving clears it. `ItemTooltip` subscribes
to the current project so title/lore edits update live, and hides if the hovered
menu disappears instead of falling back to a same-ID element in another menu.

The canvas placement tray binds each row under the placement alias when resolving its material and supports nested source paths. Dragging a placed item updates only its keyed placement on the current page, using the preview context to disambiguate shared slots. Other placements and the display cache are preserved; dropping outside the menu removes only that placement. Alt-drag also moves the row, since a row has one placement. Placement drags bypass ordinary position-list mutations.
Ordinary item paste, move, duplicate and selection moves preserve placement elements during empty-position cleanup: an empty ordinary position list is valid when places is set.
Placement tray height includes the card top offset, icon, label gap, label height and bottom padding; stacked trays use that same height plus spacing to avoid overlap.
