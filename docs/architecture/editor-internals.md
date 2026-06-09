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

Import MCFonts via "Import font" dans l'AssetsTab : drop d'un `.zip` (`font.json` + glyph PNGs). Le backend parse/valide/stocke (`data/assets/{packId}/fonts/{asset_id}/`) et crée une row `Asset` `type=font` + `fontMeta = { namespace, glyphMap }`. À la régén RP : `assets/artisan/font/<name>.json` + `textures/font/<name>/*.png` embarqués. Éditeur : `TitleRender` rend pixel-perfect via `McFontText` (composition Konva des glyph PNGs).

Background = "gros glyph" : ascent calibré pour couvrir la zone. `LayerEditForm` (Background) expose "Calibrer pour coffre" → `ascent = -11` (zone des slots). Pour couvrir depuis le haut (y=0) : `ascent = 6`. Formule : `ascent = titleLabelY(6) - targetY`.

## Title Composer UX v3

- **Édition in-place** : les layers sont édités **directement sur le pack canvas** via une 3ᵉ colonne (`LayersPanel`, ~280 px, toujours visible). Plus de focus mode dédié au titre.
- **Layout 3 colonnes** : Pack canvas | `MenuProperties` (rows/permission/actions) | `LayersPanel`. Rendu dans l'onglet `overview` du workspace (route server-scoped ci-dessous ; `pack.$packId.tsx` n'est plus qu'un redirect legacy).
- **`LayersPanel`** = Header + `AddLayerControls` (`+ Image` / `+ Text`) + liste drag-reorderable de `LayerListItem` + `LayerEditForm`.
- **Sélection** : `uiStore.selectedLayerKey: { menuId, index } | null` ; `uiStore.lastSelectedMenuId` sticky (le panel survit aux clics dans le vide).
- **Types UI** : 2 visibles — Image (collapse `background` + `glyph` avec flag `stretchToChest`) et Text. Au save, Image se split runtime en `background`/`glyph`. Glyphs externes : branche propre, pas de bouton dédié en v3.
- **Texte** = MiniMessage tags inline (`<gold>`, `<bold>`…), preview live. Pas de `color` per-layer (coloring 100% par tags).
- **Manipulation directe** : drag pour repositionner ; corner-drag (`ResizeHandles`) pour redimensionner (aspect-locked ; shift = no-op en v3).
- **Sémantique resize — IMPORTANT** : redimensionner un glyph mute l'**asset** (tous les menus qui le référencent changent). Pour une taille per-menu : bouton **"Duplicate glyph"** (`LayerEditForm`) → copie l'asset (nouveau codepoint + PNG) et repointe le layer.
- **Cursor-based attach** : drag depuis `+ Image`/`+ Text` → drop près d'un menu → attache au plus proche (seuil 200 px). Click sans drag → last-selected menu.
- **Fichiers v3** sous `editor/src/features/canvas/title/composer/` : `LayersPanel.tsx`, `LayerListItem.tsx`, `LayerEditForm.tsx`, `AddLayerControls.tsx`, `ResizeHandles.tsx`, `TitleRender.tsx`, `useTitleLayerDrag.ts`, `dragPlacement.ts`, `attachLayerAtCursor.ts`, `screenToCanvasCoords.ts` ; `stageGeometry.ts` (dans `features/canvas/`).
- **Supprimés vs v2** : `FocusComposer.tsx`, `ComposerCanvas.tsx`, `AddLayerBar.tsx`, `LayerSidePanel.tsx`, `TitleThumbnail.tsx` (+ tests).

## Édition d'un élément — onglet « Edit » du `EditorPane`

Il n'y a **pas** de mode focus plein-écran (retiré 2026-06-06 : c'était un doublon de l'onglet Edit + une source de bugs de routing — `features/element-editor/`, les routes `.../element/$elementId`, `useElementDblClickNav` et le bouton `FocusButton` ont été supprimés). On édite l'élément sélectionné dans le panneau de droite.

- **`features/canvas/EditorPane.tsx`** — `Tabs` à 3 onglets : **Edit / Library / Assets** (`uiStore.editorTab`). L'onglet `edit` rend `<FlowCanvas>`.
- **`features/flow/FlowCanvas.tsx`** — éditeur unifié de la sélection courante (`useSelectionStore`). Route par type :
  - 0 sélection → `PackProperties`
  - menu → `MenuProperties` (+ `LayersPanel` titre)
  - élément (slot) → state cards (material / title / lore / conditions + click handlers en pseudo-code)
  - command → identité + args + step tree
  - dialog → title / body / buttons + actions par bouton
  - multi-sélection → "select one item" (multi-edit hors V1)
- **Sélection → onglet Edit** (depuis 2026-06-06) : cliquer un menu / slot / command / dialog sur le canvas bascule `uiStore.editorTab` sur `"edit"` (dans `useMenuClick` + les handlers de slot de `MenuGroup` + l'`onClick` de `CommandGroup`/`DialogGroup`), pour que l'élément soit éditable sans changer d'onglet à la main. Le placement d'item « armé » et la multi-sélection (shift) ne basculent pas.

## Canvas component layout (refactor 2026-06-02)

`features/canvas/MenuGroup.tsx` (1066 → 591 lignes) éclaté : `SlotItem.tsx`, `PaginationControls.tsx`, `menuFanout.ts` (fanout positionnel pur, testé), `useMenuClick.ts` (armed-material tap-to-place), `useMenuDrag.ts` (cross-pack via pack-mini DOM walk), `useSlotDrag.ts` (selection drag + Alt).

`features/canvas/Stage.tsx` (528 → 351 lignes) éclaté : `ArmedBanner.tsx`, `useStageTouch.ts` (long-press → context menu), `useStageContextMenu.ts`.

Note : cibles de taille (≤400/≤250) pas entièrement atteintes (MenuGroup 591, Stage 351) — split supplémentaire différé.

## UI shell — Workspace + Settings (depuis 2026-05-27)

Cf. `docs/superpowers/specs/2026-05-27-workspace-shell-and-settings-design.md`.

- **`WorkspaceSidebar`** (sticky, `routes/__root.tsx`) — brand cliquable (→ `/networks`) en haut + `ServerSelector` (label via `displayServerLabel`, **masqué en session-mode**) + section Workspaces filtrées par server actif (drag-reorder via `account.packOrder`) + section Modules (empty V1) + ⚙ Settings sticky bottom. En **session-mode** (trust dance, sans cookie user) : pas d'appel `listNetworks`, packs sourcés depuis `accountStore` **sans filtre `serverKeyId`** (déjà server-scoped).
- **`/networks/$networkId/servers/$serverId/workspaces/$workspaceId`** — route canonique server-scoped (`/workspace/$workspaceId` redirige). Onglets via `?tab=` : `overview` (canvas Konva, default), `translations` (`TranslationPanelContent` inline), `data-sources` (`DataSourcesPanelContent` inline), `history` (`HistoryTab` — liste des commits + Restore par commit, depuis la Servers UX simplification).
- **Top bar** : pack name, `LangSwitcher` (contenu pack), `UndoRedoButtons`, `ExportButton` (zip deploy), `DeployButtons`, `TopBarKebabMenu ⋮` (Import / Export JSON / Patterns / ─── / Delete pack).
- **`/settings`** — sidebar de sections (V1 = Apparence, héberge `EditorLangSwitcher`) + main content.

## Import `menu/v1 → domain` (inverse de l'export)

`editor/src/schema/menuV1ToDomain.ts` est l'inverse pur de `features/export/transform.ts` : il prend un objet `menu/v1` canonique (wire, snake_case, ce que valide `validateMenuV1.ts`) et reconstruit un `Menu` domain. Signature `menuV1ToDomain(src, { packId, lang, translations? }) → { menu, i18nKeys, unsupported }`. **Pur** : aucune mutation de pack — les clés i18n allouées sont retournées dans `i18nKeys` (l'appelant les merge dans `pack.i18nKeys`).

- **Pont i18n** : un champ texte `menu/v1` est une `string`. Littéral → nouvelle clé (`newI18nKey`), valeur rangée sous `lang`. `{i18n:KEY}` → réf `LText{key:KEY}` ; si `translations[KEY]` fourni, copié dans `i18nKeys`. Les title-layers portent déjà `value:{key}` → réf directe. `lore` (string[]) → un seul `LText` (lignes jointes par `\n`).
- **Vocab sous-ensemble** : seules les actions/conditions représentables côté domain sont mappées explicitement (un-snake + drop des champs absents du domain, p.ex. `has_money.currency`). Tout autre type (`has_item`, `give_money`, `teleport`…) part dans `unsupported` plutôt que de crasher.
- **Remaps** : `size`→`rows` (÷9), `pagination_next/prev`→`paginate{direction}`, `context_inputs`→`contextInputs` (`primitive` vs `sourceRef` selon présence de `ref`).
- **Round-trip** : l'oracle `menuV1ToDomain.roundtrip.test.ts` exporte un pack domain riche puis le ré-importe. Note : un `if` d'appearance OR-joiné ne round-trip **pas** structurellement (l'export enrobe une liste pure-OR en une condition composite `{type:"or", of:[…]}`) — l'oracle utilise donc des AND-joins.

## Pipeline d'application IA (panel assistant — sous-plan 4a)

La logique qui relie le moteur backend SSE à l'éditeur (avant l'UI 4b) tient en trois morceaux découplés :

- **Seed** (`features/export/transform.ts`) : `packToMenuV1(pack)` → `serializeMenuToV1(menu, pack)[]` produit les objets canoniques `menu/v1` qui seedent une conversation (`openConversation`). Même fonction que l'export fichier (`transform()` l'appelle) → la forme wire envoyée à l'IA est identique à celle déployée.
- **Client SSE** (`lib/api/assistant.ts`) : l'endpoint étant **POST** (avec corps + auth Bearer), `EventSource` est inutilisable. `streamAssistant(token, conversationId, body)` est un async generator qui `fetch`, lit `response.body` via un reader, bufferise et découpe les frames sur `\n\n`, parsant chaque `event:`/`data:` en `{ type, ...payload }`.
- **Apply** (`state/accountStore.ts` → `applyAssistantMenu`) : à réception d'un event `menu_written`, l'UI appelle l'action qui convertit le `menu/v1` via `menuV1ToDomain`, merge les clés i18n retournées dans `pack.i18nKeys`, et insert/replace le menu par id. La suppression (`menu_deleted`) réutilise `deleteFromPack` existant — pas de nouvelle action.

Chaîne complète : `packToMenuV1` (seed) → backend → SSE → `streamAssistant` → `menuV1ToDomain` → `applyAssistantMenu`.

## Panel chat de l'assistant (sous-plan 4b — l'UI)

`features/assistant/AssistantPanel.tsx` est l'UI qui consomme la logique 4a. C'est un **overlay**, pas une route : un `Sheet` (radix dialog, `side="right"`, couvre le petit viewport sur mobile) dont l'ouverture est pilotée par le flag transitoire `uiStore.assistantPanelOpen` (jamais persisté — absent du `partialize`).

- **Ouverture** : bouton `Sparkles` (`lucide-react`) dans `WorkspaceTopBarControls` (`AssistantButton`) → `setAssistantPanelOpen(true)`. Le panel est monté inconditionnellement dans la route workspace (à côté de `DeletePackDialog`) avec le pack actif (`pId`) ; le `Sheet` gère sa propre visibilité.
- **Composer** : `<textarea>` (Enter = envoyer, Shift+Enter = nouvelle ligne) + bouton Envoyer (désactivé tant que vide / pendant le stream). Drag-drop de fichiers sur le panel → `file.text()` est stocké dans l'état `attachments` (`{ [filename]: contenu }`), un compteur s'affiche. Les `attachments` sont ré-envoyés à chaque message.
- **Boucle SSE** : `send()` résout le pack via `useAccountStore.getState()`, calcule `menus = packToMenuV1(pack)` + `lang = pack.defaultLang`, ouvre la conversation au premier message (`convId` mémorisé dans un `useRef`), puis itère `streamAssistant`. Événements : `text` → coalescé dans la bulle assistant courante (`appendAssistant`) ; `menu_written` → `applyAssistantMenu` + carte « créé/modifié » ; `menu_deleted` → `deleteFromPack` + carte « supprimé » ; `error` → toast. Toutes les strings passent par `t("assistant.*")` (namespace en + fr).

Le re-seed (`menus` + `attachments`) à **chaque** message garantit que la working-copy backend reste alignée sur l'état éditeur (last-writer), même si l'admin a édité le pack entre deux messages.
