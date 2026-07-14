# Data Source Explorer, Live Preview & Menu Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make server-declared data sources visible and exploitable in the editor: typed schema + module ownership on `DataSourceDeclaration`, a live request/response preview path over the plugin WS (REST → WS → plugin fetch → REST), a "Sources du serveur" explorer in the Data tab, and a visual filter/sort/limit editor + "Données du menu" preview section in the menu properties panel.

**Architecture:** Plugin declares typed schemas and reports them (with owning `module_id`) in `hello`/`modules_changed`; backend persists them in `server_data_sources` and serves them via the existing presence REST. A new `POST …/data-sources/preview` route correlates a `data_source_fetch` WS message to a plugin-side main-thread fetch (shaped by the existing `ContextBinder` runtime code) answered by `data_source_fetch_result`. The editor renders the presence store (today fetched but never displayed) grouped by module, previews rows through the new route, and turns the opaque `filter`/`sort`/`limit` of `sourceRef` context inputs into a visual editor.

**Tech Stack:** Kotlin 2.0 / Paper 1.21.4 / MockBukkit (plugin) · Bun + Hono + Drizzle/PostgreSQL (backend) · React 19 + Zustand + Vitest + Testing Library (editor).

**Source spec:** `docs/superpowers/specs/2026-07-14-data-source-explorer-design.md` (validated 2026-07-14).

## Global Constraints

- Preview WS request timeout: **5 s** (`504 fetch_timeout` — also covers old plugins that ignore the message).
- Plugin-side truncation guards: rows truncated at **50**, payload ≤ **~256 KB**.
- Typed error codes: `unknown_source`, `player_required`, `fetch_error` (avec message) from the plugin; `server_offline` → HTTP **503**; `fetch_timeout` → HTTP **504**.
- Preview fetches always run with `player = null`; modules may throw `PlayerRequiredException`.
- i18n: every user-visible editor string added to `editor/src/locales/en.ts` **and** `fr.ts` in the same commit. Never hardcode French/English in JSX.
- Editor styling: design-system components (`editor/src/components/ui/*`) and `var(--token)` colors only — no raw hex/rgba. New ui component ⇒ specimen in `/admin/design` same commit.
- DB: any `backend/src/db/schema.ts` change ships with its generated migration (`cd backend && bun run db:generate`, commit the `backend/drizzle/NNNN_*.sql` file).
- Docs same-commit: changes to `backend/src/protocol.ts` update `docs/architecture/ws-protocol.md`; new REST route updates `docs/architecture/rest-endpoints.md`; `net.artisanmc.modules.api.*` changes update `CHANGELOG.md` `[Unreleased]` + `docs/architecture/api-surface.md`.
- ⚠️ Backend tests: **ALWAYS `cd backend && bun run test`** — **NEVER `bun test` direct** (direct invocation bypasses `scripts/test.ts` and wipes the dev `artisan` DB).
- Plugin tests: `cd plugin && ./gradlew test`. Editor tests: `cd editor && npm test -- --run`.
- Git: stage exact paths only (never `git add -A`); conventional commit messages.

**Spec ambiguities resolved in this plan** (differences are deliberate, follow the plan):
1. *Unresolved `{arg}` interpolation*: the spec says "interpolé à vide côté plugin (comportement runtime existant)", but the real runtime (`ContextBinder.interpolate`) keeps the literal `{arg}` when the arg is missing. The preview reuses the runtime code unchanged, so unresolved tokens stay literal (filters then match nothing). Preview reflects runtime exactly — which is the spec's stronger requirement.
2. *Preview body*: the spec's body example has no `args` field, but §4 requires test values for `{arg}`. The body gains an optional `args: Record<string,string>` field (interpolation context, mirroring the runtime's `callerArgs`).
3. *Module ownership capture*: there is a single shared `ArtisanAPI` (not one handle per module), so the registry captures the owner via an `internal var currentOwner` set by `ModuleRegistry.register` around `onEnable` — no new public parameter, as required.
4. *Plugin-error HTTP statuses* (spec only fixes 503/504): `unknown_source` → 404, `player_required` → 422, `fetch_error` → 502, all `{error, message?}`.
5. *"Données du menu" for `pack:` refs*: project-local sources have no server fetch path; their card shows a "see the Data tab" hint instead of a Preview button (server refs get the full preview).

---

### Task 1: Plugin API — typed schema, `Player?` fetcher, module ownership, enriched report

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt` (owner capture in `register`)
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/ws/DataSourceReport.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt:97,260` (both `dataSourcesReport` lambdas)
- Test: `plugin/src/test/kotlin/net/artisanmc/modules/api/DataSourceRegistryTest.kt` (extend)
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/DataSourceReportTest.kt` (new)
- Docs: `CHANGELOG.md`, `docs/architecture/api-surface.md`

**Interfaces (later tasks rely on these exact signatures):**
- Produces:
  - `enum class FieldKind { STRING, NUMBER, INTEGER, BOOLEAN, LIST, OBJECT }`
  - `data class DataSourceField(val name: String, val type: FieldKind, val description: String? = null)`
  - `DataSourceDeclaration(ref, fetcher: (player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>, schema: List<DataSourceField> = emptyList(), @Sunset schemaHint: String? = null)`
  - `class PlayerRequiredException(message: String? = null) : RuntimeException(message)`
  - `data class RegisteredDataSource(val declaration: DataSourceDeclaration, val moduleId: String?)`
  - `DataSourceRegistry.fetch(ref: String, player: Player?, params: Map<String, Any?>)`, `DataSourceRegistry.registered(): List<RegisteredDataSource>` (sorted by ref), `internal var currentOwner: String?`
  - `DataSourceReport.build(registry: DataSourceRegistry): List<Map<String, Any?>>` → items `{ref, module_id, schema: [{name, type(lowercase), description}], schema_hint}`

- [ ] **Step 1: Write the failing tests**

Append to `plugin/src/test/kotlin/net/artisanmc/modules/api/DataSourceRegistryTest.kt`:

```kotlin
    @Test
    fun `fetch accepts a null player (preview mode)`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { p, _ -> listOf(mapOf("player" to (p?.name ?: "none"))) },
        ))
        val rows = registry.fetch("shop:items", null, emptyMap())
        assertEquals("none", rows[0]["player"])
    }

    @Test
    fun `declaration carries a typed schema (empty by default)`() {
        val decl = DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { _, _ -> emptyList() },
            schema = listOf(DataSourceField("price", FieldKind.NUMBER, "Unit price")),
        )
        assertEquals("price", decl.schema[0].name)
        assertEquals(FieldKind.NUMBER, decl.schema[0].type)
        assertTrue(DataSourceDeclaration(ref = "a:b", fetcher = { _, _ -> emptyList() }).schema.isEmpty())
    }

    @Test
    fun `register captures currentOwner as moduleId, null otherwise`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "core:free", fetcher = { _, _ -> emptyList() }))
        registry.currentOwner = "boutique"
        registry.register(DataSourceDeclaration(ref = "boutique:items", fetcher = { _, _ -> emptyList() }))
        registry.currentOwner = null

        val byRef = registry.registered().associateBy { it.declaration.ref }
        assertNull(byRef["core:free"]!!.moduleId)
        assertEquals("boutique", byRef["boutique:items"]!!.moduleId)
    }

    @Test
    fun `ModuleRegistry register scopes currentOwner around onEnable`() {
        val server = MockBukkit.getMock()!!
        val plugin = MockBukkit.load(net.artisanmc.plugin.ArtisanPlugin::class.java)
        val module = object : ArtisanModule {
            override val id = "boutique"
            override fun onEnable(api: ArtisanAPI) {
                api.dataSources.register(DataSourceDeclaration(ref = "boutique:owned", fetcher = { _, _ -> emptyList() }))
            }
            override fun onDisable() {}
            override fun onReload() {}
        }
        plugin.api.modules.register(module)
        val entry = plugin.api.dataSources.registered().first { it.declaration.ref == "boutique:owned" }
        assertEquals("boutique", entry.moduleId)
        assertNull(plugin.api.dataSources.currentOwner)
    }
```

> If `ArtisanModule` declares `onDisable`/`onReload` with default bodies, keep the overrides (they compile either way). If it has other abstract members, override them with the minimal no-op — check `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanModule.kt` first.

Create `plugin/src/test/kotlin/net/artisanmc/plugin/DataSourceReportTest.kt`:

```kotlin
package net.artisanmc.plugin

import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceField
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.FieldKind
import net.artisanmc.plugin.ws.DataSourceReport
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DataSourceReportTest {
    @Test
    fun `build emits ref, module_id, typed schema and legacy schema_hint`() {
        val registry = DataSourceRegistry()
        registry.currentOwner = "boutique"
        registry.register(DataSourceDeclaration(
            ref = "boutique:items",
            fetcher = { _, _ -> emptyList() },
            schema = listOf(
                DataSourceField("id", FieldKind.STRING),
                DataSourceField("price", FieldKind.NUMBER, "Unit price"),
            ),
            schemaHint = "id, price",
        ))
        registry.currentOwner = null

        val report = DataSourceReport.build(registry)
        assertEquals(1, report.size)
        val entry = report[0]
        assertEquals("boutique:items", entry["ref"])
        assertEquals("boutique", entry["module_id"])
        assertEquals("id, price", entry["schema_hint"])
        @Suppress("UNCHECKED_CAST")
        val schema = entry["schema"] as List<Map<String, Any?>>
        assertEquals(mapOf("name" to "id", "type" to "string", "description" to null), schema[0])
        assertEquals(mapOf("name" to "price", "type" to "number", "description" to "Unit price"), schema[1])
    }

    @Test
    fun `build is sorted by ref and tolerates empty schema`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "z:last", fetcher = { _, _ -> emptyList() }))
        registry.register(DataSourceDeclaration(ref = "a:first", fetcher = { _, _ -> emptyList() }))
        val report = DataSourceReport.build(registry)
        assertEquals(listOf("a:first", "z:last"), report.map { it["ref"] })
        assertEquals(emptyList<Any?>(), report[0]["schema"])
        assertNull(report[0]["module_id"])
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.modules.api.DataSourceRegistryTest" --tests "net.artisanmc.plugin.DataSourceReportTest"`
Expected: compilation FAILS (`FieldKind`, `DataSourceField`, `registered`, `currentOwner`, `DataSourceReport` unresolved).

- [ ] **Step 3: Implement the API changes**

Replace `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt`:

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.annotations.Sunset
import org.bukkit.entity.Player

/** Row-field kinds a data source can declare in its [DataSourceDeclaration.schema]. */
@Stable
enum class FieldKind { STRING, NUMBER, INTEGER, BOOLEAN, LIST, OBJECT }

/** One declared row field — drives editor tooling (schema table, filter autocomplete). */
@Stable
data class DataSourceField(
    val name: String,
    val type: FieldKind,
    val description: String? = null,
)

/**
 * Thrown by a fetcher that cannot produce meaningful rows without a real player
 * (preview mode calls it with `player = null`). Surfaced to the editor as the
 * typed `player_required` preview error.
 */
@Stable
class PlayerRequiredException(message: String? = null) : RuntimeException(message)

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * @param ref Globally unique reference, format "namespace:id" (e.g. "shop:items").
 * @param fetcher Pure function returning rows for a given player + params.
 *                `player` is null in preview mode (editor "Prévisualiser") — return
 *                generic data or throw [PlayerRequiredException].
 *                Called on the server main thread at menu render time: MUST
 *                return fast (serve from an in-memory cache, no blocking I/O).
 * @param schema Declared row fields — powers the editor's schema table and
 *               filter autocomplete. Empty = undeclared (editor falls back to free input).
 * @param schemaHint Legacy human-readable schema description. Superseded by [schema].
 */
@Stable
data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schema: List<DataSourceField> = emptyList(),
    @property:Sunset val schemaHint: String? = null,
)
```

Replace the body of `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt` (keep the two exception classes unchanged):

```kotlin
/** A registered declaration plus the module that owns it (null = registered outside a module's onEnable). */
@Stable
data class RegisteredDataSource(val declaration: DataSourceDeclaration, val moduleId: String?)

@Stable
class DataSourceRegistry {
    private val sources = ConcurrentHashMap<String, RegisteredDataSource>()

    /**
     * Owner captured for registrations happening right now. Set by
     * [ModuleRegistry.register] around `onEnable` (main-thread sequential),
     * null for direct registrations (third-party plugins via ServicesManager).
     */
    @Volatile internal var currentOwner: String? = null

    @Stable
    fun register(decl: DataSourceDeclaration) {
        if (sources.putIfAbsent(decl.ref, RegisteredDataSource(decl, currentOwner)) != null) {
            throw DuplicateDataSourceException(decl.ref)
        }
    }

    @Stable
    fun fetch(ref: String, player: Player?, params: Map<String, Any?>): List<Map<String, Any?>> {
        val entry = sources[ref] ?: throw UnknownDataSourceException(ref)
        return entry.declaration.fetcher(player, params)
    }

    @Stable
    fun has(ref: String): Boolean = sources.containsKey(ref)

    @Stable
    fun refs(): Set<String> = sources.keys.toSet()

    @Stable
    fun declarations(): List<DataSourceDeclaration> =
        sources.values.map { it.declaration }.sortedBy { it.ref }

    /** Declarations with their owning module id, sorted by ref. */
    @Stable
    fun registered(): List<RegisteredDataSource> =
        sources.values.sortedBy { it.declaration.ref }
}
```

In `plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt`, replace the `module.onEnable(boundApi)` line inside `register` with:

```kotlin
        boundApi.dataSources.currentOwner = module.id
        try {
            module.onEnable(boundApi)
        } finally {
            boundApi.dataSources.currentOwner = null
        }
```

Create `plugin/src/main/kotlin/net/artisanmc/plugin/ws/DataSourceReport.kt`:

```kotlin
package net.artisanmc.plugin.ws

import net.artisanmc.modules.api.DataSourceRegistry

/**
 * Builds the `data_sources` wire payload sent in `hello` / `modules_changed`.
 * One implementation for both call sites (ArtisanPlugin onEnable + reinit).
 * `schema_hint` stays on the wire while `DataSourceDeclaration.schemaHint` is @Sunset.
 */
object DataSourceReport {
    fun build(registry: DataSourceRegistry): List<Map<String, Any?>> =
        registry.registered().map { r ->
            mapOf(
                "ref" to r.declaration.ref,
                "module_id" to r.moduleId,
                "schema" to r.declaration.schema.map { f ->
                    mapOf(
                        "name" to f.name,
                        "type" to f.type.name.lowercase(),
                        "description" to f.description,
                    )
                },
                "schema_hint" to r.declaration.schemaHint,
            )
        }
}
```

In `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`, replace **both** occurrences (lines ~97 and ~260) of

```kotlin
            dataSourcesReport = { api.dataSources.declarations().map { mapOf("ref" to it.ref, "schema_hint" to it.schemaHint) } },
```

with:

```kotlin
            dataSourcesReport = { net.artisanmc.plugin.ws.DataSourceReport.build(api.dataSources) },
```

- [ ] **Step 4: Run the full plugin suite**

Run: `cd plugin && ./gradlew test`
Expected: PASS. Existing call sites compile unchanged: `MenuRenderer.kt:55` passes a non-null `Player` into `Player?`; existing `{ _, _ -> … }` fetcher lambdas infer the new signature.

- [ ] **Step 5: Docs (same commit)**

`CHANGELOG.md` `[Unreleased]`, add a section at the top of the Unreleased block:

```markdown
### Changed — data source declarations get typed schemas + module ownership (source-visible)
- `DataSourceDeclaration.fetcher` signature is now `(player: Player?, params) -> rows` — `null` = editor preview mode; player-dependent modules return generic data or throw the new `PlayerRequiredException`. Existing lambdas compile as-is; explicit `Player` type annotations must become `Player?`.
- `DataSourceDeclaration.schema: List<DataSourceField>` (`FieldKind`: string/number/integer/boolean/list/object) — declared row fields, drives the editor's schema table + filter autocomplete. `schemaHint` is now `@Sunset` (still sent on the wire as `schema_hint`).
- `DataSourceRegistry` captures the owning module at `register()` (during `ModuleRegistry.register` → `onEnable`); new `registered(): List<RegisteredDataSource>` exposes `(declaration, moduleId)`.
```

`docs/architecture/api-surface.md`: in the data-source section, document `FieldKind`, `DataSourceField`, `PlayerRequiredException`, `RegisteredDataSource`, the `Player?` fetcher change (source-visible, assumed per spec 2026-07-14) and mark `schemaHint` `@Sunset`.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt plugin/src/main/kotlin/net/artisanmc/plugin/ws/DataSourceReport.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/test/kotlin/net/artisanmc/modules/api/DataSourceRegistryTest.kt plugin/src/test/kotlin/net/artisanmc/plugin/DataSourceReportTest.kt CHANGELOG.md docs/architecture/api-surface.md
git commit -m "feat(plugin-api): typed data source schema, Player? fetcher, module ownership"
```

---

### Task 2: Backend ingest — enriched `data_sources` payload persisted + served

**Files:**
- Modify: `backend/src/protocol.ts` (hello + modules_changed `data_sources` type)
- Modify: `backend/src/db/schema.ts:102-113` (`serverDataSources` + `module_id`, `schema_json`)
- Create: `backend/drizzle/NNNN_*.sql` (generated — commit it)
- Modify: `backend/src/ws/hub.ts:169-191` (`persistServerDataSources`)
- Modify: `backend/src/routes/userNetworks.ts:653-683` (data-sources GET response)
- Test: `backend/src/ws/hub.test.ts`, `backend/src/routes/userNetworks.test.ts`
- Docs: `docs/architecture/ws-protocol.md`, `docs/architecture/rest-endpoints.md`, `docs/architecture/entities.md` (server_data_sources columns), `CHANGELOG.md`

**Interfaces:**
- Consumes: wire payload produced by Task 1 `DataSourceReport.build` (`{ref, module_id, schema: [{name,type,description}], schema_hint}`).
- Produces:
  - `type ReportedDataSource = { ref: string; module_id?: string | null; schema?: { name: string; type: string; description?: string | null }[]; schema_hint?: string | null }` (exported from `protocol.ts`)
  - `persistServerDataSources(serverKeyId: string, reported: ReportedDataSource[]): Promise<void>`
  - `GET /api/v1/networks/:networkId/servers/:serverId/data-sources` → `{ data_sources: { ref, module_id, schema, schema_hint }[] }` (`schema` always an array).

- [ ] **Step 1: Write the failing tests**

In `backend/src/ws/hub.test.ts`, extend the `persistServerDataSources` describe block:

```ts
  test("persists module_id and schema_json, prunes as before", async () => {
    const networkId = crypto.randomUUID();
    await db.insert(networks).values({
      id: networkId, name: "presence-ds2", createdAt: new Date(), updatedAt: new Date(),
    });
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "h-ds2", networkId, createdAt: new Date() });

    await persistServerDataSources(keyId, [
      {
        ref: "boutique:items",
        module_id: "boutique",
        schema: [{ name: "price", type: "number", description: "Unit price" }],
        schema_hint: "id, price",
      },
      { ref: "core:stats" }, // legacy shape: no module_id, no schema
    ]);
    const rows = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    const byRef = new Map(rows.map((r) => [r.ref, r]));
    expect(byRef.get("boutique:items")?.moduleId).toBe("boutique");
    expect(JSON.parse(byRef.get("boutique:items")?.schemaJson ?? "[]")).toEqual([
      { name: "price", type: "number", description: "Unit price" },
    ]);
    expect(byRef.get("core:stats")?.moduleId).toBeNull();
    expect(byRef.get("core:stats")?.schemaJson).toBeNull();

    // re-report clears stale enrichment
    await persistServerDataSources(keyId, [{ ref: "boutique:items" }]);
    const after = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    expect(after).toHaveLength(1);
    expect(after[0].moduleId).toBeNull();
    expect(after[0].schemaJson).toBeNull();
  });
```

In `backend/src/routes/userNetworks.test.ts`, add near the existing data-sources test (reuse the file's `seedUser`/`makeApp` helpers and its pattern for creating a network + server key via the API or direct inserts — follow the neighbouring data-sources/modules tests):

```ts
  test("GET data-sources returns module_id and parsed schema", async () => {
    const { userId, sessionId } = await seedUser();
    const app = makeApp();
    const create = await app.request("/api/v1/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N" }),
    });
    const { network } = await create.json();
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "h-x", networkId: network.id, createdAt: new Date() });
    await db.insert(serverDataSources).values([
      {
        serverKeyId: keyId, ref: "boutique:items", moduleId: "boutique",
        schemaJson: JSON.stringify([{ name: "id", type: "string", description: null }]),
        schemaHint: "id", reportedAt: new Date(),
      },
      { serverKeyId: keyId, ref: "core:stats", moduleId: null, schemaJson: null, schemaHint: null, reportedAt: new Date() },
    ]);

    const res = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byRef = new Map(body.data_sources.map((d: { ref: string }) => [d.ref, d]));
    expect(byRef.get("boutique:items")).toEqual({
      ref: "boutique:items", module_id: "boutique",
      schema: [{ name: "id", type: "string", description: null }], schema_hint: "id",
    });
    expect(byRef.get("core:stats")).toEqual({ ref: "core:stats", module_id: null, schema: [], schema_hint: null });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && bun run test src/ws/hub.test.ts src/routes/userNetworks.test.ts`
Expected: FAIL (unknown columns `moduleId`/`schemaJson`, response missing `module_id`/`schema`).

- [ ] **Step 3: Implement**

`backend/src/db/schema.ts` — add two columns to `serverDataSources`:

```ts
export const serverDataSources = pgTable(
	"server_data_sources",
	{
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		ref: text("ref").notNull(),
		schemaHint: text("schema_hint"),
		// Owning module reported by the plugin (null = core / third-party direct registration).
		moduleId: text("module_id"),
		// Declared typed schema, JSON array of {name, type, description} (null = undeclared).
		schemaJson: text("schema_json"),
		reportedAt: timestamp("reported_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.ref] })],
);
```

Generate + commit the migration:

Run: `cd backend && bun run db:generate`
Expected: a new `backend/drizzle/NNNN_<name>.sql` containing the two `ALTER TABLE "server_data_sources" ADD COLUMN` statements. Then `bun run db:push` locally (dev DB) so the dev server keeps working.

`backend/src/protocol.ts` — add the exported type and use it in both messages:

```ts
// Data sources registered plugin-side (DataSourceRegistry). Drives the
// editor's menu source picker + data explorer. Absent/empty on older plugins;
// module_id/schema absent on pre-schema plugins (legacy schema_hint only).
export interface ReportedDataSource {
  ref: string;
  module_id?: string | null;
  schema?: { name: string; type: string; description?: string | null }[];
  schema_hint?: string | null;
}
```

In `HelloMessage` and `ModulesChangedMessage`, replace `data_sources?: { ref: string; schema_hint?: string | null }[];` with `data_sources?: ReportedDataSource[];`.

`backend/src/ws/hub.ts` — replace `persistServerDataSources`:

```ts
export async function persistServerDataSources(
  serverKeyId: string,
  reported: ReportedDataSource[],
): Promise<void> {
  const now = new Date();
  for (const ds of reported) {
    const schemaJson = ds.schema && ds.schema.length > 0 ? JSON.stringify(ds.schema) : null;
    await db
      .insert(serverDataSources)
      .values({
        serverKeyId, ref: ds.ref, schemaHint: ds.schema_hint ?? null,
        moduleId: ds.module_id ?? null, schemaJson, reportedAt: now,
      })
      .onConflictDoUpdate({
        target: [serverDataSources.serverKeyId, serverDataSources.ref],
        set: { schemaHint: ds.schema_hint ?? null, moduleId: ds.module_id ?? null, schemaJson, reportedAt: now },
      });
  }
  const keepRefs = reported.map((d) => d.ref);
  await db
    .delete(serverDataSources)
    .where(
      keepRefs.length > 0
        ? and(eq(serverDataSources.serverKeyId, serverKeyId), notInArray(serverDataSources.ref, keepRefs))
        : eq(serverDataSources.serverKeyId, serverKeyId),
    );
}
```

Add `ReportedDataSource` to the type-only import block at the top of `hub.ts`.

`backend/src/routes/userNetworks.ts` — in the data-sources GET (line ~675), replace the response mapping:

```ts
		const rows = await db
			.select()
			.from(serverDataSources)
			.where(eq(serverDataSources.serverKeyId, sk[0].id));
		return c.json({
			data_sources: rows.map((r) => ({
				ref: r.ref,
				module_id: r.moduleId,
				schema: parseSchemaJson(r.schemaJson),
				schema_hint: r.schemaHint,
			})),
		});
```

and add near the top of the file (after `countProjectDocuments`):

```ts
/** Parsed declared schema of a server data source — [] on null/corrupt JSON (informational, never load-bearing). */
function parseSchemaJson(raw: string | null): { name: string; type: string; description?: string | null }[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
```

- [ ] **Step 4: Run the backend suite**

Run: `cd backend && bun run test`
Expected: PASS (the pre-existing `persistServerDataSources` test still passes — legacy shape is a subset of `ReportedDataSource`).

- [ ] **Step 5: Docs (same commit)**

- `docs/architecture/ws-protocol.md`: update the `hello` and `modules_changed` rows — `data_sources: {ref, module_id, schema: {name, type, description}[], schema_hint}[]` (`module_id`/`schema` absent on older plugins; `schema_hint` legacy, kept while `@Sunset`).
- `docs/architecture/rest-endpoints.md`: note the enriched response of `GET …/servers/:serverId/data-sources`.
- `docs/architecture/entities.md`: add `module_id` + `schema_json` to the `server_data_sources` description.
- `CHANGELOG.md` `[Unreleased]`: `- server_data_sources persists module_id + schema_json reported at hello/modules_changed; presence GET …/data-sources now returns {ref, module_id, schema, schema_hint} (migration NNNN).`

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle backend/src/protocol.ts backend/src/ws/hub.ts backend/src/routes/userNetworks.ts backend/src/ws/hub.test.ts backend/src/routes/userNetworks.test.ts docs/architecture/ws-protocol.md docs/architecture/rest-endpoints.md docs/architecture/entities.md CHANGELOG.md
git commit -m "feat(backend): persist data source module_id + typed schema, serve via presence REST"
```

---

### Task 3: Backend preview path — correlated WS request/response + REST route

**Files:**
- Modify: `backend/src/protocol.ts` (two new message types + unions)
- Modify: `backend/src/ws/hub.ts` (pending map, `requestDataSourceFetch`, `data_source_fetch_result` handler)
- Modify: `backend/src/routes/userNetworks.ts` (POST `…/data-sources/preview`)
- Test: `backend/src/ws/hub.test.ts`, `backend/src/routes/userNetworks.test.ts`
- Docs: `docs/architecture/ws-protocol.md`, `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`

**Interfaces:**
- Produces (Task 4 plugin handler and Task 5/6 editor client depend on these wire shapes):

```ts
// protocol.ts — backend → plugin
export interface DataSourceFetchMessage {
  type: "data_source_fetch";
  request_id: string;
  ref: string;
  params: Record<string, unknown>;
  filter: Record<string, string>;
  sort: { by: string; direction?: "asc" | "desc" } | null;
  limit: number | null;
  // Interpolation context for {arg} tokens in filter/params values (test values from the editor).
  args: Record<string, string>;
}
// protocol.ts — plugin → backend
export interface DataSourceFetchResultMessage {
  type: "data_source_fetch_result";
  request_id: string;
  ok: boolean;
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  error?: "unknown_source" | "player_required" | "fetch_error";
  message?: string;
}
```

- `hub.ts`: `export const DATA_SOURCE_FETCH_TIMEOUT_MS = 5_000;` and

```ts
export type DataSourceFetchOutcome =
  | { kind: "result"; result: DataSourceFetchResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };
export function requestDataSourceFetch(
  serverKeyId: string,
  req: { ref: string; params?: Record<string, unknown>; filter?: Record<string, string>; sort?: { by: string; direction?: "asc" | "desc" } | null; limit?: number | null; args?: Record<string, string> },
  timeoutMs?: number,
): Promise<DataSourceFetchOutcome>
```

- REST: `POST /api/v1/networks/:networkId/servers/:serverId/data-sources/preview` (cookie + membership), body `{ref, params?, filter?, sort?, limit?, args?}` → `200 {rows, truncated}` | `404 unknown_source` | `422 invalid_input | player_required` | `502 fetch_error` | `503 server_offline` | `504 fetch_timeout` (all errors `{error, message?}`).

- [ ] **Step 1: Write the failing hub tests**

In `backend/src/ws/hub.test.ts`, add imports `requestDataSourceFetch` from `./hub` and `DataSourceFetchMessage` type from `../protocol`, then:

```ts
describe("requestDataSourceFetch", () => {
  test("resolves offline when no plugin conn is bound to the server key", async () => {
    const outcome = await requestDataSourceFetch("sk-not-connected", { ref: "boutique:items" });
    expect(outcome).toEqual({ kind: "offline" });
  });

  test("sends data_source_fetch and resolves on the correlated result — two concurrent requests", async () => {
    const sent: DataSourceFetchMessage[] = [];
    registerConn("connX", (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set("connX", "sk-live");
    try {
      const p1 = requestDataSourceFetch("sk-live", { ref: "a:one", filter: { k: "v" } });
      const p2 = requestDataSourceFetch("sk-live", { ref: "b:two" });
      expect(sent).toHaveLength(2);
      expect(sent[0].type).toBe("data_source_fetch");
      expect(sent[0].ref).toBe("a:one");
      expect(sent[0].filter).toEqual({ k: "v" });
      expect(sent[0].sort).toBeNull();
      expect(sent[0].limit).toBeNull();
      expect(sent[0].args).toEqual({});

      // Answer out of order: second request first.
      await handlePluginMessage("connX", JSON.stringify({
        type: "data_source_fetch_result", request_id: sent[1].request_id,
        ok: true, rows: [{ id: "two" }], truncated: false,
      }));
      await handlePluginMessage("connX", JSON.stringify({
        type: "data_source_fetch_result", request_id: sent[0].request_id,
        ok: true, rows: [{ id: "one" }], truncated: true,
      }));

      const [o1, o2] = await Promise.all([p1, p2]);
      expect(o1).toEqual({
        kind: "result",
        result: { type: "data_source_fetch_result", request_id: sent[0].request_id, ok: true, rows: [{ id: "one" }], truncated: true },
      });
      expect(o2.kind).toBe("result");
      if (o2.kind === "result") expect(o2.result.rows).toEqual([{ id: "two" }]);
    } finally {
      connToServerId.delete("connX");
      connSenders.delete("connX");
    }
  });

  test("resolves timeout when the plugin never answers", async () => {
    registerConn("connY", () => {});
    connToServerId.set("connY", "sk-slow");
    try {
      const outcome = await requestDataSourceFetch("sk-slow", { ref: "a:one" }, 20);
      expect(outcome).toEqual({ kind: "timeout" });
    } finally {
      connToServerId.delete("connY");
      connSenders.delete("connY");
    }
  });

  test("a late result after timeout is ignored (no crash, unknown request_id)", async () => {
    const sent: DataSourceFetchMessage[] = [];
    registerConn("connZ", (raw) => sent.push(JSON.parse(raw)));
    connToServerId.set("connZ", "sk-late");
    try {
      await requestDataSourceFetch("sk-late", { ref: "a:one" }, 10);
      const res = await handlePluginMessage("connZ", JSON.stringify({
        type: "data_source_fetch_result", request_id: sent[0].request_id, ok: true, rows: [],
      }));
      expect(res.reply).toBeNull();
    } finally {
      connToServerId.delete("connZ");
      connSenders.delete("connZ");
    }
  });
});
```

- [ ] **Step 2: Write the failing route tests**

In `backend/src/routes/userNetworks.test.ts` (imports: add `registerConn, connToServerId, connSenders, handlePluginMessage` from `../ws/hub`):

```ts
  describe("POST …/data-sources/preview", () => {
    test("503 server_offline when no plugin connection", async () => {
      const { sessionId } = await seedUser();
      const app = makeApp();
      const create = await app.request("/api/v1/networks", {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "N" }),
      });
      const { network } = await create.json();
      const keyId = crypto.randomUUID();
      await db.insert(serverKeys).values({ id: keyId, hash: "h-p1", networkId: network.id, createdAt: new Date() });

      const res = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources/preview`, {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "boutique:items" }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("server_offline");
    });

    test("200 relays rows from the plugin; typed plugin errors map to statuses", async () => {
      const { sessionId } = await seedUser();
      const app = makeApp();
      const create = await app.request("/api/v1/networks", {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "N" }),
      });
      const { network } = await create.json();
      const keyId = crypto.randomUUID();
      await db.insert(serverKeys).values({ id: keyId, hash: "h-p2", networkId: network.id, createdAt: new Date() });

      // Fake plugin: echo a canned answer per ref.
      registerConn("conn-preview", (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type !== "data_source_fetch") return;
        const reply =
          msg.ref === "boutique:items"
            ? { type: "data_source_fetch_result", request_id: msg.request_id, ok: true, rows: [{ id: "sword", price: 10 }], truncated: false }
            : { type: "data_source_fetch_result", request_id: msg.request_id, ok: false, error: "player_required", message: "needs player" };
        queueMicrotask(() => { handlePluginMessage("conn-preview", JSON.stringify(reply)); });
      });
      connToServerId.set("conn-preview", keyId);
      try {
        const ok = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources/preview`, {
          method: "POST",
          headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "boutique:items", filter: { cat: "armes" }, sort: { by: "price", direction: "asc" }, limit: 27 }),
        });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ rows: [{ id: "sword", price: 10 }], truncated: false });

        const err = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources/preview`, {
          method: "POST",
          headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "boutique:secret" }),
        });
        expect(err.status).toBe(422);
        expect(await err.json()).toEqual({ error: "player_required", message: "needs player" });
      } finally {
        connToServerId.delete("conn-preview");
        connSenders.delete("conn-preview");
      }
    });

    test("422 invalid_input without ref; 403 for non-member", async () => {
      const { sessionId } = await seedUser("u1");
      const outsider = await seedUser("u2");
      const app = makeApp();
      const create = await app.request("/api/v1/networks", {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "N" }),
      });
      const { network } = await create.json();
      const keyId = crypto.randomUUID();
      await db.insert(serverKeys).values({ id: keyId, hash: "h-p3", networkId: network.id, createdAt: new Date() });

      const bad = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources/preview`, {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(bad.status).toBe(422);

      const forbidden = await app.request(`/api/v1/networks/${network.id}/servers/${keyId}/data-sources/preview`, {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${outsider.sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "boutique:items" }),
      });
      expect(forbidden.status).toBe(403);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && bun run test src/ws/hub.test.ts src/routes/userNetworks.test.ts`
Expected: FAIL (`requestDataSourceFetch` not exported; preview route 404).

- [ ] **Step 4: Implement protocol + hub**

`backend/src/protocol.ts`: add the two interfaces from the Interfaces block above, then extend the unions:
- `PluginToServerMessage`: add `| DataSourceFetchResultMessage`
- `ServerToPluginMessage`: add `| DataSourceFetchMessage`

`backend/src/ws/hub.ts`: add `DataSourceFetchMessage, DataSourceFetchResultMessage` to the type imports, then below `getInstanceCount`:

```ts
// ── data source preview: correlated request/response over the plugin WS ─────
export const DATA_SOURCE_FETCH_TIMEOUT_MS = 5_000;

export type DataSourceFetchOutcome =
  | { kind: "result"; result: DataSourceFetchResultMessage }
  | { kind: "offline" }
  | { kind: "timeout" };

const pendingFetches = new Map<string, (outcome: DataSourceFetchOutcome) => void>();

/**
 * Ask the live plugin bound to `serverKeyId` to fetch + shape a data source.
 * Resolves `offline` when no plugin conn is bound, `timeout` after `timeoutMs`
 * (default 5 s — also covers old plugins that ignore the message, forward-compat).
 * Multi-instance keys: the first live connection is used (preview data, not state).
 */
export function requestDataSourceFetch(
  serverKeyId: string,
  req: {
    ref: string;
    params?: Record<string, unknown>;
    filter?: Record<string, string>;
    sort?: { by: string; direction?: "asc" | "desc" } | null;
    limit?: number | null;
    args?: Record<string, string>;
  },
  timeoutMs: number = DATA_SOURCE_FETCH_TIMEOUT_MS,
): Promise<DataSourceFetchOutcome> {
  let send: ((msg: string) => void) | undefined;
  for (const [cId, sId] of connToServerId) {
    if (sId === serverKeyId) { send = connSenders.get(cId); if (send) break; }
  }
  if (!send) return Promise.resolve({ kind: "offline" });

  const requestId = crypto.randomUUID();
  const msg: DataSourceFetchMessage = {
    type: "data_source_fetch",
    request_id: requestId,
    ref: req.ref,
    params: req.params ?? {},
    filter: req.filter ?? {},
    sort: req.sort ?? null,
    limit: req.limit ?? null,
    args: req.args ?? {},
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingFetches.delete(requestId);
      resolve({ kind: "timeout" });
    }, timeoutMs);
    pendingFetches.set(requestId, (outcome) => {
      clearTimeout(timer);
      pendingFetches.delete(requestId);
      resolve(outcome);
    });
    send(JSON.stringify(msg));
  });
}
```

In `handlePluginMessage`, before the unknown-type fallthrough (next to the `modules_changed` handler):

```ts
  // ── data_source_fetch_result: resolve a pending preview request ──────────
  if (msg.type === "data_source_fetch_result") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const result = msg as DataSourceFetchResultMessage;
    pendingFetches.get(result.request_id)?.({ kind: "result", result });
    return { reply: null };
  }
```

- [ ] **Step 5: Implement the REST route**

In `backend/src/routes/userNetworks.ts`, import `requestDataSourceFetch` from `../ws/hub` (extend the existing hub import) and add right after the data-sources GET:

```ts
// POST /api/networks/:networkId/servers/:serverId/data-sources/preview — member access.
// Live fetch relayed to the connected plugin over the WS (data_source_fetch /
// data_source_fetch_result, 5 s timeout). Body: {ref, params?, filter?, sort?,
// limit?, args?} — args = test values for {arg} tokens (runtime interpolation).
userNetworksRouter.post(
	"/:networkId/servers/:serverId/data-sources/preview",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("networkId");
		const serverId = c.req.param("serverId");
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}
		const sk = await db
			.select()
			.from(serverKeys)
			.where(
				and(eq(serverKeys.id, serverId), eq(serverKeys.networkId, networkId)),
			);
		if (sk.length === 0) return c.json({ error: "not_found" }, 404);

		const body = (await c.req.json().catch(() => null)) as {
			ref?: unknown;
			params?: Record<string, unknown>;
			filter?: Record<string, string>;
			sort?: { by: string; direction?: "asc" | "desc" } | null;
			limit?: number | null;
			args?: Record<string, string>;
		} | null;
		if (!body || typeof body.ref !== "string" || body.ref.length === 0) {
			return c.json({ error: "invalid_input" }, 422);
		}

		const outcome = await requestDataSourceFetch(sk[0].id, {
			ref: body.ref,
			params: body.params,
			filter: body.filter,
			sort: body.sort,
			limit: body.limit,
			args: body.args,
		});
		if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
		if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
		const r = outcome.result;
		if (!r.ok) {
			const error = r.error ?? "fetch_error";
			const status = error === "unknown_source" ? 404 : error === "player_required" ? 422 : 502;
			return c.json({ error, message: r.message ?? null }, status);
		}
		return c.json({ rows: r.rows ?? [], truncated: r.truncated ?? false });
	},
);
```

- [ ] **Step 6: Run the backend suite**

Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 7: Docs (same commit)**

- `docs/architecture/ws-protocol.md`, add two rows to the message table:
  - `data_source_fetch` | backend → plugin | `{type, request_id, ref, params, filter, sort, limit, args}` — preview request relayed from `POST …/data-sources/preview`. Corrélé par `request_id`, timeout 5 s côté backend (couvre les vieux plugins qui ignorent le type). `args` = valeurs d'essai pour l'interpolation `{arg}`.
  - `data_source_fetch_result` | plugin → backend | `{type, request_id, ok, rows?, truncated?, error?, message?}` — réponse du plugin (fetch `player = null` sur le main thread + shaping `ContextBinder`, rows tronquées à 50 / ≤ 256 KB). `error` ∈ `unknown_source` / `player_required` / `fetch_error`.
- `docs/architecture/rest-endpoints.md`: index entry for `POST /api/v1/networks/:networkId/servers/:serverId/data-sources/preview` (fichier `userNetworks.ts`; 200 `{rows, truncated}`, 404 `unknown_source`, 422 `invalid_input|player_required`, 502 `fetch_error`, 503 `server_offline`, 504 `fetch_timeout`).
- `CHANGELOG.md` `[Unreleased]`: `- POST /api/v1/networks/:nid/servers/:sid/data-sources/preview — live data source preview relayed to the plugin over the WS (data_source_fetch/-_result, 5 s timeout, typed errors).`

- [ ] **Step 8: Commit**

```bash
git add backend/src/protocol.ts backend/src/ws/hub.ts backend/src/routes/userNetworks.ts backend/src/ws/hub.test.ts backend/src/routes/userNetworks.test.ts docs/architecture/ws-protocol.md docs/architecture/rest-endpoints.md CHANGELOG.md
git commit -m "feat(backend): data source preview path — correlated WS fetch + REST route"
```

---

### Task 4: Plugin preview handler — main-thread fetch, runtime shaping, truncation, typed errors

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ContextBinder.kt` (`shape`, `interpolateValues` → `internal`)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` (new `runOnMainThread` param + `data_source_fetch` handler + truncation helper)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` (pass `runOnMainThread` at both construction sites)
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/DataSourceFetchHandlerTest.kt` (new)

**Interfaces:**
- Consumes: Task 1 `DataSourceRegistry.fetch(ref, player = null, params)`, `PlayerRequiredException`; Task 3 wire shapes `data_source_fetch` / `data_source_fetch_result`.
- Produces:
  - `SyncedMenuProvider` constructor param `runOnMainThread: (() -> Unit) -> Unit = { it() }` (ArtisanPlugin passes the Bukkit scheduler).
  - `internal fun ContextBinder.shape(rows, source: Map<String, Any>, args: Map<String, Any>)` and `internal fun ContextBinder.interpolateValues(map: Map<String, Any?>, args: Map<String, Any>)` (visibility change only).
  - `internal fun truncateForPreview(rows: List<Map<String, Any?>>): Pair<List<Map<String, Any?>>, Boolean>` on `SyncedMenuProvider` (companion constants `MAX_PREVIEW_ROWS = 50`, `MAX_PREVIEW_BYTES = 256 * 1024`).

- [ ] **Step 1: Write the failing tests**

Create `plugin/src/test/kotlin/net/artisanmc/plugin/DataSourceFetchHandlerTest.kt`:

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.PlayerRequiredException
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class DataSourceFetchHandlerTest {
    private val mapper = ObjectMapper()
    private var mainThreadRuns = 0

    @BeforeEach fun setup() { MockBukkit.mock(); mainThreadRuns = 0 }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    /** Provider with a captured send + a counting synchronous "main thread". */
    private fun provider(registry: DataSourceRegistry?, sink: MutableList<Map<String, Any?>>, latch: CountDownLatch): SyncedMenuProvider {
        val dir = Files.createTempDirectory("artisan_dsf_").toFile()
        val p = SyncedMenuProvider(
            projectsDir = dir, serverKey = "", wsUrl = "", logger = null,
            dataSources = registry,
            runOnMainThread = { task -> mainThreadRuns++; task() },
        )
        p.load()
        p.setSendForTesting { raw ->
            @Suppress("UNCHECKED_CAST")
            sink.add(mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            latch.countDown()
        }
        return p
    }

    private fun await(latch: CountDownLatch) =
        assertTrue(latch.await(5, TimeUnit.SECONDS), "no data_source_fetch_result sent within 5s")

    @Test
    fun `fetches with null player on the main thread and shapes filter-sort-limit`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { player, _ ->
            assertNull(player)
            listOf(
                mapOf("id" to "bow", "cat" to "armes", "price" to 30),
                mapOf("id" to "sword", "cat" to "armes", "price" to 10),
                mapOf("id" to "bread", "cat" to "food", "price" to 1),
                mapOf("id" to "axe", "cat" to "armes", "price" to 20),
            )
        }))
        val sink = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r1","ref":"shop:items",
            "params":{},"filter":{"cat":"armes"},"sort":{"by":"price","direction":"asc"},"limit":2,"args":{}}""")
        await(latch)

        assertEquals(1, mainThreadRuns)
        val msg = sink[0]
        assertEquals("data_source_fetch_result", msg["type"])
        assertEquals("r1", msg["request_id"])
        assertEquals(true, msg["ok"])
        assertEquals(false, msg["truncated"])
        @Suppress("UNCHECKED_CAST")
        val rows = msg["rows"] as List<Map<String, Any?>>
        assertEquals(listOf("sword", "axe"), rows.map { it["id"] })
    }

    @Test
    fun `interpolates {arg} tokens in filter values from args`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "quests:list", fetcher = { _, _ ->
            listOf(mapOf("id" to "q1", "group" to "daily"), mapOf("id" to "q2", "group" to "weekly"))
        }))
        val sink = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r2","ref":"quests:list",
            "params":{},"filter":{"group":"{group}"},"sort":null,"limit":null,"args":{"group":"daily"}}""")
        await(latch)

        @Suppress("UNCHECKED_CAST")
        val rows = sink[0]["rows"] as List<Map<String, Any?>>
        assertEquals(listOf("q1"), rows.map { it["id"] })
    }

    @Test
    fun `truncates to 50 rows and flags truncated`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "big:list", fetcher = { _, _ ->
            (1..80).map { mapOf<String, Any?>("i" to it) }
        }))
        val sink = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r3","ref":"big:list",
            "params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        @Suppress("UNCHECKED_CAST")
        val rows = sink[0]["rows"] as List<Map<String, Any?>>
        assertEquals(50, rows.size)
        assertEquals(true, sink[0]["truncated"])
    }

    @Test
    fun `truncates further when payload exceeds 256 KB`() {
        val big = "x".repeat(20_000)
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "huge:list", fetcher = { _, _ ->
            (1..40).map { mapOf<String, Any?>("i" to it, "blob" to big) }
        }))
        val sink = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r4","ref":"huge:list",
            "params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        @Suppress("UNCHECKED_CAST")
        val rows = sink[0]["rows"] as List<Map<String, Any?>>
        assertTrue(rows.size < 40, "expected byte-budget truncation, got ${rows.size} rows")
        assertEquals(true, sink[0]["truncated"])
    }

    @Test
    fun `unknown ref answers unknown_source without touching the main thread`() {
        val sink = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(1)
        val p = provider(DataSourceRegistry(), sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r5","ref":"ghost:x",
            "params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        assertEquals(0, mainThreadRuns)
        assertEquals(false, sink[0]["ok"])
        assertEquals("unknown_source", sink[0]["error"])
    }

    @Test
    fun `PlayerRequiredException maps to player_required, other exceptions to fetch_error`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "me:stats", fetcher = { _, _ -> throw PlayerRequiredException("needs a player") }))
        registry.register(DataSourceDeclaration(ref = "boom:x", fetcher = { _, _ -> error("kaboom") }))
        val sink = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(2)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r6","ref":"me:stats","params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r7","ref":"boom:x","params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        val byId = sink.associateBy { it["request_id"] }
        assertEquals("player_required", byId["r6"]!!["error"])
        assertEquals("needs a player", byId["r6"]!!["message"])
        assertEquals("fetch_error", byId["r7"]!!["error"])
        assertEquals("kaboom", byId["r7"]!!["message"])
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.DataSourceFetchHandlerTest"`
Expected: compilation FAILS (`runOnMainThread` parameter unknown).

- [ ] **Step 3: Implement**

`plugin/src/main/kotlin/net/artisanmc/plugin/engine/ContextBinder.kt`: change visibility only —
`private fun shape(` → `internal fun shape(` and `private fun interpolateValues(` → `internal fun interpolateValues(`. No behavior change.

`plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`:

1. Add the constructor parameter (after `dataSourcesReport`):

```kotlin
    /**
     * Dispatches a task onto the Bukkit main thread (fetchers touch the Bukkit
     * API). Default = synchronous, for tests; ArtisanPlugin injects the scheduler.
     */
    private val runOnMainThread: (() -> Unit) -> Unit = { it() },
```

2. Add companion constants + truncation helper (near the top of the class body):

```kotlin
    companion object {
        internal const val MAX_PREVIEW_ROWS = 50
        internal const val MAX_PREVIEW_BYTES = 256 * 1024
    }

    /** Preview guard: cap at [MAX_PREVIEW_ROWS] rows and ~[MAX_PREVIEW_BYTES] serialized bytes. */
    internal fun truncateForPreview(rows: List<Map<String, Any?>>): Pair<List<Map<String, Any?>>, Boolean> {
        var out = rows.take(MAX_PREVIEW_ROWS)
        var truncated = rows.size > MAX_PREVIEW_ROWS
        while (out.isNotEmpty() && jsonMapper.writeValueAsBytes(out).size > MAX_PREVIEW_BYTES) {
            out = out.dropLast(1)
            truncated = true
        }
        return out to truncated
    }
```

3. Add the handler in `handleMessage`'s `when` (next to `"custom_items_request"`):

```kotlin
            "data_source_fetch" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val ref = node["ref"]?.asText() ?: return
                val registry = dataSources
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "data_source_fetch_result", "request_id" to requestId)
                    // Reply off the WS-callback / main thread (spec: réponse hors main thread).
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("data_source_fetch_result dropped — plugin is stopping")
                    }
                }
                if (registry == null || !registry.has(ref)) {
                    reply(mapOf("ok" to false, "error" to "unknown_source"))
                    return
                }
                fun jsonToMap(field: String): Map<String, Any?> =
                    node[field]?.takeIf { it.isObject }?.let {
                        jsonMapper.convertValue(it, object : TypeReference<Map<String, Any?>>() {})
                    } ?: emptyMap()
                val params = jsonToMap("params")
                val filter = jsonToMap("filter")
                val sort = jsonToMap("sort")
                val limit = node["limit"]?.takeIf { it.isNumber }?.asInt()
                val args: Map<String, Any> = jsonToMap("args").mapValues { it.value ?: "" }
                // Same shape ContextBinder.shape reads at render time — preview == runtime.
                val source = buildMap<String, Any> {
                    put("ref", ref)
                    if (params.isNotEmpty()) put("params", params)
                    if (filter.isNotEmpty()) put("filter", filter)
                    if (sort.isNotEmpty()) put("sort", sort)
                    if (limit != null) put("limit", limit)
                }
                runOnMainThread {
                    try {
                        val rows = registry.fetch(
                            ref, null,
                            net.artisanmc.plugin.engine.ContextBinder.interpolateValues(params, args),
                        )
                        val shaped = net.artisanmc.plugin.engine.ContextBinder.shape(rows, source, args)
                        val (payloadRows, truncated) = truncateForPreview(shaped)
                        reply(mapOf("ok" to true, "rows" to payloadRows, "truncated" to truncated))
                    } catch (e: net.artisanmc.modules.api.PlayerRequiredException) {
                        reply(mapOf("ok" to false, "error" to "player_required", "message" to e.message))
                    } catch (e: Throwable) {
                        logger?.warning("[Artisan] data source preview '$ref' failed: ${e.message}")
                        reply(mapOf("ok" to false, "error" to "fetch_error", "message" to e.message))
                    }
                }
            }
```

> Note: `ContextBinder.shape` takes `internal fun shape(rows, source, args)` where `interpolateValues`/`shape` are `object ContextBinder` members — call them as shown (`ContextBinder.shape(...)`). `TypeReference` is already imported in this file.

`plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`: at **both** `SyncedMenuProvider(...)` construction sites (onEnable ~line 80 and `reinit` ~line 243), add after `dataSourcesReport = …`:

```kotlin
            runOnMainThread = { task -> server.scheduler.runTask(this@ArtisanPlugin, Runnable { task() }) },
```

(In `onEnable`'s scope, `this@ArtisanPlugin` may be written `this`; keep the labeled form so it compiles identically in both scopes.)

- [ ] **Step 4: Run the full plugin suite**

Run: `cd plugin && ./gradlew test`
Expected: PASS (including the 6 new handler tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ContextBinder.kt plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/test/kotlin/net/artisanmc/plugin/DataSourceFetchHandlerTest.kt
git commit -m "feat(plugin): data_source_fetch preview handler — main-thread fetch, runtime shaping, 50-row/256KB guards"
```

---

### Task 5: Editor explorer — "Sources du serveur" section, DataTable, preview client

**Files:**
- Modify: `editor/src/lib/api/dataSources.ts` (enriched type + `previewDataSource`)
- Modify: `editor/src/state/serverDataSourcesStore.test.ts` (new source shape)
- Create: `editor/src/features/data/serverSourceGroups.ts` + `serverSourceGroups.test.ts`
- Create: `editor/src/components/ui/data-table.tsx` + specimen in `editor/src/features/design-system/DesignSystemPage.tsx`
- Create: `editor/src/features/data/ServerSourcesSection.tsx` (sidebar section)
- Create: `editor/src/features/data/ServerSourceDetail.tsx` + `ServerSourceDetail.test.tsx`
- Modify: `editor/src/features/data/DataSourcesSidebar.tsx`, `editor/src/features/data/DataSourcesPanel.tsx`
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`
- Docs: `docs/architecture/editor-internals.md` (Design system section: DataTable)

**Interfaces:**
- Consumes: Task 2 REST shape `{data_sources: {ref, module_id, schema, schema_hint}[]}`; Task 3 preview route + statuses.
- Produces (Task 6 depends on these):

```ts
// lib/api/dataSources.ts
export interface DataSourceSchemaField { name: string; type: string; description: string | null }
export interface ServerDataSource { ref: string; moduleId: string | null; schema: DataSourceSchemaField[]; schemaHint: string | null }
export type PreviewErrorCode = "server_offline" | "fetch_timeout" | "unknown_source" | "player_required" | "fetch_error" | "network_error";
export type PreviewResult =
  | { ok: true; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; error: PreviewErrorCode; message: string | null };
export interface PreviewRequest {
  ref: string;
  params?: Record<string, string>;
  filter?: Record<string, string>;
  sort?: { by: string; direction?: "asc" | "desc" };
  limit?: number;
  args?: Record<string, string>;
}
export async function previewDataSource(networkId: string, serverId: string, req: PreviewRequest): Promise<PreviewResult>
// features/data/serverSourceGroups.ts
export interface ServerSourceGroup { moduleId: string | null; sources: ServerDataSource[] }
export function groupServerSources(sources: ServerDataSource[]): ServerSourceGroup[]
// components/ui/data-table.tsx
export function DataTable(props: { rows: Record<string, unknown>[]; truncated?: boolean; truncatedLabel?: string; emptyLabel?: string })
```

- [ ] **Step 1: Write the failing tests**

Create `editor/src/features/data/serverSourceGroups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupServerSources } from "./serverSourceGroups";
import type { ServerDataSource } from "@/lib/api/dataSources";

const src = (ref: string, moduleId: string | null): ServerDataSource => ({
  ref, moduleId, schema: [], schemaHint: null,
});

describe("groupServerSources", () => {
  it("groups by moduleId: core modules first (alpha), then others (alpha), null last", () => {
    const groups = groupServerSources([
      src("zoo:b", "zoo"),
      src("core:x", null),
      src("menus:nav", "menus"),
      src("boutique:items", "boutique"),
      src("commands:list", "commands"),
    ]);
    expect(groups.map((g) => g.moduleId)).toEqual(["commands", "menus", "boutique", "zoo", null]);
  });

  it("sorts sources alphabetically by ref inside a group", () => {
    const groups = groupServerSources([src("boutique:z", "boutique"), src("boutique:a", "boutique")]);
    expect(groups[0].sources.map((s) => s.ref)).toEqual(["boutique:a", "boutique:z"]);
  });

  it("returns [] for no sources", () => {
    expect(groupServerSources([])).toEqual([]);
  });
});
```

Create `editor/src/features/data/ServerSourceDetail.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ServerSourceDetail } from "./ServerSourceDetail";
import type { ServerDataSource } from "@/lib/api/dataSources";

const previewDataSource = vi.fn();
vi.mock("@/lib/api/dataSources", async () => {
  const actual = await vi.importActual<object>("@/lib/api/dataSources");
  return { ...actual, previewDataSource: (...a: unknown[]) => previewDataSource(...a) };
});
const getNetworkServersStatus = vi.fn();
vi.mock("@/lib/api/networks", async () => {
  const actual = await vi.importActual<object>("@/lib/api/networks");
  return { ...actual, getNetworkServersStatus: (...a: unknown[]) => getNetworkServersStatus(...a) };
});

const source: ServerDataSource = {
  ref: "boutique:items",
  moduleId: "boutique",
  schema: [{ name: "price", type: "number", description: "Unit price" }],
  schemaHint: null,
};

describe("ServerSourceDetail", () => {
  beforeEach(() => {
    previewDataSource.mockReset();
    getNetworkServersStatus.mockReset();
    getNetworkServersStatus.mockResolvedValue({ servers: [{ id: "sk1", online: true }], online: 1, total: 1 });
  });

  it("renders ref, module badge, and the schema table", async () => {
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    expect(screen.getByText("boutique:items")).toBeInTheDocument();
    expect(screen.getByText("boutique")).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
    expect(screen.getByText("number")).toBeInTheDocument();
    expect(screen.getByText("Unit price")).toBeInTheDocument();
  });

  it("preview button fetches rows without filters and renders them", async () => {
    previewDataSource.mockResolvedValue({ ok: true, rows: [{ id: "sword", price: 10 }], truncated: true });
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    fireEvent.click(await screen.findByTestId("server-source-preview"));
    await waitFor(() => expect(screen.getByText("sword")).toBeInTheDocument());
    expect(previewDataSource).toHaveBeenCalledWith("n1", "sk1", { ref: "boutique:items" });
    expect(screen.getByTestId("data-table-truncated")).toBeInTheDocument();
  });

  it("shows the typed error states", async () => {
    previewDataSource.mockResolvedValue({ ok: false, error: "player_required", message: null });
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    fireEvent.click(await screen.findByTestId("server-source-preview"));
    await waitFor(() => expect(screen.getByTestId("preview-error")).toBeInTheDocument());
  });

  it("disables preview with an explanation when the server is offline", async () => {
    getNetworkServersStatus.mockResolvedValue({ servers: [{ id: "sk1", online: false }], online: 0, total: 1 });
    render(<ServerSourceDetail networkId="n1" serverId="sk1" source={source} />);
    await waitFor(() => expect(screen.getByTestId("server-source-preview")).toBeDisabled());
    expect(screen.getByTestId("preview-offline-hint")).toBeInTheDocument();
  });
});
```

Also update `editor/src/state/serverDataSourcesStore.test.ts`: everywhere a source object appears (`{ ref: "...", schemaHint: null }` and the fetch-mock JSON expectations), switch to the new shape — store expectations become `{ ref, moduleId: null, schema: [], schemaHint: null }` (the fetch mocks return `{ data_sources: [{ ref: "…" }] }`, and the mapper now defaults `moduleId`/`schema`).

- [ ] **Step 2: Run to verify failure**

Run: `cd editor && npm test -- --run src/features/data/serverSourceGroups.test.ts src/features/data/ServerSourceDetail.test.tsx src/state/serverDataSourcesStore.test.ts`
Expected: FAIL (modules/components missing, store shape mismatch).

- [ ] **Step 3: Implement the API client**

Replace `editor/src/lib/api/dataSources.ts`:

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface DataSourceSchemaField {
  name: string;
  type: string;
  description: string | null;
}

export interface ServerDataSource {
  ref: string;
  moduleId: string | null;
  schema: DataSourceSchemaField[];
  schemaHint: string | null;
}

/**
 * Data sources reported by the connected server for a network/server pair.
 * Cookie auth, `serverId` is the exact server_key id (not a slug). [] on any
 * failure (non-OK response, network error, or malformed JSON).
 */
export async function fetchServerDataSourcesUser(
  networkId: string,
  serverId: string,
): Promise<ServerDataSource[]> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/data-sources`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data_sources?: {
        ref: string;
        module_id?: string | null;
        schema?: { name: string; type: string; description?: string | null }[];
        schema_hint?: string | null;
      }[];
    };
    return (data.data_sources ?? []).map((d) => ({
      ref: d.ref,
      moduleId: d.module_id ?? null,
      schema: (d.schema ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description ?? null,
      })),
      schemaHint: d.schema_hint ?? null,
    }));
  } catch {
    return [];
  }
}

export type PreviewErrorCode =
  | "server_offline"
  | "fetch_timeout"
  | "unknown_source"
  | "player_required"
  | "fetch_error"
  | "network_error";

export type PreviewResult =
  | { ok: true; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; error: PreviewErrorCode; message: string | null };

export interface PreviewRequest {
  ref: string;
  params?: Record<string, string>;
  filter?: Record<string, string>;
  sort?: { by: string; direction?: "asc" | "desc" };
  limit?: number;
  args?: Record<string, string>;
}

/** Live preview relayed to the connected plugin (5 s backend timeout). */
export async function previewDataSource(
  networkId: string,
  serverId: string,
  req: PreviewRequest,
): Promise<PreviewResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/data-sources/preview`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      },
    );
    const body = (await res.json().catch(() => null)) as
      | { rows?: Record<string, unknown>[]; truncated?: boolean; error?: string; message?: string | null }
      | null;
    if (res.ok) return { ok: true, rows: body?.rows ?? [], truncated: body?.truncated ?? false };
    const known: PreviewErrorCode[] = ["server_offline", "fetch_timeout", "unknown_source", "player_required", "fetch_error"];
    const error = known.includes(body?.error as PreviewErrorCode) ? (body?.error as PreviewErrorCode) : "fetch_error";
    return { ok: false, error, message: body?.message ?? null };
  } catch {
    return { ok: false, error: "network_error", message: null };
  }
}
```

- [ ] **Step 4: Implement grouping + DataTable**

Create `editor/src/features/data/serverSourceGroups.ts`:

```ts
import type { ServerDataSource } from "@/lib/api/dataSources";

/** V1 core modules — their groups sort before Add-on groups (spec §3). */
export const CORE_MODULE_IDS = ["commands", "menus"];

export interface ServerSourceGroup {
  /** null = sources registered outside a module ("Serveur" group, rendered last). */
  moduleId: string | null;
  sources: ServerDataSource[];
}

export function groupServerSources(sources: ServerDataSource[]): ServerSourceGroup[] {
  const byModule = new Map<string | null, ServerDataSource[]>();
  for (const s of sources) {
    const key = s.moduleId ?? null;
    const list = byModule.get(key) ?? [];
    list.push(s);
    byModule.set(key, list);
  }
  const rank = (id: string | null): number =>
    id === null ? 2 : CORE_MODULE_IDS.includes(id) ? 0 : 1;
  return [...byModule.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (a ?? "").localeCompare(b ?? ""))
    .map(([moduleId, list]) => ({
      moduleId,
      sources: [...list].sort((x, y) => x.ref.localeCompare(y.ref)),
    }));
}
```

Create `editor/src/components/ui/data-table.tsx`:

```tsx
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

interface DataTableProps {
  rows: Record<string, unknown>[];
  truncated?: boolean;
  /** Shown under the table when `truncated` — pass a translated string. */
  truncatedLabel?: string;
  /** Shown instead of the table when `rows` is empty — pass a translated string. */
  emptyLabel?: string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Generic row-preview table (data source explorer + menu data section).
 * Columns = union of row keys in first-seen order. Dumb component: labels
 * come translated from the caller.
 */
export function DataTable({ rows, truncated, truncatedLabel, emptyLabel }: DataTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)]/40 px-2 py-2 text-[11px] text-[var(--text-faint)]">
        {emptyLabel ?? ""}
      </div>
    );
  }
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return (
    <div className="flex flex-col gap-1" data-testid="data-table">
      <Table>
        <THead>
          <TR>
            {columns.map((c) => (
              <TH key={c}>{c}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no stable id
            <TR key={i}>
              {columns.map((c) => (
                <TD key={c} className="font-mono text-xs">
                  {formatCell(row[c])}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      {truncated ? (
        <div data-testid="data-table-truncated" className="text-[10px] text-[var(--warning)]">
          {truncatedLabel ?? ""}
        </div>
      ) : null}
    </div>
  );
}
```

Add the specimen to `editor/src/features/design-system/DesignSystemPage.tsx`, following the file's existing specimen-section pattern (title + demo block, same wrappers as the Table/Badge specimens):

```tsx
{/* DataTable — generic row-preview table (data sources explorer / menu data) */}
<DataTable
  rows={[
    { id: "sword", price: 10, tags: ["pvp"] },
    { id: "bow", price: 30, tags: null },
  ]}
  truncated
  truncatedLabel="Results truncated."
/>
```

(import `DataTable` from `@/components/ui/data-table` at the top of the file).

- [ ] **Step 5: Implement the explorer components**

Create `editor/src/features/data/ServerSourcesSection.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useTranslation } from "react-i18next";
import { groupServerSources } from "./serverSourceGroups";

interface ServerSourcesSectionProps {
  selectedRef: string | null;
  onSelect: (ref: string) => void;
}

/** Sidebar section listing server-declared sources, grouped by owning module. */
export function ServerSourcesSection({ selectedRef, onSelect }: ServerSourcesSectionProps) {
  const { t } = useTranslation();
  const sources = useServerDataSourcesStore((s) => s.sources);
  const groups = groupServerSources(sources);

  return (
    <section>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("dataSources.sectionServer")}
      </div>
      {groups.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border-soft)] bg-[var(--surface-raised)]/40 px-2 py-2 text-[11px] text-[var(--text-faint)]">
          {t("dataSources.noServerSources")}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.moduleId ?? "__server"} className="mb-2">
            <Badge className="mb-1">{g.moduleId ?? t("dataSources.serverGroup")}</Badge>
            <ul className="flex flex-col gap-1">
              {g.sources.map((s) => (
                <li key={s.ref}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.ref)}
                    className={
                      selectedRef === s.ref
                        ? "flex w-full items-center gap-1 rounded bg-[var(--surface-raised-2)] px-2 py-1 text-left text-[12px]"
                        : "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-[var(--text-mut)] hover:bg-[var(--surface-raised)]"
                    }
                  >
                    <span>🛰</span>
                    <span className="truncate font-mono">{s.ref}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
```

> If the `Badge` component's props differ (check `editor/src/components/ui/badge.tsx` — e.g. a `variant` prop), use its default variant; do not restyle ad hoc.

Create `editor/src/features/data/ServerSourceDetail.tsx`:

```tsx
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  previewDataSource,
  type PreviewResult,
  type ServerDataSource,
} from "@/lib/api/dataSources";
import { getNetworkServersStatus } from "@/lib/api/networks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface ServerSourceDetailProps {
  networkId: string;
  serverId: string;
  source: ServerDataSource;
}

type PreviewState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; result: PreviewResult };

/** Detail view of one server data source: schema table, copyable ref, live preview. */
export function ServerSourceDetail({ networkId, serverId, source }: ServerSourceDetailProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    setPreview({ kind: "idle" });
    let cancelled = false;
    getNetworkServersStatus(networkId)
      .then((status) => {
        if (cancelled) return;
        setOnline(status.servers.find((s) => s.id === serverId)?.online ?? false);
      })
      .catch(() => {
        if (!cancelled) setOnline(null); // unknown — leave preview enabled, errors surface on click
      });
    return () => {
      cancelled = true;
    };
  }, [networkId, serverId, source.ref]);

  const runPreview = async () => {
    setPreview({ kind: "loading" });
    const result = await previewDataSource(networkId, serverId, { ref: source.ref });
    setPreview({ kind: "done", result });
  };

  const copyRef = async () => {
    await navigator.clipboard.writeText(source.ref);
    toast.success(t("dataSources.refCopied"));
  };

  const errorLabel = (error: string, message: string | null): string => {
    switch (error) {
      case "server_offline": return t("dataSources.errServerOffline");
      case "fetch_timeout": return t("dataSources.errTimeout");
      case "unknown_source": return t("dataSources.errUnknownSource");
      case "player_required": return t("dataSources.errPlayerRequired");
      default: return t("dataSources.errFetchError", { message: message ?? "?" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{source.ref}</span>
        <button
          type="button"
          onClick={copyRef}
          title={t("dataSources.copyRef")}
          className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          {t("dataSources.copyRef")}
        </button>
        <Badge className="ml-auto">{source.moduleId ?? t("dataSources.serverGroup")}</Badge>
      </div>

      <section>
        <div className="eyebrow mb-1">{t("dataSources.schemaTitle")}</div>
        {source.schema.length === 0 ? (
          <p className="text-[11px] text-[var(--text-faint)]">
            {source.schemaHint ?? t("dataSources.noSchema")}
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t("dataSources.schemaField")}</TH>
                <TH>{t("dataSources.schemaType")}</TH>
                <TH>{t("dataSources.schemaDescription")}</TH>
              </TR>
            </THead>
            <TBody>
              {source.schema.map((f) => (
                <TR key={f.name}>
                  <TD className="font-mono text-xs">{f.name}</TD>
                  <TD className="font-mono text-xs">{f.type}</TD>
                  <TD className="text-xs text-[var(--text-mut)]">{f.description ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <button
            type="button"
            data-testid="server-source-preview"
            disabled={online === false || preview.kind === "loading"}
            onClick={runPreview}
            className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)] hover:bg-[var(--brand)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preview.kind === "loading" ? t("dataSources.previewLoading") : t("dataSources.preview")}
          </button>
        </div>
        {online === false ? (
          <p data-testid="preview-offline-hint" className="text-[11px] text-[var(--text-mut)]">
            {t("dataSources.previewOffline")}
          </p>
        ) : null}
        {preview.kind === "done" && preview.result.ok ? (
          <DataTable
            rows={preview.result.rows}
            truncated={preview.result.truncated}
            truncatedLabel={t("dataSources.previewTruncated")}
            emptyLabel={t("dataSources.previewEmpty")}
          />
        ) : null}
        {preview.kind === "done" && !preview.result.ok ? (
          <div
            data-testid="preview-error"
            className="rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1.5 text-[11px] text-[var(--warning)]"
          >
            {errorLabel(preview.result.error, preview.result.message)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
```

Wire into the panel — `editor/src/features/data/DataSourcesSidebar.tsx`: add props `selectedServerRef: string | null; onSelectServerRef: (ref: string) => void;` and render `<ServerSourcesSection selectedRef={selectedServerRef} onSelect={onSelectServerRef} />` as a third `<section>` after the connectors section.

`editor/src/features/data/DataSourcesPanel.tsx` — extend the selection to a union and route the right pane:

```tsx
type DataPanelSelection =
  | { kind: "project"; id: DataSourceId }
  | { kind: "server"; ref: string }
  | null;
```

In `DataSourcesPanelContent`: replace `selectedId` state with `const [selection, setSelection] = useState<DataPanelSelection>(null);`, pass
`selectedId={selection?.kind === "project" ? selection.id : null}` / `onSelect={(id) => setSelection(id ? { kind: "project", id } : null)}` and
`selectedServerRef={selection?.kind === "server" ? selection.ref : null}` / `onSelectServerRef={(ref) => setSelection({ kind: "server", ref })}` to the sidebar. In the right pane, when `selection?.kind === "server"`, look up the source in `useServerDataSourcesStore((s) => s.sources)` by ref plus `useNetworksStore((s) => s.activeId)` and `useServersStore((s) => s.activeServerId)` and render `<ServerSourceDetail networkId={activeNetworkId} serverId={activeServerId} source={found} />` (fall back to the existing `selectHint` empty state when the ref/network/server can't be resolved).

- [ ] **Step 6: i18n keys (en + fr, same commit)**

Append inside the `dataSources` block of `editor/src/locales/en.ts`:

```ts
    sectionServer: "Server sources",
    serverGroup: "Server",
    noServerSources: "No source declared by the server.",
    schemaTitle: "Schema",
    schemaField: "Field",
    schemaType: "Type",
    schemaDescription: "Description",
    noSchema: "No declared schema.",
    copyRef: "Copy ref",
    refCopied: "Ref copied.",
    preview: "Preview",
    previewLoading: "Fetching…",
    previewEmpty: "No rows returned.",
    previewTruncated: "Results truncated.",
    previewOffline: "Server offline — schema stays available, live preview doesn't.",
    errServerOffline: "Server offline.",
    errTimeout: "No reply from the plugin — update the plugin or check the server connection.",
    errUnknownSource: "The server doesn't know this source.",
    errPlayerRequired: "This source needs an online player — preview unavailable.",
    errFetchError: "The module failed: {{message}}",
```

And in `editor/src/locales/fr.ts`:

```ts
    sectionServer: "Sources du serveur",
    serverGroup: "Serveur",
    noServerSources: "Aucune source déclarée par le serveur.",
    schemaTitle: "Schéma",
    schemaField: "Champ",
    schemaType: "Type",
    schemaDescription: "Description",
    noSchema: "Pas de schéma déclaré.",
    copyRef: "Copier la ref",
    refCopied: "Ref copiée.",
    preview: "Prévisualiser",
    previewLoading: "Chargement…",
    previewEmpty: "Aucune ligne renvoyée.",
    previewTruncated: "Résultats tronqués.",
    previewOffline: "Serveur hors ligne — le schéma reste visible, la preview live non.",
    errServerOffline: "Serveur hors ligne.",
    errTimeout: "Pas de réponse du plugin — plugin à mettre à jour ou serveur injoignable.",
    errUnknownSource: "Le serveur ne connaît pas cette source.",
    errPlayerRequired: "Cette source requiert un joueur en ligne — preview indisponible.",
    errFetchError: "Le module a échoué : {{message}}",
```

- [ ] **Step 7: Run the editor suite**

Run: `cd editor && npm test -- --run`
Expected: PASS (new tests + updated store tests + no regressions in `MenuProperties`-related tests: `SourcePickerOptions` still reads `s.schemaHint`, which the enriched type keeps).

- [ ] **Step 8: Docs + commit**

`docs/architecture/editor-internals.md` (Design system section): add one line — `DataTable` (`components/ui/data-table.tsx`): generic row-preview table (columns = union of row keys), used by the data-source explorer and the menu "Données du menu" section; specimen on `/admin/design`.

```bash
git add editor/src/lib/api/dataSources.ts editor/src/state/serverDataSourcesStore.test.ts editor/src/features/data/serverSourceGroups.ts editor/src/features/data/serverSourceGroups.test.ts editor/src/components/ui/data-table.tsx editor/src/features/design-system/DesignSystemPage.tsx editor/src/features/data/ServerSourcesSection.tsx editor/src/features/data/ServerSourceDetail.tsx editor/src/features/data/ServerSourceDetail.test.tsx editor/src/features/data/DataSourcesSidebar.tsx editor/src/features/data/DataSourcesPanel.tsx editor/src/locales/en.ts editor/src/locales/fr.ts docs/architecture/editor-internals.md
git commit -m "feat(editor): server data sources explorer — grouped by module, schema table, live preview"
```

---

### Task 6: Editor menu-side — visual filter/sort/limit editor + "Données du menu" section

**Files:**
- Create: `editor/src/features/canvas/properties/SourceShapingEditor.tsx` + `SourceShapingEditor.test.tsx`
- Create: `editor/src/features/canvas/properties/MenuDataSection.tsx` + `MenuDataSection.test.tsx`
- Modify: `editor/src/features/canvas/properties/MenuProperties.tsx` (mount both under `SourceRefInputRow` / after `ContextInputsEditor`)
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`
- Docs: `docs/architecture/editor-internals.md` (édition d'élément / menu properties section)

**Interfaces:**
- Consumes: Task 5 `previewDataSource`, `ServerDataSource`, `DataTable`, `useServerDataSourcesStore`; domain `ContextInput` sourceRef variant (`ref, params?, filter?, sort?, limit?` — already in `editor/src/domain/types.ts:160-169`, no domain change, export round-trip untouched).
- Produces:

```ts
// SourceShapingEditor.tsx
export function SourceShapingEditor(props: {
  input: Extract<ContextInput, { kind: "sourceRef" }>;
  schemaFields: string[];   // declared field names ([] = free input)
  argNames: string[];       // menu arg names for {arg} suggestions
  onChange: (patch: Partial<Extract<ContextInput, { kind: "sourceRef" }>>) => void;
})
// MenuDataSection.tsx
export function MenuDataSection(props: { menu: Menu }): JSX.Element | null
export function extractArgTokens(input: Extract<ContextInput, { kind: "sourceRef" }>): string[]
```

- [ ] **Step 1: Write the failing tests**

Create `editor/src/features/canvas/properties/SourceShapingEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceShapingEditor } from "./SourceShapingEditor";
import type { ContextInput, SourceRef } from "@/domain/types";

type SR = Extract<ContextInput, { kind: "sourceRef" }>;
const base: SR = {
  kind: "sourceRef",
  name: "quests",
  ref: "quests:list" as SourceRef,
  filter: { group: "{group}" },
  sort: { by: "order", direction: "asc" },
  limit: 27,
};

describe("SourceShapingEditor", () => {
  it("renders imported filter/sort/limit values (YAML round-trip becomes editable)", () => {
    render(<SourceShapingEditor input={base} schemaFields={["group", "order"]} argNames={["group"]} onChange={() => {}} />);
    expect(screen.getByDisplayValue("group")).toBeInTheDocument();
    expect(screen.getByDisplayValue("{group}")).toBeInTheDocument();
    expect(screen.getByDisplayValue("order")).toBeInTheDocument();
    expect(screen.getByDisplayValue("27")).toBeInTheDocument();
  });

  it("editing a filter value emits the rebuilt filter record", () => {
    const onChange = vi.fn();
    render(<SourceShapingEditor input={base} schemaFields={[]} argNames={[]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("{group}"), { target: { value: "daily" } });
    expect(onChange).toHaveBeenCalledWith({ filter: { group: "daily" } });
  });

  it("adding a filter row then naming it emits a new entry", () => {
    const onChange = vi.fn();
    render(<SourceShapingEditor input={{ ...base, filter: undefined }} schemaFields={["cat"]} argNames={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("filter-add"));
    const fields = screen.getAllByTestId("filter-field");
    fireEvent.change(fields[fields.length - 1], { target: { value: "cat" } });
    const values = screen.getAllByTestId("filter-value");
    fireEvent.change(values[values.length - 1], { target: { value: "armes" } });
    expect(onChange).toHaveBeenLastCalledWith({ filter: { cat: "armes" } });
  });

  it("clearing limit emits undefined; setting sort none emits undefined", () => {
    const onChange = vi.fn();
    render(<SourceShapingEditor input={base} schemaFields={[]} argNames={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("limit-input"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ limit: undefined });
    fireEvent.change(screen.getByTestId("sort-by"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ sort: undefined });
  });

  it("offers schema fields and {arg} suggestions via datalists", () => {
    render(<SourceShapingEditor input={base} schemaFields={["group", "order"]} argNames={["group", "page"]} onChange={() => {}} />);
    const fieldOptions = screen.getByTestId("filter-field-options").querySelectorAll("option");
    expect([...fieldOptions].map((o) => o.value)).toEqual(["group", "order"]);
    const valueOptions = screen.getByTestId("filter-value-options").querySelectorAll("option");
    expect([...valueOptions].map((o) => o.value)).toEqual(["{group}", "{page}"]);
  });
});
```

Create `editor/src/features/canvas/properties/MenuDataSection.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MenuDataSection, extractArgTokens } from "./MenuDataSection";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import type { ContextInput, Menu, SourceRef } from "@/domain/types";

const previewDataSource = vi.fn();
vi.mock("@/lib/api/dataSources", async () => {
  const actual = await vi.importActual<object>("@/lib/api/dataSources");
  return { ...actual, previewDataSource: (...a: unknown[]) => previewDataSource(...a) };
});

const sourceInput: Extract<ContextInput, { kind: "sourceRef" }> = {
  kind: "sourceRef",
  name: "quests",
  ref: "quests:list" as SourceRef,
  filter: { group: "{group}" },
  sort: { by: "order", direction: "asc" },
  limit: 10,
};
const menu = {
  id: "m1",
  contextInputs: [sourceInput, { kind: "primitive", name: "group", type: "string" }],
  layers: [],
} as unknown as Menu;

describe("extractArgTokens", () => {
  it("collects {arg} tokens from filter and params values, deduped + sorted", () => {
    expect(
      extractArgTokens({
        ...sourceInput,
        params: { page: "{page}" },
        filter: { group: "{group}", other: "{group}" },
      }),
    ).toEqual(["group", "page"]);
  });
  it("returns [] without tokens", () => {
    expect(extractArgTokens({ ...sourceInput, filter: { group: "daily" } })).toEqual([]);
  });
});

describe("MenuDataSection", () => {
  beforeEach(() => {
    previewDataSource.mockReset();
    useNetworksStore.setState({ activeId: "n1" } as never);
    useServersStore.setState({ activeServerId: "sk1" } as never);
    useServerDataSourcesStore.setState({
      sources: [{ ref: "quests:list", moduleId: "quests", schema: [], schemaHint: null }],
      status: "ready",
      loadedKey: "u:n1/sk1",
    });
  });

  it("renders one card per sourceRef input with ref, module badge and filter summary", () => {
    render(<MenuDataSection menu={menu} />);
    expect(screen.getByText("quests:list")).toBeInTheDocument();
    expect(screen.getByText("quests")).toBeInTheDocument();
    expect(screen.getByText(/group = \{group\}/)).toBeInTheDocument();
  });

  it("previews with the menu's filters and the typed test-arg values", async () => {
    previewDataSource.mockResolvedValue({ ok: true, rows: [{ id: "q1" }], truncated: false });
    render(<MenuDataSection menu={menu} />);
    fireEvent.change(screen.getByTestId("test-arg-group"), { target: { value: "daily" } });
    fireEvent.click(screen.getByTestId("menu-data-preview"));
    await waitFor(() => expect(screen.getByText("q1")).toBeInTheDocument());
    expect(previewDataSource).toHaveBeenCalledWith("n1", "sk1", {
      ref: "quests:list",
      params: undefined,
      filter: { group: "{group}" },
      sort: { by: "order", direction: "asc" },
      limit: 10,
      args: { group: "daily" },
    });
  });

  it("returns null when the menu consumes no source", () => {
    const { container } = render(<MenuDataSection menu={{ ...menu, contextInputs: [] } as Menu} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd editor && npm test -- --run src/features/canvas/properties/SourceShapingEditor.test.tsx src/features/canvas/properties/MenuDataSection.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `SourceShapingEditor`**

Create `editor/src/features/canvas/properties/SourceShapingEditor.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import type { ContextInput } from "@/domain/types";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

type SourceRefInput = Extract<ContextInput, { kind: "sourceRef" }>;

interface SourceShapingEditorProps {
  input: SourceRefInput;
  /** Declared field names from the server schema — [] falls back to free input. */
  schemaFields: string[];
  /** Menu arg names, offered as `{arg}` value suggestions. */
  argNames: string[];
  onChange: (patch: Partial<SourceRefInput>) => void;
}

/**
 * Visual editor over the existing runtime shaping (`filter` equality +
 * `{arg}` interpolation, single-key `sort`, `limit`) — no runtime change,
 * imported YAML values become editable and round-trip unchanged.
 */
export function SourceShapingEditor({ input, schemaFields, argNames, onChange }: SourceShapingEditorProps) {
  const { t } = useTranslation();
  const fieldsListId = useId();
  const valuesListId = useId();
  // Local entries: editing a field name must not collapse rows with equal
  // interim names — the record is rebuilt on every emit.
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(input.filter ?? {}));
  useEffect(() => {
    setRows(Object.entries(input.filter ?? {}));
    // Re-sync when the input identity changes (source picked / row re-created).
  }, [input.ref, input.name]);

  const emit = (next: [string, string][]) => {
    setRows(next);
    const named = next.filter(([k]) => k !== "");
    onChange({ filter: named.length > 0 ? Object.fromEntries(named) : undefined });
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--border-soft)] pt-1.5">
      <datalist id={fieldsListId} data-testid="filter-field-options">
        {schemaFields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id={valuesListId} data-testid="filter-value-options">
        {argNames.map((a) => (
          <option key={a} value={`{${a}}`} />
        ))}
      </datalist>

      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.filterSection")}
      </div>
      {rows.map(([field, value], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while editing
        <div key={i} className="flex items-center gap-1.5">
          <Input
            data-testid="filter-field"
            value={field}
            list={fieldsListId}
            placeholder={t("menuProperties.filterFieldPlaceholder")}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            className="h-7 w-24 px-2 py-0 font-mono text-xs"
          />
          <span className="text-[10px] text-[var(--text-faint)]">=</span>
          <Input
            data-testid="filter-value"
            value={value}
            list={valuesListId}
            placeholder={t("menuProperties.filterValuePlaceholder")}
            onChange={(e) => emit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            className="h-7 flex-1 px-2 py-0 font-mono text-xs"
          />
          <button
            type="button"
            title={t("menuProperties.filterRemove")}
            onClick={() => emit(rows.filter((_, j) => j !== i))}
            className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-[var(--text-faint)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="filter-add"
        onClick={() => emit([...rows, ["", ""]])}
        className="self-start rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("menuProperties.filterAdd")}
      </button>

      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("menuProperties.sortLabel")}:</span>
        <Input
          data-testid="sort-by"
          value={input.sort?.by ?? ""}
          list={fieldsListId}
          placeholder={t("menuProperties.sortNone")}
          onChange={(e) =>
            onChange({
              sort: e.target.value === "" ? undefined : { by: e.target.value, direction: input.sort?.direction ?? "asc" },
            })
          }
          className="h-7 w-24 px-2 py-0 font-mono text-xs"
        />
        <select
          data-testid="sort-direction"
          value={input.sort?.direction ?? "asc"}
          disabled={!input.sort?.by}
          onChange={(e) =>
            input.sort?.by
              ? onChange({ sort: { by: input.sort.by, direction: e.target.value as "asc" | "desc" } })
              : undefined
          }
          className="h-7 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)] disabled:opacity-40"
        >
          <option value="asc">{t("menuProperties.sortAsc")}</option>
          <option value="desc">{t("menuProperties.sortDesc")}</option>
        </select>
        <span className="ml-2 font-mono text-[10px] text-[var(--text-faint)]">{t("menuProperties.limitLabel")}:</span>
        <Input
          data-testid="limit-input"
          type="number"
          min={1}
          value={input.limit ?? ""}
          onChange={(e) => onChange({ limit: e.target.value === "" ? undefined : Number(e.target.value) })}
          className="h-7 w-16 px-2 py-0 font-mono text-xs"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `MenuDataSection`**

Create `editor/src/features/canvas/properties/MenuDataSection.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import type { ContextInput, Menu } from "@/domain/types";
import { previewDataSource, type PreviewResult } from "@/lib/api/dataSources";
import { useNetworksStore } from "@/state/networksStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServersStore } from "@/state/serversStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type SourceRefInput = Extract<ContextInput, { kind: "sourceRef" }>;

const ARG_TOKEN = /\{([a-z][a-z0-9_]*)\}/g;

/** `{arg}` tokens appearing in an input's filter/params values, deduped + sorted. */
export function extractArgTokens(input: SourceRefInput): string[] {
  const tokens = new Set<string>();
  const values = [...Object.values(input.filter ?? {}), ...Object.values(input.params ?? {})];
  for (const v of values) {
    for (const m of v.matchAll(ARG_TOKEN)) tokens.add(m[1]!);
  }
  return [...tokens].sort();
}

function summarizeShaping(input: SourceRefInput, t: (k: string) => string): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input.filter ?? {})) parts.push(`${k} = ${v}`);
  if (input.sort?.by) parts.push(`${t("menuProperties.sortLabel")} ${input.sort.by} ${input.sort.direction ?? "asc"}`);
  if (input.limit != null) parts.push(`${t("menuProperties.limitLabel")} ${input.limit}`);
  return parts.length > 0 ? parts.join(" · ") : t("menuProperties.menuDataNoFilters");
}

/** "Données du menu": one card per consumed source, live preview with the menu's filters. */
export function MenuDataSection({ menu }: { menu: Menu }) {
  const { t } = useTranslation();
  const sourceInputs = (menu.contextInputs ?? []).filter(
    (i): i is SourceRefInput => i.kind === "sourceRef" && !!i.ref,
  );
  if (sourceInputs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="menu-data-section">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
        {t("menuProperties.menuData")}
      </div>
      {sourceInputs.map((input) => (
        <MenuSourceCard key={`${input.name}:${input.ref}`} input={input} />
      ))}
    </div>
  );
}

type PreviewState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; result: PreviewResult };

function MenuSourceCard({ input }: { input: SourceRefInput }) {
  const { t } = useTranslation();
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);
  const serverSource = useServerDataSourcesStore((s) => s.sources.find((x) => x.ref === input.ref));
  const argTokens = extractArgTokens(input);
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const isLocal = input.ref.startsWith("pack:");

  const runPreview = async () => {
    if (!networkId || !serverId) return;
    setPreview({ kind: "loading" });
    const result = await previewDataSource(networkId, serverId, {
      ref: input.ref,
      params: input.params,
      filter: input.filter,
      sort: input.sort,
      limit: input.limit,
      args: testArgs,
    });
    setPreview({ kind: "done", result });
  };

  const errorLabel = (error: string, message: string | null): string => {
    switch (error) {
      case "server_offline": return t("dataSources.errServerOffline");
      case "fetch_timeout": return t("dataSources.errTimeout");
      case "unknown_source": return t("dataSources.errUnknownSource");
      case "player_required": return t("dataSources.errPlayerRequired");
      default: return t("dataSources.errFetchError", { message: message ?? "?" });
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)]/40 p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-xs">{input.ref}</span>
        {serverSource?.moduleId ? <Badge className="ml-auto">{serverSource.moduleId}</Badge> : null}
      </div>
      <div className="text-[10px] text-[var(--text-mut)]">{summarizeShaping(input, t)}</div>
      {isLocal ? (
        <div className="text-[10px] text-[var(--text-faint)]">{t("menuProperties.menuDataLocalHint")}</div>
      ) : (
        <>
          {argTokens.length > 0 ? (
            <div className="flex flex-col gap-1">
              {argTokens.map((token) => (
                <label key={token} className="flex items-center gap-1.5 text-[10px] text-[var(--text-mut)]">
                  <span className="font-mono">{t("menuProperties.testArgHint", { token: `{${token}}` })}</span>
                  <Input
                    data-testid={`test-arg-${token}`}
                    value={testArgs[token] ?? ""}
                    onChange={(e) => setTestArgs((prev) => ({ ...prev, [token]: e.target.value }))}
                    className="h-6 w-24 px-2 py-0 font-mono text-[10px]"
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div>
            <button
              type="button"
              data-testid="menu-data-preview"
              disabled={preview.kind === "loading"}
              onClick={runPreview}
              className="rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2 py-1 text-[10px] text-[var(--brand)] hover:bg-[var(--brand)]/20 disabled:opacity-50"
            >
              {preview.kind === "loading" ? t("dataSources.previewLoading") : t("dataSources.preview")}
            </button>
          </div>
          {preview.kind === "done" && preview.result.ok ? (
            <DataTable
              rows={preview.result.rows}
              truncated={preview.result.truncated}
              truncatedLabel={t("dataSources.previewTruncated")}
              emptyLabel={t("dataSources.previewEmpty")}
            />
          ) : null}
          {preview.kind === "done" && !preview.result.ok ? (
            <div className="rounded border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-2 py-1 text-[10px] text-[var(--warning)]">
              {errorLabel(preview.result.error, preview.result.message)}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount in `MenuProperties.tsx`**

In `editor/src/features/canvas/properties/MenuProperties.tsx`:
1. Import `SourceShapingEditor` and `MenuDataSection`.
2. In `MenuProperties`, after `<ContextInputsEditor projectId={projectId} menu={menu} />`, add `<MenuDataSection menu={menu} />`.
3. `SourceRefInputRow` gains a `menu: Menu` prop (pass `menu={menu}` from `ContextInputsEditor`, which already closes over `menu`). At the end of `SourceRefInputRow`'s JSX (wrap the current single-row `<div>` and the new editor in a fragment), append:

```tsx
      <SourceShapingEditor
        input={input}
        schemaFields={(serverSources.find((s) => s.ref === input.ref)?.schema ?? []).map((f) => f.name)}
        argNames={(menu.contextInputs ?? [])
          .filter((ci): ci is Extract<ContextInput, { kind: "primitive" }> => ci.kind === "primitive")
          .map((ci) => ci.name)
          .filter((n) => n !== "")}
        onChange={onChange}
      />
```

with `const serverSources = useServerDataSourcesStore((s) => s.sources);` added inside `SourceRefInputRow` (the store is already imported in this file).

- [ ] **Step 6: i18n keys (en + fr, same commit)**

Append inside the `menuProperties` block of `editor/src/locales/en.ts`:

```ts
    filterSection: "Filters",
    filterAdd: "+ Add filter",
    filterFieldPlaceholder: "field",
    filterValuePlaceholder: "value or {arg}",
    filterRemove: "Remove this filter",
    sortLabel: "sort",
    sortNone: "none",
    sortAsc: "asc",
    sortDesc: "desc",
    limitLabel: "limit",
    menuData: "Menu data",
    menuDataNoFilters: "No filter — full source.",
    menuDataLocalHint: "Project data — see the Data tab.",
    testArgHint: "filter uses {{token}} — test value:",
```

And in `editor/src/locales/fr.ts`:

```ts
    filterSection: "Filtres",
    filterAdd: "+ Ajouter un filtre",
    filterFieldPlaceholder: "champ",
    filterValuePlaceholder: "valeur ou {arg}",
    filterRemove: "Retirer ce filtre",
    sortLabel: "tri",
    sortNone: "aucun",
    sortAsc: "asc",
    sortDesc: "desc",
    limitLabel: "limite",
    menuData: "Données du menu",
    menuDataNoFilters: "Aucun filtre — source complète.",
    menuDataLocalHint: "Données du projet — voir l'onglet Data.",
    testArgHint: "filtre sur {{token}} — valeur d'essai :",
```

- [ ] **Step 7: Run the editor suite**

Run: `cd editor && npm test -- --run`
Expected: PASS — including existing export/import round-trip tests (the sourceRef domain shape and the YAML transform are untouched; only the UI writes the previously opaque fields).

- [ ] **Step 8: Docs + commit**

`docs/architecture/editor-internals.md`: in the menu-properties/édition section, add a short paragraph — `SourceShapingEditor` (filtre égalité + `{arg}`, tri mono-clé, limite ; autocomplétion depuis le schéma serveur + args du menu) and `MenuDataSection` (« Données du menu » : carte par source consommée, preview live via `POST …/data-sources/preview` avec valeurs d'essai pour `{arg}`).

```bash
git add editor/src/features/canvas/properties/SourceShapingEditor.tsx editor/src/features/canvas/properties/SourceShapingEditor.test.tsx editor/src/features/canvas/properties/MenuDataSection.tsx editor/src/features/canvas/properties/MenuDataSection.test.tsx editor/src/features/canvas/properties/MenuProperties.tsx editor/src/locales/en.ts editor/src/locales/fr.ts docs/architecture/editor-internals.md
git commit -m "feat(editor): visual filter/sort/limit editor + menu data preview section"
```

---

### Task 7: User docs, CHANGELOG proofread, manual validation checklist

**Files:**
- Create: `docs-site/src/content/docs/editor/data-sources.md`
- Create: `docs/superpowers/specs/2026-07-14-data-source-explorer-validation.md`
- Modify: `CHANGELOG.md` (proofread the three entries added by Tasks 1–3 into one coherent Unreleased block)

- [ ] **Step 1: Write the user doc page**

Create `docs-site/src/content/docs/editor/data-sources.md` (match frontmatter style of sibling pages in `docs-site/src/content/docs/editor/` — check one before writing):

```markdown
---
title: Data sources
description: Explore server data sources, preview live rows, and filter them per menu.
---

Modules installed on your server (the Boutique Add-on, third-party plugins…) can expose **data sources** — live lists of rows such as shop items or quests. The editor's **Data** tab shows them under **Server sources**, grouped by the module that declares them.

## Explore a source

Select a source to see:

- its **ref** (e.g. `boutique:items`) — copy it to reference the source anywhere,
- its **schema**: the fields each row declares (name, type, description),
- a **Preview** button that fetches real rows from your connected server (up to 50 rows; larger results are truncated).

Previews run without a player context. Sources that require an online player show a "needs an online player" notice instead of rows. If the server is offline, the schema stays visible but live preview is disabled. A timeout usually means the plugin needs an update or the server is unreachable.

## Filter a source in a menu

In a menu's properties, each **Source ref** context input now has a visual editor:

- **Filters** — `field = value` rows. Fields autocomplete from the declared schema; values can be literals (`armes`) or menu args in braces (`{group}`).
- **Sort** — a field plus `asc`/`desc`.
- **Limit** — maximum number of rows.

These map 1:1 to the runtime behavior: the preview shows exactly what players will get.

## Menu data

Below the context inputs, the **Menu data** section lists every source the menu consumes with its active filters. **Preview** applies those filters live. When a filter uses `{arg}`, type a test value first — it substitutes the arg the way a real menu call would.
```

- [ ] **Step 2: Proofread CHANGELOG**

Read `CHANGELOG.md` `[Unreleased]`: merge/order the Task 1–3 entries under a single feature heading `### Added — data source explorer, live preview & menu filters` (keep the per-layer bullets), fix any duplication, verify the migration file number referenced by the Task 2 bullet matches the committed file in `backend/drizzle/`.

- [ ] **Step 3: Write the manual validation checklist**

Create `docs/superpowers/specs/2026-07-14-data-source-explorer-validation.md`:

```markdown
# Data source explorer — manual validation checklist (Docker cross-stack)

Setup: `docker compose up` (backend + editor + minecraft), server linked, Boutique Add-on (or any module registering a data source with a schema) installed.

## Explorer (Data tab)
- [ ] "Sources du serveur" section lists the module's sources, grouped with the module badge; core sources first, no-module sources under "Serveur".
- [ ] Source detail shows the schema table (name/type/description) and a copyable ref.
- [ ] "Prévisualiser" returns real rows (≤ 50); a >50-row source shows the "tronqué" note.
- [ ] Stop the MC container → schema + badges remain visible, preview disabled with the offline explanation; REST preview returns 503.
- [ ] A player-dependent source shows the player_required message.
- [ ] With an old plugin JAR (pre data_source_fetch) → preview fails with the timeout message after ~5 s (504).

## Menu filters
- [ ] Import a project whose menu YAML has `source.filter/sort/limit` → values appear in the visual editor; export round-trips byte-identical shaping.
- [ ] Add filter `group = {group}` via autocomplete (schema field + menu arg suggestion).
- [ ] "Données du menu" card shows ref + module badge + filter summary.
- [ ] Preview with a test value for `{group}` returns the filtered rows; in-game `/artisan menu …` with the same arg matches the preview.
- [ ] Preview with the test value left empty matches runtime behavior (unresolved `{group}` stays literal → no rows match).

## Regression
- [ ] Menu rendering with data sources (iteration) unchanged in game.
- [ ] `hello` from an old plugin (schema_hint only) still populates the source picker.
```

- [ ] **Step 4: Full verification run**

Run all three suites and expect PASS:
- `cd plugin && ./gradlew test`
- `cd backend && bun run test` (⚠️ never `bun test`)
- `cd editor && npm test -- --run`

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/content/docs/editor/data-sources.md docs/superpowers/specs/2026-07-14-data-source-explorer-validation.md CHANGELOG.md
git commit -m "docs: data source explorer user guide + manual validation checklist"
```

---

## Self-review (done at plan-writing time)

- **Spec coverage**: §1 API plugin → Task 1 (+Task 2 persistence/REST); §2 preview path → Tasks 3 (backend) + 4 (plugin); §3 explorer → Task 5; §4 menu-side → Task 6; Tests section → per-task test cycles; docs/same-commit policy → embedded in each task + Task 7. Hors-scope items excluded everywhere (no player selector, no canvas data, no DSL, no hard scoping, no realtime push).
- **Placeholder scan**: every code step shows complete code; the two "follow the file's existing pattern" notes (DesignSystemPage specimen placement, docs-site frontmatter) include the concrete content to insert.
- **Type consistency**: `ReportedDataSource` (T2) matches `DataSourceReport.build` output (T1); `DataSourceFetchMessage`/`DataSourceFetchResultMessage` (T3) match the plugin handler's parsing/reply (T4) and the REST relay consumed by `previewDataSource` (T5/T6); `ServerDataSource {ref, moduleId, schema, schemaHint}` (T5) is what `groupServerSources`, `ServerSourceDetail`, `MenuDataSection` and `SourceShapingEditor.schemaFields` consume (T5/T6).
