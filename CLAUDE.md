# Interfaze — Instructions Claude

## Règles de mise à jour des docs

Quand tu modifies du code, tu dois aussi mettre à jour les docs correspondants :

| Tu touches | Tu mets à jour |
|---|---|
| Protocole WS (`hub.ts`, `protocol.ts`, `WsClient.kt`) | `docs/specs/` section protocole |
| Stack / dépendances | `docs/decisions/stack.md` + tableau "Pivots" si c'est un changement de choix |
| Termes du domaine (Pack, Menu, Element…) | `CONTEXT.md` |
| Commandes plugin (`IfzCommand.kt`) | Ce fichier, section Plugin ci-dessous + `docs-site/src/content/docs/getting-started/install-admin.md` (table commandes) |
| Variables d'environnement | `.env.example` + ce fichier |
| Endpoints API | Ce fichier, section Backend |
| Config plugin (`config.yml`, defaults) | `docs-site/src/content/docs/getting-started/install-admin.md` (sections Config / Reference) |
| Resource pack distribution modes (`ResourcePackDelegator.kt`) | `docs-site/src/content/docs/getting-started/install-admin.md` (section Resource pack) + ce fichier |
| UI éditeur visible user (nouveau bouton/flow user-facing) | `docs-site/src/content/docs/editor/<feature>.md` (créer si nécessaire) |

Ne pas mettre à jour = la prochaine session ne saura pas que le code a changé.

**Discipline same-commit vs `/sync-docs`** — Quand un commit touche du code marqué dans le tableau, la doc correspondante doit être mise à jour dans le même commit si l'update reste petit (changement ciblé d'une ou deux sections existantes, typiquement ≤30 lignes diff de doc). Si l'update doc dépasse ce volume ou nécessite des screenshots / refonte, invoquer le skill `/sync-docs` à la fin de la feature pour traiter la dette doc en un commit séparé. Ne jamais merger une PR avec dette doc non-listée. La source de vérité fine du mapping est `.claude/skills/sync-docs/doc-impact-map.yaml` ; la table ci-dessus en est un résumé humain.

---

## Commandes

### Plugin (Kotlin 2.0 / Paper 1.21.4)

```bash
cd plugin
./gradlew test          # ~206 tests (unit + intégration MockWebServer)
./gradlew shadowJar     # → build/libs/interfaze-plugin-1.0.0-SNAPSHOT-all.jar
```

**Commandes plugin** — `/ifz` subcommands:
- `/ifz menu <packId> <menuId>` — open menu editor session
- `/ifz reload` — reload all packs from disk
- `/ifz pushLocal <packId>` — push local pack changes to backend (for FTP scenario: admin edits YAML on disk → push before reconnecting, else backend overwrites on next sync)

### Backend (Bun + Hono + PostgreSQL)

```bash
cd backend
bun install
bun run db:push         # Applique le schéma Drizzle sur PostgreSQL (DATABASE_URL requis)
bun run dev             # Dev avec --watch sur port 3001
bun test                # ~175 tests (unit + intégration WS réel)
```

```bash
# Générer les données items (à faire avant gen-icons.ts)
bun backend/scripts/gen-items.ts [version]    # télécharge assets MC + génère items.json avec champs model

# Pre-render les icônes 3D server-side (Playwright + Three.js, nécessite gen-items.ts d'abord)
bun backend/scripts/gen-icons.ts [version]    # rend 750 PNGs → data/mc-assets/{version}/textures/icons/
                                               # puis met à jour items.json (remplace model par texture icons/{id})
# Note : utilise Node.js en sous-processus pour Playwright (workaround Bun+Windows pipe IPC)
```

### Editor (React 19 + Vite 6)

```bash
cd editor
npm install
npm run dev             # Vite dev server sur port 5173
npx vitest run          # 400 tests
npm run build           # Build production
```

### Stack complète (Docker)

```bash
cp .env.example .env    # puis renseigner INTERFAZE_SERVER_KEY
docker compose up       # backend:3001 + editor:5173 + minecraft:25565
```

**Déployer un nouveau JAR plugin (workflow normal) :**
```bash
cd plugin
./gradlew deploy        # compile + redémarre le container (le JAR est monté directement depuis build/libs/)
```

---

## Architecture

```
editor/          React 19 + Vite + Konva
backend/         Bun + Hono + PostgreSQL (Drizzle)
plugin/          Kotlin 2.0 + Paper 1.21.4 + OkHttp
docker/          Config serveur Minecraft (itzg/minecraft-server, Paper géré par l'image)
docker-compose.yml
docs-site/       Astro Starlight — public user docs (EN)
docs/
  decisions/             ← ADRs (stack, state model)
  specs/                 ← specs produit et éditeur (web-editor.md, main-spec.md)
  schema/                ← JSON schemas menu/pack/command/translations
  superpowers/specs/     ← design docs data-sources, expression DSL
  superpowers/plans/     ← plans actifs (archive/ = plans complétés)
CONTEXT.md               ← glossaire domaine (source de vérité pour les termes)
```

### Pattern modulaire (depuis 2026-05-25)

Interfaze suit le pattern **modular monolith** spécifié dans `docs/architecture/modules.md`. Chaque module vit en 3 layers symétriques :

- Plugin : `plugin/src/main/kotlin/gg/interfaze/modules/{id}/` — implements `InterfazeModule`
- Backend : `backend/src/modules/{id}/` — exports `BackendModule`
- Éditeur : `editor/src/modules/{id}/` — exports `FrontendModule`

Communication cross-module via deux registries plugin-side : `DataSourceRegistry` (`namespace:source_id`) et `CommandRegistry` (`namespace:command`). Aucune dépendance directe entre modules. Hot-reload propagé via `ModuleEventBus` (plugin) + WS `module_event` → `editor/src/modules/api/eventBus.ts`.

V1 modules : `menus`, `commands`. V1.5+ : `shop`. Le code menus/commands existant reste dans `gg.interfaze.plugin.engine` / `command` ; les classes `MenusModule` / `CommandsModule` sont des wrappers fins. Move physique différé jusqu'au 3ᵉ module (voir `docs/architecture/modules.md` §13).

**Quand ajouter un module :**
1. Spec dans `docs/architecture/modules.md` (ajouter section "Module {id}")
2. Layer plugin : nouvelle classe sous `gg.interfaze.modules.{id}/` impl `InterfazeModule`, register dans `InterfazePlugin.defaultModules()`
3. Layer backend : nouveau dir `modules/{id}/index.ts` exporte un `BackendModule`, register dans `app.ts` (`mountModules` array)
4. Layer éditeur : `editor/src/modules/{id}/index.ts` exporte `FrontendModule`, `registerModule(...)` dans `main.tsx`
5. Schema JSON dans `modules/{id}/schemas/` si form-based — utiliser `<SchemaForm>`

### `<SchemaForm>` — générateur de formulaires depuis JSON Schema

`editor/src/components/SchemaForm/` génère des formulaires React depuis un JSON Schema. Couvre `string` (texte / textarea via `format: "long"` / select via `enum`), `number`/`integer`, `boolean`, `object` (nesting), `array` (avec + / −).

**Pour ajouter un widget custom** (color picker, asset picker, MiniMessage editor, etc.) :

```ts
import { SchemaForm } from "@/components/SchemaForm/SchemaForm";
import { ColorPicker } from "@/components/widgets/ColorPicker";

<SchemaForm
  schema={schema}
  value={value}
  onChange={setValue}
  widgets={{ color: ColorPicker }}
/>
```

Le widget est routé via le champ `format` du schema (e.g. `{ type: "string", format: "color" }`).

**Hors scope V1 :** `oneOf` / `anyOf` / `if/then/else` / `$ref` resolution. À ajouter quand un module en a besoin.

### Stability annotations (depuis 2026-05-25)

Le package `gg.interfaze.modules.api.*` est annoté avec `@Stable` (depuis `gg.interfaze.modules.api.annotations`). Convention :

| Annotation | Signification | Quand |
|---|---|---|
| `@Stable` | Couvert par SemVer. Pas de breaking change dans un même major. | Tout `modules/api/*` après stabilisation. |
| `@Beta` | Expérimental, peut changer en minor. | API nouvelle avant ship public. |
| `@Internal` | Usage interne uniquement. Modules tiers ne doivent pas en dépendre. | Tout `gg.interfaze.plugin.*` (implicite par convention de package). |
| `@Sunset(reason, removeInVersion, replacement)` | Sera retiré au prochain major. | À l'annonce de dépréciation. |

**Règle d'import pour les modules** : un `InterfazeModule` n'importe **que** depuis `gg.interfaze.modules.api.*`. Jamais depuis `gg.interfaze.plugin.*` (qui est implicitement `@Internal`).

Cf. `docs/architecture/versioning.md` section 3.

### Flux de données

```
[Editor browser]
   │ WS ws://backend:3001/ws/plugin  (pluginBridge.ts)
   │ POST /api/bundles/:packId       (bundlePublisher.ts)
   ▼
[Backend Bun/Hono]
   │ WS /ws/plugin                   (hub.ts)
   │ REST /api/bundles, /api/server-keys
   ▼
[Plugin Kotlin]
   │ hello → hello_ack + bundle_available
   │ GET /api/bundles/:packId        (BundleDownloader.kt)
   └ écrit sur disque → hot-reload menus
```

### Protocole WS plugin ↔ backend

| Message | Sens | Contenu clé |
|---|---|---|
| `hello` | plugin → backend | `server_key`, `current_bundle_hash`, `custom_items_hash?` |
| `hello_ack` | backend → plugin | `pack_hashes`, `needs_sync`, `api_url`, `resource_pack: { url, hash } \| null`, `deleted_pack_ids: string[]` — liste des packs supprimés côté éditeur depuis la dernière connexion, pour que le plugin puisse move-to-trash les packs locaux correspondants. **Phase 2** : `pack_hashes[packId]` = `branch.head_commit.contentHash` (le binding détermine la branche). |
| `bundle_available` | backend → plugin | `pack_id`, `url`, `hash` |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` |
| `editor_session_request` | plugin → backend | `sender` |
| `editor_session_ready` | backend → plugin | `url`, `expires_at`, `trust_code` |
| `editor_session_revoke` | plugin → backend | `{}` |
| `editor_trust_request` | plugin → backend | `trust_code` |
| `session_trusted` | backend → éditeur WS | `{}` |
| `session_expired` | backend → éditeur WS | `{}` |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |
| `resource_pack_updated` | backend → plugin | `{ url, hash }` — broadcast après chaque rebuild |
| `custom_items_changed` | plugin → backend | `{ hash }` — hot-reload Nexo/Oraxen/ItemsAdder |
| `custom_items_request` | backend → plugin | `{}` — demande le bundle complet |
| `custom_items_bundle` | plugin → backend | `{ hash, data }` — `data = base64(gzip(zip))` |
| `pack_divergence_detected` | plugin → backend | `{ pack_id, disk_files, disk_hash, last_synced_hash }` — **Plan 1C: handler is now a no-op for backward compat; new plugins log WARN instead** |
| `pack_deleted` | backend → plugin | `{ pack_id }` — pack supprimé côté éditeur, le plugin move-to-trash |
| `local_push` | plugin → backend | `{ pack_id, files, hash }` — used by `/ifz pushLocal`. Backend creates pack + binding if missing, upserts content, broadcasts `bundle_available`. |

---

## Invariants critiques

**Hash byte-order sort** — `BundleHasher.kt` et `hashUtils.ts` trient les fichiers par ordre byte natif (`<`/`>` Kotlin/JS). Ne jamais utiliser `localeCompare` ou `compareToIgnoreCase` : les hashes divergeraient entre plugin et backend.

**Sentinel `""`** — chaîne vide = "jamais synchronisé / pas de contenu" dans tous les contextes hash. `BundleHasher.hash()` renvoie `""` pour un répertoire vide. `SyncMetadata.syncedHash` est `""` par défaut.

**`BUNDLE_BASE_URL` vs `API_BASE_URL`** — en Docker, le plugin (container `minecraft`) accède au backend via `http://backend:3001`, mais le browser accède via `http://localhost:3001`. Les deux env vars sont distinctes. Par défaut `BUNDLE_BASE_URL` = `API_BASE_URL` (hors Docker, c'est identique).

**OkHttp thread** — `SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Le download de bundle est dispatché sur `httpClient.dispatcher.executorService`. Ne jamais faire de I/O bloquant dans le callback WS directement.

**Reload atomique** — `reloadFromDisk()` construit un nouveau `ConcurrentHashMap` entier, puis l'assigne à `@Volatile var menus`. Ne jamais modifier le map en place.

**Conflit = freeze** — tant que `pack_conflicts.resolved_at IS NULL` côté backend, aucun `bundle_available` n'est broadcast pour ce `(server_id, pack_id)`. Implémenté dans `pushBundleAvailable` (hub.ts) qui consulte la table en début de fonction. Empêche tout écrasement silencieux pendant qu'une décision est en attente.

**Auto-resolution sur DELETE pack** — `DELETE /api/editor-session/:token/packs/:packId` marque tout conflit ouvert pour ce pack comme `resolution: "editor"` et envoie `pack_deleted` au plugin (qui move-to-trash). L'éditeur devient implicitement autoritaire.

**`.interfaze-trash/` is sacred** — répertoire au top de `packsDir` créé par `PackDeleter`. Exclu du hash (filtre `.` au top-level dans `BundleHasher.hashAll`) et du sweep de `BundleDownloader` (filtre `.interfaze*` sur les filenames). Ne jamais utiliser ce nom pour autre chose.

**Suppressions propagées** — `BundleDownloader.download` walk le packDir après écriture et supprime les fichiers locaux absents du bundle (filtre `.interfaze*` préservé). Le sweep résout le bug historique où supprimer un menu dans l'éditeur ne le retirait pas du disque serveur.

---

## Structure des packs sur disque

```
plugins/Interfaze/packs/
  <pack_id>/
    manifest.yaml
    menus/<menu_id>.yaml
    dialogs/<dialog_id>.yaml
    lang/<lang>.yaml
    .interfaze-sync.yaml   ← SyncMetadata (syncedHash, backendHash, syncedAt)
```

`.interfaze-sync.yaml` est exclu du hash (préfixe `.interfaze` filtré dans `BundleHasher`).

### Format menu YAML — champ `title`

Depuis la sub-project "title composer" (SP3), `title` est un tableau de couches typées (`MenuTitleLayer[]`). Format legacy (chaîne brute ou `{i18n:key}`) toléré au parsing plugin pour rétro-compat.

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
    font_asset_id: ...   # optionnel (Sub-project 4)
  - kind: textarea
    value:
      key: i18nKey_block
    x: 8
    y: 6
    width: 168
    line_height: 10
    alignment: left      # left | center | right
    font_asset_id: ...   # optionnel (Sub-project 4)
  - kind: external_glyph
    provider: oraxen     # nexo | oraxen | itemsadder
    glyph_name: my_glyph
    x: 50
    y: 5
```

Le kind `textarea` (SP5) est un bloc de texte multi-ligne. La string i18n est split sur `\n` au runtime, puis chaque ligne est word-wrappée pour tenir dans `width` (px). Chaque sous-ligne est rendue à `(x, y + i * line_height)` avec l'`alignment` (`left`/`center`/`right`) partagé. La police optionnelle `font_asset_id` s'applique à toutes les lignes. Mots plus larges que `width` débordent (soft constraint).

Le plugin embarque un `assets/interfaze/asset-index.json` (schéma **v2**) dans le zip resource pack pour mapper `asset_id → name + type + codepoint? + ascent + height + width + namespace?` et déclarer la table `offsets` (codepoint hex → pixel advance). Le `TitleCompiler` enveloppe tout le titre dans `<font:interfaze:default>…</font>` et insère, entre chaque couche, une séquence de chars "space" (du provider `space` embarqué dans `font/default.json`) pour positionner précisément chaque layer à son `x` cible. Voir section "Title Composer — pixel offsets" plus bas.

### Title Composer — pixel offsets (spaces font)

Pour positionner chaque layer du titre à son `x` exact, le backend embarque dans `assets/interfaze/font/default.json` un provider de type `space` (MC 1.20+) qui mappe 18 codepoints (`U+F800..U+F811`) à des advances en pixels (puissances de 2 ±1 / ±2 / ±4 / … / ±256, soit une portée naturelle de ±511 px par décomposition gourmande, et **plus avec réutilisation** des mêmes chars). On évite `U+F900..U+FAFF` (CJK Compatibility Ideographs) où la font vanilla a des glyphes (caractères chinois) qui empêcheraient le `space` provider de s'appliquer.

Pipeline :

1. **Backend** — `backend/src/lib/spaceOffsets.ts` est la source de vérité de la table. `buildDefaultFontJson` ajoute le provider `space` après les bitmaps. `buildAssetIndex` (v2) émet aussi le champ `offsets` (codepoint hex uppercase → advance) + un `width` par entrée pour permettre au plugin de mesurer la largeur rendue d'une layer image.
2. **Plugin** — `AssetCatalog` parse `offsets` à chaque update du resource pack et construit un `OffsetEncoder` (`gg.interfaze.plugin.render.OffsetEncoder`). `TitleCompiler.compileTitle` track `currentX`, insère `offsetEncoder.encode(targetX - currentX)` avant chaque body de layer, et avance `currentX = targetX + estimateBodyWidth(layer)`.
3. **Estimation de largeur** — best-effort : Image (background/glyph) → `AssetEntry.width` (fallback 16) ; Text → `length * 6` (heuristique du width par défaut MC, imprécis pour les caractères très étroits/larges) ; ExternalGlyph → 8 px.

**Système de coordonnées x** : `layer.x` est exprimé en pixels depuis le bord gauche du coffre (`chest-x 0`). Le titre MC est dessiné à `titleLabelX = 8` (bord gauche du coffre + 8 px). `TitleCompiler` initialise `currentX = TITLE_LABEL_X = 8` pour absorber ce décalage : une layer à `x=8` produit un offset nul (position naturelle du titre), une layer à `x=0` produit un offset `-8` (bord gauche du coffre).

L'encoder du plugin est lenient : il ne lève **jamais** d'exception, retourne `""` quand la table est vide (catalog pas encore chargé), et fait du best-effort hors plage. Côté backend, `encodeOffset` est strict (throw) pour attraper les bugs à la source.

### Custom fonts (SP4)

Les utilisateurs importent des fonts au format MCFonts via le bouton "Import font" dans l'AssetsTab : drop d'un `.zip` contenant `font.json` + glyph PNGs. Le backend parse, valide, stocke sur disque (`data/assets/{sk}/fonts/{asset_id}/`) et crée une row `Asset` avec `type=font` + `fontMeta = { namespace, glyphMap }`. À la prochaine régénération du resource pack, `assets/interfaze/font/<name>.json` + `assets/interfaze/textures/font/<name>/*.png` sont embarqués dans le zip. Côté éditeur, `TitleRender` rend pixel-perfect via `McFontText` (composition Konva des glyph PNGs).

Background = "gros glyph" : l'utilisateur upload un glyph dont l'ascent est calibré pour couvrir la zone souhaitée. Le `LayerEditForm` pour les layers Background expose un bouton "Calibrer pour coffre" qui set `ascent = -11` (couvre la zone des slots, en-dessous de la barre de titre). Pour couvrir depuis le haut du coffre (y=0), utiliser `ascent = 6`. Formule : `ascent = titleLabelY(6) - targetY`. Le pack canvas affiche les menus en forme finale (toutes layers + items dessus) en édition directe — `MenuGroup` rend `TitleRender` interactif (drag layers, resize handles, sélection).

### Title Composer UX v3

- **Édition in-place** : les layers d'un titre sont édités **directement sur le pack canvas** via une 3ᵉ colonne (`LayersPanel`, toujours visible, ~280 px). Plus de focus mode dédié — l'édition se fait au même endroit que la vue d'ensemble du pack.
- **Layout 3 colonnes** : Pack canvas (gauche) | `MenuProperties` (centre, rows / permission / actions) | `LayersPanel` (droite). Route principale `pack.$packId.tsx`.
- **Composition du `LayersPanel`** : Header + `AddLayerControls` (boutons `+ Image` / `+ Text`) + liste drag-reorderable de `LayerListItem` + `LayerEditForm` pour le layer sélectionné.
- **Modèle de sélection** : `uiStore.selectedLayerKey: { menuId, index } | null` désigne un layer unique sélectionné ; `uiStore.lastSelectedMenuId` reste sticky pour que le panel survive aux clics dans le vide (pas de "tout désélectionner par accident").
- **Types de layers en UI** : **2 visibles** — Image (collapse `background` + `glyph` avec flag `stretchToChest`) et Text. Au save, la couche Image se split en runtime entre `background` / `glyph` (`MenuTitleLayer`). Les glyphs externes (Oraxen / Nexo / ItemsAdder) ont leur propre branche, mais l'UI v3 ne les expose pas encore comme bouton dédié.
- **Texte** = MiniMessage tags inline (`<gold>`, `<bold>`, etc.) ; preview live dans `LayerEditForm` + rendu live sur le canvas. Pas de champ `color` per-layer (coloring 100% par tags, hérité de v2).
- **Manipulation directe** : drag d'un layer sur le canvas pour repositionner ; corner-drag (`ResizeHandles`) pour redimensionner (aspect-locked par défaut ; shift = no-op en v3, scope futur si PNG resample est implémenté).
- **Sémantique du resize — IMPORTANT** : redimensionner un glyph mute l'**asset** lui-même (pas juste la couche). Tous les menus qui référencent le même asset voient la nouvelle taille. Pour avoir une taille per-menu, utiliser le bouton **"Duplicate glyph"** dans `LayerEditForm` — crée une copie de l'asset (nouveau `codepoint`, PNG copié) et repointe le layer courant vers le nouvel asset.
- **Cursor-based new-layer attach** : drag depuis le bouton `+ Image` / `+ Text` → le curseur suit le geste → drop près d'un menu → la couche s'attache au menu le plus proche (seuil 200 px). Click sans drag → attache au last-selected menu.
- **Nouveaux fichiers v3** sous `editor/src/features/canvas/title/composer/` :
  - `LayersPanel.tsx` (composition de la 3ᵉ colonne)
  - `LayerListItem.tsx`
  - `LayerEditForm.tsx`
  - `AddLayerControls.tsx`
  - `ResizeHandles.tsx`
  - `TitleRender.tsx` (interactif, plus de split compact/edit)
  - `useTitleLayerDrag.ts`
  - `dragPlacement.ts`
  - `attachLayerAtCursor.ts`
  - `screenToCanvasCoords.ts`
  - `stageGeometry.ts` (dans `editor/src/features/canvas/`)
- **Files supprimés vs v2** : `FocusComposer.tsx`, `ComposerCanvas.tsx`, `AddLayerBar.tsx`, `LayerSidePanel.tsx`, `TitleThumbnail.tsx` (+ leurs tests).
- **Runtime YAML** inchangé en v3 : seul l'éditeur évolue. Le plugin lit toujours le même format `MenuTitleLayer[]` (background / glyph / text / external_glyph).

---

## Custom Items — endpoints et cache

| Endpoint | Description |
|---|---|
| `GET /api/editor-session/:token/custom-items` | Retourne `{ serverKeyId, items[] }` depuis le cache disque. `items: []` si pas encore synchronisé. |
| `GET /api/textures/:version/:path*` | Sert les PNG vanilla depuis `data/mc-assets/{version}/textures/{path}.png`. |
| `GET /api/textures/custom/:serverKeyId/:path*` | Sert les PNG custom depuis `data/custom-items/{serverKeyId}/textures/{path}.png`. |
| `GET /api/models/:version/:path*` | Sert les JSON de modèles vanilla depuis `data/mc-assets/{version}/models/{path}.json`. |
| `GET /api/models/custom/:serverKeyId/:path*` | Sert les JSON de modèles custom depuis `data/custom-items/{serverKeyId}/models/{path}.json`. |
| `POST /api/editor-session/:token/packs/:packId/assets` | Upload PNG asset (multipart). Body: `type`, `name`, `ascent?`, `file`. Returns `{ asset }`. Dedup par contentHash + packId, alloc codepoint pour glyph. 403 si le pack n'est pas bindé au server_key de la session. |
| `GET /api/editor-session/:token/packs/:packId/assets` | Liste les assets du pack. Query `type=&search=`. |
| `GET /api/editor-session/:token/packs/:packId/assets/:id` | Détail d'un asset. 404 si autre pack. |
| `PATCH /api/editor-session/:token/packs/:packId/assets/:id` | Renommer / changer ascent / changer height (glyph). Body JSON `{ name?, ascent?, height? }`. Validation `height` : entier, 1 ≤ height ≤ 256, applicable uniquement aux assets `type=glyph`. Après update : rebuild RP + broadcast `resource_pack_updated`. |
| `POST /api/editor-session/:token/packs/:packId/assets/:id/duplicate` | Duplique un asset glyph. Crée un nouvel id, alloue un nouveau codepoint (`codepointAllocator`), nom suffixé `_copy` (puis `_copy2`, `_copy3`, … si conflit), copie le PNG sur disque. Returns `{ asset }`. Rebuild RP + broadcast. |
| `DELETE /api/editor-session/:token/packs/:packId/assets/:id` | Supprime (DB + fichier disque). 204. |
| `DELETE /api/editor-session/:token/packs/:packId` | Soft-delete du pack (sets `deletedAt`), auto-résolution de tout conflit ouvert en "editor", broadcast `pack_deleted` au plugin et aux autres éditeurs. 200 `{deleted: true}` ou 404. |
| `GET /api/networks` | Liste les Networks de l'utilisateur connecté. Cookie `ifz_user_session` requis. |
| `POST /api/networks` | Crée un Network + Membership owner. Body `{name}`. 201 / 422 invalid_name. |
| `GET /api/networks/:id` | Détail (network + packs + serverKeys). 403 si pas membre. |
| `POST /api/networks/:id/server-keys` | Crée un server_key dans le Network. Body `{label?}`. Returns plaintext key (only once). |
| `POST /api/networks/:id/packs` | Crée un pack. Body `{name, description?}`. |
| `POST /api/networks/:id/packs/:packId/bindings/:serverKeyId` | Bind pack ↔ server_key. Body `{branch_name?}` (default `"main"`). 201 ou 404 `branch_not_found` si la branche cible n'existe pas. |
| `DELETE /api/networks/:id/packs/:packId/bindings/:serverKeyId` | Unbind. 204. |
| `GET /api/networks/:id/packs/:packId/branches` | Liste les branches du pack. |
| `POST /api/networks/:id/packs/:packId/branches` | Body `{name, from}`. 201 / 409 `branch_exists` / 404 `source_branch_not_found` / 422 `invalid_name`. Le name doit matcher `/^[a-zA-Z0-9_\-./]+$/`. |
| `GET /api/networks/:id/packs/:packId/commits?branch=&limit=` | Liste les commits récents (desc createdAt). `limit` clampé à 200, défaut 50. Le `branch` query param est accepté mais pas filtré pour MVP. |
| `POST /api/networks/:id/packs/:packId/commits` | Body `{branch, message}`. Crée un commit depuis le WIP courant (`packs.filesJson` + `editorJson`) + avance la branche + broadcast `bundle_available`. Dedup par `(packId, contentHash)`. 404 si branche n'existe pas. |
| `POST /api/networks/:id/packs/:packId/branches/:src/promote/:dst` | Fast-forward only. 200 `{ok, advanced}` ou 409 `not_fast_forward` si la cible a divergé. 400 `same_branch` si src===dst. |
| `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst` | Tente un merge sémantique de `src` dans `dst`. Body `{message?}`. Returns `{kind: "already_merged" | "fast_forward" | "auto" | "conflicts", ...}`. Le cas `fast_forward` avance `dst.head` directement et broadcast `bundle_available`. Les cas `auto` / `conflicts` ne créent pas de commit — le client doit poster vers `/resolve` ensuite (en passant le `mergedFilesJson` / `mergedEditorJson` qu'il a calculé côté éditeur). 400 `same_branch` si src===dst. 404 si branche inconnue. |
| `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst/resolve` | Body `{resolutions, lcaCommitId, srcCommitId, dstCommitId, mergedFilesJson, mergedEditorJson, message?}`. Crée le merge commit avec `parentId = dst.head` et `parentId2 = src.head`, avance la branche `dst`, broadcast `bundle_available`. 409 `stale_merge` si les heads ont bougé depuis le `/merge-into`. 400 `missing_resolutions` / `extra_resolutions` / `invalid_resolution_value` si le mapping conflit→choix est inconsistant. |
| `GET /api/user/packs/:packId` | Lecture pack (user-auth, membership check). |
| `PUT /api/user/packs/:packId` | Écriture pack (user-auth). Broadcast `bundle_available`. |
| `GET /api/textures/asset/:packId/:assetId` | Sert le PNG d'un asset (texture/glyph) depuis `data/assets/{packId}/{assetId}.png`. |
| `GET /api/textures/asset-font/:assetId/:path*` | Sert un glyph PNG d'un asset font depuis `data/assets/{packId}/fonts/{assetId}/{path}`. Lookup par assetId (le packId est lu en DB). 404 si pas un asset font ou path traversal. |
| `GET /api/resource-pack/:server_key_id/:hash.zip` | Sert le zip du resource pack généré. `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<hash>"`. 404 si hash inconnu. |
| `POST /api/editor-session/:token/resource-pack/rebuild` | Force la régénération du resource pack pour le server_key de la session. Returns `{ url, hash }` et broadcast `resource_pack_updated`. |

Cache disque : `backend/data/custom-items/{server_key_id}/hash.txt`, `items.json`, `textures/`.

**Invariant custom items hash** — `CustomItemsManager.buildBundle()` calcule le hash en inline à partir des items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.

---

## Modèle d'entités (Plan 1B + Phase 2 + Phase 3)

```
User (Plan 1A) ── Membership ──┐
                                ▼
                            Network (id, name, tier="free")
                              │ owns
                  ┌───────────┼───────────┐
                  ▼                       ▼
              ServerKey (N)            Pack (N, first-class)
                  │                       │
                  └── PackBinding ────────┘
                       (server_key_id, pack_id, branchName="main")
                       many-to-many
                  
                                         Pack → PackBranch ← PackCommit
                                         (branches + commits)
```

### Plan 1B — Multi-server networks

- **Pack** : entité first-class avec `id`, `networkId`, `name`, `hash`, `filesJson`, `editorJson`, `deployedEditorJson`, `deletedAt`. Plus de scope par `server_key`.
- **PackBinding** : table `pack_bindings(server_key_id, pack_id, branchName)` — un même pack peut être lié à plusieurs server_keys (multi-server sync), un server_key peut binder plusieurs packs (multi-pack sur un même serveur MC). Chaque binding vise une branche spécifique (default `"main"`).
- **Assets per-pack** : `assets.packId` (au lieu de `assets.serverKeyId`). Codepoint allocator scopé au pack. Chemins disque `data/assets/{packId}/...`.
- **Resource pack build multi-pack** : `rebuildResourcePack(serverKeyId)` collecte les assets de tous les packs bindés au server_key et merge les codepoints à la volée (premier pack arrivé garde son codepoint, collisions ré-allouées). Voir `lib/rpCodepointMerger.ts`.
- **Server keys belongs to Network** : `server_keys.networkId` NOT NULL. À la création (`/api/link/claim` ou `/api/server-keys` ou WS `setup_claim`), un Network par défaut `Network <prefix>` est auto-créé.
- **WS hub** : `hello_ack.pack_hashes` et `pushBundleAvailable(packId, hash)` résolvent les targets via `packBindings`. `pushPackDeleted(packId)` idem.
- **Plugin protocole inchangé** : aucun changement de code plugin nécessaire ; seule la source des données côté backend bouge.

Tables Drizzle ajoutées en Plan 1B : `networks`, `memberships`, `packs`, `pack_bindings`. Table supprimée : `pack_bundles` (son contenu fusionne dans `packs`).

### Phase 2 — branches + commits

- **pack_commits** : `(id, packId, parentId, contentHash, filesJson, editorJson, authorUserId, message, createdAt)`. Snapshot complet par commit. Dedup par `(packId, contentHash)`. `parentId` est nullable pour le commit racine (auto-créé à `createPack`).
- **pack_branches** : `(packId, name, headCommitId, createdAt, updatedAt)`. Pointeur vers un commit. Unique par `(packId, name)`.
- **pack_bindings.branchName** (default `"main"`) : un binding cible une branche spécifique. Unique par `(serverKeyId, packId, branchName)` — un même server_key peut binder le même pack sur des branches différentes (cas rare mais possible).
- **WIP vs commit** : `packs.filesJson` / `packs.editorJson` / `packs.hash` reste le buffer éditeur live (Plan 1B/1C). Les plugins lisent UNIQUEMENT les commits via le `branchName` du binding → `pack_branches.headCommitId` → `pack_commits.filesJson`.
- **Promotion** : fast-forward only. Le backend refuse en 409 `not_fast_forward` si la cible a divergé. Merge sémantique = Phase 3.

Tables Drizzle ajoutées en Phase 2 : `pack_commits`, `pack_branches`. Column ajoutée : `pack_bindings.branchName`.

### Phase 3 — merge sémantique par item

- **pack_commits.parentId2** (nullable) : 2ᵉ parent sur les merge commits, `null` sur les commits linéaires. Le DAG résultant supporte LCA via `branchStorage.findLCA(a, b)` — BFS bidirectionnel borné à 10 000 steps qui walk `parentId` + `parentId2`.
- **Granularité du merge** : par item top-level uniquement (`menus`, `commands`, `dialogs`, `templates`, `dataSources` indexés par `id` ; `i18nKeys`, `canvasLayout` en map ; scalaires `defaultLang` / `name` / `description`). Pas de merge field-level intra-item — un menu/dialog/etc. conflictuel est résolu en entier ("use src" ou "use dst").
- **Auto-merge** : changements non-collisionnels (un seul côté a touché l'item depuis le LCA) → la valeur de ce côté entre dans `mergedState`, pas de conflit émis.
- **Conflit** : item modifié des 2 côtés différemment (modify-modify) OU supprimé d'un côté et modifié de l'autre (delete-modify). Clés conflit : `"<collection>:<id>"` ou `"scalar:<field>"`. User choisit `src` ou `dst` par conflit via `MergeConflictModal`.
- **mergeEngine.merge** est pur (pas de DB) — opère sur `EditorState` désérialisé. Retourne `{ mergedState, conflicts[] }`. Sur conflit, `mergedState` garde la valeur `dst` par défaut (état renderable même avant résolution).
- **`assets[]` et `importedConnectors[]`** sont SKIP du merge (gérés via leurs propres APIs, scope per-pack). Le merge commit hérite des valeurs de `dst` pour ces champs.
- **contentHash collision** : 2 merges avec exactement les mêmes fichiers résolus violeraient `pack_commits_pack_content_uniq`. Workaround : la route `/resolve` ajoute un marker `merge-meta` (lcaCommitId + srcCommitId + dstCommitId) au contentHash pour différencier.

Column ajoutée en Phase 3 : `pack_commits.parentId2` (nullable).

### Plan accounts × networks UX — flow setup logged-in

- **Claim link auth** : `/ifz setup` requiert maintenant un compte user. Le claim `/api/link/:code/claim` exige cookie `ifz_user_session` et choisit le network destination via smart count (auto-crée "Mon Réseau" si 0, utilise si 1, picker modale si 2+).
- **`network_transfers`** : `(token, network_id, initiated_by_user_id, expires_at, consumed_at, consumed_by_user_id, created_at)`. Tokens partageables 24h pour transférer la propriété d'un Network entier. Memberships swap clean break — ancien owner perd accès.
- **Server key deletion** : `/api/networks/:id/server-keys/:keyId` (owner-only) suppress la clé + cascade pack_bindings. Le plugin perd la connexion au prochain hello.
- **Bootstrap plugin auto-push** : au hello, les packs disque inconnus du backend (`disk_hash != "" && backend_hash == ""`) sont auto-pushés via `local_push`. Plus de `/ifz pushLocal` manuel pour le first-time setup.
- **Désaffectation d'un serveur sans transfert** : delete la server_key dans `/networks/:id`, puis re-setup côté plugin → l'auto-push recharge les packs dans le nouveau network. Pas de mutation cross-account.

---

## Auth — endpoints

| Endpoint | Description |
|---|---|
| `POST /api/auth/signup` | Crée un user (email+password+name). Body JSON. 201 + Set-Cookie `ifz_user_session`. Erreurs : 400 invalid_body, 409 email_taken, 422 invalid_email / weak_password. |
| `POST /api/auth/login` | Authentifie email+password. 200 + Set-Cookie. Erreur : 401 invalid_credentials. |
| `POST /api/auth/logout` | Détruit la session courante (si présente), clear le cookie. Toujours 204. |
| `GET /api/auth/me` | Retourne le user courant. 200 `{ user }` ou 401 si pas de session. |
| `GET /api/auth/discord/start` | Redirige vers Discord pour OAuth (set cookie `ifz_oauth_state`). 500 si Discord pas configuré. |
| `GET /api/auth/discord/callback?code&state` | Callback OAuth : exchange code, fetch user Discord, crée/lien user + session, redirige vers `${EDITOR_URL}/account`. |

Cookies utilisés :
- `ifz_user_session` (HttpOnly, 30 jours) — référence la row `user_sessions.id`.
- `ifz_oauth_state` (HttpOnly, 10 min) — anti-CSRF pour le flow Discord.

Tables Drizzle ajoutées : `users`, `user_sessions`, `discord_accounts`.

Distinct du flow trust dance existant (server_keys + editor_sessions) — les deux cookies (`ifz_user_session` et `ifz_refresh`) coexistent.

### Plan accounts × networks UX — endpoints signup/login → network

| Endpoint | Description |
|---|---|
| `POST /api/link/:code/claim` | **Login required** (cookie `ifz_user_session`). Body `{network_id?}`. Smart count : 0 networks chez l'user → auto-crée "Mon Réseau", 1 → use it, 2+ → 400 `must_choose_network`. 401 sans cookie, 403 si pas membre du network demandé. Réécrit le legacy claim anonyme. |
| `POST /api/networks/:id/transfer/init` | Owner-only. Crée un transfer token (TTL 24h). Returns `{url, expiresAt}`. |
| `GET /api/networks/transfer/:token` | Returns `{networkId, networkName, packCount, serverKeyCount, expiresAt}`. 410 `expired` / `consumed`, 404 `not_found`. |
| `POST /api/networks/transfer/:token/accept` | Login required. Swap memberships (clean break — ancien owner perd accès). 410 expired/consumed. |
| `DELETE /api/networks/:id/server-keys/:keyId` | Owner-only. Delete server_key + cascade pack_bindings. Plugin perd la connexion au prochain hello. |
| `GET /api/editor-session/:token` | Étendu : retourne aussi `network_id` (le network du server_key behind la session). |

---

## Variables d'environnement (backend)

| Variable | Défaut | Usage |
|---|---|---|
| `PORT` | `3001` | Port HTTP/WS du backend |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/interfaze` | URL de connexion PostgreSQL |
| `API_BASE_URL` | `http://localhost:3001` | URL publique du backend (envoyée dans `hello_ack.api_url`) |
| `BUNDLE_BASE_URL` | `= API_BASE_URL` | URL utilisée dans `bundle_available.url` (**plugin → download du bundle menus**, donc côté réseau Docker = `http://backend:3001`) |
| `RESOURCE_PACK_BASE_URL` | `= API_BASE_URL` | URL utilisée dans les URLs de resource pack envoyées au joueur via `setResourcePack` (**doit être joignable depuis la machine du joueur**, pas le réseau Docker). Override en prod avec l'URL publique. |
| `DISCORD_CLIENT_ID` | (vide) | OAuth Discord — laisser vide désactive le bouton "Continue with Discord" |
| `DISCORD_CLIENT_SECRET` | (vide) | OAuth Discord |
| `DISCORD_REDIRECT_URI` | `http://localhost:3001/api/auth/discord/callback` | URI de callback configurée dans la Discord Developer Portal |

### Resource pack distribution modes

Switched by the plugin config `resource-pack.delegate-to-dir` — empty = legacy, suffix decides output shape:

| Mode | When | Behavior |
|---|---|---|
| Legacy (default) | `delegate-to-dir` empty | Plugin pushes its own RP via `addResourcePack` on join + on every update. Coexists with other RP plugins via the multi-pack stack (each pack has its own UUID). Two prompts at login when a host plugin also pushes. |
| Delegation (directory) | `delegate-to-dir: <path>` (no `.zip`) | Plugin extracts `assets/interfaze/*` into `<path>/assets/interfaze/` on every update. Skips player push. |
| Delegation (zip) | `delegate-to-dir: <path>.zip` | Plugin writes a single `<path>.zip` containing `assets/interfaze/*` + minimal `pack.mcmeta` (atomic via `.tmp` + rename). Use this with **Nexo's `pack/external_packs/`** — Nexo's directory scanner skips PNG files for non-vanilla namespaces, but its zip-merger pulls every entry. |

Both delegation modes own the `assets/interfaze/` subtree only — entries outside that namespace (and the source pack.mcmeta) are skipped. Set `resource-pack.delegate-reload-command` (e.g. `n reload`, `oraxen reload pack`) to auto-dispatch the host's reload after each rebuild; otherwise admin reloads manually.

**Nexo recipe:** `delegate-to-dir: "plugins/Nexo/pack/external_packs/interfaze.zip"` + `delegate-reload-command: "n reload"`.

---

## Tests — ce qui est couvert

| Scope | Fichiers | Count |
|---|---|---|
| Backend unit + intégration | `hub.test.ts`, `bundles.test.ts`, `serverKeys.test.ts`, `app.test.ts`, `editorSession.test.ts`, `integration.test.ts`, `customItems.test.ts`, `models.test.ts`, `assets.test.ts` (PATCH height + POST duplicate inclus), `codepointAllocator.test.ts`, `assetStorage.test.ts`, `pngDimensions.test.ts`, `textures.assets.test.ts`, `resourcePackBuilder.test.ts`, `fontJsonBuilder.test.ts`, `assetIndexBuilder.test.ts`, `spaceOffsets.test.ts`, `mcFontsParser.test.ts`, `fontStorage.test.ts`, `resourcePackStorage.test.ts`, `resourcePack.test.ts`, `routes/resourcePack.test.ts`, `packImport.test.ts`, `conflictDiff.test.ts`, `conflicts.test.ts`, `auth.test.ts`, `passwordHasher.test.ts`, `sessionManager.test.ts`, `emailNormalizer.test.ts`, `userAuth.test.ts`, `discordOauth.test.ts` (lib + routes), etc. | ~365 total après Plan 1A accounts foundation |
| Plugin unit + intégration | `BundleHasherTest`, `ConflictDetectionTest`, `BundleDownloaderTest`, `CustomItemsManagerTest`, `ActionExecutorTest` (inclus `show_title` exec via Adventure `showTitle(Title)`), `ActionParserTest` (inclus `show_title` parse + timings + i18n), `FullSyncIntegrationTest`, `ResourcePackManagerTest`, `PluginConfigTest`, `ResourcePackInfoTest`, `MenuTitleParserTest` (textarea parser tests), `AssetCatalogTest`, `TitleCompilerTest` (textarea compiler tests), `OffsetEncoderTest`, `ManifestYamlIgnoresEditorLayoutTest`, `PackDeleterTest`, `PackDeletionIntegrationTest`, etc. | ~365 (recount après merge) |
| Editor unit | Vitest, tests couvrant expr DSL, canvas, export (inclus `show_title` serializer + validate), i18n (inclus `showTitleKeyAt`/`showSubtitleKeyAt` + rekey + alloc), custom items Library, mcModelRenderer, assets Library, AssetUploadDialog, AssetImportFontDialog, AssetDetailPanel, AssetsTab, title composer v3 (TitleRender interactif / LayersPanel / LayerListItem / LayerEditForm / AddLayerControls / ResizeHandles / useTitleLayerDrag / dragPlacement / attachLayerAtCursor / screenToCanvasCoords / stageGeometry / uiLayerMapping / snap), McFontText, fontGlyphUrl, textarea layer (TextareaLayerForm / TextAreaText / WidthResizeHandle / wrapLine), text-size (`TextSizeSelector`, `LayerEditForm` size field), conflictsStore, DeletePackDialog, ConflictBanner, ConflictResolutionModal, `authStore.test.ts`, `LoginForm.test.tsx`, `SignupForm.test.tsx`, `LogoutButton.test.tsx`, etc. | ~720 (recount après merge) |
| E2E editor | `smoke.spec.ts` (Playwright) — canvas charge, sidebar visible | 1 |

E2E cross-stack (editor → backend → plugin en bout en bout) : **non automatisé**, test manuel via Docker.
