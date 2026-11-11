# Library Items — Design Spec

**Date:** 2026-05-07
**Status:** Approved

---

## Goal

Show in the editor all items that can be placed in a Minecraft inventory, with their texture, in a drag-and-drop side panel. Phase 1: vanilla items only. Phase 2 (future): custom items (Oraxen, Nexo, ItemAdder).

---

## Data flow

```
Plugin (Kotlin)
  └─ hello { server_key, mc_version: "1.21.4", current_bundle_hash }
        │
        ▼
Backend (Bun/Hono)
  ├─ Stores mc_version in the plugin's WS connection
  ├─ GET /api/items          → list of vanilla items for the active version
  └─ GET /api/textures/:ver/* → lazy proxy to mcasset.cloud
        │
        ▼
Editor (React)
  ├─ Loads the item list on first display of the Library panel
  └─ LibraryPanel (right tab, visible if a menu is selected)
       ├─ Search (client filter) + filter chips (categories)
       ├─ Item grid with lazy-loaded textures
       └─ Drag from the grid → drop on a Konva slot
              └─ appearance.material updated in the store
```

---

## Plugin

### Change: hello message

The `mc_version` field is **required**. The backend closes the connection if it is missing.

```kotlin
val mcVersion = Bukkit.getServer().minecraftVersion  // e.g. "1.21.4"
mapOf(
    "type" to "hello",
    "server_key" to cfg.serverKey,
    "mc_version" to mcVersion,
    "current_bundle_hash" to syncMetadata.syncedHash,
)
```

Source: `Bukkit.getServer().minecraftVersion` returns the Minecraft version (not Bukkit/Paper).

---

## Backend

### Static data — item registry

Files committed in the repo: `backend/data/items/{version}.json`

Generated once via the `backend/scripts/gen-items.ts` script:
1. Fetch `https://raw.githubusercontent.com/misode/mcmeta/summary/registries/item/data.json`
2. Automatic mapping of label (title-case of the ID) + category (by naming convention)
3. Write to `backend/data/items/{version}.json`

Structure of an item:
```json
{
  "id": "diamond_sword",
  "label": "Diamond Sword",
  "category": "combat",
  "texture": "item/diamond_sword"
}
```

Categories: `combat` | `tools` | `armor` | `food` | `blocks` | `potions` | `misc`

### Server connection — mc_version addition

```typescript
interface ServerConnection {
  serverKey: string
  mcVersion: string   // required, received in hello
  // ... existing fields
}
```

If `mc_version` is missing in `hello`: close the WS connection with code 4400.

### New endpoint: GET /api/items

```
GET /api/items
Authorization: Bearer <editor-session-token>

→ 200 { version: "1.21.4", items: Item[] }
→ 404 if registry missing for this version
→ 503 if plugin not connected (mc_version unknown)
```

Resolution: the backend looks up the `mc_version` from the WS connection associated with the editor session's `server_key`, loads `data/items/{version}.json`.

### New endpoint: GET /api/textures/:version/*

```
GET /api/textures/1.21.4/item/diamond_sword

→ Proxy to https://mcasset.cloud/1.21.4/assets/minecraft/textures/item/diamond_sword.png
→ Cache-Control: public, max-age=86400
→ 502 if mcasset.cloud unreachable
```

No disk storage. The HTTP cache of the Bun process is enough for the session duration.

---

## Editor

### Layout

The right panel gets two tabs:

```
[ Properties ]  [ Library ]
```

The **Library** tab is shown only when a menu is selected (not on the pack view, a command, or no selection).

### LibraryPanel component

```
LibraryPanel
  ├─ useItems()
  │    └─ GET /api/items, result cached (React Query or useState)
  ├─ useState: searchQuery, activeCategory
  ├─ filtered items (client-side, on label and id)
  ├─ <input> search
  ├─ <FilterChips> (All + categories present in the data)
  └─ <ItemGrid> (virtualized grid if >200 items)
       └─ <LibraryItem>
            ├─ <img src="/api/textures/{version}/item/{texture}" loading="lazy">
            ├─ title={item.label}   (native tooltip)
            └─ draggable + onDragStart → dataTransfer.setData("library/itemId", item.id)
```

### Drag & Drop DOM → Konva

**Library side (DOM):**
```typescript
onDragStart={e => {
  e.dataTransfer.setData("library/itemId", item.id)
  e.dataTransfer.effectAllowed = "copy"
}}
```

**Canvas side (Konva Stage wrapper):**
```typescript
onDragOver={e => e.preventDefault()}
onDrop={e => {
  const itemId = e.dataTransfer.getData("library/itemId")
  if (!itemId) return
  const slot = hitTestSlot(stageRef.current, e.clientX, e.clientY)
  if (slot != null) setSlotMaterial(slot, itemId)  // Zustand action
}}
```

`hitTestSlot(stage, clientX, clientY)`:
1. Converts screen coordinates → stage coordinates (offset + scale)
2. Finds the Konva slot at this position via `stage.getIntersection(point)`
3. Returns the slot index or `null`

`setSlotMaterial` updates the targeted slot's `appearance.material` in the Zustand store (new action to add).

### Editor-side error handling

| Case | Behavior |
|---|---|
| `/api/items` fails | Library tab disabled + message "Library unavailable" |
| Texture 502/404 | Gray placeholder (CSS `bg-zinc-700`), editing not blocked |
| Plugin disconnected | Same behavior as `/api/items` fails |

---

## Backend error handling

| Case | Response |
|---|---|
| `mc_version` missing in `hello` | Close WS 4400 |
| Item registry missing for the version | 404 with `{ error: "unknown_version" }` |
| Plugin not connected to the session | 503 with `{ error: "server_offline" }` |
| mcasset.cloud unreachable | 502 with `{ error: "upstream_unavailable" }` |

---

## Tests

| Scope | What is tested |
|---|---|
| Backend unit | `gen-items.ts` produces the right format; `/api/items` returns the correct registry; `/api/textures` proxies and applies the right header |
| Backend integration | hello without `mc_version` → connection closed; valid hello → `/api/items` returns correct version |
| Editor unit (Vitest) | `LibraryPanel` filters correctly by search/category; `hitTestSlot` returns the right slot |
| Manual | Drag from Library → Konva slot receives the right material |

---

## Phase 2 — Custom items (Oraxen, Nexo, ItemAdder)

Extensible architecture without a rewrite:

```
GET /api/items
  → vanilla items (static registry)       ← phase 1
  → + plugin items (Oraxen/Nexo/etc.)     ← phase 2

GET /api/textures/:source/:version/:path
  → source=minecraft  → mcasset.cloud
  → source=plugin     → textures sent by the plugin via WS ← phase 2
```

Note: the `:source` segment is added at the head of the URL (phase 1: `/api/textures/:version/*`). The migration will redirect the old pattern to `source=minecraft` so as not to break existing sessions.

In phase 2, the plugin sends a `custom_items` WS message containing its list of custom items + texture URLs (or the textures in base64). The backend merges them with the vanilla registry. The editor does not change architecture.

Custom items can occupy several slots (multi-block items): a `size: { width, height }` field is added in phase 2 to the Item structure.
