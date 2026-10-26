# Data source explorer, live preview & menu filters — Design

**Date**: 2026-07-14 · **Status**: validated (brainstorm with Iban)

## Goal

Make data sources visible and usable in the editor:
1. The Data sources tab shows the sources declared by the server's modules (schema + originating module + preview of the real data).
2. A menu can filter a source (field = value / `{arg}`, sort, limit) via a UI, instead of opaque YAML fields.
3. A selected menu exposes a "Menu data" section: its sources, their filters, and a preview of the rows with filters applied.

## Decisions (brainstorm 2026-07-14)

| Question | Decision |
|---|---|
| Displayed data | **Real server data** via a new WS request/response path (no static samples). |
| Fetch player context | **`player: Player?`** — `null` = preview; a player-dependent module returns generic data or throws `PlayerRequiredException`. |
| Schema | **Declared by the module** (typed fields in `DataSourceDeclaration`); `schemaHint` deprecated `@Sunset`. |
| Workspace scoping | **Group without restricting**: grouping + badge by originating module, no hard restriction (consistent with the editor's non-hermetic philosophy). Note: no project↔module link exists in the model (only server↔module) — "highlighting the sources of the module linked to the project" is therefore postponed out of V1. |
| Menu filters | **UI on the existing runtime** (`filter` equality + `{arg}` interpolation, `sort`, `limit`) — the Expression DSL remains a separate epic (spec 2026-05-03). |
| Per-menu view | **Properties panel section** (no real data in the canvas in V1). |
| Preview transport | **Request/response over the plugin WS**: REST → correlated WS message → plugin response → REST. Rejected: periodic push of samples (stale data, heavy payloads), fire-and-forget fetch via `module_event` (fragile asynchronous UX, events not consumed client-side). |

## 1. Plugin API — declared schema + module ownership

`net.artisanmc.modules.api.DataSourceDeclaration` (`@Stable` — adding `schema` is backward compatible; changing `fetcher` to `Player?` is a deliberate source-visible change, documented below):

```kotlin
data class DataSourceField(
    val name: String,
    val type: FieldKind,          // STRING | NUMBER | INTEGER | BOOLEAN | LIST | OBJECT
    val description: String? = null,
)

data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schema: List<DataSourceField> = emptyList(),
    @Sunset val schemaHint: String? = null,
)

class PlayerRequiredException(message: String? = null) : RuntimeException(message)
```

- `fetcher` receives `player = null` in preview mode. Kotlin signature break (`Player` → `Player?`): existing lambdas compile as is (unused parameter or usage to adapt); CHANGELOG `[Unreleased]` + `api-surface.md` note.
- `DataSourceRegistry` captures the **owning module** at `register(...)`: the `ArtisanAPI` handle given to each module knows its module id; the registry stores `ref → (declaration, moduleId)`. No new public parameter.

**Propagation**: the `hello`/heartbeat payload `data_sources` becomes `[{ref, module_id, schema: [{name, type, description}]}]` (the old `schema_hint` field is still sent as long as it is `@Sunset`). `server_data_sources` table: + columns `module_id` (text nullable) and `schema_json` (jsonb/text nullable), `db:generate` migration committed. `GET /api/v1/networks/:nid/servers/:sid/data-sources` returns `{ref, module_id, schema, schema_hint}`.

## 2. Preview path (live fetch)

`POST /api/v1/networks/:networkId/servers/:serverId/data-sources/preview` (cookie-auth + membership):

```jsonc
// body
{ "ref": "boutique:items", "params": {}, "filter": {"category": "weapons"}, "sort": {"by": "price", "direction": "asc"}, "limit": 27 }
// 200
{ "rows": [ {…}, … ], "truncated": false }
```

Flow:
1. The backend checks that the server is connected to the hub — otherwise `503 server_offline`.
2. The backend sends WS `data_source_fetch` `{request_id, ref, params, filter, sort, limit}` to the plugin and records `request_id` in a pending-requests map. **5 s** timeout → `504 fetch_timeout` (also covers old plugins that ignore the message — existing forward-compat).
3. Plugin: received on the OkHttp WS thread → **switch to the Bukkit main thread** (the fetchers touch the Bukkit API) → `fetcher(null, params)` → shaping via the existing `ContextBinder` code (filter/sort/limit — the preview reflects the runtime exactly) → response off the main thread: `data_source_fetch_result` `{request_id, ok, rows?, error?}`.
4. Plugin safeguards: rows truncated to **50**, payload ≤ ~256 KB. Typed errors: `unknown_source`, `player_required`, `fetch_error` (with message).
5. The backend resolves the pending request and answers the REST call.

Same-commit docs: `protocol.ts`, `ws-protocol.md`, `rest-endpoints.md`, CHANGELOG.

## 3. Data sources tab — explorer

The tab keeps "Pack data" and "Imported connectors", and gains a **"Server sources"** section:

- Rendering of the existing presence store (`serverDataSourcesStore`, fetched but never displayed today), **grouped by `module_id`** with a module badge (groups sorted alphabetically, core sources first; absent `module_id` → "Server" group). All sources stay usable everywhere.
- Source detail: schema table (name / type / description), copyable ref, **Preview** button → route §2 without filters → rows table (max 50, "truncated" note).
- States: server offline (schemas and badges stay visible — metadata in DB; preview disabled with explanation), `player_required`, module error, timeout ("plugin to update or server unreachable").
- Design system: existing `Card`, `Badge`, `Tabs`, `EmptyState`; new **`ui/DataTable`** component (rows table) with a specimen in `/admin/design`, reused by §4. en+fr i18n.

## 4. Menu side — filters editor + "Menu data" section

In `MenuProperties`, for each `contextInput` of kind `sourceRef`:

**Filters editor** (no runtime change — UI on the existing `filter`/`sort`/`limit`):
- "field = value" rows: field autocompleted from the declared schema (free input if the schema is absent); literal value or `{arg}` (autocompletion of the menu's args). Nominal case "current quest": `group = {group}`.
- Sort (field + asc/desc), limit (numeric).
- The `filter`/`sort`/`limit` imported from the YAML (carried opaquely today) become editable; export round-trip unchanged.

**"Menu data" section**: one card per consumed source — ref + module badge, summary of the active filters, **Preview** button calling route §2 **with the menu's filters**. Unresolved `{arg}`s: small form of test values (hint "filter on {group}: enter a test value"); left empty = the literal `{arg}` is kept as is on the plugin side (existing runtime behavior of `ContextBinder.interpolate` — the preview reflects the runtime). Result in `ui/DataTable`.

## Tests

- **Backend**: preview route (happy path, membership, 503 offline, 504 timeout, correlation of two concurrent requests, typed error propagation); `module_id`/`schema_json` persistence from hello.
- **Plugin**: `data_source_fetch` handler (main thread execution, filter/sort/limit shaping, 50/256 KB truncation, `player_required`, `unknown_source`); registry captures the owner module; enriched hello payload.
- **Editor**: Server sources section (grouping, offline, preview + errors), filters editor (schema/args autocompletion, import round-trip), Menu data section (applied filters, test values).

## Out of scope V1

- Expression DSL for filters (separate spec `2026-05-03-expression-dsl-design.md`).
- Real data in the canvas (slots populated by the fetch).
- Online player picker for the preview (`player = null` only).
- Hard restriction of sources per workspace (possible module opt-in later).
- Real-time WS push of source changes (the existing presence refresh is enough).
