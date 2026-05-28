# Texture Pack System — Design Spec

**Date:** 2026-05-11
**Status:** Approved
**Replaces:** `docs/specs/main-spec.md` § 9 (Resource Pack)

## Goal

Permettre à l'utilisateur d'enrichir visuellement ses menus Artisan avec :

1. **Backgrounds custom** (textures qui remplacent/recouvrent le fond du chest GUI)
2. **Glyphs/overlays** (icônes décoratives positionnées en pixels dans le menu)
3. **Texte arbitraire** dans le menu, statique ou dynamique via placeholders, avec optional custom fonts

Le système doit fonctionner **avec ou sans** plugin de pack externe (Oraxen/Nexo/ItemsAdder), tout en s'intégrant à ces plugins quand ils sont présents (référencer leurs glyphs, pas dupliquer).

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  EDITOR (React)                                            │
│  • Onglet Assets (biblio globale par server_key)           │
│  • Title composer WYSIWYG : layers (bg, glyphs, text)      │
│  • Asset picker (filtre Artisan/Oraxen/Nexo/ItemsAdder)  │
└──────────────────────┬────────────────────────────────────┘
                       │ POST /api/assets (upload)
                       │ PUT  /api/packs/.../menus (refs AssetId)
                       ▼
┌───────────────────────────────────────────────────────────┐
│  BACKEND (Bun + Postgres)                                  │
│  • assets table : scoped par server_key                    │
│  • resource pack generator : merge tous assets → zip       │
│    déclenché sur asset CRUD                                │
│  • GET /api/resource-pack/:server_key/:hash.zip            │
│    cache HTTP immutable                                    │
│  • WS broadcast `resource_pack_updated` → plugin           │
└──────────────────────┬────────────────────────────────────┘
                       │ WS resource_pack_updated (hash, url)
                       │ HTTPS GET pack zip
                       ▼
┌───────────────────────────────────────────────────────────┐
│  PLUGIN (Kotlin/Paper)                                     │
│  • À player join : player.setResourcePack(url, hash...)    │
│  • Pack stack-compatible (coexiste avec Oraxen)            │
│  • Au render menu : compile MenuTitleLayer[] → MiniMessage │
└───────────────────────────────────────────────────────────┘
```

**Décisions clés** :

- Un seul resource pack par `server_key` (toutes packs Artisan fusionnées dedans)
- Asset library globale au `server_key` (pas au pack)
- Cache busting par hash dans l'URL
- Le plugin push le pack au joueur (`setResourcePack`), coexistence via pack stack 1.20.3+
- Glyphs externes (Oraxen/Nexo/ItemsAdder) **référencés** mais **jamais** inclus dans le pack Artisan

## Domain Model

### Asset (entité globale)

```ts
type AssetType = "texture" | "glyph" | "font";

interface Asset {
  id: AssetId;              // "asset_a1b2c3", généré backend
  serverKeyId: ServerKeyId;
  type: AssetType;
  name: string;             // unique par (serverKey, type), ex "shop_bg"
  width: number;
  height: number;

  // pour type=glyph :
  ascent?: number;          // défaut: height-1
  codepoint?: number;       // auto-assigné dans U+E000–U+F8FF

  // pour type=font (import MCFonts) :
  fontMeta?: {
    namespace: string;      // ex "artisan:my_font"
    glyphMap: Array<{
      char: string;
      texture: string;
      ascent: number;
      height: number;
    }>;
  };

  createdAt: Date;
  updatedAt: Date;
  contentHash: string;      // SHA1 du PNG/font
}
```

### MenuTitle (remplace l'ancien `title: LText`)

```ts
type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;  // undefined = font vanilla
      color?: string }
  | { kind: "external_glyph";
      provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };

interface Menu {
  // ...
  title: MenuTitleLayer[];
  // ...
}
```

### ExternalGlyph (cache backend, lecture seule)

```ts
type ExternalGlyph = {
  provider: "oraxen" | "nexo" | "itemsadder";
  namespace: string;        // ex "oraxen", "nexo"
  glyphName: string;
  char: string;             // codepoint
  textureUrl: string;       // servi par backend (PNG décodé du bundle WS)
  width: number;
  height: number;
  ascent: number;
};
```

### Compilation runtime (plugin)

`MenuTitleLayer[]` → MiniMessage string :

- Background/glyph Artisan → `<font:artisan:default><offset:Xpx></offset></font>`
- Text vanilla → `<offset:Xpx><color:...>texte</color></offset>`
- Text custom font → `<offset:Xpx><font:artisan:my_font>texte</font></offset>`
- External glyph → `<font:oraxen:default></font>`

(où le caractère après `<offset:Xpx>` ou dans `<font:oraxen:default>` est le codepoint Unicode alloué au glyph dans la Private Use Area, ex ``. Valeurs réelles assignées par le générateur backend.)

L'ordre des layers détermine le z-order (premier = arrière, dernier = avant). Les `<offset:>` permettent de positionner chaque layer indépendamment.

## Resource Pack Generation

### Déclencheurs

- Asset CRUD (upload/edit/delete) → régénération synchrone
- Manual trigger : `POST /api/resource-pack/:server_key/rebuild`
- **Pas** de régénération sur publish de menu (le pack ne dépend que des assets)

### Structure du zip

```
artisan-pack.zip
├── pack.mcmeta              # format 22 (1.21+)
├── pack.png                 # icône Artisan (fixe MVP)
└── assets/
    └── artisan/
        ├── font/
        │   ├── default.json # aggregate glyphs standalone + refs minecraft:default
        │   └── <name>.json  # 1 par font importée
        └── textures/
            └── font/
                ├── <glyph_id>.png
                └── <font_name>/
                    └── <char>.png
```

Exemple `font/default.json` :

```json
{
  "providers": [
    { "type": "reference", "id": "minecraft:default" },
    { "type": "bitmap", "file": "artisan:font/coin_icon.png",
      "ascent": 8, "height": 9, "chars": [""] },
    { "type": "bitmap", "file": "artisan:font/shop_bg.png",
      "ascent": -8, "height": 200, "chars": [""] }
  ]
}
```

### Pipeline backend

1. Read all `Asset` WHERE `serverKeyId = X`
2. Allocate codepoints (stable across regenerations, stocké sur Asset)
3. Generate font JSONs (default.json + per-font files)
4. Stream-build zip en mémoire
5. SHA1 du zip → `{hash}`
6. Write `data/resource-packs/{serverKeyId}/{hash}.zip`
7. Update `ServerKey.resourcePackHash` + `resourcePackUrl`
8. GC : garder les 3 derniers hashes (grace period download)
9. WS notify plugin : `{ kind: "resource_pack_updated", url, hash }`

### Codepoint allocation

- Range : `U+E000` à `U+F7FF` (Private Use Area, on évite `U+F800–U+F8FF` souvent utilisé par Oraxen/Nexo)
- Séquence par `serverKeyId`, premier libre, stable (jamais réutilisé tant que l'asset existe)
- Si > 6144 assets : refuse upload, message "asset library full"

### Endpoints HTTP

```
GET /api/resource-pack/:server_key_id/:hash.zip
  → 200 + zip stream, Cache-Control: immutable, ETag: hash
  → 404 si hash inconnu

GET /api/textures/asset/:asset_id
  → preview PNG brut (pour l'éditeur)

GET /api/external-glyphs/:server_key_id/:provider/:glyph_name.png
  → preview glyph externe (décodé du bundle WS)
```

## Plugin Distribution

### Envoi au joueur

```kotlin
fun pushPackToPlayer(player: Player) {
  val info = currentPackInfo ?: return
  player.setResourcePack(
    info.uuid,             // UUID.nameUUIDFromBytes(hash.toByteArray())
    info.url,
    info.sha1Bytes,        // 20 bytes
    info.prompt,           // Component MiniMessage
    false                  // required = false
  )
}
```

**Quand on push** :
- `PlayerJoinEvent` + 20 ticks délai
- Réception WS `resource_pack_updated` → re-push à tous les onlines

**UUID stable par hash** : `UUID.nameUUIDFromBytes(hash.toByteArray())` → envoi répété idempotent dans le pack stack du client.

### Messages WS additionnels

| Message | Sens | Contenu |
|---|---|---|
| `hello_ack` | backend → plugin | + `resource_pack: { url, hash } \| null` |
| `resource_pack_updated` | backend → plugin | `{ url, hash }` |
| `external_glyphs_changed` | plugin → backend | `{ hash }` |
| `external_glyphs_request` | backend → plugin | `{}` |
| `external_glyphs_bundle` | plugin → backend | `{ hash, data: base64(gzip(json)) }` |

### Configuration plugin

```yaml
# plugins/Artisan/config.yml
resource-pack:
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
```

### Refus joueur

- `PlayerResourcePackStatusEvent` → log DECLINED / FAILED_DOWNLOAD
- Pas de kick (pack `required = false`)
- Menus affichent `□` à la place des glyphs si pack refusé

## Editor UX

### Onglet Assets

```
[+ Upload PNG] [+ Import font]  [Search...]  [All|Texture|Glyph|Font]

┌────┬────┬────┬────┬────┬────┐
│[img]│[img]│[img]│[img]│[img]│[img]│   ← grid virtualisée
│name │name │name │name │name │name │
└────┴────┴────┴────┴────┴────┘

Section: External glyphs (read-only, Oraxen/Nexo)
```

**Sélection asset** → panel latéral : name (éditable), type, dimensions, ascent (éditable pour glyph), codepoint, "Used in N packs", [Delete] (warning si utilisé).

### Title composer WYSIWYG

Mockup chest à l'échelle 2x avec layers superposés. À droite, liste z-order :

```
🅃 Text: "Shop"   x=68 y=8  font=vanilla
🇬 Glyph: coin    x=32 y=4
🇧 Bg: shop_bg
```

**Interactions** :
- Drag sur mockup → bouge le layer (snap pixel; Shift = libre; Alt = snap slot 18px)
- Click layer → highlight + select
- "Add layer" → asset picker (filtré par type)
- Reorder via drag-drop dans la liste = z-index

**Preview** : Konva rend à l'échelle, glyphs Artisan via `<img>` asset, glyphs externes via `textureUrl`, texte en font Minecraft approximative HTML/CSS (MVP) ou Canvas bitmap (phase 2).

### Asset picker (partagé)

Réutilisable depuis : title composer, element appearances, font selector.

Toggle source : All / Artisan / Oraxen / Nexo / ItemsAdder. External glyphs badgés + cadenas read-only.

### Import font

Modal "Import font" : upload `.zip` (MCFonts format) → backend valide structure, parse `font.json`, extrait glyphs, crée 1 Asset `type=font` avec `fontMeta` rempli.

### Composants éditor à créer

```
editor/src/features/assets/
├── AssetsTab.tsx
├── AssetGrid.tsx            # réutilise virtualization Library
├── AssetUploadDialog.tsx
├── AssetImportFontDialog.tsx
├── AssetDetailPanel.tsx
├── AssetPicker.tsx
└── assetStore.ts

editor/src/features/canvas/title/
├── TitleComposer.tsx
├── TitleMockup.tsx          # Konva render
├── TitleLayerList.tsx
├── TitleLayerItem.tsx
├── TitleTextEditor.tsx
└── (intégré au pack store existant)
```

## External Glyphs Integration

### Détection runtime (plugin)

```kotlin
interface GlyphSource {
  val provider: String
  fun isAvailable(): Boolean
  fun listGlyphs(): List<ExternalGlyph>
  fun registerReloadHook(callback: () -> Unit)
}

class OraxenGlyphSource : GlyphSource { ... }
class NexoGlyphSource : GlyphSource { ... }
class ItemsAdderGlyphSource : GlyphSource { ... }
```

Pattern identique à `CustomItemsManager`.

### Bundle envoyé au backend

Le plugin lit les PNGs sources (`plugins/Oraxen/pack/...`, etc.), construit un JSON :

```ts
[
  {
    provider: "oraxen",
    namespace: "oraxen",
    glyphName: "iron_coin",
    char: "",
    ascent: 8,
    height: 9,
    width: 8,
    pngBase64: "..."
  },
  ...
]
```

Gzip+base64, envoyé via `external_glyphs_bundle`. Backend décode, sert via `/api/external-glyphs/...`.

### Hot reload

Les events Oraxen/Nexo/ItemsAdder de reload sont hookés (déjà en place pour custom items) → re-bundle → WS notify.

### Compilation runtime

```kotlin
val glyph = externalGlyphs.lookup(layer.provider, layer.glyphName)
  ?: return PLACEHOLDER  // □ si glyph absent
"<font:${glyph.namespace}:default>${glyph.char}</font>"
```

### Pas d'inclusion dans le pack Artisan

Les glyphs externes sont délivrés au joueur par le pack Oraxen/Nexo/ItemsAdder lui-même (stack 1.20.3+). Artisan ne fait que **référencer** le namespace au runtime.

## Export / Import

### Format `.zip`

```
my-pack.zip
├── manifest.json             # version format, métadonnées
├── pack.json                 # le Pack (refs AssetId)
└── assets/                   # optionnel
    ├── manifest.json         # liste assets bundlés (name, type, contentHash, originalId)
    ├── <asset_name>.png
    └── fonts/
        └── <font_name>/
            ├── font.json
            └── glyphs/
                └── <char>.png
```

### Export

Dialog UI :
- ☑ Include used assets (N assets, ~XKB)
- ☐ Include external glyph references metadata (warning destinataire doit avoir Oraxen)

Backend : `GET /api/packs/:pack_id/export?include_assets=true` → stream zip, walk refs `AssetId`, dédup.

### Import

Dialog UI :
- Drop/browse `.zip`
- Preview : "N menus, M assets bundled"
- Conflict resolution par asset :

| Cas | Action |
|---|---|
| Name inexistant | Créer + remap refs |
| Name existe, même contentHash | Réutiliser + remap refs |
| Name existe, contentHash différent | Demander (reuse / rename / skip) |

### Algorithme remap AssetIds

```ts
const idMap = new Map<AssetId, AssetId>();

for (const bundled of importedManifest.assets) {
  const resolved = resolveConflict(bundled);
  idMap.set(bundled.originalId, resolved.id);
}

remapAssetIds(pack, idMap);  // walk: menu.title[*].assetId, appearances[*].assetId
```

### External glyph refs

Conservées intactes à l'import. Si plugin externe absent côté destinataire, glyphs affichent `□` au runtime + warning UI persistant.

### Backwards compat

Anciens exports (sans assets, sans `MenuTitleLayer[]`) → `formatVersion = 0` → migration in-place (legacy `LText` title → unique text layer).

## Migration

`Menu.title: LText` → `Menu.title: MenuTitleLayer[]` :

```ts
function migrateTitle(legacy: LText | MenuTitleLayer[]): MenuTitleLayer[] {
  if (Array.isArray(legacy)) return legacy;
  return [{
    kind: "text",
    value: legacy,
    x: 8,
    y: 5,
    fontAssetId: undefined,
    color: undefined,
  }];
}
```

Appliquée :
- Backend : à la lecture DB (JSONB, pas de migration SQL)
- Plugin : au parsing YAML (parser tolère les deux formats)
- Éditeur : à l'ingestion du pack (Zustand init)

## Testing Strategy

### Editor (Vitest)

- `assetStore.test.ts` : CRUD assets, dédup contentHash
- `AssetUploadDialog.test.tsx` : flow upload, validation
- `AssetImportFontDialog.test.tsx` : parsing zip MCFonts
- `TitleComposer.test.tsx` : add/reorder/delete layers, drag-snap
- `migrateTitle.test.ts` : legacy LText → layers
- `exportPack.test.ts` : zip contient les refs et seulement elles
- `importPack.test.ts` : remap AssetIds, conflict resolution

### Backend (bun test)

- `assets.test.ts` : CRUD endpoint, scoping serverKey
- `resourcePackGenerator.test.ts` : zip structure, codepoint allocation, font JSON validity
- `externalGlyphs.test.ts` : cache disque, WS bundle decode
- `exportPack.test.ts` : zip stream, refs collection
- `importPack.test.ts` : conflict detection, idMap remap

### Plugin (JUnit)

- `ResourcePackManagerTest` : setResourcePack args, idempotence UUID
- `ExternalGlyphsManagerTest` : adapters Oraxen/Nexo/ItemsAdder (mock API)
- `TitleCompilerTest` : MenuTitleLayer[] → MiniMessage (text seul, glyph seul, bg+glyph+text, external, missing asset)
- `ResourcePackHotReloadTest` : WS update → re-push to onlines

## Sub-project Decomposition

Le scope MVP couvre les 3 axes (bg + glyphs + text custom), découpé en **6 sub-projects** indépendants, chacun avec son propre implementation plan :

| # | Sub-project | Livrables | Dépend de |
|---|---|---|---|
| **1** | **Asset library + backend** | Schema DB, CRUD endpoints, upload PNG, codepoint allocation, asset detail panel UI | — |
| **2** | **Resource pack generator** | Pipeline génération zip, HTTP endpoint, plugin distribution (`setResourcePack`) | 1 |
| **3** | **MenuTitleLayer + WYSIWYG composer** | Domain migration, title composer UI, runtime compiler (plugin) — text + glyphs Artisan | 1, 2 |
| **4** | **Background + custom fonts** | Bg layer kind, import MCFonts dialog, font asset type, font rendering preview | 3 |
| **5** | **External glyphs (Oraxen/Nexo/ItemsAdder)** | `GlyphSource` adapters, WS messaging, external glyphs picker | 3 |
| **6** | **Export/import `.zip` avec assets** | Export dialog, zip pipeline, import conflict resolution, AssetId remap | 1, 3 |

**Ordre de delivery** : 1 → 2 → 3 → (4, 5, 6 en parallèle).

Chaque sub-project produit un état utilisable end-to-end.

## Open Questions / Future Work

Hors MVP, à reprendre dans des specs futures :

- **`required: true` admin option** : kick si refus du pack
- **`pack.png` custom** : upload icône custom par l'admin
- **Glyph studio** : éditeur pixel-art intégré (créer un glyph sans uploader)
- **Animated glyphs** (Minecraft 1.20+ supporte animation frames dans font bitmaps)
- **Bridge inverse** : "exporter un asset Artisan vers le config Oraxen"
- **Asset marketplace** : partage public d'assets entre serveurs

## Decision Log

| Décision | Choix | Justification |
|---|---|---|
| Own pack system vs integrate | **Hybride** | Indépendance + intégration optionnelle aux plugins existants |
| Pack delivery | **Plugin `setResourcePack()`** | Pack stack 1.20.3+ permet coexistence sans config admin |
| Asset scope | **Server-wide library** | Cohérent avec les server_keys; portabilité via export bundle |
| Asset workflow | **Upload + library + MCFonts import** | Couvre simple et avancé |
| Title UX | **WYSIWYG visuel** | Plus accessible que MiniMessage brut |
| External glyphs | **Référence pure, pas d'inclusion** | Évite duplication; respecte ownership Oraxen/Nexo |
| MVP scope | **3 axes complets** | Cohérence fonctionnelle, découpé en 6 sub-projects gérables |
| Export format | **`.zip` standard** | Universellement reconnu, pas de friction OS |
