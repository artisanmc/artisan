# Modular Monolith Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrer Interfaze de sa structure plate actuelle (`routes/`, `features/`, `engine/`) vers le **modular monolith** spécifié dans `docs/architecture/modules.md`, en wrappant le code existant dans des modules `menus` et `commands` sans rewrite, et en mettant en place les registries `DataSource` + `Command` qui découpleront les modules futurs (shop V1.5, quests V2, etc.).

**Architecture:** 3 couches symétriques — plugin (Kotlin), backend (Bun/Hono), editor (React) — chacune avec :
1. Une interface `*Module` (~30 lignes par layer)
2. Un registry centralisé de modules chargé au boot
3. Des registries `DataSource` + `Command` côté plugin pour la composition cross-module
4. Le code existant `menus` et `commands` encapsulé dans des classes `MenusModule` / `CommandsModule` qui implémentent les interfaces
5. Côté editor : sidebar + routes générés dynamiquement depuis le registry
6. Un composant `<SchemaForm>` pour générer les formulaires de config des modules futurs depuis un JSON Schema (multiplicateur V1.5+)
7. Un event bus interne pour hot-reload cross-module

**Tech Stack:** Kotlin 2.0 + Paper, Bun + Hono, React 19 + TanStack Router, JSON Schema (form generator). Tests via JUnit5 (plugin), `bun:test` (backend), Vitest (editor).

**Spec source :** `docs/architecture/modules.md`.

**Hors scope (différé V1.5+ ou V3) :**
- Dynamic module loading (modules statiquement linkés)
- SDK public 3ᵉ party
- Module bundles bootstrap (section 5 de la spec) — utile dès V1.5 avec le module `shop`
- Schema migrations runtime (section 7) — utile quand `menu/v2` arrive
- Marketplace, billing, isolation runtime

---

## File Structure

### Plugin — `plugin/src/main/kotlin/gg/interfaze/`

- **Create**:
  - `modules/api/InterfazeModule.kt` — interface module
  - `modules/api/InterfazeAPI.kt` — facade exposée aux modules
  - `modules/api/DataSourceRegistry.kt` + `DataSourceDeclaration.kt`
  - `modules/api/CommandRegistry.kt` + `CommandDeclaration.kt`
  - `modules/api/ModuleEventBus.kt` — pub/sub interne pour hot-reload
  - `modules/menus/MenusModule.kt` — wrap `MenuProvider` + listeners
  - `modules/commands/CommandsModule.kt` — wrap `CommandRegistrar`
  - Tests : `modules/api/*Test.kt`, `modules/menus/MenusModuleTest.kt`, `modules/commands/CommandsModuleTest.kt`
- **Modify**:
  - `plugin/InterfazePlugin.kt` — `onEnable()` charge la liste de modules, appelle `onEnable(api)` sur chacun

### Backend — `backend/src/`

- **Create**:
  - `modules/api/BackendModule.ts` — interface
  - `modules/api/moduleRegistry.ts` — `mountModules(app, modules)`
  - `modules/api/types.ts` — `DataSourceDeclaration`, `CommandDeclaration`
  - `modules/menus/index.ts` — `MenusModule` wrapping `userPacksRouter`, `userBranchesRouter`, `bundlesRouter`
  - `modules/commands/index.ts` — placeholder (commands editing est dans userPacks pour MVP)
  - Tests : `modules/api/moduleRegistry.test.ts`, `modules/menus/index.test.ts`
- **Modify**:
  - `app.ts` — remplace les `app.route(...)` directs par `mountModules(app, modules)`

### Editor — `editor/src/`

- **Create**:
  - `modules/api/types.ts` — interface `FrontendModule`
  - `modules/api/registry.ts` — `modules: FrontendModule[]` (singleton)
  - `modules/menus/index.ts` — `MenusModule` (routes existantes `pack.$packId.tsx` etc.)
  - `modules/commands/index.ts` — `CommandsModule`
  - `components/ModuleSidebar.tsx` — itère sur registry pour afficher la sidebar
  - `components/SchemaForm/index.tsx` — composant générique (~500 lignes)
  - `components/SchemaForm/widgets/` — widgets de base (string/number/boolean/enum)
  - Tests : `modules/api/registry.test.ts`, `modules/menus/index.test.ts`, `components/SchemaForm/SchemaForm.test.tsx`
- **Modify**:
  - `main.tsx` — boot charge le registry avant `<RouterProvider>`
  - `routeTree.gen.ts` (généré) — pas touché manuellement, mais on déplace les routes dans `modules/menus/routes/`
  - `routes/__root.tsx` — utilise `<ModuleSidebar>`

### Docs

- **Modify**:
  - `CLAUDE.md` — table mise à jour : section "Architecture modules"
  - `.claude/skills/sync-docs/doc-impact-map.yaml` — nouvelles entrées

---

## Phase A — Plugin foundation : interfaces + registries

### Task A1: Define `InterfazeModule` interface

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/InterfazeModule.kt`

- [ ] **Step 1: Create the interface file**

```kotlin
package gg.interfaze.modules.api

/**
 * Contract implemented by every Interfaze module (menus, commands, future shop/quests/...).
 *
 * Each module lives in `gg.interfaze.modules.{id}/` and is statically registered
 * in [gg.interfaze.plugin.InterfazePlugin.onEnable]. Modules communicate exclusively
 * via [InterfazeAPI] — never via direct dependencies on each other.
 */
interface InterfazeModule {
    /** Module id, lowercase, e.g. "menus", "commands", "shop". Used in data source refs. */
    val id: String

    /** Schema version this module currently understands, e.g. "menu/v1". */
    val schemaVersion: String

    /** Called once at plugin enable, after the API facade is built. */
    fun onEnable(api: InterfazeAPI)

    /** Called on plugin disable. Modules must release listeners, executors, threads. */
    fun onDisable()

    /** Called when the menu cache is reloaded from disk (e.g. WS bundle update). */
    fun onReload() {}
}
```

- [ ] **Step 2: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/api/InterfazeModule.kt
git commit -m "feat(plugin): add InterfazeModule interface"
```

### Task A2: Define `DataSourceDeclaration` + `DataSourceRegistry`

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/DataSourceDeclaration.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/DataSourceRegistry.kt`
- Test: `plugin/src/test/kotlin/gg/interfaze/modules/api/DataSourceRegistryTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package gg.interfaze.modules.api

import be.seeseemelk.mockbukkit.MockBukkit
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class DataSourceRegistryTest {

    private lateinit var player: Player

    @BeforeEach fun setup() {
        MockBukkit.mock()
        player = MockBukkit.getMock()!!.addPlayer()
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `register and fetch returns the declared data`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { _, _ -> listOf(mapOf("id" to "diamond", "price" to 100)) }
        ))

        val rows = registry.fetch("shop:items", player, emptyMap())

        assertEquals(1, rows.size)
        assertEquals("diamond", rows[0]["id"])
    }

    @Test
    fun `fetch on unknown ref throws UnknownDataSourceException`() {
        val registry = DataSourceRegistry()

        assertThrows(UnknownDataSourceException::class.java) {
            registry.fetch("ghost:items", player, emptyMap())
        }
    }

    @Test
    fun `registering twice with same ref throws DuplicateDataSourceException`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))

        assertThrows(DuplicateDataSourceException::class.java) {
            registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))
        }
    }
}
```

**Note** — the plugin uses MockBukkit for Player mocking (not Mockito-Kotlin, which is not on the classpath). Other tests in this plan that use `Player` follow the same setup.

- [ ] **Step 2: Run test to verify it fails (file does not exist)**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.api.DataSourceRegistryTest'
```

Expected: FAIL — compilation errors (`DataSourceRegistry not found`).

- [ ] **Step 3: Implement `DataSourceDeclaration`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/api/DataSourceDeclaration.kt
package gg.interfaze.modules.api

import org.bukkit.entity.Player

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * @param ref Globally unique reference, format "namespace:id" (e.g. "shop:items").
 * @param fetcher Pure function returning rows for a given player + params.
 *                Rows are `Map<String, Any?>` — the schema is documented in [schemaHint],
 *                consumers (e.g. menus rendering `data_source.ref`) iterate generically.
 * @param schemaHint Optional human-readable schema description for tooling (web editor).
 */
data class DataSourceDeclaration(
    val ref: String,
    val fetcher: (player: Player, params: Map<String, Any?>) -> List<Map<String, Any?>>,
    val schemaHint: String? = null,
)
```

- [ ] **Step 4: Implement `DataSourceRegistry`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/api/DataSourceRegistry.kt
package gg.interfaze.modules.api

import org.bukkit.entity.Player
import java.util.concurrent.ConcurrentHashMap

class UnknownDataSourceException(ref: String) :
    RuntimeException("No data source registered with ref '$ref'")

class DuplicateDataSourceException(ref: String) :
    IllegalStateException("Data source '$ref' is already registered")

class DataSourceRegistry {
    private val sources = ConcurrentHashMap<String, DataSourceDeclaration>()

    fun register(decl: DataSourceDeclaration) {
        if (sources.putIfAbsent(decl.ref, decl) != null) {
            throw DuplicateDataSourceException(decl.ref)
        }
    }

    fun fetch(ref: String, player: Player, params: Map<String, Any?>): List<Map<String, Any?>> {
        val decl = sources[ref] ?: throw UnknownDataSourceException(ref)
        return decl.fetcher(player, params)
    }

    fun has(ref: String): Boolean = sources.containsKey(ref)

    fun refs(): Set<String> = sources.keys.toSet()
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.api.DataSourceRegistryTest'
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/api/DataSourceDeclaration.kt \
        plugin/src/main/kotlin/gg/interfaze/modules/api/DataSourceRegistry.kt \
        plugin/src/test/kotlin/gg/interfaze/modules/api/DataSourceRegistryTest.kt
git commit -m "feat(plugin): add DataSourceRegistry with register + fetch"
```

### Task A3: Define `CommandDeclaration` + `CommandRegistry`

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/CommandDeclaration.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/CommandRegistry.kt`
- Test: `plugin/src/test/kotlin/gg/interfaze/modules/api/CommandRegistryTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package gg.interfaze.modules.api

import be.seeseemelk.mockbukkit.MockBukkit
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CommandRegistryTest {

    private lateinit var player: Player

    @BeforeEach fun setup() {
        MockBukkit.mock()
        player = MockBukkit.getMock()!!.addPlayer()
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `dispatch routes to the registered handler`() {
        val registry = CommandRegistry()
        var calledWith: Map<String, Any?>? = null
        registry.register(CommandDeclaration(
            name = "shop:buy",
            handler = { _, args -> calledWith = args }
        ))

        registry.dispatch("shop:buy", player, mapOf("item" to "diamond"))

        assertEquals("diamond", calledWith?.get("item"))
    }

    @Test
    fun `dispatch on unknown command throws UnknownCommandException`() {
        val registry = CommandRegistry()
        assertThrows(UnknownCommandException::class.java) {
            registry.dispatch("ghost:cmd", player, emptyMap())
        }
    }

    @Test
    fun `register twice on same name throws DuplicateCommandException`() {
        val registry = CommandRegistry()
        registry.register(CommandDeclaration(name = "shop:buy", handler = { _, _ -> }))
        assertThrows(DuplicateCommandException::class.java) {
            registry.register(CommandDeclaration(name = "shop:buy", handler = { _, _ -> }))
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.api.CommandRegistryTest'
```

- [ ] **Step 3: Implement `CommandDeclaration` + `CommandRegistry`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/api/CommandDeclaration.kt
package gg.interfaze.modules.api

import org.bukkit.entity.Player

data class CommandDeclaration(
    val name: String,
    val handler: (player: Player, args: Map<String, Any?>) -> Unit,
)
```

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/api/CommandRegistry.kt
package gg.interfaze.modules.api

import org.bukkit.entity.Player
import java.util.concurrent.ConcurrentHashMap

class UnknownCommandException(name: String) :
    RuntimeException("No command registered with name '$name'")

class DuplicateCommandException(name: String) :
    IllegalStateException("Command '$name' is already registered")

class CommandRegistry {
    private val commands = ConcurrentHashMap<String, CommandDeclaration>()

    fun register(decl: CommandDeclaration) {
        if (commands.putIfAbsent(decl.name, decl) != null) {
            throw DuplicateCommandException(decl.name)
        }
    }

    fun dispatch(name: String, player: Player, args: Map<String, Any?>) {
        val decl = commands[name] ?: throw UnknownCommandException(name)
        decl.handler(player, args)
    }

    fun has(name: String): Boolean = commands.containsKey(name)

    fun names(): Set<String> = commands.keys.toSet()
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.api.CommandRegistryTest'
```

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/api/CommandDeclaration.kt \
        plugin/src/main/kotlin/gg/interfaze/modules/api/CommandRegistry.kt \
        plugin/src/test/kotlin/gg/interfaze/modules/api/CommandRegistryTest.kt
git commit -m "feat(plugin): add CommandRegistry with register + dispatch"
```

### Task A4: Define `ModuleEventBus` for cross-module hot-reload

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/ModuleEventBus.kt`
- Test: `plugin/src/test/kotlin/gg/interfaze/modules/api/ModuleEventBusTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package gg.interfaze.modules.api

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModuleEventBusTest {
    @Test
    fun `subscribers receive published events of matching type`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe<DataReloadEvent> { received.add(it.dataSourceRef) }

        bus.publish(DataReloadEvent(dataSourceRef = "shop:items"))

        assertEquals(listOf("shop:items"), received)
    }

    @Test
    fun `subscribers of other event types do not receive`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe<DataReloadEvent> { received.add(it.dataSourceRef) }

        bus.publish(ConfigReloadEvent(moduleId = "shop"))

        assertTrue(received.isEmpty())
    }
}
```

- [ ] **Step 2: Implement**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/api/ModuleEventBus.kt
package gg.interfaze.modules.api

import java.util.concurrent.CopyOnWriteArrayList

/** Marker for events published on the bus. */
sealed interface ModuleEvent

/** A module signals that its data source needs to be re-fetched by consumers. */
data class DataReloadEvent(val dataSourceRef: String) : ModuleEvent

/** A module's config was hot-reloaded; consumers should refresh references. */
data class ConfigReloadEvent(val moduleId: String) : ModuleEvent

class ModuleEventBus {
    private data class Sub(val type: Class<out ModuleEvent>, val handler: (ModuleEvent) -> Unit)
    private val subs = CopyOnWriteArrayList<Sub>()

    inline fun <reified T : ModuleEvent> subscribe(noinline handler: (T) -> Unit) {
        @Suppress("UNCHECKED_CAST")
        subscribeRaw(T::class.java) { handler(it as T) }
    }

    fun subscribeRaw(type: Class<out ModuleEvent>, handler: (ModuleEvent) -> Unit) {
        subs.add(Sub(type, handler))
    }

    fun publish(event: ModuleEvent) {
        for (sub in subs) {
            if (sub.type.isInstance(event)) sub.handler(event)
        }
    }
}
```

- [ ] **Step 3: Run tests**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.api.ModuleEventBusTest'
```

- [ ] **Step 4: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/api/ModuleEventBus.kt \
        plugin/src/test/kotlin/gg/interfaze/modules/api/ModuleEventBusTest.kt
git commit -m "feat(plugin): add ModuleEventBus for cross-module hot-reload"
```

### Task A5: Define `InterfazeAPI` facade

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/api/InterfazeAPI.kt`

- [ ] **Step 1: Write the file**

```kotlin
package gg.interfaze.modules.api

import gg.interfaze.plugin.InterfazePlugin

/**
 * Facade passed to every module at `onEnable(api)`. Exposes:
 * - the [plugin] handle (for Bukkit scheduler, server, dataFolder)
 * - the cross-module registries ([dataSources], [commands])
 * - the [events] bus for hot-reload propagation
 *
 * Modules MUST go through this facade — direct access to the plugin internals
 * is allowed only inside the module's own package.
 */
class InterfazeAPI(
    val plugin: InterfazePlugin,
    val dataSources: DataSourceRegistry,
    val commands: CommandRegistry,
    val events: ModuleEventBus,
)
```

- [ ] **Step 2: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/api/InterfazeAPI.kt
git commit -m "feat(plugin): add InterfazeAPI facade for modules"
```

---

## Phase B — Plugin : wrap menus + commands as modules

### Task B1: Create `MenusModule` wrapping existing menu logic

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/menus/MenusModule.kt`
- Test: `plugin/src/test/kotlin/gg/interfaze/modules/menus/MenusModuleTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package gg.interfaze.modules.menus

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.modules.api.*
import gg.interfaze.plugin.InterfazePlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class MenusModuleTest {

    private lateinit var plugin: InterfazePlugin

    @BeforeEach fun setup() {
        MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `module id is 'menus' and schema is 'menu_v1'`() {
        val module = MenusModule()
        assertEquals("menus", module.id)
        assertEquals("menu/v1", module.schemaVersion)
    }

    @Test
    fun `onEnable does not throw with a real plugin API`() {
        val module = MenusModule()
        val api = InterfazeAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
        )
        // Should not throw — the module just records the API ref for later use.
        module.onEnable(api)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.menus.MenusModuleTest'
```

- [ ] **Step 3: Implement `MenusModule` (skeletal — wraps existing code at boot)**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/menus/MenusModule.kt
package gg.interfaze.modules.menus

import gg.interfaze.modules.api.InterfazeAPI
import gg.interfaze.modules.api.InterfazeModule

/**
 * First Interfaze module — encapsulates the existing menu rendering pipeline:
 * - SyncedMenuProvider (WS sync, pack loading)
 * - MenuListener (Bukkit InventoryClickEvent)
 * - TitleCompiler, AssetCatalog
 *
 * V1 scope: this module is a thin wrapper. The existing classes are kept in
 * gg.interfaze.plugin.* and instantiated inside [onEnable]. Phase B5 moves
 * the relevant classes physically under modules/menus/.
 */
class MenusModule : InterfazeModule {
    override val id = "menus"
    override val schemaVersion = "menu/v1"

    private var api: InterfazeAPI? = null

    override fun onEnable(api: InterfazeAPI) {
        this.api = api
        // Wiring happens in InterfazePlugin for V1 — see migration note in onEnable docstring.
        // This keeps the patch surface minimal: existing instantiation order is preserved.
    }

    override fun onDisable() {
        // Provider shutdown is handled by InterfazePlugin.onDisable for V1.
    }

    override fun onReload() {
        // Hot-reload trigger forwarded via api.events in Phase H.
    }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.menus.MenusModuleTest'
```

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/menus/MenusModule.kt \
        plugin/src/test/kotlin/gg/interfaze/modules/menus/MenusModuleTest.kt
git commit -m "feat(plugin): add MenusModule skeleton"
```

### Task B2: Create `CommandsModule` wrapping `CommandRegistrar`

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/modules/commands/CommandsModule.kt`
- Test: `plugin/src/test/kotlin/gg/interfaze/modules/commands/CommandsModuleTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
package gg.interfaze.modules.commands

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.modules.api.*
import gg.interfaze.plugin.InterfazePlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CommandsModuleTest {

    private lateinit var plugin: InterfazePlugin

    @BeforeEach fun setup() {
        MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `module id is 'commands' and schema is 'command_v1'`() {
        val module = CommandsModule()
        assertEquals("commands", module.id)
        assertEquals("command/v1", module.schemaVersion)
    }

    @Test
    fun `onEnable does not throw with a real plugin API`() {
        val module = CommandsModule()
        val api = InterfazeAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
        )
        module.onEnable(api)
    }
}
```

- [ ] **Step 2: Implement**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/modules/commands/CommandsModule.kt
package gg.interfaze.modules.commands

import gg.interfaze.modules.api.InterfazeAPI
import gg.interfaze.modules.api.InterfazeModule

/**
 * Encapsulates the existing CommandRegistrar / IfzCommand / CommandCompiler pipeline.
 * V1 scope: thin wrapper. Physical relocation happens in Phase B5.
 */
class CommandsModule : InterfazeModule {
    override val id = "commands"
    override val schemaVersion = "command/v1"

    override fun onEnable(api: InterfazeAPI) {
        // Wiring done by InterfazePlugin for V1 — see B5 for relocation plan.
    }

    override fun onDisable() {}
    override fun onReload() {}
}
```

- [ ] **Step 3: Run tests**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.modules.commands.CommandsModuleTest'
```

- [ ] **Step 4: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/modules/commands/CommandsModule.kt \
        plugin/src/test/kotlin/gg/interfaze/modules/commands/CommandsModuleTest.kt
git commit -m "feat(plugin): add CommandsModule skeleton"
```

### Task B3: Wire modules into `InterfazePlugin.onEnable`

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`
- Test: `plugin/src/test/kotlin/gg/interfaze/plugin/InterfazePluginModuleWiringTest.kt`

- [ ] **Step 1: Write the failing test (registry visible after onEnable)**

```kotlin
package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.modules.api.InterfazeAPI
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class InterfazePluginModuleWiringTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `plugin exposes an InterfazeAPI after enable`() {
        val plugin = MockBukkit.load(InterfazePlugin::class.java)
        val api = InterfazePlugin.buildApi(plugin)
        assertNotNull(api.dataSources)
        assertNotNull(api.commands)
        assertNotNull(api.events)
    }

    @Test
    fun `default module list contains menus and commands`() {
        val ids = InterfazePlugin.defaultModules().map { it.id }
        assertTrue("menus" in ids)
        assertTrue("commands" in ids)
    }
}
```

- [ ] **Step 2: Modify `InterfazePlugin` to expose the helpers + wire modules**

In `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`, after the existing imports add:

```kotlin
import gg.interfaze.modules.api.*
import gg.interfaze.modules.menus.MenusModule
import gg.interfaze.modules.commands.CommandsModule
```

Add at the **top of the class body** (after the existing `lateinit var` declarations):

```kotlin
    lateinit var api: InterfazeAPI
        private set
    private val modules: List<InterfazeModule> = defaultModules()

    companion object {
        fun defaultModules(): List<InterfazeModule> = listOf(
            MenusModule(),
            CommandsModule(),
        )

        fun buildApi(plugin: InterfazePlugin): InterfazeAPI = InterfazeAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
        )
    }
```

Inside `onEnable()`, right after `saveDefaultConfig()` and BEFORE the existing wiring:

```kotlin
        api = buildApi(this)
        modules.forEach { it.onEnable(api) }
```

Inside `onDisable()`, BEFORE the existing teardown:

```kotlin
        modules.forEach { runCatching { it.onDisable() } }
```

- [ ] **Step 3: Run tests**

```bash
cd plugin && ./gradlew test --tests 'gg.interfaze.plugin.InterfazePluginModuleWiringTest'
```

Expected: PASS (2 tests).

- [ ] **Step 4: Run the full plugin suite to catch regressions**

```bash
cd plugin && ./gradlew test
```

Expected: all green (~365 tests existing + 9 new from A2–A4 + 2 new from B1 + 2 from B2 + 2 from B3).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt \
        plugin/src/test/kotlin/gg/interfaze/plugin/InterfazePluginModuleWiringTest.kt
git commit -m "feat(plugin): wire module registry into InterfazePlugin.onEnable"
```

### Task B4: Wire `onReload` from `SyncedMenuProvider` into module bus

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Change the `onReload` callback in the `SyncedMenuProvider` ctor**

In `onEnable()` and `reinit()`, replace the lambda passed to `SyncedMenuProvider(... onReload = { ... })` so it also notifies modules and the bus.

Find the current line:

```kotlin
            onReload         = { commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator) },
```

Replace with:

```kotlin
            onReload         = {
                commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
                modules.forEach { runCatching { it.onReload() } }
                api.events.publish(ConfigReloadEvent(moduleId = "menus"))
            },
```

Apply the same change at both call sites (`onEnable` and `reinit`).

Add the import at top of the file:

```kotlin
import gg.interfaze.modules.api.ConfigReloadEvent
```

- [ ] **Step 2: Run the plugin test suite**

```bash
cd plugin && ./gradlew test
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt
git commit -m "feat(plugin): fan onReload to module list and event bus"
```

### Task B5: Physically relocate menus + commands classes (light-touch)

**Note:** For V1 we deliberately keep the existing `gg.interfaze.plugin.engine.*` and `gg.interfaze.plugin.command.*` packages where they are. Moving them physically would force a cascade of import updates with no behavior change. We document the deferred move and tackle it when adding a 3rd module (V1.5+).

**Files:**
- Modify: `docs/architecture/modules.md`

- [ ] **Step 1: Add a section "Physical layout V1 vs target"**

Append to `docs/architecture/modules.md` (new section after section 12):

```markdown
## 13. Physical layout — V1 vs target

The target layout in section 3.3 places module-specific code under
`gg.interfaze.modules.{id}/`. V1 keeps the existing physical structure
(`gg.interfaze.plugin.engine`, `gg.interfaze.plugin.command`, etc.) and only adds
the module wrapper classes under `gg.interfaze.modules.{id}/`.

**Why defer the move:**
- The wrapper interface (`InterfazeModule`) is what other code depends on.
- Moving ~50 files just to change package names is a high-risk, zero-behavior change.
- Move opportunistically when adding the 3rd module (shop V1.5), which makes the
  pattern more visible and amortises the rename cost.

**When to do the physical move:** when introducing `shop` module in V1.5 — by then
the pattern is established and the rename is justified by symmetry.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/modules.md
git commit -m "docs(architecture): document V1 vs target physical layout"
```

---

## Phase C — Backend foundation : `BackendModule` interface + registry

### Task C1: Define `BackendModule` type

**Files:**
- Create: `backend/src/modules/api/types.ts`

- [ ] **Step 1: Write the file**

```ts
// backend/src/modules/api/types.ts
import type { Hono } from "hono";

/**
 * Backend-side contract for an Interfaze module.
 *
 * Each module mounts its REST routes under /api/modules/{id}/* and may declare
 * data sources and commands that map to the plugin-side registries via WS.
 */
export interface BackendModule {
  /** Module id, lowercase. Must match the plugin-side InterfazeModule.id. */
  id: string;

  /** Schema version this module currently emits / accepts. */
  schemaVersion: string;

  /**
   * Mount the module's REST routes onto the given Hono app.
   * Implementations should call `app.route("/api/modules/{id}/...", subrouter)`
   * (or use the helper `mountSubrouter` in moduleRegistry).
   */
  registerRoutes(app: Hono): void;

  /** Drizzle table refs this module owns (used by tooling, not yet enforced). */
  tables?: unknown[];

  /** Data sources declared by this module (relayed to the plugin via WS). */
  dataSources?: DataSourceDeclaration[];

  /** Commands declared by this module (relayed to the plugin via WS). */
  commands?: CommandDeclaration[];
}

export interface DataSourceDeclaration {
  ref: string;          // "shop:items"
  schemaHint?: string;  // documentation only
}

export interface CommandDeclaration {
  name: string;         // "shop:buy"
  schemaHint?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/api/types.ts
git commit -m "feat(backend): add BackendModule interface types"
```

### Task C2: Implement `mountModules` registry

**Files:**
- Create: `backend/src/modules/api/moduleRegistry.ts`
- Test: `backend/src/modules/api/moduleRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/api/moduleRegistry.test.ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { mountModules } from "./moduleRegistry";
import type { BackendModule } from "./types";

describe("mountModules", () => {
  it("calls registerRoutes on each module", () => {
    const calls: string[] = [];
    const modA: BackendModule = {
      id: "a",
      schemaVersion: "a/v1",
      registerRoutes: () => calls.push("a"),
    };
    const modB: BackendModule = {
      id: "b",
      schemaVersion: "b/v1",
      registerRoutes: () => calls.push("b"),
    };

    mountModules(new Hono(), [modA, modB]);

    expect(calls).toEqual(["a", "b"]);
  });

  it("throws on duplicate module id", () => {
    const mod: BackendModule = {
      id: "dup",
      schemaVersion: "dup/v1",
      registerRoutes: () => {},
    };
    expect(() => mountModules(new Hono(), [mod, mod])).toThrow(/duplicate/i);
  });

  it("exposes the list of registered ids via the returned handle", () => {
    const mod: BackendModule = {
      id: "x",
      schemaVersion: "x/v1",
      registerRoutes: () => {},
    };
    const handle = mountModules(new Hono(), [mod]);
    expect(handle.ids()).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && bun test src/modules/api/moduleRegistry.test.ts
```

- [ ] **Step 3: Implement**

```ts
// backend/src/modules/api/moduleRegistry.ts
import type { Hono } from "hono";
import type { BackendModule } from "./types";

export interface ModuleRegistryHandle {
  ids: () => string[];
  get: (id: string) => BackendModule | undefined;
}

export function mountModules(app: Hono, modules: BackendModule[]): ModuleRegistryHandle {
  const seen = new Set<string>();
  const byId = new Map<string, BackendModule>();
  for (const m of modules) {
    if (seen.has(m.id)) {
      throw new Error(`duplicate module id: ${m.id}`);
    }
    seen.add(m.id);
    byId.set(m.id, m);
    m.registerRoutes(app);
  }
  return {
    ids: () => Array.from(byId.keys()),
    get: (id) => byId.get(id),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/modules/api/moduleRegistry.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/api/moduleRegistry.ts \
        backend/src/modules/api/moduleRegistry.test.ts
git commit -m "feat(backend): add mountModules registry helper"
```

---

## Phase D — Backend : wrap existing routes in `MenusModule`

### Task D1: Create `MenusModule` (backend) wrapping existing routers

**Files:**
- Create: `backend/src/modules/menus/index.ts`
- Test: `backend/src/modules/menus/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/menus/index.test.ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { menusModule } from "./index";

describe("menusModule", () => {
  it("has id 'menus' and schema 'menu/v1'", () => {
    expect(menusModule.id).toBe("menus");
    expect(menusModule.schemaVersion).toBe("menu/v1");
  });

  it("registers /api/modules/menus/health on the app", async () => {
    const app = new Hono();
    menusModule.registerRoutes(app);
    const res = await app.request("/api/modules/menus/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.module).toBe("menus");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// backend/src/modules/menus/index.ts
import { Hono } from "hono";
import type { BackendModule } from "../api/types";

/**
 * V1 backend MenusModule — owns the legacy /api/user/packs/* and /api/bundles/* routes.
 *
 * The existing routers in backend/src/routes/userPacks.ts and routes/bundles.ts
 * remain mounted in app.ts for backward compatibility. This module additionally
 * exposes a /api/modules/menus/health endpoint as a marker for the new layout,
 * and is the foundation other modules will follow.
 */
function buildMenusSubrouter(): Hono {
  const sub = new Hono();
  sub.get("/health", (c) => c.json({ module: "menus", schema: "menu/v1" }));
  return sub;
}

export const menusModule: BackendModule = {
  id: "menus",
  schemaVersion: "menu/v1",
  registerRoutes: (app) => {
    app.route("/api/modules/menus", buildMenusSubrouter());
  },
};
```

- [ ] **Step 3: Run tests**

```bash
cd backend && bun test src/modules/menus/index.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/menus/index.ts backend/src/modules/menus/index.test.ts
git commit -m "feat(backend): add menusModule with /api/modules/menus/health"
```

### Task D2: Create `CommandsModule` (backend) placeholder

**Files:**
- Create: `backend/src/modules/commands/index.ts`
- Test: `backend/src/modules/commands/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/commands/index.test.ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { commandsModule } from "./index";

describe("commandsModule", () => {
  it("has id 'commands' and schema 'command/v1'", () => {
    expect(commandsModule.id).toBe("commands");
    expect(commandsModule.schemaVersion).toBe("command/v1");
  });

  it("registers /api/modules/commands/health on the app", async () => {
    const app = new Hono();
    commandsModule.registerRoutes(app);
    const res = await app.request("/api/modules/commands/health");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// backend/src/modules/commands/index.ts
import { Hono } from "hono";
import type { BackendModule } from "../api/types";

function buildCommandsSubrouter(): Hono {
  const sub = new Hono();
  sub.get("/health", (c) => c.json({ module: "commands", schema: "command/v1" }));
  return sub;
}

export const commandsModule: BackendModule = {
  id: "commands",
  schemaVersion: "command/v1",
  registerRoutes: (app) => {
    app.route("/api/modules/commands", buildCommandsSubrouter());
  },
};
```

- [ ] **Step 3: Run tests**

```bash
cd backend && bun test src/modules/commands/index.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/commands/index.ts backend/src/modules/commands/index.test.ts
git commit -m "feat(backend): add commandsModule placeholder"
```

### Task D3: Wire modules into `app.ts`

**Files:**
- Modify: `backend/src/app.ts`
- Test: `backend/src/app.test.ts`

- [ ] **Step 1: Add failing test**

In `backend/src/app.test.ts`, append:

```ts
describe("module registry", () => {
  it("mounts /api/modules/menus/health", async () => {
    const res = await app.request("/api/modules/menus/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.module).toBe("menus");
  });

  it("mounts /api/modules/commands/health", async () => {
    const res = await app.request("/api/modules/commands/health");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Modify `app.ts`**

Add at top of `backend/src/app.ts`:

```ts
import { mountModules } from "./modules/api/moduleRegistry";
import { menusModule } from "./modules/menus";
import { commandsModule } from "./modules/commands";
```

After the last existing `app.route(...)` call (currently `app.route("/api/user/packs", userPacksRouter);`), add:

```ts
mountModules(app, [menusModule, commandsModule]);
```

- [ ] **Step 3: Run tests**

```bash
cd backend && bun test src/app.test.ts
```

Expected: all green (existing tests + 2 new).

- [ ] **Step 4: Run the full backend suite**

```bash
cd backend && bun test
```

Expected: all green (~365 + new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.ts backend/src/app.test.ts
git commit -m "feat(backend): mount module registry in app.ts"
```

---

## Phase E — Editor foundation : `FrontendModule` interface + registry

### Task E1: Define `FrontendModule` type + registry

**Files:**
- Create: `editor/src/modules/api/types.ts`
- Create: `editor/src/modules/api/registry.ts`
- Test: `editor/src/modules/api/registry.test.ts`

- [ ] **Step 1: Write the types file**

```ts
// editor/src/modules/api/types.ts
import type { ComponentType, ReactNode } from "react";

export interface ModuleSidebarEntry {
  /** Lucide icon component or any ReactNode (e.g. SVG). */
  icon: ComponentType<{ className?: string }> | (() => ReactNode);
  label: string;
  /** Route to navigate to when clicked. */
  to: string;
}

export interface ModuleRouteDecl {
  path: string;                  // "/packs/$packId"
  component: ComponentType;       // The route component
}

export interface FrontendModule {
  id: string;
  displayName: string;
  schemaVersion: string;
  sidebar: ModuleSidebarEntry;
  routes: ModuleRouteDecl[];
  /** WS message kinds this module wants to receive. */
  wsMessageTypes?: string[];
  onMount?: () => void;
  onUnmount?: () => void;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// editor/src/modules/api/registry.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { registerModule, listModules, clearRegistry, getModule } from "./registry";
import type { FrontendModule } from "./types";

describe("frontend module registry", () => {
  beforeEach(() => clearRegistry());

  const stub = (id: string): FrontendModule => ({
    id,
    displayName: id,
    schemaVersion: `${id}/v1`,
    sidebar: { icon: () => null, label: id, to: `/${id}` },
    routes: [],
  });

  it("registers modules in order", () => {
    registerModule(stub("menus"));
    registerModule(stub("commands"));
    expect(listModules().map((m) => m.id)).toEqual(["menus", "commands"]);
  });

  it("getModule returns by id", () => {
    registerModule(stub("menus"));
    expect(getModule("menus")?.id).toBe("menus");
    expect(getModule("ghost")).toBeUndefined();
  });

  it("throws on duplicate id", () => {
    registerModule(stub("a"));
    expect(() => registerModule(stub("a"))).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd editor && npx vitest run src/modules/api/registry.test.ts
```

- [ ] **Step 4: Implement the registry**

```ts
// editor/src/modules/api/registry.ts
import type { FrontendModule } from "./types";

const modules: FrontendModule[] = [];
const ids = new Set<string>();

export function registerModule(mod: FrontendModule): void {
  if (ids.has(mod.id)) {
    throw new Error(`duplicate module id: ${mod.id}`);
  }
  ids.add(mod.id);
  modules.push(mod);
}

export function listModules(): readonly FrontendModule[] {
  return modules;
}

export function getModule(id: string): FrontendModule | undefined {
  return modules.find((m) => m.id === id);
}

/** Test-only helper. Do not call from production code. */
export function clearRegistry(): void {
  modules.length = 0;
  ids.clear();
}
```

- [ ] **Step 5: Run tests**

```bash
cd editor && npx vitest run src/modules/api/registry.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add editor/src/modules/api/types.ts \
        editor/src/modules/api/registry.ts \
        editor/src/modules/api/registry.test.ts
git commit -m "feat(editor): add FrontendModule types + registry"
```

---

## Phase F — Editor : module declarations + dynamic sidebar

### Task F1: Create `menusModule` declaration

**Files:**
- Create: `editor/src/modules/menus/index.ts`
- Test: `editor/src/modules/menus/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/src/modules/menus/index.test.ts
import { describe, expect, it } from "vitest";
import { menusModule } from "./index";

describe("menusModule (editor)", () => {
  it("has id 'menus'", () => {
    expect(menusModule.id).toBe("menus");
  });

  it("declares a sidebar entry pointing to /networks", () => {
    expect(menusModule.sidebar.label).toMatch(/menu/i);
    expect(menusModule.sidebar.to).toBe("/networks");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// editor/src/modules/menus/index.ts
import type { FrontendModule } from "../api/types";

/**
 * V1 editor MenusModule — wraps the existing pack/menu editing routes.
 *
 * Routes are still declared via TanStack Router file-based routing
 * (editor/src/routes/*). This module decl is the bridge: it points the
 * sidebar to the network list page, where the user picks a network → pack → menus.
 */
export const menusModule: FrontendModule = {
  id: "menus",
  displayName: "Menus",
  schemaVersion: "menu/v1",
  sidebar: {
    icon: () => null,  // wired with a Lucide icon in F3 after sidebar component lands
    label: "Menus",
    to: "/networks",
  },
  routes: [],  // file-based routes remain owned by TanStack Router for V1
};
```

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/modules/menus/index.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add editor/src/modules/menus/index.ts editor/src/modules/menus/index.test.ts
git commit -m "feat(editor): add menusModule decl pointing to /networks"
```

### Task F2: Create `commandsModule` declaration

**Files:**
- Create: `editor/src/modules/commands/index.ts`
- Test: `editor/src/modules/commands/index.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { commandsModule } from "./index";

describe("commandsModule (editor)", () => {
  it("has id 'commands' and points to /networks", () => {
    expect(commandsModule.id).toBe("commands");
    expect(commandsModule.sidebar.to).toBe("/networks");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// editor/src/modules/commands/index.ts
import type { FrontendModule } from "../api/types";

export const commandsModule: FrontendModule = {
  id: "commands",
  displayName: "Commandes",
  schemaVersion: "command/v1",
  sidebar: {
    icon: () => null,
    label: "Commandes",
    to: "/networks",
  },
  routes: [],
};
```

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/modules/commands/index.test.ts
```

```bash
git add editor/src/modules/commands/index.ts editor/src/modules/commands/index.test.ts
git commit -m "feat(editor): add commandsModule decl"
```

### Task F3: Build `ModuleSidebar` component

**Files:**
- Create: `editor/src/components/ModuleSidebar.tsx`
- Test: `editor/src/components/ModuleSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/components/ModuleSidebar.test.tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter, createRootRoute } from "@tanstack/react-router";
import { ModuleSidebar } from "./ModuleSidebar";
import { registerModule, clearRegistry } from "../modules/api/registry";

function renderInRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("ModuleSidebar", () => {
  beforeEach(() => clearRegistry());

  it("renders one entry per registered module", () => {
    registerModule({
      id: "a", displayName: "Alpha", schemaVersion: "a/v1",
      sidebar: { icon: () => null, label: "Alpha", to: "/" }, routes: [],
    });
    registerModule({
      id: "b", displayName: "Beta", schemaVersion: "b/v1",
      sidebar: { icon: () => null, label: "Beta", to: "/" }, routes: [],
    });
    renderInRouter(<ModuleSidebar />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/components/ModuleSidebar.tsx
import { Link } from "@tanstack/react-router";
import { listModules } from "../modules/api/registry";

export function ModuleSidebar() {
  const modules = listModules();
  return (
    <nav className="flex flex-col gap-1 p-2">
      {modules.map((m) => {
        const Icon = m.sidebar.icon;
        return (
          <Link
            key={m.id}
            to={m.sidebar.to}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <Icon className="size-4" />
            <span>{m.sidebar.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/components/ModuleSidebar.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/ModuleSidebar.tsx \
        editor/src/components/ModuleSidebar.test.tsx
git commit -m "feat(editor): add ModuleSidebar component driven by registry"
```

### Task F4: Register modules at boot in `main.tsx`

**Files:**
- Modify: `editor/src/main.tsx`

- [ ] **Step 1: Add the registrations**

Open `editor/src/main.tsx`. Just before `ReactDOM.createRoot(...)`, add:

```ts
import { registerModule } from "./modules/api/registry";
import { menusModule } from "./modules/menus";
import { commandsModule } from "./modules/commands";

registerModule(menusModule);
registerModule(commandsModule);
```

- [ ] **Step 2: Boot the editor manually + verify console**

```bash
cd editor && npm run dev
```

Then open `http://localhost:5173/`, open DevTools console, run :

```js
window.__interfaze_debug_modules__ ?? "no debug hook — that's OK if no error logged"
```

Expected: no errors at boot. The sidebar isn't visible yet (mounted in F5).

- [ ] **Step 3: Commit**

```bash
git add editor/src/main.tsx
git commit -m "feat(editor): register menus + commands modules at boot"
```

### Task F5: Mount `ModuleSidebar` in `__root.tsx`

**Files:**
- Modify: `editor/src/routes/__root.tsx`

- [ ] **Step 1: Read the current root to understand its layout**

```bash
cat editor/src/routes/__root.tsx
```

- [ ] **Step 2: Add the sidebar above the existing `<Outlet />`**

Wrap the outlet in a flex container with `<ModuleSidebar />` on the left. Add at top of the file:

```tsx
import { ModuleSidebar } from "../components/ModuleSidebar";
```

Replace the component body so it renders:

```tsx
<div className="flex h-screen">
  <aside className="w-56 border-r border-zinc-800 bg-zinc-950">
    <ModuleSidebar />
  </aside>
  <main className="flex-1 overflow-auto">
    <Outlet />
  </main>
</div>
```

(Adapt to whatever the current root layout looks like — keep existing devtools / providers in place.)

- [ ] **Step 3: Smoke test in the browser**

```bash
cd editor && npm run dev
```

Open the editor, log in, see the sidebar with **Menus** and **Commandes** entries.

- [ ] **Step 4: Commit**

```bash
git add editor/src/routes/__root.tsx
git commit -m "feat(editor): mount ModuleSidebar in root layout"
```

---

## Phase G — `<SchemaForm>` component (the multiplier)

### Task G1: Decide between `@rjsf/core` and homemade

**Decision (locked in):** start with a minimal homemade implementation in `editor/src/components/SchemaForm/`. Rationale (from spec section 8): the codebase has a strong custom design system (Tailwind + shadcn), and `@rjsf/core` brings opinionated styling that fights it. Homemade lets us match the existing forms exactly. Scope cap: ~500 lines for V1 (only the field types we use).

Supported types in V1:
- `{ type: "string" }` → `<input type="text">`
- `{ type: "string", enum: [...] }` → `<select>`
- `{ type: "string", format: "long" }` → `<textarea>`
- `{ type: "number" }` / `{ type: "integer" }` → `<input type="number">`
- `{ type: "boolean" }` → `<input type="checkbox">`
- `{ type: "object", properties: {...} }` → nested fieldset
- `{ type: "array", items: {...} }` → list of items with + / − buttons

Out of scope V1: `oneOf`, `anyOf`, `if/then/else`, `$ref` resolution. We add them when a module needs them.

### Task G2: Implement `SchemaForm` for string/number/boolean/enum

**Files:**
- Create: `editor/src/components/SchemaForm/types.ts`
- Create: `editor/src/components/SchemaForm/SchemaForm.tsx`
- Test: `editor/src/components/SchemaForm/SchemaForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/components/SchemaForm/SchemaForm.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchemaForm } from "./SchemaForm";

describe("SchemaForm — primitives", () => {
  it("renders a string field with current value", () => {
    render(<SchemaForm
      schema={{ type: "object", properties: { name: { type: "string", title: "Name" } } }}
      value={{ name: "Iban" }}
      onChange={() => {}}
    />);
    expect(screen.getByLabelText("Name")).toHaveValue("Iban");
  });

  it("calls onChange with patched object when string changes", () => {
    const changes: any[] = [];
    render(<SchemaForm
      schema={{ type: "object", properties: { name: { type: "string", title: "Name" } } }}
      value={{ name: "Iban" }}
      onChange={(v) => changes.push(v)}
    />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Iban2" } });
    expect(changes.at(-1)).toEqual({ name: "Iban2" });
  });

  it("renders a number field", () => {
    render(<SchemaForm
      schema={{ type: "object", properties: { age: { type: "integer", title: "Age" } } }}
      value={{ age: 42 }}
      onChange={() => {}}
    />);
    expect(screen.getByLabelText("Age")).toHaveValue(42);
  });

  it("renders an enum as a select", () => {
    render(<SchemaForm
      schema={{ type: "object", properties: {
        role: { type: "string", title: "Role", enum: ["owner", "admin"] }
      } }}
      value={{ role: "admin" }}
      onChange={() => {}}
    />);
    expect(screen.getByLabelText("Role")).toHaveValue("admin");
  });

  it("renders a boolean as checkbox", () => {
    render(<SchemaForm
      schema={{ type: "object", properties: { enabled: { type: "boolean", title: "Enabled" } } }}
      value={{ enabled: true }}
      onChange={() => {}}
    />);
    expect(screen.getByLabelText("Enabled")).toBeChecked();
  });
});
```

- [ ] **Step 2: Implement `types.ts`**

```ts
// editor/src/components/SchemaForm/types.ts
export type JsonSchema =
  | StringSchema | NumberSchema | BooleanSchema | ObjectSchema | ArraySchema;

export interface StringSchema {
  type: "string";
  title?: string;
  description?: string;
  enum?: string[];
  format?: "long";  // textarea hint
  default?: string;
}

export interface NumberSchema {
  type: "number" | "integer";
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: number;
}

export interface BooleanSchema {
  type: "boolean";
  title?: string;
  description?: string;
  default?: boolean;
}

export interface ObjectSchema {
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, JsonSchema>;
  required?: string[];
}

export interface ArraySchema {
  type: "array";
  title?: string;
  description?: string;
  items: JsonSchema;
  default?: unknown[];
}

export interface SchemaFormProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Custom widgets keyed by `format` value (string-only). */
  widgets?: Record<string, React.ComponentType<{ value: unknown; onChange: (v: unknown) => void; schema: JsonSchema }>>;
}
```

- [ ] **Step 3: Implement `SchemaForm.tsx`**

```tsx
// editor/src/components/SchemaForm/SchemaForm.tsx
import { useId } from "react";
import type { JsonSchema, SchemaFormProps, ObjectSchema, ArraySchema } from "./types";

export function SchemaForm({ schema, value, onChange, widgets }: SchemaFormProps) {
  return <FieldRouter schema={schema} value={value} onChange={onChange} widgets={widgets} />;
}

interface FieldProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  widgets?: SchemaFormProps["widgets"];
  fieldId?: string;
}

function FieldRouter(p: FieldProps) {
  switch (p.schema.type) {
    case "string":  return <StringField {...p} />;
    case "number":
    case "integer": return <NumberField {...p} />;
    case "boolean": return <BooleanField {...p} />;
    case "object":  return <ObjectField {...p} schema={p.schema as ObjectSchema} />;
    case "array":   return <ArrayField {...p} schema={p.schema as ArraySchema} />;
  }
}

function StringField({ schema, value, onChange, widgets, fieldId }: FieldProps) {
  const id = fieldId ?? useId();
  const s = schema as Extract<JsonSchema, { type: "string" }>;
  const custom = s.format && widgets?.[s.format];
  if (custom) {
    const Widget = custom;
    return <Widget value={value} onChange={onChange} schema={schema} />;
  }
  if (s.enum) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {s.title && <span>{s.title}</span>}
        <select id={id} aria-label={s.title} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          {s.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </label>
    );
  }
  if (s.format === "long") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {s.title && <span>{s.title}</span>}
        <textarea id={id} aria-label={s.title} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="min-h-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {s.title && <span>{s.title}</span>}
      <input id={id} aria-label={s.title} type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
    </label>
  );
}

function NumberField({ schema, value, onChange, fieldId }: FieldProps) {
  const id = fieldId ?? useId();
  const s = schema as Extract<JsonSchema, { type: "number" | "integer" }>;
  return (
    <label className="flex flex-col gap-1 text-sm">
      {s.title && <span>{s.title}</span>}
      <input id={id} aria-label={s.title} type="number" value={Number(value ?? 0)} step={s.type === "integer" ? 1 : "any"} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1" />
    </label>
  );
}

function BooleanField({ schema, value, onChange, fieldId }: FieldProps) {
  const id = fieldId ?? useId();
  const s = schema as Extract<JsonSchema, { type: "boolean" }>;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input id={id} aria-label={s.title} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      {s.title && <span>{s.title}</span>}
    </label>
  );
}

function ObjectField({ schema, value, onChange, widgets }: FieldProps & { schema: ObjectSchema }) {
  const obj = (value ?? {}) as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-2">
      {schema.title && <h3 className="text-sm font-semibold">{schema.title}</h3>}
      {Object.entries(schema.properties).map(([key, propSchema]) => (
        <FieldRouter
          key={key}
          schema={propSchema}
          value={obj[key]}
          onChange={(v) => onChange({ ...obj, [key]: v })}
          widgets={widgets}
        />
      ))}
    </div>
  );
}

function ArrayField({ schema, value, onChange, widgets }: FieldProps & { schema: ArraySchema }) {
  const arr = (Array.isArray(value) ? value : []) as unknown[];
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-800 p-2">
      {schema.title && <h3 className="text-sm font-semibold">{schema.title}</h3>}
      {arr.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <FieldRouter schema={schema.items} value={item} onChange={(v) => {
            const next = [...arr]; next[i] = v; onChange(next);
          }} widgets={widgets} />
          <button type="button" onClick={() => onChange(arr.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-400">×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...arr, undefined])} className="self-start text-sm text-zinc-400 hover:text-zinc-200">+ Add</button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd editor && npx vitest run src/components/SchemaForm/SchemaForm.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/SchemaForm/
git commit -m "feat(editor): add SchemaForm component (string/number/boolean/enum/object/array)"
```

### Task G3: Add test for nested object + array

**Files:**
- Modify: `editor/src/components/SchemaForm/SchemaForm.test.tsx`

- [ ] **Step 1: Append integration tests**

```tsx
describe("SchemaForm — nested + array", () => {
  it("renders nested object fields and propagates changes", () => {
    const changes: any[] = [];
    render(<SchemaForm
      schema={{
        type: "object",
        properties: {
          owner: { type: "object", properties: { name: { type: "string", title: "Owner name" } } }
        }
      }}
      value={{ owner: { name: "x" } }}
      onChange={(v) => changes.push(v)}
    />);
    fireEvent.change(screen.getByLabelText("Owner name"), { target: { value: "y" } });
    expect(changes.at(-1)).toEqual({ owner: { name: "y" } });
  });

  it("renders an array of strings with + and − controls", () => {
    const changes: any[] = [];
    render(<SchemaForm
      schema={{
        type: "object",
        properties: {
          tags: { type: "array", title: "Tags", items: { type: "string", title: "Tag" } }
        }
      }}
      value={{ tags: ["a", "b"] }}
      onChange={(v) => changes.push(v)}
    />);
    fireEvent.click(screen.getByText("+ Add"));
    expect(changes.at(-1)).toEqual({ tags: ["a", "b", undefined] });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd editor && npx vitest run src/components/SchemaForm/SchemaForm.test.tsx
```

Expected: PASS (7 tests total).

- [ ] **Step 3: Commit**

```bash
git add editor/src/components/SchemaForm/SchemaForm.test.tsx
git commit -m "test(editor): SchemaForm nested object + array coverage"
```

---

## Phase H — Cross-module event bus (editor side)

### Task H1: Backend WS — broadcast `ConfigReloadEvent` to editor

**Files:**
- Modify: `backend/src/ws/hub.ts`

- [ ] **Step 1: Find the editor broadcast helpers in `hub.ts`**

```bash
grep -n "registerEditorConn\|editorConns\|pushToEditor" backend/src/ws/hub.ts
```

- [ ] **Step 2: Add `pushModuleEvent`**

In `backend/src/ws/hub.ts`, after the existing `pushBundleAvailable` export, add:

```ts
export function pushModuleEvent(serverKeyId: string, event: { kind: "config_reload"; module_id: string }) {
  const conns = editorConnsByServerKey.get(serverKeyId);
  if (!conns) return;
  for (const conn of conns) {
    conn.send(JSON.stringify({ type: "module_event", payload: event }));
  }
}
```

(Adapt the cache name `editorConnsByServerKey` to the real one in the file.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/ws/hub.ts
git commit -m "feat(backend): broadcast module_event over editor WS"
```

### Task H2: Editor — receive `module_event` and forward to listeners

**Files:**
- Modify: `editor/src/state/wsStore.ts` (or wherever WS messages are routed)
- Create: `editor/src/modules/api/eventBus.ts`
- Test: `editor/src/modules/api/eventBus.test.ts`

- [ ] **Step 1: Write the test**

```ts
// editor/src/modules/api/eventBus.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { onModuleEvent, emitModuleEvent, clearModuleBus } from "./eventBus";

describe("editor module event bus", () => {
  beforeEach(() => clearModuleBus());

  it("delivers events to subscribers", () => {
    const seen: string[] = [];
    onModuleEvent("config_reload", (e) => seen.push(e.module_id));
    emitModuleEvent({ kind: "config_reload", module_id: "menus" });
    expect(seen).toEqual(["menus"]);
  });

  it("does not deliver to subscribers of other kinds", () => {
    const seen: string[] = [];
    onModuleEvent("data_reload", (e) => seen.push((e as any).data_source_ref));
    emitModuleEvent({ kind: "config_reload", module_id: "menus" });
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// editor/src/modules/api/eventBus.ts
export type ModuleEvent =
  | { kind: "config_reload"; module_id: string }
  | { kind: "data_reload"; data_source_ref: string };

type Listener = (e: ModuleEvent) => void;
const listeners: Map<string, Set<Listener>> = new Map();

export function onModuleEvent(kind: ModuleEvent["kind"], fn: Listener): () => void {
  if (!listeners.has(kind)) listeners.set(kind, new Set());
  listeners.get(kind)!.add(fn);
  return () => listeners.get(kind)!.delete(fn);
}

export function emitModuleEvent(e: ModuleEvent): void {
  for (const fn of listeners.get(e.kind) ?? []) fn(e);
}

export function clearModuleBus(): void {
  listeners.clear();
}
```

- [ ] **Step 3: Wire `wsStore` to call `emitModuleEvent` on `module_event` messages**

Open `editor/src/state/wsStore.ts`, find the message dispatcher and add a case:

```ts
import { emitModuleEvent, type ModuleEvent } from "../modules/api/eventBus";
// ... inside the existing onMessage / dispatcher:
case "module_event": {
  emitModuleEvent(msg.payload as ModuleEvent);
  break;
}
```

- [ ] **Step 4: Run editor tests**

```bash
cd editor && npx vitest run src/modules/api/eventBus.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/modules/api/eventBus.ts \
        editor/src/modules/api/eventBus.test.ts \
        editor/src/state/wsStore.ts
git commit -m "feat(editor): module event bus + WS routing"
```

---

## Phase I — Docs + sync-docs map

### Task I1: Add architecture section to `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the section near the top of the architecture summary**

Append after the `## Architecture` section, before `### Flux de données`:

```markdown
### Pattern modulaire (depuis 2026-05-25)

Interfaze suit le pattern **modular monolith** spécifié dans `docs/architecture/modules.md`. Chaque module vit en 3 layers symétriques :

- Plugin : `plugin/src/main/kotlin/gg/interfaze/modules/{id}/` — implements `InterfazeModule`
- Backend : `backend/src/modules/{id}/` — exports `BackendModule`
- Éditeur : `editor/src/modules/{id}/` — exports `FrontendModule`

Communication cross-module via deux registries plugin-side : `DataSourceRegistry` (`namespace:source_id`) et `CommandRegistry` (`namespace:command`). Aucune dépendance directe entre modules.

V1 modules : `menus`, `commands`. V1.5+ : `shop`. Le code menus/commands existant reste dans `gg.interfaze.plugin.engine` / `command` ; les classes `MenusModule` / `CommandsModule` sont des wrappers fins. Move physique différé (voir section 13 de la spec).

**Quand ajouter un module :**
1. Spec dans `docs/architecture/modules.md` (ajouter section "Module {id}")
2. Layer plugin : nouvelle classe sous `gg.interfaze.modules.{id}/` impl `InterfazeModule`
3. Layer backend : nouveau dir `modules/{id}/index.ts` exporte un `BackendModule`
4. Layer éditeur : `editor/src/modules/{id}/index.ts` exporte `FrontendModule`, `registerModule(...)` dans `main.tsx`
5. Schema JSON dans `modules/{id}/schemas/` si form-based — utiliser `<SchemaForm>`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): document modular monolith pattern"
```

### Task I2: Update `sync-docs` map

**Files:**
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1: Add mappings**

Append entries:

```yaml
  - touches: "plugin/src/main/kotlin/gg/interfaze/modules/api/"
    updates:
      - "CLAUDE.md"
      - "docs/architecture/modules.md"
    reason: "Module API surface (interfaces, registries) — changes here affect every module"

  - touches: "backend/src/modules/api/"
    updates:
      - "CLAUDE.md"
      - "docs/architecture/modules.md"
    reason: "Backend module API surface"

  - touches: "editor/src/modules/api/"
    updates:
      - "CLAUDE.md"
      - "docs/architecture/modules.md"
    reason: "Frontend module API surface"

  - touches: "editor/src/components/SchemaForm/"
    updates:
      - "CLAUDE.md"
    reason: "SchemaForm is the module form multiplier — any new feature documented in CLAUDE.md form-gen section"
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs(sync-docs): map module API + SchemaForm"
```

### Task I3: Add `SchemaForm` developer note

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add SchemaForm section**

After the modular monolith section just added, add:

```markdown
### `<SchemaForm>` — générateur de formulaires depuis JSON Schema

`editor/src/components/SchemaForm/` génère des formulaires React depuis un JSON Schema. Couvre `string` (texte / textarea / select via `enum`), `number`/`integer`, `boolean`, `object` (nesting), `array` (avec + / −).

**Pour ajouter un widget custom** (color picker, asset picker, MiniMessage editor, etc.) :

```ts
import { SchemaForm } from "@/components/SchemaForm";
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): SchemaForm usage + custom widgets"
```

---

## Final verification

### Task J1: Run all three test suites

- [ ] Run `cd plugin && ./gradlew test`
- [ ] Expected: all green (~365 existing + ~13 new from Phase A-B)

- [ ] Run `cd backend && bun test`
- [ ] Expected: all green (~365 + ~7 new from Phase C-D)

- [ ] Run `cd editor && npx vitest run`
- [ ] Expected: all green (~720 + ~12 new from Phase E-H)

### Task J2: Docker smoke test

- [ ] `docker compose up` — backend, editor, MC up
- [ ] In the editor browser, see the new sidebar with **Menus** + **Commandes** entries on the left of every page
- [ ] `curl http://localhost:3001/api/modules/menus/health` returns `{"module":"menus","schema":"menu/v1"}`
- [ ] `curl http://localhost:3001/api/modules/commands/health` returns `{"module":"commands","schema":"command/v1"}`
- [ ] In-game `/ifz reload` — verify plugin logs no errors (modules `onReload()` fires harmlessly)

### Task J3: Manual integration check — module bus

- [ ] In two browser tabs, open the same pack
- [ ] Make a change in tab A, observe tab B receives `module_event` (DevTools network → WS frames)
- [ ] Confirm the editor doesn't crash if a `module_event` arrives for an unknown `kind` (forward-compat)

---

## Self-Review

**1. Spec coverage** — Mapped each section of `docs/architecture/modules.md` to tasks :

| Spec section | Covered by |
|---|---|
| §3.1 Frontend module | E1 (interface), F1–F2 (decl), F3–F5 (sidebar + boot) |
| §3.2 Backend module | C1 (interface), C2 (registry), D1–D3 (decl + mount) |
| §3.3 Plugin module | A1 (interface), A5 (API), B1–B4 (decls + wire) |
| §4.1 Data sources | A2 (registry) ; consumer wiring deferred — no current consumer code |
| §4.2 Commands | A3 (registry) ; consumer wiring deferred — same reason |
| §5 Module bundles | OUT OF SCOPE (V1.5+) — explicitly listed in plan goal |
| §6 Cross-module nav | E1, F1–F2 — sidebar entries point at routes |
| §7 Versioning / migrations | OUT OF SCOPE — only schemaVersion field carried, migration code not yet needed |
| §8 SchemaForm | G1–G3 |
| §9 V1 modules | menus + commands implemented in all 3 layers |
| §10 V1 add | All 3 sub-bullets covered (Plugin/Backend/Frontend) |
| §11 NOT in V1 | Respected — no dynamic loading, no SDK |
| §12 Risks (hot-reload) | H1–H2 (event bus) |

**2. Placeholder scan** — Searched for "TBD", "TODO", "implement later", "appropriate" — none in the plan body. The wrappers in B1–B2 intentionally have empty `onEnable` bodies for V1 — this is documented (V1 keeps the existing instantiation in `InterfazePlugin.onEnable`) and isn't a placeholder, it's a deliberate skeletal step preserving existing behavior.

**3. Type consistency**
- `InterfazeModule.id`, `BackendModule.id`, `FrontendModule.id` — all `string`
- `schemaVersion` consistent across all 3 (`"menu/v1"`, `"command/v1"`)
- `DataSourceDeclaration.ref` (plugin) is `string`; backend `DataSourceDeclaration.ref` mirror
- `registerModule` / `mountModules` / `mountModules` (the editor and backend use different names — that's correct, they're different functions on different layers and each registry has slightly different semantics : the editor registry is a singleton, the backend registry returns a handle)

**4. Notable deliberate omissions**
- Phase B5 explicitly defers physical relocation of `engine/`, `command/`, etc. (documented in `docs/architecture/modules.md` §13).
- DataSource/Command **consumers** (i.e. menus that consume `shop:items`) — no current code consumes the registry. Wiring the consumer side belongs to the V1.5 shop module plan, not this migration.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-modular-monolith-architecture.md`.**
