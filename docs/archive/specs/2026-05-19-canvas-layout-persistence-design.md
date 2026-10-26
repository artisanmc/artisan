# Canvas layout persistence — design

**Date:** 2026-05-19
**Status:** Approved (pending review)

## Problem

`Pack.canvasLayout` — the `{ x, y }` positions of the Menu / Command / Dialog cards in the pack canvas — today lives only in:

- `editor/src/state/accountStore.ts` (zustand + localStorage)
- `packBundles.editorJson` on the backend (written by `PUT /api/editor-session/:token/packs/:packId` and `POST .../deploy`)

It is **not** serialized in the pack's YAML (`editor/src/features/export/transform.ts:542-555`). Consequence: if an admin copies `plugins/Artisan/packs/<id>/` from server A to server B (file copy outside the editor), plugin B republishes via `hello` → backend B rebuilds `editorJson` from the files via `importPackFromFiles` → `canvasLayout: {}` at `backend/src/lib/packImport.ts:239`. The cards fall back to the default auto grid.

Goal: positions carried by the files themselves, so they are transferable.

## Key decisions

- **Source of truth = files (`manifest.yaml`).** `editorJson.canvasLayout` is a derived cache.
- **Location = `manifest.yaml`**, in an optional `editor_layout` field.
- **Plugin**: no change. The field is ignored (already `@JsonIgnoreProperties(ignoreUnknown = true)` on `ManifestYaml`). The file goes through plugin → bundle → backend intact.
- **No migration.** Existing packs → `canvasLayout: {}` at import → `autoLayout` fills the deterministic grid. The first mutation persists the positions in the manifest.

## `manifest.yaml` schema

```yaml
schema: manifest/v1
pack_id: my_pack
default_lang: en
languages: [en, fr]
files:
  menus: [main, shop]
  commands: [open_shop]
  dialogs: []
editor_layout:                # ← optional, omitted if empty
  main:       { x: 40,  y: 40 }
  shop:       { x: 260, y: 40 }
  open_shop:  { x: 480, y: 40 }
```

- Keys: `MenuId | CommandId | DialogId` (same id space as `canvasLayout` today).
- Values: `{ x: number, y: number }`.
- Schema version unchanged (`manifest/v1`). The field being optional + ignored by tolerant parsers, no breaking change.

## Changes per module

### Editor — `editor/src/features/export/transform.ts`

Before writing `manifest.yaml`, build `editor_layout` from `pack.canvasLayout` filtered on the ids still alive:

```ts
const layoutIds = new Set<string>([
  ...pack.menus.map(m => m.id),
  ...pack.commands.map(c => c.id),
  ...pack.dialogs.map(d => d.id),
]);
const editorLayout = Object.fromEntries(
  Object.entries(pack.canvasLayout).filter(([id]) => layoutIds.has(id))
);

const manifest: Record<string, unknown> = {
  schema: "manifest/v1",
  pack_id: pack.id,
  default_lang: pack.defaultLang,
  languages: langs,
  files: { menus: ..., commands: ..., dialogs: ... },
};
if (Object.keys(editorLayout).length > 0) {
  manifest.editor_layout = editorLayout;
}
files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);
```

Why filter: avoid `canvasLayout` containing orphan entries (id of a deleted menu) that would pollute the YAML and survive a round trip.

### Backend — `backend/src/lib/packImport.ts`

`importPackFromFiles` today reads the manifest with `tryParse<ManifestYaml>` then returns a hardcoded `canvasLayout: {}` (line 239). Extension:

```ts
interface ManifestYaml {
  pack_id?: string;
  default_lang?: string;
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
  editor_layout?: Record<string, { x?: number; y?: number }>;
}

function parseEditorLayout(raw: ManifestYaml["editor_layout"]): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v.x !== "number" || typeof v.y !== "number") continue;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    out[id] = { x: v.x, y: v.y };
  }
  return out;
}

// ... in returned object:
canvasLayout: parseEditorLayout(manifest.editor_layout),
```

Tolerant: badly typed entries silently ignored (no exception that would crash the import of the whole pack).

Helper extracted + exported for use on the `bundles.ts` side:

```ts
export function readEditorLayoutFromFiles(
  files: Record<string, string>,
  packId: string,
): Record<string, { x: number; y: number }> {
  const m = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  return parseEditorLayout(m.editor_layout);
}
```

### Backend — `backend/src/routes/bundles.ts` (plugin publish)

Current logic (lines 19-46): if a non-stub `editorJson` exists, we keep it as is; otherwise we generate from the files. Under "files win", we must **always** sync `canvasLayout` with what the manifest says:

```ts
const incomingLayout = readEditorLayoutFromFiles(body.files, packId);

let editorJsonObj: Record<string, unknown>;
if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
  editorJsonObj = JSON.parse(existing[0].editorJson!);
} else {
  editorJsonObj = importPackFromFiles(packId, body.files);
}
editorJsonObj.canvasLayout = incomingLayout;  // files win

const keepEditorJson = JSON.stringify(editorJsonObj);
```

Observable effect:

- File copy server A → B with positions in the manifest → plugin republish → `editorJson.canvasLayout` filled. Editor opened afterwards → correct positions.
- File copy server A → B **without** `editor_layout` (legacy case or field removed) → `canvasLayout: {}` → autoLayout default grid.

### Backend — `backend/src/routes/editorSession.ts` (editor PUT/deploy)

The PUT sends `{ pack, files }`. `pack.canvasLayout` and `files.manifest.yaml.editor_layout` can in theory diverge (editor bug, race…). Same "files win" rule applies:

```ts
const incomingLayout = readEditorLayoutFromFiles(body.files, packId);
const packObj = body.pack as Record<string, unknown>;
packObj.canvasLayout = incomingLayout;
const editorJson = JSON.stringify(packObj);
```

A single source at write time, regardless of the path (plugin publish or editor PUT).

### Plugin — no change

`plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt:14`:
```kotlin
@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(...)
```
The `editor_layout` field is silently ignored at parse. On republish via `BundleDownloader`, the `manifest.yaml` file is sent back as is (the plugin never serializes it itself — it serves the binary from disk).

## Tests

| File | Cases |
|---|---|
| `editor/src/features/export/transform.test.ts` | (1) manifest contains `editor_layout` when `canvasLayout` is non-empty; (2) ghost ids (deleted menu) filtered; (3) field omitted from manifest if `canvasLayout` is `{}`. |
| `backend/src/lib/packImport.test.ts` (new or extended) | (1) manifest's `editor_layout` → `canvasLayout`; (2) badly typed entries (`x: "a"`, `null`) silently ignored; (3) `editor_layout` absent → `canvasLayout: {}`. |
| `backend/src/routes/bundles.test.ts` | (1) Plugin republish with positions → `editorJson.canvasLayout` overwritten; (2) without positions → `canvasLayout: {}` even if the DB had positions; (3) stub editorJson → behaves as before + manifest positions. |
| `backend/src/routes/editorSession.test.ts` | PUT with `pack.canvasLayout` diverging from the manifest → the manifest wins on the DB side. |
| Round-trip (new, e.g. `backend/src/lib/packRoundTrip.test.ts` or in `transform.test.ts`) | `pack.canvasLayout` → `transform` → `importPackFromFiles` → perfect equality (modulo ghost id filtering). |

## Risks / limits

- **Editor session open on server B + plugin republish in the meantime**: the `canvasLayout` loaded at editor startup can be overwritten. This is consistent with the behavior of the rest of the bundle today (the plugin republish rewrites menus/lang too). Acceptable.
- **Id collision `MenuId == CommandId == DialogId`**: possible in theory (branded spaces but not disjoint at runtime). The bug already exists in `canvasLayout` today. Out of scope.
- **Manifest size**: a pack with 100 menus adds ~100 lines to the manifest. Negligible.

## Out of scope

- Zoom / pan / current selection of the editor (UI state, not domain).
- Order of a menu's layers (already persisted elsewhere).
- Versioning or history of positions.
