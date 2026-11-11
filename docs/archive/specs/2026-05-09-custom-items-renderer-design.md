# Custom Items Renderer — Design

## Goal

Custom items (Nexo/Oraxen/ItemsAdder) currently appear in the editor Library as raw flat PNG textures. This design extends the existing backend isometric icon pipeline to render custom items the same way vanilla items are rendered, producing consistent 32×32 icons for all item types (flat sprites for tools/weapons, isometric boxes for block-type models).

---

## Architecture

The backend already pre-renders vanilla items via `iconRenderer.ts` + `gen-items.ts`. We extend the same pipeline to run server-side when a custom items bundle arrives, reusing all existing rendering code. No browser-side 3D rendering is introduced.

```
[Plugin]                         [Backend]                        [Editor]
  NexoSource                       processBundle()                  ItemTile
  OraxenSource    — bundle →       renderCustomIcons()   — icon →   /api/textures/custom/
  ItemsAdderSource                 iconRenderer.ts
  (textures + model JSONs)         (same as gen-items.ts)
```

---

## Section 1 — Bundle protocol extension

### CustomItemEntry (Kotlin)

Add a nullable `modelJson` field to carry the raw JSON bytes of the item's model:

```kotlin
data class CustomItemEntry(
    val id: String,
    val label: String,
    val texturePath: String,
    val modelJson: ByteArray? = null,   // raw model JSON, null = flat item
)
```

### Bundle zip layout (extended)

```
items.json
textures/nexo/sword.png
textures/nexo/chair.png
models/nexo/sword.json          ← new: model JSON for items that have one
models/nexo/chair.json          ← new
```

`items.json` entries are unchanged in shape — `texture` still points to the texturePath used as key in the textures map. The backend re-writes `texture` to `icons/{sanitized_id}` after rendering.

### CustomItemsManager.buildBundle()

Extend `buildBundle()` to write a `models/` directory in the zip alongside `textures/`:

```kotlin
for ((path, bytes) in models) {
    zip.putNextEntry(ZipEntry("models/$path.json"))
    zip.write(bytes)
    zip.closeEntry()
}
```

where `models: Map<String, ByteArray>` is populated from `entry.modelJson` when non-null.

---

## Section 2 — Plugin source changes

### NexoSource

`NexoSource` already has `loadViaModel()` which parses the model JSON to find the texture path. Extend it to also **return the raw model JSON bytes** alongside the texture.

Add `loadModelJson(zipFile, itemId): ByteArray?` that extracts the raw `models/item/{id}.json` bytes from the cached zip list (same zip walk already done in `collectItems()`).

Set `CustomItemEntry.modelJson` from this result in `collectItems()`.

### OraxenSource

Same pattern: walk Oraxen's pack directory/zip to find `models/item/{id}.json`, return raw bytes.

### ItemsAdderSource

ItemsAdder stores model JSONs in `plugins/ItemsAdder/contents/*/resourcepack/assets/*/models/`. Extract using the same file walk already used for textures.

---

## Section 3 — Backend icon rendering

### New file: `backend/src/lib/customItemRenderer.ts`

Single exported function:

```ts
export async function renderCustomIcons(
  cacheDir: string,
  mcVersion: string,
): Promise<void>
```

**Algorithm** (mirrors `gen-items.ts:resolveItem()`):

1. Read `cacheDir/items.json` (already written by `processBundle`)
2. For each item with a model JSON at `cacheDir/models/{namespace}/{id}.json`:
   a. Parse the model JSON
   b. Resolve parent chain: custom model parents (e.g. `item/generated`, `block/cube_all`) resolve against vanilla MC asset models at `data/mc-assets/{mcVersion}/models/`
   c. If resolved model has `elements` and any `block/` ancestor → `renderFromElements()`
   d. Else if any `CUBE_PARENTS` ancestor → `renderIsometricIcon()`
   e. Else → flat texture, no icon generated
3. Write rendered PNG to `cacheDir/icons/{namespace}__{id}.png` (double underscore as namespace separator to keep flat paths, e.g. `nexo__coin`)
4. Re-write `items.json` with updated `texture` field: `"icons/nexo__coin"` for rendered items

**Texture loading**: textures referenced in the model JSON may be:
- In `cacheDir/textures/` (custom namespace, e.g. `nexo:item/coin`)
- In vanilla MC assets `data/mc-assets/{mcVersion}/textures/` (minecraft namespace)

Resolve in that order: custom textures (`cacheDir/textures/`) first, vanilla MC assets as fallback.

**Parent chain resolution**: same 8-level depth limit as `gen-items.ts`. Missing parents (custom plugins may reference parent models not in vanilla) → treat as `item/generated` (flat).

### Integration into processBundle

In `customItems.ts`, after `processBundle()` writes the bundle to disk, call:

```ts
import { renderCustomIcons } from "./customItemRenderer";
// ...
await processBundle(cacheDir, bundle.hash, bundle.data);
await renderCustomIcons(cacheDir, hello.minecraft_version ?? "1.21.4");
```

The MC version is already tracked per server in `serverIdToMcVersion`.

### Timing

Rendering 50 items takes ~100ms. Run synchronously inside `processBundle` (already async). No streaming needed.

---

## Section 4 — Editor (no changes)

The editor already:
- Reads `texture` field from `/api/editor-session/:token/custom-items`
- Constructs URL as `/api/textures/custom/{serverKeyId}/{texture}.png`
- Serves files from `cacheDir/` via the existing texture endpoint

After this change, `texture` for rendered items becomes `icons/nexo__coin`, so the URL becomes `/api/textures/custom/{serverKeyId}/icons/nexo__coin.png`, which the existing static file handler serves automatically from `cacheDir/icons/nexo__coin.png`.

No changes to `ItemTile`, `textureStore`, or any editor code.

---

## Section 5 — Testing

### Plugin tests (Kotlin)

- `CustomItemEntry` with non-null `modelJson` is included in bundle zip under `models/`
- Items with null `modelJson` produce no `models/` entry but still produce a `textures/` entry
- `NexoSource.loadModelJson()` returns null on an item with no model file

### Backend tests (Bun)

- `renderCustomIcons()` called with a bundle containing a flat item model (`item/generated`) → no icon generated, `texture` unchanged in `items.json`
- `renderCustomIcons()` called with a bundle containing a cube block model → icon written to `icons/`, `texture` updated to `icons/` path
- `renderCustomIcons()` with unknown parent chain → falls through to flat, no crash

### Edge cases

- Model JSON references a vanilla parent not found in MC assets: treat as flat
- Item has model JSON but its texture is missing: fall through to flat
- Re-render on bundle update (hash change): overwrite existing icons

---

## Out of scope

- Animated textures (MCMeta)
- Tinted textures (grass color, biome overlays)
- Special item types (shields, armor, heads) using `minecraft:special` model type
- Browser-side rendering (deferred — backend pre-rendering covers all current Nexo items)
