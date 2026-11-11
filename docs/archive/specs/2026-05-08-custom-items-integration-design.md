# Custom Items Integration (Nexo / Oraxen / ItemsAdder)

**Date:** 2026-05-08  
**Status:** Draft

## Goal

Allow users to pick custom items from third-party item plugins (Nexo, Oraxen, ItemsAdder) directly from the editor Library, alongside vanilla Minecraft items.

## Scope

- Plugin detection and item collection (Nexo, Oraxen, ItemsAdder)
- Hash-based sync protocol between plugin and backend
- Per-server disk cache on the backend
- Hot-reload support (e.g. `/n reload`)
- Editor Library displaying custom items with their textures
- Offline fallback for already-cached items

Out of scope: custom item *creation*, editing item properties, or any write-back to Nexo/Oraxen/ItemsAdder configs.

---

## Architecture

### Data flow

```
[Plugin Kotlin]
  detects installed item plugins at startup
  collects items + textures → computes hash
  includes custom_items_hash in `hello`
  on reload event → sends `custom_items_changed { hash }`
        │
        │ WS
        ▼
[Backend Bun/Hono]
  compares hash with data/custom-items/{server_key_id}/hash.txt
  if different → sends `custom_items_request`
  receives `custom_items_bundle` → decompresses → writes to disk
        │
        │ REST
        ▼
[Editor React]
  GET /api/editor-session/:token/custom-items  (reads from disk cache)
  GET /api/textures/custom/:serverKeyId/:path*  (serves cached PNGs)
  merges with vanilla items in Library
```

---

## Protocol — new WS messages

| Message | Direction | Payload |
|---|---|---|
| `hello` (updated) | plugin → backend | adds `custom_items_hash: String?` (null if no custom item plugin detected) |
| `custom_items_changed` | plugin → backend | `{ hash: String }` |
| `custom_items_request` | backend → plugin | `{}` |
| `custom_items_bundle` | plugin → backend | `{ hash: String, data: String }` |

`data` is `base64(gzip(zip archive))`. The ZIP archive contains:
```
items.json               ← array of CustomItemEntry
textures/
  nexo/iron_coin.png
  itemsadder/coins__iron_coin.png
  oraxen/ruby.png
  ...
```

`items.json` entry shape:
```json
{ "id": "nexo:iron_coin", "label": "Iron Coin", "category": "nexo", "texture": "nexo/iron_coin" }
```

The `texture` field is a path relative to `textures/` in the archive (and relative to the texture endpoint, without `.png`).

### Sync trigger logic (shared between `hello` and `custom_items_changed`)

```
received hash H for server S
  read data/custom-items/{S}/hash.txt → cached_H (or "" if absent)
  if H == cached_H → no-op
  else → send custom_items_request to plugin
```

---

## Backend

### Disk cache layout

```
data/custom-items/{server_key_id}/
  hash.txt          ← last known synced hash
  items.json        ← flat array of CustomItemEntry
  textures/
    nexo/iron_coin.png
    ...
```

Cache is per `server_key_id` — two servers with identically-named items never collide.

### New REST endpoints

| Endpoint | Description |
|---|---|
| `GET /api/editor-session/:token/custom-items` | Returns `{ serverKeyId, items[] }` from disk cache. Returns `{ serverKeyId, items: [] }` if not yet synced (never 503). |
| `GET /api/textures/custom/:serverKeyId/:path*` | Serves PNG from `data/custom-items/{serverKeyId}/textures/{path}.png`. |

### Bundle processing

On receiving `custom_items_bundle`:
1. Decode base64 → gunzip → unzip (via `fflate.unzipSync` — already a dependency)
2. Parse `items.json`
3. Write each texture PNG to `data/custom-items/{serverKeyId}/textures/`
4. Write `items.json`
5. Write `hash.txt`

---

## Plugin Kotlin

### CustomItemSource interface

```kotlin
interface CustomItemSource {
    val namespace: String
    fun isAvailable(): Boolean
    fun collectItems(): List<CustomItemEntry>
    fun loadTexture(texturePath: String): ByteArray?
}

data class CustomItemEntry(
    val id: String,           // "nexo:iron_coin"
    val label: String,
    val texturePath: String   // "nexo/iron_coin" — relative path for the archive
)
```

### Adapters (soft-depend in plugin.yml)

| Adapter | Detection | Item API | Texture source |
|---|---|---|---|
| `NexoSource` | `Bukkit.getPluginManager().getPlugin("Nexo") != null` | `Nexo.itemManager().items()` | Resolved via `NexoItem.itemModel()` → model path → texture path inside the generated Nexo resource pack (`plugins/Nexo/pack/`) |
| `OraxenSource` | `getPlugin("Oraxen") != null` | `OraxenItems.getEntries()` | Resolved via `OraxenItem.getMaterial()` + model info → `plugins/Oraxen/pack/` |
| `ItemsAdderSource` | `getPlugin("ItemsAdder") != null` | `ItemsAdder.getAllItems()` | Resolved via `CustomStack.getTexture()` or equivalent API → `plugins/ItemsAdder/` |

Exact texture resolution paths depend on each plugin's API version and are finalized during implementation. All three plugins expose their generated resource pack in a known subdirectory of their plugin folder.

### Hash computation

SHA-256 over the concatenation of all `(entry.id + textureBytes)`, entries sorted by `entry.id` in byte order (same invariant as `BundleHasher`). Returns `""` if no sources are available or all sources return empty.

### Bundle building

Labels are stripped of Minecraft color codes (`§x` sequences) before inclusion.

Items for which `loadTexture` returns `null` are excluded from the bundle entirely (no texture = no entry in `items.json`).

```
CustomItemsManager.buildBundle():
  items = all sources → collectItems()
  for each item:
    bytes = source.loadTexture(item.texturePath) ?: continue  // skip if missing
    textures[item.texturePath] = bytes
    bundleItems += item.copy(label = stripColorCodes(item.label))
  archive = ZIP { items.json, textures/*.png }
  data = base64(gzip(archive))   // java.util.zip.GZIPOutputStream
  return CustomItemsBundle(hash, data)
```

### Hot-reload

Each adapter registers a Bukkit listener for its plugin's reload event:
- Nexo: `NexoReloadEvent` (or equivalent)
- Oraxen: `OraxenItemsLoadedEvent`
- ItemsAdder: `ItemsAdderLoadDataEvent`

On event: `CustomItemsManager.onReload()` → recomputes hash → if hash changed → sends `custom_items_changed { hash }` via `WsClient`.

### hello message update

`hello` gains an optional field `custom_items_hash: String?`. Null means no custom item plugin detected.

---

## Editor

### Library changes

`fetchCustomItems(token): Promise<CustomItemsData>` — new API call, runs in parallel with `fetchItems`.

```ts
interface CustomItemsData {
  serverKeyId: string;
  items: LibraryItem[];  // same shape as vanilla, category = "nexo" | "oraxen" | "itemsadder"
}
```

Custom item texture URL pattern:
```
${API_URL}/api/textures/custom/${serverKeyId}/${item.texture}
```

The Library merges vanilla + custom items into a single list. Custom items appear in their own categories (`nexo`, `oraxen`, `itemsadder`). No other UI changes — they render as standard `ItemTile` components.

### Offline fallback

`fetchCustomItems` never throws — if the cache is empty it returns `items: []`. Items already placed in menu slots keep their `material: "nexo:iron_coin"` ID; the texture `<img>` falls back to hidden via the existing `onError` handler.

---

## Testing

| Layer | What to test |
|---|---|
| Plugin unit | `CustomItemsManager` hash computation, bundle build (mock sources) |
| Plugin unit | Each adapter's `isAvailable()` returns false when plugin absent |
| Backend unit | Bundle processing: decode → write files → correct hash.txt |
| Backend unit | `custom-items` endpoint returns `[]` when no cache, items when cached |
| Backend integration | Full WS flow: `hello` with new hash → `custom_items_request` → `bundle` → files on disk |
| Editor unit | Library merges vanilla + custom items, deduplicates categories |

---

## Open questions

None — all design decisions resolved during brainstorming.
