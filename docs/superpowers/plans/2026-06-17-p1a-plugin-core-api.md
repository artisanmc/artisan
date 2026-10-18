# P1a — Plugin: publishable core-api + runtime module registration seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A separate `depend:[Artisan]` plugin can obtain `ArtisanAPI` (via Bukkit `ServicesManager`), call `api.modules.register(module)` at runtime, and that module appears in the `installed_modules` the core reports to the backend — including when it registers *after* the WS `hello` (via a new `modules_changed` message). Plus: the `net.artisanmc.modules.api.**` surface is published as a consumable Maven artifact `net.artisanmc:artisan-core-api`.

**Architecture:** Break the `ArtisanAPI → ArtisanPlugin` back-reference (widen `plugin` to `JavaPlugin`) so `api/` compiles standalone. Add a `ModuleRegistry` to `ArtisanAPI` (`register`/`active`/`has`) plus `isCompatibleWith`. Route core modules (menus, commands) through the registry; source `installed_modules` from `registry.active()` via a **dynamic supplier** read at hello-send time, and emit `modules_changed` when the registry changes post-connect. Expose `ArtisanAPI` through Bukkit `ServicesManager`. Publish a filtered `apiJar`.

**Tech stack:** Kotlin 2.0.21, Paper 1.21.7 API, Gradle 8.9, shadow 8.1.8, MockBukkit + MockWebServer (tests); backend Bun + Hono (the `modules_changed` handler).

**Scope boundaries (deferred):**
- The **real separate `artisan-quests` plugin repo** + cross-repo Gradle composite / consuming the published artifact = **P1c**. P1a proves the seam with a MockBukkit integration test simulating an external registrant, and proves publishing via `publishToMavenLocal`.
- The full Gradle **`:api` subproject split** = P1c. P1a publishes a **filtered `apiJar`** from the existing single module.
- Proper published-POM dependencies (paper-api as provided) = P1c. P1a's mavenLocal publication is artifact-only (consumers add paper-api).
- Supersedes `modules.md §3.3.2`'s `getPlugin("Artisan") as ArtisanCorePlugin` sketch — we use **`ServicesManager`** (the api artifact deliberately ships no `ArtisanPlugin` class to cast to).

**Commands:** plugin from `plugin/` (`rtk ./gradlew test`, `rtk ./gradlew publishToMavenLocal`); backend from `backend/` (**`rtk bun run test`** — NEVER `bun test` direct, it wipes the dev DB). git from repo root. Prefix with `rtk`.

**Branch:** `feat/plugin-core-api` off `8ad67bf6` (canvas-nav's pre-WIP HEAD — has the plugin hash work, none of the editor WIP). *(Set up by the orchestrator before Task 1.)*

---

## File Structure

**New (api):**
- `plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt` — runtime registry (`register`/`active`/`has`/`bind`) + `DuplicateModuleException`
- `plugin/src/main/kotlin/net/artisanmc/modules/api/SemVer.kt` — minimal version compare for `isCompatibleWith`
- `plugin/src/test/kotlin/net/artisanmc/modules/api/ModuleRegistryTest.kt`
- `plugin/src/test/kotlin/net/artisanmc/modules/api/SemVerTest.kt`

**Modified (plugin):**
- `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt` — `plugin: JavaPlugin`; `+ modules`, `+ coreVersion`, `+ isCompatibleWith`
- `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` — build+bind registry; register core modules through it; ServicesManager; dynamic supplier; onDisable/reinit
- `plugin/src/main/kotlin/net/artisanmc/plugin/ws/WsClient.kt` — `installedModules` → supplier; `installedModules()` at hello
- `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` — `installedModules` → supplier; `notifyModulesChanged(...)`
- `plugin/build.gradle.kts` — `maven-publish` + `apiJar`

**Modified (backend):**
- `backend/src/protocol.ts` — `ModulesChangedMessage`
- `backend/src/ws/hub.ts` — `modules_changed` handler

**Modified (tests / docs):**
- `plugin/src/test/kotlin/net/artisanmc/plugin/ArtisanPluginModuleWiringTest.kt` — adapt to registry
- `plugin/src/test/kotlin/net/artisanmc/plugin/ModuleRegistrationIntegrationTest.kt` — NEW E2E seam test
- `backend/src/ws/hub.test.ts` — `modules_changed` case
- `docs/architecture/ws-protocol.md`, `docs/architecture/api-surface.md`, `CHANGELOG.md`

---

## Task 1: `ModuleRegistry` + `SemVer` (new api classes, TDD)

Standalone new classes — they don't touch `ArtisanAPI` yet, so the plugin still compiles. TDD each.

**Files:** Create the 2 classes + 2 test files above.

- [ ] **Step 1: Write the failing `SemVer` test**

`plugin/src/test/kotlin/net/artisanmc/modules/api/SemVerTest.kt`:

```kotlin
package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SemVerTest {
    @Test fun `same version satisfies`() = assertTrue(SemVer.satisfies("1.0.0", "1.0.0"))
    @Test fun `higher core minor satisfies`() = assertTrue(SemVer.satisfies("1.5.0", "1.0.0"))
    @Test fun `higher core patch satisfies`() = assertTrue(SemVer.satisfies("1.0.3", "1.0.1"))
    @Test fun `lower core minor fails`() = assertFalse(SemVer.satisfies("1.0.0", "1.2.0"))
    @Test fun `different major fails`() = assertFalse(SemVer.satisfies("2.0.0", "1.0.0"))
    @Test fun `snapshot suffix is ignored`() = assertTrue(SemVer.satisfies("1.0.0-SNAPSHOT", "1.0.0"))
}
```

- [ ] **Step 2: Run it — fails (no `SemVer`)**

Run: `rtk ./gradlew test --tests "net.artisanmc.modules.api.SemVerTest"` (from `plugin/`)
Expected: FAIL (unresolved `SemVer`).

- [ ] **Step 3: Implement `SemVer`**

`plugin/src/main/kotlin/net/artisanmc/modules/api/SemVer.kt`:

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable

/** Minimal SemVer compare for module↔core compatibility (same major; core >= min). */
@Stable
object SemVer {
    private fun parse(v: String): Triple<Int, Int, Int> {
        val p = v.substringBefore("-").split(".").map { it.toIntOrNull() ?: 0 }
        return Triple(p.getOrElse(0) { 0 }, p.getOrElse(1) { 0 }, p.getOrElse(2) { 0 })
    }

    /** True if [core] is the same major as [min] and >= it. */
    @Stable
    fun satisfies(core: String, min: String): Boolean {
        val c = parse(core)
        val m = parse(min)
        if (c.first != m.first) return false
        if (c.second != m.second) return c.second > m.second
        return c.third >= m.third
    }
}
```

- [ ] **Step 4: Run — passes**

Run: `rtk ./gradlew test --tests "net.artisanmc.modules.api.SemVerTest"`
Expected: PASS.

- [ ] **Step 5: Write the failing `ModuleRegistry` test**

`plugin/src/test/kotlin/net/artisanmc/modules/api/ModuleRegistryTest.kt`:

```kotlin
package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ModuleRegistryTest {
    private fun module(moduleId: String) = object : ArtisanModule {
        override val id = moduleId
        override val schemaVersion = "$moduleId/v1"
        var enabled = false
        override fun onEnable(api: ArtisanAPI) { enabled = true }
        override fun onDisable() {}
    }

    private fun boundRegistry(onChange: () -> Unit = {}): Pair<ModuleRegistry, ArtisanAPI> {
        val reg = ModuleRegistry()
        // A throwaway ArtisanAPI is enough — register() only passes it to onEnable.
        val api = ArtisanAPI(
            plugin = org.bukkit.plugin.java.JavaPlugin::class.java.let { null as org.bukkit.plugin.java.JavaPlugin? } ?: error("unused"),
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
            schemas = net.artisanmc.modules.api.schemas.SchemaRegistry(),
            modules = reg,
            coreVersion = "1.0.0",
        )
        reg.bind(api, onChange)
        return reg to api
    }

    @Test fun `register enables, lists, and signals change`() {
        var changes = 0
        val (reg, _) = boundRegistry { changes++ }
        val m = module("quests")
        reg.register(m)
        assertTrue(reg.has("quests"))
        assertEquals(listOf("quests"), reg.active().map { it.id })
        assertEquals(1, changes)
    }

    @Test fun `duplicate id throws`() {
        val (reg, _) = boundRegistry()
        reg.register(module("quests"))
        assertFailsWith<DuplicateModuleException> { reg.register(module("quests")) }
    }

    @Test fun `unbound registry errors on register`() {
        val reg = ModuleRegistry()
        assertFailsWith<IllegalStateException> { reg.register(module("quests")) }
    }

    @Test fun `has is false for unknown`() {
        val (reg, _) = boundRegistry()
        assertFalse(reg.has("ghost"))
    }
}
```

> Note: the `boundRegistry` helper constructs a real `ArtisanAPI`. Because `plugin: JavaPlugin` is non-null, the helper can't fabricate one without MockBukkit. **Simpler**: change the helper to take the api from a MockBukkit plugin, OR (preferred) make the test not need a real plugin by having `register` tolerate the api it's given. The implementer should use MockBukkit (`MockBukkit.mock()` → `MockBukkit.load(...)` or a stub `JavaPlugin`) to get a `JavaPlugin` for the throwaway api, mirroring `ArtisanPluginModuleWiringTest`. If that's heavy, an acceptable alternative is to assert `register` calls `onEnable` by having the registry expose the passed api — but do NOT weaken the duplicate/has/unbound assertions.

- [ ] **Step 6: Run it — fails**

Run: `rtk ./gradlew test --tests "net.artisanmc.modules.api.ModuleRegistryTest"`
Expected: FAIL (`ModuleRegistry`/`DuplicateModuleException` unresolved). (Also won't compile until Task 2 adds `modules`/`coreVersion` to `ArtisanAPI` — so if the test references those, either land Task 1's `ModuleRegistry` impl first and stub the api in the test via MockBukkit, or fold the `ArtisanAPI` constructor change into this task. The implementer may pull the `ArtisanAPI` constructor change (Task 2 Step "extend ArtisanAPI") forward if needed to compile this test — that's acceptable; note it.)

- [ ] **Step 7: Implement `ModuleRegistry`**

`plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt`:

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Internal
import net.artisanmc.modules.api.annotations.Stable
import java.util.concurrent.CopyOnWriteArrayList

/** Thrown when a module id is registered twice. */
@Stable
class DuplicateModuleException(val moduleId: String) :
    IllegalStateException("module already registered: $moduleId")

/**
 * The live set of modules active in this Core process. Core modules (menus,
 * commands) are registered at boot; business-module plugins register at their
 * own `onEnable` via the [ArtisanAPI] obtained from the Bukkit ServicesManager.
 */
@Stable
class ModuleRegistry {
    private val activeModules = CopyOnWriteArrayList<ArtisanModule>()
    private var api: ArtisanAPI? = null
    private var onChange: (() -> Unit)? = null

    /** Core-internal wiring; called once at boot. NOT part of the module contract. */
    @Internal
    fun bind(api: ArtisanAPI, onChange: () -> Unit) {
        this.api = api
        this.onChange = onChange
    }

    /** Enable [module] and signal a presence change. Throws on duplicate id. */
    @Stable
    fun register(module: ArtisanModule) {
        if (activeModules.any { it.id == module.id }) throw DuplicateModuleException(module.id)
        val boundApi = api ?: error("ModuleRegistry is not bound to an ArtisanAPI yet")
        activeModules.add(module)
        module.onEnable(boundApi)
        onChange?.invoke()
    }

    @Stable
    fun active(): List<ArtisanModule> = activeModules.toList()

    @Stable
    fun has(id: String): Boolean = activeModules.any { it.id == id }
}
```

- [ ] **Step 8: Run — passes** (`rtk ./gradlew test --tests "net.artisanmc.modules.api.ModuleRegistryTest"` → PASS) then **commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt plugin/src/main/kotlin/net/artisanmc/modules/api/SemVer.kt plugin/src/test/kotlin/net/artisanmc/modules/api/ModuleRegistryTest.kt plugin/src/test/kotlin/net/artisanmc/modules/api/SemVerTest.kt
rtk git commit -m "feat(plugin): add ModuleRegistry + SemVer to the module api"
```

---

## Task 2: Wire the registry + dynamic presence (the core of P1a)

Cohesive integration: break the back-ref, extend `ArtisanAPI`, route core modules through the registry, make `installed_modules` a supplier, add `notifyModulesChanged`. The plugin is edited across several files and verified green at the end (one commit). **Read each current file before editing** (use the anchors below).

**Files:** `ArtisanAPI.kt`, `ArtisanPlugin.kt`, `ws/WsClient.kt`, `provider/SyncedMenuProvider.kt`, and adapt `ArtisanPluginModuleWiringTest.kt`.

- [ ] **Step 1: Extend `ArtisanAPI` (break back-ref)**

Replace `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt` body. Change the import `net.artisanmc.plugin.ArtisanPlugin` → `org.bukkit.plugin.java.JavaPlugin`, widen `plugin`, add `modules`, `coreVersion`, `isCompatibleWith`:

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import net.artisanmc.modules.api.schemas.SchemaRegistry
import org.bukkit.plugin.java.JavaPlugin

/**
 * Facade passed to every module at `onEnable(api)`. Modules compile against the
 * published `artisan-core-api` artifact and obtain this via the Bukkit
 * ServicesManager: `server.servicesManager.getRegistration(ArtisanAPI::class.java)?.provider`.
 */
@Stable
class ArtisanAPI(
    @Stable val plugin: JavaPlugin,
    @Stable val dataSources: DataSourceRegistry,
    @Stable val commands: CommandRegistry,
    @Stable val events: ModuleEventBus,
    @Stable val schemas: SchemaRegistry<MutableMap<String, Any?>>,
    @Stable val modules: ModuleRegistry,
    @Stable val coreVersion: String,
) {
    /** True if the running core satisfies a module's minimum required version. */
    @Stable
    fun isCompatibleWith(minVersion: String): Boolean = SemVer.satisfies(coreVersion, minVersion)
}
```

- [ ] **Step 2: Rework `buildApi` + core-module registration in `ArtisanPlugin`**

In `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`:

(a) Remove the static module list field. Delete line 33:
```kotlin
    private val modules: List<ArtisanModule> = defaultModules()
```

(b) Replace the `buildApi` companion function (current lines 41–47) with a version that creates + binds the registry. The `onChange` callback resends presence through the (cast) menu provider, guarded so it no-ops before `menuProvider` is initialised:

```kotlin
        fun buildApi(plugin: ArtisanPlugin): ArtisanAPI {
            val registry = ModuleRegistry()
            val api = ArtisanAPI(
                plugin = plugin,
                dataSources = DataSourceRegistry(),
                commands = CommandRegistry(),
                events = ModuleEventBus(),
                schemas = SchemaRegistry(),
                modules = registry,
                coreVersion = plugin.description.version,
            )
            registry.bind(api) {
                if (plugin::menuProvider.isInitialized) {
                    (plugin.menuProvider as? SyncedMenuProvider)?.notifyModulesChanged(
                        registry.active().map { mapOf("id" to it.id, "version" to plugin.description.version) },
                    )
                }
            }
            return api
        }
```

(c) In `onEnable()`, current line 52–53 are:
```kotlin
        api = buildApi(this)
        modules.forEach { it.onEnable(api) }
```
Replace with just building the api (core modules are registered later, after `menuProvider` exists):
```kotlin
        api = buildApi(this)
```

(d) The `installedModules = modules.map { ... }` arg in the `SyncedMenuProvider(...)` construction (current line 81) becomes a **supplier** reading the registry:
```kotlin
            installedModules = { api.modules.active().map { mapOf("id" to it.id, "version" to description.version) } },
```

(e) **Register the core modules through the registry**, immediately after `menuProvider` is assigned (right after the `SyncedMenuProvider(...)` block ends, current ~line 82, before the custom-items setup). This way `onChange` sees an initialised `menuProvider` (and no-ops because the WS isn't connected yet), and the later `menuProvider.load()` hello reads the supplier:
```kotlin
        defaultModules().forEach { api.modules.register(it) }
```

(f) `onDisable()` (current line 142) iterates `modules` — change to the registry:
```kotlin
        api.modules.active().forEach { runCatching { it.onDisable() } }
```

(g) `reinit()` references `modules` at the `installedModules` arg (current line 236) and the `onReload` (line 230). Change the `installedModules` arg to the same supplier `{ api.modules.active().map { mapOf("id" to it.id, "version" to description.version) } }`, and `onReload`'s `modules.forEach { runCatching { it.onReload() } }` → `api.modules.active().forEach { runCatching { it.onReload() } }`. (The `onReload` at line 75 in `onEnable` likewise: `api.modules.active().forEach { runCatching { it.onReload() } }`.)

- [ ] **Step 3: Make `WsClient.installedModules` a supplier**

In `plugin/src/main/kotlin/net/artisanmc/plugin/ws/WsClient.kt`:

Constructor param (current line 16):
```kotlin
    private val installedModules: List<Map<String, String>> = emptyList(),
```
→
```kotlin
    private val installedModules: () -> List<Map<String, String>> = { emptyList() },
```

`onOpen` hello (current line 60):
```kotlin
        "installed_modules" to installedModules,
```
→
```kotlin
        "installed_modules" to installedModules(),
```

- [ ] **Step 4: Supplier + `notifyModulesChanged` in `SyncedMenuProvider`**

In `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`:

Constructor param (current line ~62):
```kotlin
    private val installedModules: List<Map<String, String>> = emptyList(),
```
→
```kotlin
    private val installedModules: () -> List<Map<String, String>> = { emptyList() },
```

The `WsClient(...)` construction (current line ~119) passes `installedModules = installedModules` — it now passes the supplier straight through (same identifier, now a lambda). No change needed beyond the type.

Add a public method (mirror `notifyCustomItemsReload` at line ~186):
```kotlin
    /** Re-report presence to the backend after the active module set changed. */
    fun notifyModulesChanged(modules: List<Map<String, String>>) {
        wsClient?.send(mapOf(
            "type" to "modules_changed",
            "server_key" to serverKey,
            "installed_modules" to modules,
        ))
    }
```

- [ ] **Step 5: Adapt `ArtisanPluginModuleWiringTest`**

`ArtisanPluginModuleWiringTest.kt` asserts `defaultModules()` and that `buildApi` populates the registries. Update it so: after enabling the plugin via MockBukkit, `plugin.api.modules.active().map { it.id }` contains `menus` + `commands` (they now flow through the registry), and `plugin.api.isCompatibleWith("1.0.0")` is true, and `plugin.api.modules` is non-null. Keep the existing "exposes an ArtisanAPI after enable" assertion. Read the current test and adapt minimally.

- [ ] **Step 6: Verify the whole plugin suite green**

Run: `rtk ./gradlew test` (from `plugin/`)
Expected: BUILD SUCCESSFUL, all tests pass — including `WsClientTest` (its `sends installed_modules in hello` now passes a supplier; if that test constructs `WsClient(installedModules = listOf(...))`, update it to `installedModules = { listOf(...) }`), `FullSyncIntegrationTest`, and the adapted wiring test. Fix any compile breaks from the supplier type change (search for `installedModules =` call sites).

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/main/kotlin/net/artisanmc/plugin/ws/WsClient.kt plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/test/kotlin/net/artisanmc/plugin/ArtisanPluginModuleWiringTest.kt
# plus WsClientTest.kt if it needed the supplier update:
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/WsClientTest.kt
rtk git commit -m "feat(plugin): route modules through ModuleRegistry + dynamic installed_modules + modules_changed"
```

---

## Task 3: Expose `ArtisanAPI` via `ServicesManager`

**Files:** `ArtisanPlugin.kt` (+ an assertion in `ArtisanPluginModuleWiringTest.kt`).

- [ ] **Step 1: Register the service in `onEnable`**

In `ArtisanPlugin.onEnable()`, right after `api = buildApi(this)`, register the API as a Bukkit service so external `depend:[Artisan]` plugins can look it up:

```kotlin
        server.servicesManager.register(ArtisanAPI::class.java, api, this, org.bukkit.plugin.ServicePriority.Normal)
```

- [ ] **Step 2: Test it's retrievable**

Add a test to `ArtisanPluginModuleWiringTest.kt`: after enabling, the service is registered and returns the same `api`:

```kotlin
    @Test fun `ArtisanAPI is exposed via the services manager`() {
        // (inside the existing MockBukkit setup that loads ArtisanPlugin as `plugin`)
        val provided = plugin.server.servicesManager
            .getRegistration(ArtisanAPI::class.java)?.provider
        assertNotNull(provided)
        assertSame(plugin.api, provided)
    }
```

(Adapt to the file's existing MockBukkit load/teardown idiom.)

- [ ] **Step 3: Run + commit**

Run: `rtk ./gradlew test --tests "net.artisanmc.plugin.ArtisanPluginModuleWiringTest"` → PASS.

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/test/kotlin/net/artisanmc/plugin/ArtisanPluginModuleWiringTest.kt
rtk git commit -m "feat(plugin): expose ArtisanAPI through the Bukkit ServicesManager"
```

---

## Task 4: Backend `modules_changed` handler (TDD)

**Files:** `backend/src/protocol.ts`, `backend/src/ws/hub.ts`, `backend/src/ws/hub.test.ts`. **Use `rtk bun run test` — NEVER `bun test` direct (wipes the dev DB).**

- [ ] **Step 1: Add the message type**

In `backend/src/protocol.ts`, add:

```ts
export interface ModulesChangedMessage {
  type: "modules_changed";
  server_key: string;
  installed_modules: { id: string; version: string }[];
}
```

(If there's a `PluginToServerMessage` union, add `ModulesChangedMessage` to it.)

- [ ] **Step 2: Write the failing test**

In `backend/src/ws/hub.test.ts`, add a case (mirror the existing hello→`persistServerModules` test): a connection that has said `hello` (so `connToServerId` is populated) then sends `modules_changed` with a new module → `server_modules` for that server now includes it. Follow the file's existing harness for driving `handlePluginMessage` and asserting on `server_modules` rows. Example shape:

```ts
it("persists modules on modules_changed", async () => {
  // ... establish a server_key + a hello so connToServerId is set for connId ...
  await handlePluginMessage(connId, JSON.stringify({
    type: "modules_changed",
    server_key: rawKey,
    installed_modules: [{ id: "menus", version: "1.0.0" }, { id: "quests", version: "0.1.0" }],
  }));
  const rows = await db.select().from(serverModules).where(eq(serverModules.serverKeyId, keyId));
  expect(rows.map((r) => r.moduleId).sort()).toEqual(["menus", "quests"]);
});
```

- [ ] **Step 3: Run — fails**

Run: `rtk bun run test src/ws/hub.test.ts` (from `backend/`)
Expected: FAIL (no handler → no persistence).

- [ ] **Step 4: Implement the handler**

In `backend/src/ws/hub.ts`, add after the `pong` handler (current line ~403), before `pack_divergence_detected`:

```ts
  if (msg.type === "modules_changed") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const m = msg as ModulesChangedMessage;
    await persistServerModules(serverId, m.installed_modules ?? []).catch(() => {});
    return { reply: null };
  }
```

Add `ModulesChangedMessage` to the existing protocol import at the top of `hub.ts`.

- [ ] **Step 5: Run — passes + full backend suite**

Run: `rtk bun run test src/ws/hub.test.ts` → PASS. Then `rtk bun run test` (full) → green.

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/protocol.ts backend/src/ws/hub.ts backend/src/ws/hub.test.ts
rtk git commit -m "feat(backend): handle modules_changed WS message (presence refresh)"
```

---

## Task 5: Publish `artisan-core-api` (maven-publish, filtered apiJar)

**Files:** `plugin/build.gradle.kts`.

- [ ] **Step 1: Add `maven-publish` + `apiJar` + publication**

In `plugin/build.gradle.kts`, add `` `maven-publish` `` to the `plugins {}` block:

```kotlin
plugins {
    kotlin("jvm") version "2.0.21"
    id("io.github.goooler.shadow") version "8.1.8"
    `maven-publish`
}
```

After the `tasks.shadowJar { ... }` block, add a filtered jar containing only the api package + a publication:

```kotlin
// Publishable, self-contained API surface (net.artisanmc.modules.api.**).
// Business-module plugins compileOnly this + paper-api. The full :api Gradle
// subproject split is deferred (cf. P1c); this filtered jar proves the boundary.
val apiJar by tasks.registering(Jar::class) {
    archiveBaseName.set("artisan-core-api")
    archiveClassifier.set("")
    from(sourceSets.main.get().output) {
        include("net/artisanmc/modules/api/**")
    }
}

publishing {
    publications {
        create<MavenPublication>("coreApi") {
            groupId = "net.artisanmc"
            artifactId = "artisan-core-api"
            version = project.version.toString()
            artifact(apiJar)
        }
    }
}
```

- [ ] **Step 2: Verify it publishes to mavenLocal**

Run: `rtk ./gradlew publishToMavenLocal` (from `plugin/`)
Expected: BUILD SUCCESSFUL.

Run: `ls ~/.m2/repository/net/artisanmc/artisan-core-api/1.0.0-SNAPSHOT/` (or the project version)
Expected: the `artisan-core-api-1.0.0-SNAPSHOT.jar` + `.pom` are present.

Sanity-check the jar is self-contained (contains the api classes, references no plugin internals):
Run: `unzip -l ~/.m2/repository/net/artisanmc/artisan-core-api/*/artisan-core-api-*.jar | grep -E "ArtisanAPI|ModuleRegistry|ArtisanModule"`
Expected: lists `net/artisanmc/modules/api/ArtisanAPI.class`, `ModuleRegistry.class`, `ArtisanModule.class`, etc., and **no** `net/artisanmc/plugin/` classes.

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/build.gradle.kts
rtk git commit -m "build(plugin): publish artisan-core-api (filtered apiJar) to maven"
```

---

## Task 6: Integration test — external registrant → presence (the seam proof)

**Files:** Create `plugin/src/test/kotlin/net/artisanmc/plugin/ModuleRegistrationIntegrationTest.kt`.

Proves the full plugin-side pipe: a simulated external plugin obtains the API via the ServicesManager and registers a module *after* the hello handshake → a `modules_changed` frame carrying the new module reaches the backend (MockWebServer). Follow `FullSyncIntegrationTest`'s MockBukkit + MockWebServer harness and `WsClientTest`'s frame-capture pattern.

- [ ] **Step 1: Write the test**

```kotlin
package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.mockbukkit.mockbukkit.MockBukkit
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class ModuleRegistrationIntegrationTest {
    private val mapper = ObjectMapper()

    @BeforeTest fun setUp() { MockBukkit.mock() }
    @AfterTest fun tearDown() { MockBukkit.unmock() }

    @Test fun `external plugin registering a module emits modules_changed with it`() {
        val frames = ConcurrentLinkedQueue<String>()
        val gotModulesChanged = CountDownLatch(1)

        MockWebServer().use { server ->
            server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    frames.add(text)
                    val node = mapper.readTree(text)
                    if (node["type"]?.asText() == "modules_changed") gotModulesChanged.countDown()
                }
            }))
            server.start()

            // Load the Core plugin pointed at the mock WS.
            val plugin = loadArtisanPointedAt(server.url("/ws/plugin").toString())

            // Simulate an external depend:[Artisan] plugin obtaining the API + registering.
            val api = plugin.server.servicesManager.getRegistration(ArtisanAPI::class.java)!!.provider
            assertTrue(api.isCompatibleWith("1.0.0"))
            api.modules.register(object : ArtisanModule {
                override val id = "quests"
                override val schemaVersion = "quests/v1"
                override fun onEnable(api: ArtisanAPI) {}
                override fun onDisable() {}
            })

            assertTrue(gotModulesChanged.await(5, TimeUnit.SECONDS), "no modules_changed frame received")
            val changed = frames.map { mapper.readTree(it) }
                .last { it["type"]?.asText() == "modules_changed" }
            val ids = changed["installed_modules"].map { it["id"].asText() }
            assertTrue("quests" in ids && "menus" in ids, "expected menus+quests, got $ids")
        }
    }
}
```

> The helper `loadArtisanPointedAt(wsUrl)` must load `ArtisanPlugin` under MockBukkit with config pointing `ws-url` at the mock server and a test `server-key`. **Reuse the exact loading idiom from `FullSyncIntegrationTest`** (which already configures `SyncedMenuProvider`/the plugin against a MockWebServer) — read that file and mirror how it sets `wsUrl`/`serverKey` and triggers `load()`. If the existing harness builds a `SyncedMenuProvider` directly rather than the full plugin, adapt: build the plugin via `MockBukkit.load(ArtisanPlugin::class.java)` after writing a `config.yml` with the mock `ws-url`, OR drive a `SyncedMenuProvider` with the supplier + call `notifyModulesChanged` directly through `api`'s onChange. The assertion that matters: registering a module post-hello produces a `modules_changed` frame containing it.

- [ ] **Step 2: Run — passes**

Run: `rtk ./gradlew test --tests "net.artisanmc.plugin.ModuleRegistrationIntegrationTest"`
Expected: PASS. (If the full-plugin load under MockBukkit is too heavy/flaky, fall back to the lighter `SyncedMenuProvider` + `setSendForTesting`/frame-capture path noted above — but keep the assertion that the registered module reaches a `modules_changed` payload.)

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/ModuleRegistrationIntegrationTest.kt
rtk git commit -m "test(plugin): external registrant emits modules_changed with its module"
```

---

## Task 7: Docs + final verification

**Files:** `docs/architecture/ws-protocol.md`, `docs/architecture/api-surface.md`, `CHANGELOG.md`.

- [ ] **Step 1: Docs**

- `ws-protocol.md`: add `modules_changed` (plugin → backend: `{type, server_key, installed_modules}`; effect: backend re-runs `persistServerModules`). Note `installed_modules` in `hello` is now sourced from the live `ModuleRegistry`.
- `api-surface.md`: add `ModuleRegistry` (`register`/`active`/`has`, `@Stable`; `bind` `@Internal`), `ArtisanAPI.modules`/`coreVersion`/`isCompatibleWith`, the `plugin: JavaPlugin` widening, and that `ArtisanAPI` is obtained via `ServicesManager`. Note the published `net.artisanmc:artisan-core-api` artifact.
- `CHANGELOG.md` `[Unreleased]`: entry for the new api surface + `modules_changed` + the published artifact.

- [ ] **Step 2: Final verification (all layers)**

Run (plugin): `rtk ./gradlew test` → BUILD SUCCESSFUL.
Run (plugin): `rtk ./gradlew publishToMavenLocal` → BUILD SUCCESSFUL.
Run (backend): `rtk bun run test` → green.

- [ ] **Step 3: Commit**

```bash
rtk git add docs/architecture/ws-protocol.md docs/architecture/api-surface.md CHANGELOG.md
rtk git commit -m "docs(modules): document modules_changed + ModuleRegistry api surface"
```

---

## Self-Review notes (for the executor)

- **Compatibility:** the back-ref widening (`plugin: JavaPlugin`) is safe because nothing in `api/` used `ArtisanPlugin`-specific members, and `ArtisanPlugin` *is* a `JavaPlugin`. Search for other `installedModules =` call sites after the supplier change — `WsClientTest` likely needs `{ listOf(...) }`.
- **Boot ordering:** core modules are registered *after* `menuProvider` exists but *before* `load()` connects → `onChange` no-ops (WS not open), and the initial hello reads the supplier (includes them). External modules registering post-hello hit `notifyModulesChanged` → `modules_changed`. Both timings covered.
- **Auth on `modules_changed`:** like every post-hello handler, it trusts `connToServerId` membership (no re-validate). The plugin still includes `server_key` in the payload for parity, but the backend keys off the established connection.
- **Type/name consistency:** `ModuleRegistry` (`register`/`active`/`has`/`bind`), `DuplicateModuleException`, `SemVer.satisfies`, `ArtisanAPI.modules`/`coreVersion`/`isCompatibleWith`, `notifyModulesChanged`, message type `modules_changed`. Module id `quests`.
- **Deferred (not P1a):** real separate repo + composite/consume-published (P1c), `:api` subproject split (P1c), POM provided-deps (P1c), editor live-update on `modules_changed` (editor re-reads presence on next integrate; live push = P3).
