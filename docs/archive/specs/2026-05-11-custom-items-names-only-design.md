# Custom items library — names-only sync

**Status:** Draft
**Date:** 2026-05-11
**Author:** Iban

## Context

The plugin currently syncs full custom-items bundles (id, label, model JSON, texture
PNG) for every Nexo/Oraxen/ItemsAdder item on the server. On servers with large Nexo
configs (1700+ items), this:

- Adds tens of seconds to plugin startup (sync indexing reads hundreds of MB of zip
  data, even with the recent async + index optimizations).
- Pushes hundreds of MB through WS at every reload.
- Caches the same data on the backend disk per server-key.
- Races with Nexo's own `PackGenerator` (observed `IllegalStateException: zip file
  closed` warning at startup).
- 99 % of synced items are armor / furniture / tools with no real value as menu
  icons — they have vanilla material renders already, or no thumbnail use case at
  all.

The 3D thumbnail rendering itself remains fragile: multi-texture models, condition
/ select model selection, and `nexo:` vs `nexo/` path resolution have each surfaced
their own bugs.

## Decision

Drop texture / model bundling entirely. Custom-items sync becomes a flat list of
names (`id`, `label`). The editor library still lets the user discover and pick
items, but uses a generic placeholder icon instead of a 3D render. In-game
rendering is unaffected (the plugin already resolves `nexo:foo` to a proper
`ItemStack` via `NexoItemRenderer.buildStack`).

This is explicitly a scope cut: lazy on-demand texture loading was considered and
deferred. If 3D thumbnails for custom items become a hard requirement later, the
on-demand WS protocol can be added back without re-introducing the bundle path.

## Non-goals

- 3D thumbnails for custom items in the editor library or canvas.
- On-demand texture / model fetching protocol.
- Server-side filtering of "useful" items (armor exclusion etc.).
- Display-name extraction via `getFinalItemStack()` reflection.

## Design

### Plugin

`CustomItemEntry` simplifies to `{ id, label, category }`. `texturePath` and
`modelJson` are removed.

- `NexoSource.collectItems()`: returns one entry per `NexoItems.itemNames()`
  result, with `label = id` and `category = "nexo"`. No `ZipFile` opens, no
  `buildIndex()`, no UUID resolution, no `getFinalItemStack` calls.
- `OraxenSource.collectItems()`: returns one entry per
  `OraxenItems.getEntries()` key. No model / texture extraction.
- `ItemsAdderSource.collectItems()`: same shape.
- `CustomItemSource.loadTexture()` is removed from the interface.

`CustomItemsManager.buildBundle()` now produces a zip containing only
`items.json` (no `textures/` or `models/` folders). `computeHash()` hashes the
sorted `id|label` list.

`NexoIndex`, `NexoSource.buildIndex`, `loadModelJson`, `loadTexture`,
`loadTextureViaModelFromIndex`, `defaultModelUuid`, `resolveModelNode`,
`UUID_REGEX`, `NON_PARTICLE_UUID_TEXTURE_REGEX`, `ANY_NS_UUID_REGEX`,
`ITEM_JSON_PATH_REGEX`, `OLD_MODEL_PATH_REGEX`, `LAYER_TEXTURE_REGEX` are all
deleted. Same for the texture/model-loading helpers in `OraxenSource`.

### Protocol

`custom_items_bundle` and `custom_items_request` keep their existing shape —
the `data` payload is still `base64(gzip(zip))`, but the zip's content is just
`items.json`. No protocol version bump needed; plugins and backends speaking
the new schema produce/consume the smaller zip transparently.

### Backend

- `customItems.ts`: extracts the bundle as before, but `textures/` and `models/`
  folders will simply be absent in fresh bundles. The extraction code already
  handles missing folders.
- `/api/textures/custom/:serverKeyId/*` and `/api/models/custom/:serverKeyId/*`
  stay registered but will always 404 for items synced under the new scheme.
  Removing them would break older clients still requesting these URLs.
- No invalidation logic changes: a new `custom_items_changed` still triggers a
  re-sync, the bundle is just smaller now.

### Editor

- `Library.tsx`: keeps the existing `items.json` iteration. The "custom" section
  shows entries by name, grouped by category (namespace).
- Replace the existing per-item `renderToCanvas(...)` call for custom items
  with a static placeholder component (gray tile + `?` glyph or the
  `category` initial). The 3D render path stays unchanged for vanilla items.
- The canvas (`FlowCanvas`, element appearances) renders the same placeholder
  when an element's material is a custom item ID.
- `mcModelRenderer.ts`: no changes required — it's simply not invoked for
  custom items anymore.

### Failure modes

- **Backend has stale full bundle on disk:** the next `custom_items_bundle`
  overwrites `items.json`, leaving orphan `textures/` and `models/` from the
  previous schema. Cleanup is one-shot: when the backend writes a new bundle
  whose zip lacks `textures/`, it removes the on-disk `textures/` and `models/`
  directories.
- **Editor still requests `/api/textures/custom/...`:** harmless 404. The
  placeholder component is the source of truth for missing textures.
- **Plugin offline:** library shows whatever names were last synced (the
  backend keeps `items.json` until a new sync replaces it). Same behavior as
  today.

## Migration

No data migration is needed for sync metadata or pack data. Existing on-disk
texture / model caches under `data/custom-items/{serverKeyId}/textures` and
`models/` will be cleaned up by the backend the first time a new-schema bundle
arrives.

## Open questions

None — scope is deliberately tight. Future work to restore 3D thumbnails goes
through a separate spec.
