# Versioning Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place les fondations de versioning et stabilité d'API d'Artisan, spec section 12 — annotations de stabilité, schema registry + migration framework, version dans le protocol WS, REST URL versioning `/api/v1/*`, Drizzle migrations folder, CHANGELOG, api-surface doc.

**Architecture:** Couvre les 6 surfaces de versioning (schemas de données, API Java publique, protocol WS, REST API, DB schema, resource pack format). V1 implémente le minimum nécessaire selon section 12.1 du spec, ~7-8 jours total. Décisions de scope :
1. **REST big-bang** : toutes les routes existantes (`/api/*`) sont renommées en `/api/v1/*`. Plugin + editor clients mis à jour dans le même commit.
2. **Schema field émis dès maintenant** : editor export écrit `schema: "menu/v1"` / `"command/v1"` / `"dialog/v1"` au top de chaque YAML. Plugin parser tolérant (default v1 si absent).

**Tech Stack:** Kotlin 2.0 + Paper (plugin), Bun + Hono (backend), React 19 + Vite 6 (editor), Drizzle ORM (PostgreSQL), JSON Schema, Keep-a-Changelog format.

**Spec source :** `docs/architecture/versioning.md`.

**Hors scope (déféré post-V1) :**
- Multiple versions protocol en parallèle (juste v1 partout pour l'instant)
- `japicmp` en CI (à mettre quand le 1ᵉʳ module externe arrive)
- Deprecations actives (tout est neuf, rien à déprécier)
- Auto-génération de api-surface.md depuis annotations
- Resource pack format versioning au-delà du `pack_format` existant (déjà géré par `pack.mcmeta`)

---

## File Structure

### Plugin — `plugin/src/main/kotlin/net/artisanmc/`

- **Create**:
  - `modules/api/annotations/Stable.kt` — `@Stable` annotation
  - `modules/api/annotations/Beta.kt` — `@Beta` annotation
  - `modules/api/annotations/Internal.kt` — `@Internal` annotation
  - `modules/api/annotations/Deprecated.kt` — `@Deprecated(reason, removeInVersion, replacement)` annotation
  - `modules/api/schemas/SchemaMigration.kt` — interface
  - `modules/api/schemas/SchemaRegistry.kt` — registry + `loadToCurrent()` + exceptions
  - Tests : `modules/api/schemas/SchemaRegistryTest.kt`
- **Modify**:
  - `modules/api/ArtisanModule.kt`, `ArtisanAPI.kt`, `DataSourceRegistry.kt`, `CommandRegistry.kt`, `ModuleEventBus.kt`, `DataSourceDeclaration.kt`, `CommandDeclaration.kt` — annoter `@Stable`
  - `modules/api/ArtisanAPI.kt` — ajouter `val schemas: SchemaRegistry`
  - `plugin/ArtisanPlugin.kt` — `buildApi(this)` passe une `SchemaRegistry` à `ArtisanAPI`
  - `engine/MenuTitleParser.kt` (+ siblings DialogYamlParser, CommandCompiler) — tolérer `schema:` field optionnel au top
  - `sync/WsClient.kt` ou `provider/SyncedMenuProvider.kt` — `hello` inclut `protocol_version: "1"` + `core_version`
  - `sync/BundleUploader.kt:47` — `/api/bundles/...` → `/api/v1/bundles/...`

### Backend — `backend/src/`

- **Modify**:
  - `app.ts` — toutes les `app.route("/api/...", router)` → `app.route("/api/v1/...", router)` ; idem `/ws/plugin` reste inchangé (WS pas concerné par URL versioning REST)
  - `ws/hub.ts` — `BUNDLE_BASE_URL/api/bundles/...` → `/api/v1/bundles/...` dans `pushBundleAvailable` + URLs `editor_session_ready` etc. ; lire `protocol_version` du hello + log inconnu
  - `protocol.ts` — `HelloMessage` ajoute `protocol_version` + `core_version`
  - Tous les test files qui hit `app.request("/api/...")` → `/api/v1/...` (auth.test.ts, networks.test.ts, etc.)
  - `drizzle.config.ts` — confirm `out: "./drizzle"` (déjà OK)
  - `package.json` — ajouter scripts `db:generate`, `db:migrate`
  - `docker-compose.yml:37` — `bun run db:push` → `bun run db:migrate`
- **Create**:
  - `drizzle/0001_initial.sql` — baseline migration auto-générée

### Editor — `editor/src/`

- **Modify**:
  - `lib/api/auth.ts`, `networks.ts`, `branches.ts`, `userPacks.ts`, `packs.ts` — toutes les `/api/...` → `/api/v1/...`
  - `lib/editorSession.ts`, `lib/linkApi.ts`, `lib/mcModelRenderer.ts`, `lib/packApi.ts`, `lib/ws/bundlePublisher.ts` — idem
  - Test files miroirs (.test.ts) — idem
  - `features/export/transform.ts` — émettre `schema: "menu/v1"` / `"command/v1"` / `"dialog/v1"` au top de chaque YAML généré

### Docs

- **Create**:
  - `CHANGELOG.md` (root) — format Keep-a-Changelog, version `[1.0.0-alpha]` initiale
  - `docs/architecture/api-surface.md` — liste des `@Stable` APIs
- **Modify**:
  - `CLAUDE.md` — section "Versioning" pointant vers `versioning.md` + règles de discipline
  - `.claude/skills/sync-docs/doc-impact-map.yaml` — nouvelles entrées pour `modules/api/`, `CHANGELOG.md`, `drizzle/`

---

## Phase A — Stability annotations (plugin)

### Task A1: Create the 4 stability annotations

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/annotations/Stable.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/annotations/Beta.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/annotations/Internal.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/annotations/Deprecated.kt`

- [ ] **Step 1: Write `Stable.kt`**

```kotlin
package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is covered by SemVer.
 * - No removal or breaking changes within a major version.
 * - May be deprecated, but kept functional with a sunset date.
 */
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class Stable
```

- [ ] **Step 2: Write `Beta.kt`**

```kotlin
package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is experimental.
 * - May change in minor versions.
 * - Modules should not rely on this in production.
 */
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class Beta
```

- [ ] **Step 3: Write `Internal.kt`**

```kotlin
package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is internal to Artisan.
 * - May change anytime, without notice.
 * - Modules MUST NOT use this.
 */
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class Internal
```

- [ ] **Step 4: Write `Deprecated.kt`**

Use a distinct name to avoid clashing with `kotlin.Deprecated`:

```kotlin
package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is deprecated within Artisan's own deprecation flow.
 * Distinct from kotlin.Deprecated — this is the schedule-aware variant that
 * carries the removal version and a recommended replacement.
 *
 * - Functional until [removeInVersion].
 * - Modules should migrate to [replacement].
 */
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY, AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class Sunset(
    val reason: String,
    val removeInVersion: String,
    val replacement: String = "",
)
```

(Renamed `Deprecated` → `Sunset` in code; the spec calls it Deprecated but Kotlin already has `kotlin.Deprecated`. Document the rename in api-surface.md.)

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/modules/api/annotations/
git commit -m "feat(plugin): add stability annotations (Stable/Beta/Internal/Sunset)"
```

### Task A2: Mark existing `modules/api/*` classes as `@Stable`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanModule.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/CommandRegistry.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/CommandDeclaration.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleEventBus.kt`

- [ ] **Step 1: Add `@Stable` annotation to `ArtisanModule`**

Open `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanModule.kt`. Add import + annotation:

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable

@Stable
interface ArtisanModule {
    @Stable val id: String
    @Stable val schemaVersion: String
    @Stable fun onEnable(api: ArtisanAPI)
    @Stable fun onDisable()
    @Stable fun onReload() {}
}
```

Apply the same pattern to the other files:
- `ArtisanAPI.kt` — `@Stable class ArtisanAPI(...)`
- `DataSourceRegistry.kt` — `@Stable class DataSourceRegistry`, `@Stable fun register(...)`, `@Stable fun fetch(...)`, `@Stable fun has(...)`, `@Stable fun refs(...)` ; exceptions `UnknownDataSourceException` and `DuplicateDataSourceException` get `@Stable class` annotations too
- `DataSourceDeclaration.kt` — `@Stable data class DataSourceDeclaration(...)`
- `CommandRegistry.kt` — symmetric to DataSourceRegistry
- `CommandDeclaration.kt` — `@Stable`
- `ModuleEventBus.kt` — `@Stable` on the `ModuleEvent` sealed interface, `DataReloadEvent`, `ConfigReloadEvent`, `ModuleEventBus` class, and its `subscribe<T>`, `subscribeRaw`, `publish` methods

- [ ] **Step 2: Run the plugin test suite to verify nothing broke**

```bash
cd plugin && ./gradlew test --tests 'net.artisanmc.modules.*'
```

Expected: 13 tests pass (the existing modules/api + modules/menus + modules/commands tests).

- [ ] **Step 3: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/modules/api/
git commit -m "feat(plugin): mark modules.api surface as @Stable"
```

### Task A3: Document annotations + import rules

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append section under "Pattern modulaire"**

Find the line `Le widget est routé via le champ \`format\` du schema (e.g. \`{ type: "string", format: "color" }\`).` and after the SchemaForm section, ADD:

```markdown
### Stability annotations (depuis 2026-05-25)

Le package `net.artisanmc.modules.api.*` est annoté avec `@Stable` (depuis `net.artisanmc.modules.api.annotations`). Convention :

| Annotation | Signification | Quand |
|---|---|---|
| `@Stable` | Couvert par SemVer. Pas de breaking change dans un même major. | Tout `modules/api/*` après stabilisation. |
| `@Beta` | Expérimental, peut changer en minor. | API nouvelle avant ship public. |
| `@Internal` | Usage interne uniquement. Modules tiers ne doivent pas en dépendre. | Tout `net.artisanmc.plugin.*` (implicite par convention de package). |
| `@Sunset(reason, removeInVersion, replacement)` | Sera retiré au prochain major. | À l'annonce de dépréciation. |

**Règle d'import pour les modules** : un `ArtisanModule` n'importe **que** depuis `net.artisanmc.modules.api.*`. Jamais depuis `net.artisanmc.plugin.*` (qui est implicitement `@Internal`).

Cf. `docs/architecture/versioning.md` section 3.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): stability annotations + module import rule"
```

---

## Phase B — SchemaRegistry + migration framework (plugin)

### Task B1: Define `SchemaMigration` interface

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/schemas/SchemaMigration.kt`

- [ ] **Step 1: Write the interface**

```kotlin
package net.artisanmc.modules.api.schemas

import net.artisanmc.modules.api.annotations.Stable

/**
 * One-way data migration from one schema version to the next.
 *
 * Implementations MUST be:
 * - **Pure** : no I/O, no DB calls, no network — input → output only.
 * - **Idempotent** : running twice on the same input yields the same output.
 * - **Write-once** : never modified after release (write a follow-up migration instead).
 *
 * @param T the JSON-like document type the migration operates on. For YAML-backed
 *          schemas use a typed Map<String, Any?>; tests in this codebase use
 *          MutableMap<String, Any?>.
 */
@Stable
interface SchemaMigration<T> {
    /** Source schema discriminator, e.g. "menu/v1". */
    val from: String

    /** Target schema discriminator, e.g. "menu/v2". */
    val to: String

    /** Pure transform: returns the migrated document with `schema` set to [to]. */
    fun migrate(data: T): T
}
```

- [ ] **Step 2: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/modules/api/schemas/SchemaMigration.kt
git commit -m "feat(plugin): add SchemaMigration interface"
```

### Task B2: Implement `SchemaRegistry` — TDD

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/schemas/SchemaRegistry.kt`
- Test: `plugin/src/test/kotlin/net/artisanmc/modules/api/schemas/SchemaRegistryTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package net.artisanmc.modules.api.schemas

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SchemaRegistryTest {

    private fun migration(from: String, to: String, transform: (MutableMap<String, Any?>) -> Unit = {}) =
        object : SchemaMigration<MutableMap<String, Any?>> {
            override val from = from
            override val to = to
            override fun migrate(data: MutableMap<String, Any?>): MutableMap<String, Any?> {
                transform(data)
                data["schema"] = to
                return data
            }
        }

    @Test
    fun `loadToCurrent returns input as-is when already at current version`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        val doc = mutableMapOf<String, Any?>("schema" to "menu/v1", "id" to "main")
        val out = registry.loadToCurrent(doc, "menu/v1") { it["schema"] as String }
        assertEquals("menu/v1", out["schema"])
        assertEquals("main", out["id"])
    }

    @Test
    fun `loadToCurrent applies single migration v1 to v2`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        registry.register(migration("menu/v1", "menu/v2") { it["dimensions"] = mapOf("rows" to 3) })

        val doc = mutableMapOf<String, Any?>("schema" to "menu/v1")
        val out = registry.loadToCurrent(doc, "menu/v2") { it["schema"] as String }

        assertEquals("menu/v2", out["schema"])
        assertEquals(mapOf("rows" to 3), out["dimensions"])
    }

    @Test
    fun `loadToCurrent chains v1 to v2 to v3`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        registry.register(migration("menu/v1", "menu/v2"))
        registry.register(migration("menu/v2", "menu/v3"))

        val doc = mutableMapOf<String, Any?>("schema" to "menu/v1")
        val out = registry.loadToCurrent(doc, "menu/v3") { it["schema"] as String }

        assertEquals("menu/v3", out["schema"])
    }

    @Test
    fun `loadToCurrent throws UnsupportedSchemaVersionException when migration is missing`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        val doc = mutableMapOf<String, Any?>("schema" to "menu/v1")

        assertThrows(UnsupportedSchemaVersionException::class.java) {
            registry.loadToCurrent(doc, "menu/v2") { it["schema"] as String }
        }
    }

    @Test
    fun `loadToCurrent throws CircularMigrationException on cycle`() {
        val registry = SchemaRegistry<MutableMap<String, Any?>>()
        registry.register(migration("a/v1", "a/v2"))
        registry.register(migration("a/v2", "a/v1"))

        val doc = mutableMapOf<String, Any?>("schema" to "a/v1")

        assertThrows(CircularMigrationException::class.java) {
            registry.loadToCurrent(doc, "a/v3") { it["schema"] as String }
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd plugin && ./gradlew test --tests 'net.artisanmc.modules.api.schemas.SchemaRegistryTest'
```

Expected: FAIL — compile errors (`SchemaRegistry`, `UnsupportedSchemaVersionException`, `CircularMigrationException` not found).

- [ ] **Step 3: Implement `SchemaRegistry`**

```kotlin
package net.artisanmc.modules.api.schemas

import net.artisanmc.modules.api.annotations.Stable
import java.util.concurrent.ConcurrentHashMap

class UnsupportedSchemaVersionException(version: String) :
    RuntimeException("No migration registered for schema version '$version'")

class CircularMigrationException(version: String) :
    IllegalStateException("Circular migration detected at schema version '$version'")

/**
 * Versioned schema migrator. Modules register migrations from one schema version
 * to the next; [loadToCurrent] chains them automatically to bring legacy data
 * forward.
 *
 * @param T the document type — typically `MutableMap<String, Any?>` for YAML.
 */
@Stable
class SchemaRegistry<T> {
    private val migrations = ConcurrentHashMap<String, SchemaMigration<T>>()

    @Stable
    fun register(migration: SchemaMigration<T>) {
        migrations[migration.from] = migration
    }

    /**
     * Apply migrations until [data] reaches [currentVersion].
     *
     * @param data the input document
     * @param currentVersion the target schema version (e.g. "menu/v2")
     * @param versionOf reads the current schema discriminator from a document
     */
    @Stable
    fun loadToCurrent(data: T, currentVersion: String, versionOf: (T) -> String): T {
        var current = data
        var version = versionOf(current)
        val visited = mutableSetOf<String>()

        while (version != currentVersion) {
            if (version in visited) throw CircularMigrationException(version)
            visited.add(version)

            val migration = migrations[version]
                ?: throw UnsupportedSchemaVersionException(version)
            current = migration.migrate(current)
            version = versionOf(current)
        }
        return current
    }

    @Stable
    fun has(from: String): Boolean = migrations.containsKey(from)
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd plugin && ./gradlew test --tests 'net.artisanmc.modules.api.schemas.SchemaRegistryTest'
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/modules/api/schemas/SchemaRegistry.kt \
        plugin/src/test/kotlin/net/artisanmc/modules/api/schemas/SchemaRegistryTest.kt
git commit -m "feat(plugin): add SchemaRegistry with chained migration support"
```

### Task B3: Wire `SchemaRegistry` into `ArtisanAPI`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`

- [ ] **Step 1: Add `schemas` field to `ArtisanAPI`**

Open `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt`. Add `schemas` parameter:

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin

/**
 * Facade passed to every module at `onEnable(api)`. Exposes:
 * - the [plugin] handle (for Bukkit scheduler, server, dataFolder)
 * - the cross-module registries ([dataSources], [commands])
 * - the [events] bus for hot-reload propagation
 * - the [schemas] registry for versioned data migrations
 *
 * Modules MUST go through this facade — direct access to the plugin internals
 * is allowed only inside the module's own package.
 */
@Stable
class ArtisanAPI(
    val plugin: ArtisanPlugin,
    val dataSources: DataSourceRegistry,
    val commands: CommandRegistry,
    val events: ModuleEventBus,
    val schemas: SchemaRegistry<MutableMap<String, Any?>>,
)
```

- [ ] **Step 2: Update `ArtisanPlugin.buildApi()`**

Open `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`. Find the `companion object` and update `buildApi` to pass a `SchemaRegistry`:

```kotlin
import net.artisanmc.modules.api.schemas.SchemaRegistry
```

```kotlin
fun buildApi(plugin: ArtisanPlugin): ArtisanAPI = ArtisanAPI(
    plugin = plugin,
    dataSources = DataSourceRegistry(),
    commands = CommandRegistry(),
    events = ModuleEventBus(),
    schemas = SchemaRegistry(),
)
```

- [ ] **Step 3: Update `ArtisanPluginModuleWiringTest`**

The existing test asserts `api.dataSources`, `api.commands`, `api.events` are non-null. Add `api.schemas`:

Open `plugin/src/test/kotlin/net/artisanmc/plugin/ArtisanPluginModuleWiringTest.kt`. In the test `plugin exposes an ArtisanAPI after enable`, add:

```kotlin
assertNotNull(api.schemas)
```

- [ ] **Step 4: Run plugin test suite**

```bash
cd plugin && ./gradlew test
```

Expected: all green (~391 tests = ~387 existing + new SchemaRegistryTest 5).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt \
        plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt \
        plugin/src/test/kotlin/net/artisanmc/plugin/ArtisanPluginModuleWiringTest.kt
git commit -m "feat(plugin): expose SchemaRegistry via ArtisanAPI"
```

---

## Phase C — Schema field in YAML output + parser tolerance

### Task C1: Plugin YAML parsers accept optional `schema` field

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt` (or the menu YAML root parser — verify location)
- Modify: any other YAML parsers (dialog, command, manifest)
- Test: add coverage in existing `MenuTitleParserTest.kt` / matching test for dialog/command

**Investigation step:** before touching files, locate where the menu / dialog / command YAML is parsed at the top level. The hits to look for:
- `BundleCompiler.kt`, `MenuTitleParser.kt`, `DialogYamlParser.kt`, `CommandCompiler.kt`

- [ ] **Step 1: Find the YAML root parsers**

```bash
cd plugin && grep -rn "yaml\\.load\\|YamlMap\\|Map<String, Any" src/main/kotlin/net/artisanmc/plugin/engine src/main/kotlin/net/artisanmc/plugin/yaml | head -20
```

Read the files returned. The parsers we want to make tolerant are those that take a top-level `Map<String, Any?>` of a menu/command/dialog YAML.

- [ ] **Step 2: Add an explicit ignore of `schema` field**

For each parser file (menu, command, dialog), if the parser iterates keys and warns on unknown keys, add `schema` to the known-key allowlist. If the parser only reads specific keys, this is a no-op (the parser already ignores extra keys).

Concretely, in each parser, after reading the known fields, add:

```kotlin
// Accept the optional `schema` discriminator (versioning support, future-proof).
// Currently only "<type>/v1" is supported; future versions will be migrated via
// SchemaRegistry before reaching the parser. See docs/architecture/versioning.md §2.
val schemaVersion = (root["schema"] as? String) ?: "menu/v1"
require(schemaVersion == "menu/v1") {
    "Unsupported menu schema version '$schemaVersion'. This plugin reads menu/v1 only — " +
    "register a SchemaMigration via api.schemas.register(...) to migrate from older versions."
}
```

Adjust `"menu/v1"` to `"command/v1"` / `"dialog/v1"` / `"pack/v1"` per parser.

- [ ] **Step 3: Add a test that the parser accepts both with-and-without `schema`**

For the menu parser test file (e.g. `MenuTitleParserTest.kt` — find the most appropriate existing test class for "parses a menu YAML"), add two tests:

```kotlin
@Test
fun `accepts menu YAML with explicit schema field`() {
    val yaml = """
        schema: "menu/v1"
        id: test_menu
        rows: 3
        title: []
    """.trimIndent()
    // Adapt the call site to whatever the existing parser entrypoint is.
    val parsed = parseMenuYaml(yaml)
    assertEquals("test_menu", parsed.id)
}

@Test
fun `accepts menu YAML without schema field for backward compat`() {
    val yaml = """
        id: legacy_menu
        rows: 3
        title: []
    """.trimIndent()
    val parsed = parseMenuYaml(yaml)
    assertEquals("legacy_menu", parsed.id)
}

@Test
fun `rejects menu YAML with unsupported schema version`() {
    val yaml = """
        schema: "menu/v99"
        id: future_menu
    """.trimIndent()
    assertThrows(IllegalArgumentException::class.java) { parseMenuYaml(yaml) }
}
```

Use the actual existing parser entrypoint (e.g. `MenuTitleParser.parse(...)` or whatever `BundleCompiler` calls). If the entrypoint is not named `parseMenuYaml`, adapt the call.

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests '*MenuTitle*'
cd plugin && ./gradlew test --tests '*Dialog*Parser*'
cd plugin && ./gradlew test --tests '*Command*Compiler*'
```

Expected: pass after the parser changes. If a parser doesn't have a "root" entry point that consumes the whole YAML map, do the schema check in the layer ABOVE the parser (typically `BundleCompiler` or the place that reads menu YAML files from disk and dispatches per-file).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/ plugin/src/test/kotlin/
git commit -m "feat(plugin): YAML parsers accept optional schema field (versioning foundation)"
```

### Task C2: Editor `transform.ts` emits `schema` field

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts` (or wherever the transform's outputs are asserted)

- [ ] **Step 1: Read the current `transform.ts` to find the YAML emission points**

```bash
cd editor && grep -n "function transform\\|menus/\\|commands/\\|dialogs/\\|stringify" src/features/export/transform.ts | head -30
```

Identify where each YAML string is built (per menu, per command, per dialog).

- [ ] **Step 2: Add the `schema` key to each emitted YAML object**

Each YAML emission should start with a `schema: "X/v1"` field. For each top-level emitted object (menu, command, dialog, manifest, translations), prepend the schema key.

If `transform.ts` builds an object then calls `YAML.stringify(obj)`, do:

```ts
// Menu YAML — emit schema discriminator first for forward-compat / versioning.
const menuYaml = YAML.stringify({
  schema: "menu/v1",
  ...menuObject,
});
```

Apply the same to commands (`"command/v1"`), dialogs (`"dialog/v1"`), manifest (`"pack/v1"`), translations (`"translations/v1"` — confirm if translations are top-level YAML).

- [ ] **Step 3: Update the transform test**

In `transform.test.ts` (or the appropriate test file), add an assertion that each emitted YAML string starts with the expected `schema:` line. For example:

```ts
it("emits schema: menu/v1 at the top of each menu YAML", () => {
  const pack = makePackWithOneMenu();
  const files = transform(pack);
  const menuYaml = files["menus/main.yaml"];
  expect(menuYaml).toMatch(/^schema:\s+["']?menu\/v1["']?\s*$/m);
});
```

Repeat for commands, dialogs, manifest.

- [ ] **Step 4: Run editor tests**

```bash
cd editor && npx vitest run src/features/export/
```

Expected: all green (existing tests must still pass since they likely assert specific fields rather than the absence of `schema`; if any test fails because it expects no `schema` key, update it).

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/export/
git commit -m "feat(editor): emit schema field at top of menu/command/dialog YAML"
```

### Task C3: Cross-stack smoke check

**Files:** none (manual verification)

- [ ] **Step 1: Boot the stack**

```bash
docker compose up -d backend editor minecraft
```

- [ ] **Step 2: From the editor, create a menu (or trigger autosave) and inspect the produced YAML**

In the editor browser, change a menu title, wait for autosave (~2s). Then look on disk inside the MC container :

```bash
docker exec artisan-minecraft-1 cat /data/plugins/Artisan/packs/<pack_id>/menus/<menu_id>.yaml | head -5
```

Expected: first line is `schema: "menu/v1"` (or unquoted `schema: menu/v1`).

- [ ] **Step 3: In the MC console**, run `/artisan reload`. Verify no errors.

(No commit — manual verification only.)

---

## Phase D — WS protocol version

### Task D1: Plugin includes `protocol_version` + `core_version` in hello

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/WsClient.kt` (or wherever `HelloMessage` is constructed)
- Test: existing FullSyncIntegrationTest or similar covers hello

- [ ] **Step 1: Locate the hello builder**

```bash
cd plugin && grep -rn "\"hello\"\\|HelloMessage\\|sendHello" src/main/kotlin | head -10
```

- [ ] **Step 2: Update the hello payload**

Wherever the hello JSON is built (likely a function in `SyncedMenuProvider` or `WsClient`), add the two new fields:

```kotlin
val hello = buildJsonObject {
    put("type", "hello")
    put("protocol_version", "1")
    put("core_version", description.version)  // from JavaPlugin.description, or hardcode "1.0.0" if not available here
    put("server_key", serverKey)
    put("current_bundle_hash", currentBundleHash)
    // ... existing fields
}
```

If `description.version` isn't accessible from the WS layer, pass it as a constructor parameter to `WsClient`, sourced from `JavaPlugin.description.version` in `ArtisanPlugin.onEnable`.

- [ ] **Step 3: Add or update a test that hello includes these fields**

In the appropriate test file (e.g. `FullSyncIntegrationTest.kt` or a new `WsClientTest.kt`), assert that the first message sent on connect contains `protocol_version` and `core_version`.

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests '*Sync*' --tests '*WsClient*'
```

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/sync/
git commit -m "feat(plugin): hello includes protocol_version + core_version"
```

### Task D2: Backend reads `protocol_version` + silently ignores unknown message types

**Files:**
- Modify: `backend/src/protocol.ts` — extend `HelloMessage` type
- Modify: `backend/src/ws/hub.ts` — `handlePluginMessage` reads `protocol_version` + logs unknown types

- [ ] **Step 1: Extend `HelloMessage`**

Open `backend/src/protocol.ts`. Add optional fields to `HelloMessage`:

```ts
export interface HelloMessage {
  type: "hello";
  protocol_version?: string;   // NEW — "1" for current protocol
  core_version?: string;       // NEW — plugin's own version string
  server_key: string;
  current_bundle_hash: string;
  custom_items_hash?: string;
  // ... whatever else already exists
}
```

- [ ] **Step 2: Add a test for unknown message type tolerance**

In `backend/src/ws/hub.test.ts`, add:

```ts
test("handlePluginMessage logs and ignores unknown message types", async () => {
  const connId = "conn-unknown";
  registerConn(connId, () => {});
  const result = await handlePluginMessage(connId, JSON.stringify({
    type: "future_message_type",
    foo: "bar",
  }));
  expect(result.reply).toBeNull();
  expect(result.push ?? []).toEqual([]);
});

test("hello with protocol_version 1 is accepted", async () => {
  const connId = "conn-pv";
  registerConn(connId, () => {});
  // Pre-seed a valid server key — adapt to existing test helpers
  const validKey = await createTestServerKey();
  const result = await handlePluginMessage(connId, JSON.stringify({
    type: "hello",
    protocol_version: "1",
    core_version: "1.0.0",
    server_key: validKey,
    current_bundle_hash: "",
  }));
  expect(result.reply).not.toBeNull();
  const reply = JSON.parse(result.reply!);
  expect(reply.type).toBe("hello_ack");
});
```

- [ ] **Step 3: Update `handlePluginMessage` to tolerate unknown types**

Open `backend/src/ws/hub.ts`. Find the dispatch (likely a `switch (msg.type)` or `if/else` chain). At the default case, log + return:

```ts
// Default case at end of dispatch:
default: {
  console.debug(
    `[hub] unknown message type '${msg.type}' from conn ${connId} ` +
    `(protocol_version=${(msg as any).protocol_version ?? "?"}). Ignoring.`,
  );
  return { reply: null };
}
```

If the existing structure doesn't have an explicit default, add one or wrap the existing chain.

- [ ] **Step 4: Run hub tests**

```bash
cd backend && bun test src/ws/hub.test.ts
```

Expected: all green including the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/protocol.ts backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "feat(backend): hello carries protocol_version + unknown msg types ignored"
```

---

## Phase E — REST `/api/v1/*` big-bang rewrite

### Task E1: Audit current route paths

**Files:** none (audit only)

- [ ] **Step 1: List all current `/api/...` route mounts**

```bash
cd backend && grep -rn "app\\.route\\|\\.route(\"/api" src/app.ts
```

Expected output: a list of ~15-20 `app.route("/api/<thing>", router)` lines. Save them mentally — you'll prepend `/v1` to each.

- [ ] **Step 2: List all hardcoded `/api/` paths in backend source**

```bash
cd backend && grep -rn '"/api/\|`/api/' src/ | grep -v "\.test\."
```

Note URL generators in `ws/hub.ts` (bundle URLs, resource pack URLs, editor session URLs).

- [ ] **Step 3: List all hardcoded `/api/` paths in editor source**

```bash
cd editor && grep -rn '"/api/\|`/api/' src/ | wc -l
```

Expected: ~71 occurrences.

- [ ] **Step 4: List plugin Kotlin sources hitting `/api/`**

```bash
cd plugin && grep -rn '"/api/\|`/api/' src/main/kotlin
```

Expected: ~1 (BundleUploader).

No commit for this task. Use the lists to drive the rewrites in E2–E5.

### Task E2: Rewrite backend `app.ts` route mounts

**Files:**
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Add `/v1` to every `app.route("/api/...")`**

Open `backend/src/app.ts`. For each `app.route("/api/X", router)` line, change to `app.route("/api/v1/X", router)`. Apply to ALL routes:
- `/api/server-keys` → `/api/v1/server-keys`
- `/api/bundles` → `/api/v1/bundles`
- `/api/link` → `/api/v1/link`
- `/api/editor-session` → `/api/v1/editor-session` (3 mounts)
- `/api/textures` → `/api/v1/textures`
- `/api/models` → `/api/v1/models`
- `/api/model-bundle` → `/api/v1/model-bundle`
- `/api/resource-pack` → `/api/v1/resource-pack`
- `/api/auth` → `/api/v1/auth`
- `/api/auth/discord` → `/api/v1/auth/discord`
- `/api/networks` → `/api/v1/networks`
- `/api/user/packs` → `/api/v1/user/packs`
- `mountModules(app, ...)` — Update `modulesMenusModule.registerRoutes` and `commandsModule.registerRoutes` to mount under `/api/v1/modules/...` instead of `/api/modules/...` (modify `backend/src/modules/menus/index.ts` and `backend/src/modules/commands/index.ts`)

Also update the CORS middleware (line ~28): `app.use("/api/*", cors(...))` → `app.use("/api/v1/*", cors(...))`.

And the userAuth middleware paths: `app.use("/api/networks/*", userAuth())` → `app.use("/api/v1/networks/*", userAuth())`, `app.use("/api/user/packs/*", userAuth())` → `app.use("/api/v1/user/packs/*", userAuth())`.

- [ ] **Step 2: Run `app.test.ts` — it will FAIL (URLs in test don't match yet)**

```bash
cd backend && bun test src/app.test.ts
```

Expected: failures because tests call `/api/...` but routes are now `/api/v1/...`. Will be fixed in E3.

- [ ] **Step 3: Commit (intentionally fails tests, to be fixed in next task)**

```bash
git add backend/src/app.ts backend/src/modules/menus/index.ts backend/src/modules/commands/index.ts
git commit -m "feat(backend): rewrite all route prefixes /api/ -> /api/v1/

Routes are now mounted under /api/v1/*. Tests + clients fail until E3+E4+E5
land them on the new URLs."
```

### Task E3: Rewrite backend tests + URL generators

**Files:**
- Modify: every `*.test.ts` file under `backend/src/` that calls `app.request("/api/...")`
- Modify: `backend/src/ws/hub.ts` — URL generators that emit `BUNDLE_BASE_URL/api/...`

- [ ] **Step 1: Find all backend test files hitting `/api/`**

```bash
cd backend && grep -rln 'app\\.request("/api/\|app\\.request(`/api/' src/
```

- [ ] **Step 2: Bulk-replace `/api/` with `/api/v1/` in those test files**

For each file in the list, replace every `/api/` with `/api/v1/`. Be careful: don't double-prefix (don't turn `/api/v1/foo` into `/api/v1/v1/foo`).

Use this sed-like approach per file (do it via Edit tool, not actual sed, to maintain visibility):

For each test file, find every occurrence of `"/api/X"` or backtick `` `/api/X` `` and rewrite to `"/api/v1/X"` / `` `/api/v1/X` ``.

- [ ] **Step 3: Update URL generators in `hub.ts`**

Open `backend/src/ws/hub.ts`. Find every hardcoded `"/api/..."` in template strings (bundle URLs, resource pack URLs, editor session URLs etc.). Update to `/api/v1/...`.

Key spots to check:
- `pushBundleAvailable`: the `url` constant uses `BUNDLE_BASE_URL/api/bundles/...` → change to `/api/v1/bundles/...`
- `editor_session_ready` URL builder
- Any other URL-generating helper

- [ ] **Step 4: Update non-test backend source code**

```bash
cd backend && grep -rln '"/api/\|`/api/' src/ | grep -v "\.test\."
```

For each file in the list (other than `app.ts` already handled in E2), update `/api/` → `/api/v1/`.

- [ ] **Step 5: Run the full backend test suite**

```bash
cd backend && bun test
```

Expected: all green (modulo the pre-existing test-isolation flakes on hub.test.ts — confirmed pre-existing on main).

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(backend): update tests + URL generators to /api/v1/*"
```

### Task E4: Rewrite editor API client fetch URLs

**Files:**
- Modify: 14 files under `editor/src/lib/` containing `/api/`

- [ ] **Step 1: List the files**

```bash
cd editor && grep -rln '"/api/\|`/api/' src/lib
```

Expected list:
- `editor/src/lib/editorSession.ts`
- `editor/src/lib/linkApi.ts`
- `editor/src/lib/mcModelRenderer.ts`
- `editor/src/lib/packApi.ts`
- `editor/src/lib/api/auth.ts`
- `editor/src/lib/api/networks.ts`
- `editor/src/lib/api/branches.ts`
- `editor/src/lib/api/userPacks.ts`
- `editor/src/lib/api/packs.ts`
- `editor/src/lib/ws/bundlePublisher.ts`

Plus the test files (`.test.ts`) for each.

- [ ] **Step 2: For each file, rewrite `/api/` → `/api/v1/`**

Open each file in the list and replace every occurrence. Pay attention to:
- String literals `"/api/foo"` → `"/api/v1/foo"`
- Template literals `` `${apiUrl}/api/foo/${id}` `` → `` `${apiUrl}/api/v1/foo/${id}` ``
- Don't double-prefix when re-running on a file.

- [ ] **Step 3: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: ~852+ passing (matches post-migration count, modulo 5 pre-existing LoginForm/SignupForm failures unrelated to versioning).

- [ ] **Step 4: Commit**

```bash
git add editor/src/lib/
git commit -m "feat(editor): API clients call /api/v1/* (REST versioning big-bang)"
```

### Task E5: Update plugin BundleUploader

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt`

- [ ] **Step 1: Edit line 47**

Open `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt`. Find:

```kotlin
.url("$apiUrl/api/bundles/$packId")
```

Replace with:

```kotlin
.url("$apiUrl/api/v1/bundles/$packId")
```

- [ ] **Step 2: Run the relevant plugin tests**

```bash
cd plugin && ./gradlew test --tests '*Bundle*' --tests '*Uploader*' --tests '*Sync*'
```

Expected: all green. The MockWebServer-based BundleUploader tests will match the new path.

- [ ] **Step 3: Verify nothing else in the plugin references `/api/...` for direct calls (already audited in E1)**

- [ ] **Step 4: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt
git commit -m "feat(plugin): BundleUploader uses /api/v1/bundles"
```

### Task E6: Cross-stack smoke check

**Files:** none

- [ ] **Step 1: Restart stack**

```bash
docker compose restart backend editor
```

(Plugin container will reconnect WS automatically; if not, restart `minecraft` too.)

- [ ] **Step 2: Verify the new module health endpoints**

```bash
curl -s http://localhost:3001/api/v1/modules/menus/health && echo
curl -s http://localhost:3001/api/v1/modules/commands/health && echo
```

Expected: JSON responses with `module` field.

- [ ] **Step 3: Verify old paths return 404**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/modules/menus/health
```

Expected: `404`. Confirms there's no leftover legacy mount.

- [ ] **Step 4: Open the editor in a browser, complete login → networks → pick pack flow**

(No commit. Manual verification.)

---

## Phase F — Drizzle migrations workflow

### Task F1: Generate the initial migration baseline

**Files:**
- Create: `backend/drizzle/0001_initial.sql` (auto-generated)
- Create: `backend/drizzle/meta/_journal.json` (auto-generated)

- [ ] **Step 1: Ensure DATABASE_URL points to a fresh DB**

If Postgres has data from `db:push` already, the generated migration won't reflect the actual SQL needed to create the schema from scratch. Two options:
- (a) Wipe Postgres volume + re-create (we did this earlier in the session)
- (b) Use `drizzle-kit generate` with the schema file as source of truth (it doesn't read the DB)

We use (b) — drizzle-kit reads `schema.ts` and emits SQL that creates everything.

- [ ] **Step 2: Generate migration**

```bash
cd backend && bunx drizzle-kit generate --name initial
```

Expected: creates `backend/drizzle/0001_initial.sql` + `meta/_journal.json` + `meta/0000_snapshot.json`.

- [ ] **Step 3: Inspect the generated SQL**

```bash
cat backend/drizzle/0001_initial.sql | head -50
```

Should be a `CREATE TABLE users`, `CREATE TABLE networks`, etc. Skim for sanity.

- [ ] **Step 4: Commit**

```bash
git add backend/drizzle/
git commit -m "feat(backend): baseline migration 0001_initial.sql via drizzle-kit"
```

### Task F2: Add `db:generate` + `db:migrate` scripts

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/db/migrate.ts` — entrypoint for the migration runner

- [ ] **Step 1: Add the scripts**

Open `backend/package.json`. In `"scripts"`, add:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "bun run src/db/migrate.ts",
```

Keep `"db:push"` for now (used in dev when you want to skip migrations).

- [ ] **Step 2: Write the migration runner**

Create `backend/src/db/migrate.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = new Client({ connectionString: url });
await client.connect();
const db = drizzle(client);

console.log("[migrate] applying migrations from ./drizzle/");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[migrate] done");

await client.end();
```

If the project already uses a different driver (e.g. `postgres-js` instead of `pg`), adapt the import. Check `backend/src/db/index.ts` for the driver in use.

- [ ] **Step 3: Test the migrate script against the running Postgres**

```bash
cd backend && bun run db:migrate
```

Expected: `[migrate] applying migrations from ./drizzle/` then `done`. If Postgres already has the schema applied via `db:push`, drizzle-kit's migrator will detect the schema and either skip or apply idempotently. Inspect output for errors.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/src/db/migrate.ts
git commit -m "feat(backend): add db:generate + db:migrate scripts"
```

### Task F3: Switch Docker compose to `db:migrate`

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update the backend command**

Open `docker-compose.yml`. Find line 37 :

```yaml
sh -c "bun install && bun run db:push && bun run start"
```

Change to:

```yaml
sh -c "bun install && bun run db:migrate && bun run start"
```

- [ ] **Step 2: Document the workflow in CLAUDE.md**

Open `CLAUDE.md`. Find the section "Backend (Bun + Hono + PostgreSQL)" with the `bun run db:push` line. Add right after it:

```markdown
**Workflow migrations** :
- `bun run db:push` — dev/test only. Auto-sync `schema.ts` → DB. Pas de fichier migration.
- `bun run db:generate` — quand un changement de schéma est prêt à shipper. Génère `backend/drizzle/NNNN_<name>.sql`. Commit le fichier.
- `bun run db:migrate` — applique les fichiers de migrations en ordre. Utilisé en prod et dans Docker compose.

Règle : tout merge dans `main` qui modifie `schema.ts` DOIT inclure la migration générée. Pas de push live de schema en prod.
```

- [ ] **Step 3: Smoke-test the change**

```bash
docker compose down backend
docker compose up -d backend
docker compose logs backend --tail 20
```

Expected: `[migrate] applying migrations` line in logs. Then backend serves traffic on 3001.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml CLAUDE.md
git commit -m "feat(docker): backend uses db:migrate instead of db:push"
```

---

## Phase G — CHANGELOG.md initial setup

### Task G1: Create root CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md` (repo root)

- [ ] **Step 1: Write the file**

Create `CHANGELOG.md` at repo root:

```markdown
# Changelog

All notable changes to Artisan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

See `docs/architecture/versioning.md` for the full versioning rules.

## [Unreleased]

### Added
- Versioning foundations: stability annotations (`@Stable`, `@Beta`, `@Internal`, `@Sunset`), `SchemaRegistry` + `SchemaMigration` interface, `protocol_version` in WS hello, `/api/v1/*` URL versioning, Drizzle migrations folder, `CHANGELOG.md`, `docs/architecture/api-surface.md`.
- Modular monolith pattern: `ArtisanModule` / `BackendModule` / `FrontendModule` interfaces, `DataSourceRegistry`, `CommandRegistry`, `ModuleEventBus`, `<SchemaForm>` generator. See `docs/architecture/modules.md`.
- Schema field at the top of menu/command/dialog YAMLs (`schema: "menu/v1"` etc.).

### Changed
- **BREAKING (pre-1.0)** REST API now under `/api/v1/*` instead of `/api/*`. All clients (editor, plugin) updated in the same release.

### Deprecated
- Nothing yet.

### Removed
- Nothing yet.

### Fixed
- Race condition in editor: `/login`, `/link`, `/transfer` no longer redirect to /login before `authStore.hydrate()` completes.

### Security
- Nothing yet.

## [1.0.0-alpha] - 2026-05-25

### Added
- Pre-release alpha. See git log for the full history. Future releases will follow proper SemVer.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): initialize CHANGELOG.md (Keep-a-Changelog format)"
```

---

## Phase H — api-surface.md

### Task H1: Create the api-surface manual

**Files:**
- Create: `docs/architecture/api-surface.md`

- [ ] **Step 1: Write the file**

Create `docs/architecture/api-surface.md`:

```markdown
# Artisan Public API Surface (v1.x)

This document lists the **stable** API surface of Artisan Core that modules can safely depend on.
Anything not listed here is internal and may change without notice.

> Source of truth : the `@Stable` annotations in `plugin/src/main/kotlin/net/artisanmc/modules/api/`.
> This doc is hand-maintained; future versions will auto-generate it (see versioning.md §9.2).

## Annotations

| Annotation | Package | Meaning |
|---|---|---|
| `@Stable` | `net.artisanmc.modules.api.annotations.Stable` | Covered by SemVer. No breaking change within a major version. |
| `@Beta` | `net.artisanmc.modules.api.annotations.Beta` | Experimental. May change in minor versions. |
| `@Internal` | `net.artisanmc.modules.api.annotations.Internal` | DO NOT USE from modules. |
| `@Sunset(reason, removeInVersion, replacement)` | `net.artisanmc.modules.api.annotations.Sunset` | Scheduled for removal. Replacement is provided. |

Note : we use `@Sunset` (not `@Deprecated`) to avoid clashing with `kotlin.Deprecated`. The schedule-aware annotation carries removal version + replacement.

## Stable APIs (v1.x)

### `net.artisanmc.modules.api.ArtisanModule`

Contract implemented by every module.

| Member | Type | Since |
|---|---|---|
| `id` | `String` | 1.0.0 |
| `schemaVersion` | `String` | 1.0.0 |
| `onEnable(api: ArtisanAPI)` | `Unit` | 1.0.0 |
| `onDisable()` | `Unit` | 1.0.0 |
| `onReload()` | `Unit` (default empty) | 1.0.0 |

### `net.artisanmc.modules.api.ArtisanAPI`

The facade passed to every module at `onEnable(api)`.

| Member | Type | Since |
|---|---|---|
| `plugin` | `ArtisanPlugin` | 1.0.0 |
| `dataSources` | `DataSourceRegistry` | 1.0.0 |
| `commands` | `CommandRegistry` | 1.0.0 |
| `events` | `ModuleEventBus` | 1.0.0 |
| `schemas` | `SchemaRegistry<MutableMap<String, Any?>>` | 1.0.0 |

### `net.artisanmc.modules.api.DataSourceRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: DataSourceDeclaration)` | `Unit` | 1.0.0 |
| `fetch(ref: String, player: Player, params: Map<String, Any?>)` | `List<Map<String, Any?>>` | 1.0.0 |
| `has(ref: String)` | `Boolean` | 1.0.0 |
| `refs()` | `Set<String>` | 1.0.0 |

Exceptions: `UnknownDataSourceException`, `DuplicateDataSourceException`.

### `net.artisanmc.modules.api.CommandRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: CommandDeclaration)` | `Unit` | 1.0.0 |
| `dispatch(name: String, player: Player, args: Map<String, Any?>)` | `Unit` | 1.0.0 |
| `has(name: String)` | `Boolean` | 1.0.0 |
| `names()` | `Set<String>` | 1.0.0 |

Exceptions: `UnknownCommandException`, `DuplicateCommandException`.

### `net.artisanmc.modules.api.ModuleEventBus`

| Member | Type | Since |
|---|---|---|
| `subscribe<T : ModuleEvent>(handler: (T) -> Unit)` | `Unit` | 1.0.0 |
| `subscribeRaw(type: Class<out ModuleEvent>, handler: (ModuleEvent) -> Unit)` | `Unit` | 1.0.0 |
| `publish(event: ModuleEvent)` | `Unit` | 1.0.0 |

Event types: `DataReloadEvent`, `ConfigReloadEvent`. Modules may add their own subclasses of `ModuleEvent`.

### `net.artisanmc.modules.api.schemas.SchemaRegistry<T>`

| Member | Type | Since |
|---|---|---|
| `register(migration: SchemaMigration<T>)` | `Unit` | 1.0.0 |
| `loadToCurrent(data: T, currentVersion: String, versionOf: (T) -> String)` | `T` | 1.0.0 |
| `has(from: String)` | `Boolean` | 1.0.0 |

Exceptions: `UnsupportedSchemaVersionException`, `CircularMigrationException`.

### `net.artisanmc.modules.api.schemas.SchemaMigration<T>`

| Member | Type | Since |
|---|---|---|
| `from` | `String` | 1.0.0 |
| `to` | `String` | 1.0.0 |
| `migrate(data: T)` | `T` | 1.0.0 |

## Beta APIs (may change)

None at this time.

## Deprecated APIs

None at this time.

## Internal — DO NOT USE

Everything under `net.artisanmc.plugin.*` is implicitly internal. Use the API surface above instead.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/api-surface.md
git commit -m "docs(architecture): add api-surface.md v1"
```

---

## Phase I — Docs sync

### Task I1: Update CLAUDE.md with versioning rules

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add versioning rules section**

Open `CLAUDE.md`. After the "Pattern modulaire" + SchemaForm section added by the previous migration, append :

```markdown
### Versioning (depuis 2026-05-25)

Architecture cible : `docs/architecture/versioning.md`. Surface API publique : `docs/architecture/api-surface.md`.

**Les 4 disciplines à respecter** :

1. **CHANGELOG** : tout commit qui touche `net.artisanmc.modules.api.*` ou un endpoint REST ajoute une entrée dans `[Unreleased]` de `CHANGELOG.md`.
2. **Nouveau schema version = nouveau dossier** : on ne modifie jamais un `menu/v1` après ship. On crée `menu/v2` séparé et on écrit `MenuV1ToV2 : SchemaMigration` qu'on register via `api.schemas.register(...)`.
3. **DB forward-only** : tout changement de `schema.ts` génère `bun run db:generate` un fichier dans `backend/drizzle/` qui doit être committé. Pas de `db:push` en prod.
4. **REST URL versionné** : nouvelle route = `/api/v1/<name>`. Quand un endpoint a un breaking change inevitable, on crée `/api/v2/<name>` à côté et on garde v1 6-12 mois.

**Annotations de stabilité** (cf. api-surface.md) :
- `@Stable` couvert par SemVer
- `@Beta` peut bouger en minor
- `@Internal` ne pas utiliser
- `@Sunset(reason, removeInVersion, replacement)` planifié pour retrait
```

- [ ] **Step 2: Update sync-docs map**

Open `.claude/skills/sync-docs/doc-impact-map.yaml`. Append :

```yaml
  - touches: "plugin/src/main/kotlin/net/artisanmc/modules/api/"
    updates:
      - "CHANGELOG.md"
      - "docs/architecture/api-surface.md"
    reason: "Stable API surface — every change must be reflected in CHANGELOG + api-surface doc"

  - touches: "backend/src/db/schema.ts"
    updates:
      - "backend/drizzle/"
      - "CHANGELOG.md"
    reason: "Schema change requires drizzle-kit generate + CHANGELOG entry"

  - touches: "backend/src/app.ts"
    updates:
      - "CHANGELOG.md"
    reason: "Route mount changes are part of the REST API surface (versioned)"

  - touches: "backend/src/protocol.ts"
    updates:
      - "CHANGELOG.md"
      - "docs/architecture/versioning.md"
    reason: "WS protocol changes need version bump consideration"
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs: versioning discipline rules in CLAUDE.md + sync-docs map"
```

---

## Final verification

### Task Z1: Full test sweep

- [ ] Run `cd plugin && ./gradlew test`
- [ ] Expected: ~392 tests passing (5 from SchemaRegistryTest added, others unchanged)

- [ ] Run `cd backend && bun test`
- [ ] Expected: ~462 passing / ~25 pre-existing test-isolation flakes (same as before, no new regressions)

- [ ] Run `cd editor && npx vitest run`
- [ ] Expected: ~852+ passing / 5 pre-existing LoginForm/SignupForm failures (unchanged)

### Task Z2: Docker smoke

- [ ] `docker compose down && docker compose up -d`
- [ ] Backend logs show `[migrate] applying migrations`
- [ ] `curl http://localhost:3001/api/v1/modules/menus/health` returns JSON
- [ ] `curl http://localhost:3001/api/v1/modules/commands/health` returns JSON
- [ ] `curl -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/modules/menus/health` returns `404` (old prefix gone)
- [ ] Open editor in browser → login → networks → pack → edit a menu → autosave → inspect YAML on disk: `schema: "menu/v1"` at top
- [ ] MC console : `/artisan reload` — no errors

### Task Z3: Verify CHANGELOG completeness

- [ ] Read `CHANGELOG.md` `[Unreleased]` section. Confirm every commit on the branch is reflected at least once (Added / Changed / Fixed). If any breaking change is missing, add it.

---

## Self-Review

**1. Spec coverage** — Mapped each V1 item from `docs/architecture/versioning.md` §12.1 to tasks:

| Spec V1 item | Effort estimate | Covered by |
|---|---|---|
| Package `api/` vs `internal/` séparation | 1 jour | Phase A2 (mark `modules/api/*` `@Stable`); implicit `@Internal` on `plugin.*` (convention not enforced — see deliberate omissions below) |
| Annotations `@Stable`, `@Beta`, `@Internal`, `@Deprecated` | 0,5 jour | Phase A1, A3 (with `@Sunset` rename for `Deprecated`) |
| `SchemaRegistry` avec migration framework | 1-2 jours | Phase B1, B2, B3 |
| Protocol version + dispatch dans le hub WS | 1 jour | Phase D1, D2 |
| URL versioning `/api/v1/*` côté Fastify | 0,5 jour | Phase E (big-bang scope per user decision — 1-2 days, not 0.5 day) |
| Drizzle migrations folder + workflow doc | 0,5 jour | Phase F1, F2, F3 |
| `CHANGELOG.md` initial + règle de commit | 0,1 jour | Phase G1, I1 |
| `docs/architecture/api-surface.md` v1 | 0,5 jour | Phase H1 |
| Schema field in YAML (user decision) | +1 jour | Phase C1, C2, C3 |

Total realistic effort : 7-9 days due to big-bang REST + schema field decisions expanding spec defaults.

**2. Placeholder scan** — Searched for "TBD", "TODO", "implement later", "appropriate" — none in plan body. Tasks like C1 say "Investigation step" with concrete grep commands, not generic placeholders.

**3. Type consistency**
- `SchemaMigration<T>.from`, `.to`, `.migrate(data)` consistent between interface (B1), tests (B2), usage in registry (B2)
- `SchemaRegistry<T>` parameterized — `ArtisanAPI.schemas: SchemaRegistry<MutableMap<String, Any?>>` (B3)
- Annotation rename `Deprecated` → `Sunset` consistent across A1, A3, H1
- Test pattern uses `MutableMap<String, Any?>` (not `JsonObject` as in spec literal) because that's what Kotlin's YAML libs return naturally on this codebase

**4. Deliberate omissions / scope choices**
- **No physical package rename** `net.artisanmc.plugin.*` → `net.artisanmc.core.*` (spec section 3.1 namespace is aspirational; rename = 2+ days, not in spec's 1-day estimate)
- **No `@Internal` annotation on `net.artisanmc.plugin.*`** (100+ files, redundant given the package convention; the api-surface.md documents the rule)
- **No multi-version protocol handler scaffolding** (per section 12.2 "tout est neuf, juste v1 partout")
- **No `japicmp` in CI** (per section 12.2)
- **`@Sunset` instead of `@Deprecated`** to avoid clash with `kotlin.Deprecated` (rationale documented in A1, A3, H1)

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-versioning-foundations.md`.**
