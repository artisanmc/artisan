# Scaffold Backend, Plugin & WebSocket Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Kotlin/Paper plugin, Hono/Bun backend, and WebSocket bridge, wiring them to the existing export pipeline already built in the frontend.

**Architecture:** Three new directories at repo root: `plugin/` (Kotlin/Paper plugin that reads exported YAML bundles from disk or cloud), `backend/` (Hono 4 on Bun, manages server keys and WebSocket hub for plugin connections), and the frontend gains a `web/src/lib/ws/` layer. The plugin first works offline via `FilesystemMenuProvider` (reads YAML written by the export pipeline from `plugins/Artisan/packs/`), then gains `CloudMenuProvider` that connects to the backend via WebSocket for live draft updates. The backend validates server keys, performs the `hello`/`hello_ack` handshake, and routes `draft_update` messages from the editor to the connected plugin.

**Tech Stack:** Kotlin 2.0 + Paper API 1.21.4 + Gradle 8.9 + Jackson YAML + OkHttp 4.12; Hono 4 + Bun 1.x + Drizzle ORM + `bun:sqlite`; Vitest (frontend WS tests).

---

## File Map

| File | What it does |
|---|---|
| `plugin/settings.gradle.kts` | Gradle project name |
| `plugin/build.gradle.kts` | Kotlin 2.0, Paper API, Jackson, OkHttp, shadow |
| `plugin/src/main/resources/plugin.yml` | Plugin manifest for Paper |
| `plugin/src/main/resources/config.yml` | Default config (mode, server_key, packs_dir) |
| `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` | Plugin entry — selects provider by config |
| `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt` | Typed wrapper over `FileConfiguration` |
| `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt` | Data classes matching the exported YAML schema |
| `plugin/src/main/kotlin/net/artisanmc/plugin/yaml/PackReader.kt` | Reads all packs under `packs_dir/` |
| `plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt` | Interface: load, findMenu, openMenu |
| `plugin/src/main/kotlin/net/artisanmc/plugin/provider/FilesystemMenuProvider.kt` | Implements MenuProvider from disk |
| `plugin/src/main/kotlin/net/artisanmc/plugin/provider/CloudMenuProvider.kt` | Implements MenuProvider via WebSocket |
| `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt` | Bukkit inventory creation from MenuYaml |
| `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt` | `/artisan menu <id>` and `/artisan reload` |
| `plugin/src/main/kotlin/net/artisanmc/plugin/ws/WsClient.kt` | OkHttp WS client with exponential backoff |
| `backend/package.json` | Bun project |
| `backend/tsconfig.json` | TypeScript config |
| `backend/drizzle.config.ts` | Drizzle-kit config |
| `backend/src/app.ts` | Hono app with all routes mounted |
| `backend/src/index.ts` | Bun server entry |
| `backend/src/db/schema.ts` | `server_keys` table |
| `backend/src/db/index.ts` | SQLite DB via `bun:sqlite` |
| `backend/src/routes/serverKeys.ts` | POST/GET `/api/server-keys` |
| `backend/src/ws/hub.ts` | `handlePluginMessage` — hello → hello_ack |
| `web/src/lib/ws/pluginBridge.ts` | WS client factory with reconnect |
| `web/src/state/wsStore.ts` | Zustand store: connected state + bridge |

---

### Task 1: Plugin Gradle scaffold

**Files:**
- Create: `plugin/settings.gradle.kts`
- Create: `plugin/build.gradle.kts`
- Create: `plugin/gradle/wrapper/gradle-wrapper.properties`
- Create: `plugin/src/main/resources/plugin.yml`
- Create: `plugin/src/main/resources/config.yml`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/PluginLoadTest.kt`

- [ ] **Step 1: Create the Gradle wrapper properties**

Write `plugin/gradle/wrapper/gradle-wrapper.properties`:
```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.9-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

Then bootstrap the wrapper scripts (requires Gradle installed system-wide once):
```powershell
cd plugin
gradle wrapper --gradle-version 8.9
```

After this, every subsequent command uses `gradlew.bat` (Windows) instead of `gradle`.

- [ ] **Step 2: Write settings.gradle.kts and build.gradle.kts**

`plugin/settings.gradle.kts`:
```kotlin
rootProject.name = "artisan-plugin"
```

`plugin/build.gradle.kts`:
```kotlin
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21"
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

group = "net.artisanmc"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
    }
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    maven("https://jitpack.io")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.4-R0.1-SNAPSHOT")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation(kotlin("test"))
    testImplementation("com.github.seeseemelk:MockBukkit-v1.21:3.133.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

tasks.test {
    useJUnitPlatform()
}

tasks.shadowJar {
    relocate("com.fasterxml.jackson", "net.artisanmc.shaded.jackson")
    relocate("okhttp3", "net.artisanmc.shaded.okhttp3")
    relocate("okio", "net.artisanmc.shaded.okio")
}
```

- [ ] **Step 3: Write plugin.yml and config.yml**

`plugin/src/main/resources/plugin.yml`:
```yaml
name: Artisan
version: '1.0.0'
main: net.artisanmc.plugin.ArtisanPlugin
api-version: '1.21'
description: Artisan GUI editor plugin
commands:
  ifz:
    description: Artisan commands
    usage: /artisan <menu|reload> [args]
```

`plugin/src/main/resources/config.yml`:
```yaml
# "local" reads YAML from disk; "cloud" connects to the backend via WebSocket
mode: local

# Only used in cloud mode
server_key: ""
ws_url: "wss://editor.artisanmc.net/ws/plugin"

# Path relative to the server root where exported pack bundles are placed
packs_dir: "plugins/Artisan/packs"
```

- [ ] **Step 4: Write the failing test**

`plugin/src/test/kotlin/net/artisanmc/plugin/PluginLoadTest.kt`:
```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertNotNull

class PluginLoadTest {
    @BeforeTest
    fun setup() {
        MockBukkit.mock()
    }

    @AfterTest
    fun teardown() {
        MockBukkit.unmock()
    }

    @Test
    fun `plugin loads without throwing`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        assertNotNull(plugin)
    }
}
```

- [ ] **Step 5: Run the test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "net.artisanmc.plugin.PluginLoadTest"
```
Expected: BUILD FAILED — `ArtisanPlugin` class not found.

- [ ] **Step 6: Write the minimal plugin class**

`plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`:
```kotlin
package net.artisanmc.plugin

import org.bukkit.plugin.java.JavaPlugin

class ArtisanPlugin : JavaPlugin() {
    override fun onEnable() {
        logger.info("Artisan ${description.version} enabled")
    }

    override fun onDisable() {
        logger.info("Artisan disabled")
    }
}
```

- [ ] **Step 7: Run the test — confirm it passes**

```powershell
cd plugin
gradlew.bat test --tests "net.artisanmc.plugin.PluginLoadTest"
```
Expected: BUILD SUCCESSFUL — 1 test passed.

- [ ] **Step 8: Commit**

```bash
git add plugin/
git commit -m "feat(plugin): scaffold Kotlin/Paper plugin with Gradle build"
```

---

### Task 2: Pack YAML reader

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/yaml/PackReader.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/PackReaderTest.kt`

The export pipeline in the frontend already produces this layout:

```
plugins/Artisan/packs/<packId>/
  manifest.yaml        — schema, pack_id, default_lang, languages[], files.menus[], files.commands[]
  menus/<id>.yaml      — schema, id, title (as "{i18n:key}"), size, layers
  commands/<id>.yaml   — schema, id, name, aliases, steps
  lang/<code>.yaml     — flat key→value map
```

- [ ] **Step 1: Write the failing test**

`plugin/src/test/kotlin/net/artisanmc/plugin/PackReaderTest.kt`:
```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.PackReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PackReaderTest {

    private fun writeTempPack(): File {
        val root = createTempDir("artisan_packs_")
        val packDir = File(root, "p_test").apply { mkdirs() }

        File(packDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            pack_id: p_test
            default_lang: en
            languages:
              - en
              - fr
            files:
              menus:
                - m_shop
              commands: []
        """.trimIndent())

        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m_shop.yaml").writeText("""
            schema: menu/v1
            id: m_shop
            title: "{i18n:menus.m_shop.title}"
            size: 27
            layers:
              - id: l_default
                name: default
                elements: []
        """.trimIndent())

        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("menus.m_shop.title: Shop\n")
        File(packDir, "lang/fr.yaml").writeText("menus.m_shop.title: Boutique\n")

        return root
    }

    @Test
    fun `reads manifest and resolves menu title for default lang`() {
        val packsRoot = writeTempPack()
        val bundles = PackReader(packsRoot).readAll()

        assertEquals(1, bundles.size)
        val bundle = bundles.first()
        assertEquals("p_test", bundle.packId)
        assertEquals("en", bundle.defaultLang)
        assertEquals(1, bundle.menus.size)
        assertNotNull(bundle.menus.first())
        assertEquals("m_shop", bundle.menus.first().id)
        assertEquals("Shop", bundle.menus.first().resolveTitle("en"))
    }

    @Test
    fun `resolveTitle falls back to i18n tag when lang has no entry`() {
        val packsRoot = writeTempPack()
        val bundle = PackReader(packsRoot).readAll().first()
        assertEquals("Boutique", bundle.menus.first().resolveTitle("fr"))
    }

    @Test
    fun `resolveTitle returns raw tag when lang file absent`() {
        val packsRoot = writeTempPack()
        val bundle = PackReader(packsRoot).readAll().first()
        assertEquals("{i18n:menus.m_shop.title}", bundle.menus.first().resolveTitle("de"))
    }
}
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "net.artisanmc.plugin.PackReaderTest"
```
Expected: FAIL — `PackReader` not found.

- [ ] **Step 3: Write the data model**

`plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`:
```kotlin
package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(
    val schema: String = "",
    @JsonProperty("pack_id") val packId: String = "",
    @JsonProperty("default_lang") val defaultLang: String = "en",
    val languages: List<String> = emptyList(),
    val files: ManifestFiles = ManifestFiles(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestFiles(
    val menus: List<String> = emptyList(),
    val commands: List<String> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class MenuYaml(
    val schema: String = "",
    val id: String = "",
    val title: String = "",
    val size: Int = 27,
    val permission: String? = null,
    val layers: List<LayerYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class LayerYaml(
    val id: String = "",
    val name: String = "",
    val elements: List<ElementYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ElementYaml(
    val id: String = "",
    val positions: String = "",
    val appearances: List<AppearanceYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class AppearanceYaml(
    val material: String? = null,
    val count: Int = 1,
    val title: String? = null,
    val lore: List<String> = emptyList(),
    val click: Map<String, ClickHandlerYaml> = emptyMap(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ClickHandlerYaml(
    val steps: List<Map<String, Any>> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandYaml(
    val schema: String = "",
    val id: String = "",
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val permission: String? = null,
    val description: String? = null,
    val arguments: List<Map<String, Any>> = emptyList(),
    val steps: List<Map<String, Any>> = emptyList(),
)

/** Assembled result for one pack — all menus plus their lang maps. */
data class PackBundle(
    val packId: String,
    val defaultLang: String,
    val languages: List<String>,
    val menus: List<BundleMenu>,
    val commands: List<CommandYaml>,
)

/** One menu with its per-language translation maps bundled in. */
data class BundleMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
) {
    val id: String get() = yaml.id

    /**
     * Resolves `{i18n:key}` in `yaml.title` using the given lang.
     * Falls back to the raw tag if lang has no entry (e.g. "de" not in bundle).
     */
    fun resolveTitle(lang: String): String {
        val raw = yaml.title
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMaps[lang]?.get(key) ?: raw
    }
}
```

- [ ] **Step 4: Write the PackReader**

`plugin/src/main/kotlin/net/artisanmc/plugin/yaml/PackReader.kt`:
```kotlin
package net.artisanmc.plugin.yaml

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.*
import java.io.File

class PackReader(private val packsRoot: File) {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    fun readAll(): List<PackBundle> =
        packsRoot.listFiles { f -> f.isDirectory }
            ?.mapNotNull { readPack(it) }
            ?: emptyList()

    private fun readPack(packDir: File): PackBundle? {
        val manifestFile = File(packDir, "manifest.yaml").takeIf { it.exists() } ?: return null
        val manifest = mapper.readValue(manifestFile, ManifestYaml::class.java)

        val langMaps: Map<String, Map<String, String>> = manifest.languages.associateWith { lang ->
            val langFile = File(packDir, "lang/$lang.yaml")
            if (langFile.exists()) {
                @Suppress("UNCHECKED_CAST")
                mapper.readValue(langFile, Map::class.java) as Map<String, String>
            } else emptyMap()
        }

        val menus = manifest.files.menus.mapNotNull { menuId ->
            val f = File(packDir, "menus/$menuId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            BundleMenu(mapper.readValue(f, MenuYaml::class.java), langMaps)
        }

        val commands = manifest.files.commands.mapNotNull { cmdId ->
            val f = File(packDir, "commands/$cmdId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            mapper.readValue(f, CommandYaml::class.java)
        }

        return PackBundle(manifest.packId, manifest.defaultLang, manifest.languages, menus, commands)
    }
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test --tests "net.artisanmc.plugin.PackReaderTest"
```
Expected: BUILD SUCCESSFUL — 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/
git commit -m "feat(plugin): add PackBundle data model and PackReader for exported YAML bundles"
```

---

### Task 3: FilesystemMenuProvider + inventory renderer + /artisan command

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/FilesystemMenuProvider.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/FilesystemMenuProviderTest.kt`

- [ ] **Step 1: Write the failing test**

`plugin/src/test/kotlin/net/artisanmc/plugin/FilesystemMenuProviderTest.kt`:
```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.provider.FilesystemMenuProvider
import java.io.File
import kotlin.test.*

class FilesystemMenuProviderTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: ArtisanPlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
    }

    @AfterTest
    fun teardown() {
        MockBukkit.unmock()
    }

    private fun writePackFixture(packsRoot: File) {
        val packDir = File(packsRoot, "p_test").apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("""
            schema: manifest/v1
            pack_id: p_test
            default_lang: en
            languages: [en]
            files:
              menus: [m_shop]
              commands: []
        """.trimIndent())
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m_shop.yaml").writeText("""
            schema: menu/v1
            id: m_shop
            title: "{i18n:menus.m_shop.title}"
            size: 27
            layers:
              - id: l_def
                name: default
                elements:
                  - id: el_btn
                    positions: "13"
                    appearances:
                      - material: PAPER
                        title: "{i18n:menus.m_shop.elements.el_btn.default.title}"
        """.trimIndent())
        File(packDir, "lang").mkdirs()
        File(packDir, "lang/en.yaml").writeText("""
            menus.m_shop.title: Shop
            menus.m_shop.elements.el_btn.default.title: Buy
        """.trimIndent())
    }

    @Test
    fun `resolves menu by id`() {
        val packsRoot = createTempDir("artisan_packs_")
        writePackFixture(packsRoot)
        val provider = FilesystemMenuProvider(packsRoot)
        provider.load()
        val menu = provider.findMenu("m_shop")
        assertNotNull(menu)
        assertEquals("Shop", menu.resolveTitle("en"))
    }

    @Test
    fun `openMenu creates a 27-slot inventory for the player`() {
        val packsRoot = createTempDir("artisan_packs_")
        writePackFixture(packsRoot)
        val provider = FilesystemMenuProvider(packsRoot)
        provider.load()
        val player = server.addPlayer()
        provider.openMenu(player, "m_shop", "en")
        assertNotNull(player.openInventory)
        assertEquals(27, player.openInventory.topInventory.size)
    }
}
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "net.artisanmc.plugin.FilesystemMenuProviderTest"
```
Expected: FAIL — `FilesystemMenuProvider` not found.

- [ ] **Step 3: Write the MenuProvider interface**

`plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt`:
```kotlin
package net.artisanmc.plugin.provider

import net.artisanmc.plugin.model.BundleMenu
import org.bukkit.entity.Player

interface MenuProvider {
    fun load()
    fun findMenu(menuId: String): BundleMenu?
    fun openMenu(player: Player, menuId: String, lang: String)
}
```

- [ ] **Step 4: Write the MenuRenderer**

`plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`:
```kotlin
package net.artisanmc.plugin.render

import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.kyori.adventure.text.Component
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.ItemStack

object MenuRenderer {

    fun open(player: Player, menu: BundleMenu, lang: String) {
        val titleText = menu.resolveTitle(lang)
        val inv = Bukkit.createInventory(null, menu.yaml.size, Component.text(titleText))
        populate(inv, menu, lang)
        player.openInventory(inv)
    }

    private fun populate(inv: Inventory, menu: BundleMenu, lang: String) {
        val langMap = menu.langMaps[lang] ?: emptyMap()
        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val appearance = element.appearances.firstOrNull() ?: continue
                val item = buildItem(appearance, langMap)
                for (slot in parsePositions(element.positions, menu.yaml.size)) {
                    inv.setItem(slot, item)
                }
            }
        }
    }

    private fun buildItem(app: AppearanceYaml, langMap: Map<String, String>): ItemStack {
        val material = app.material
            ?.let { runCatching { Material.valueOf(it.uppercase()) }.getOrNull() }
            ?: Material.STONE
        val item = ItemStack(material, app.count.coerceAtLeast(1))
        val meta = item.itemMeta ?: return item
        if (app.title != null) {
            val resolved = resolveI18n(app.title, langMap)
            meta.displayName(Component.text(resolved))
        }
        if (app.lore.isNotEmpty()) {
            meta.lore(app.lore.map { Component.text(resolveI18n(it, langMap)) })
        }
        item.itemMeta = meta
        return item
    }

    private fun resolveI18n(raw: String, langMap: Map<String, String>): String {
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMap[key] ?: raw
    }

    /**
     * Parses a positions string like "13", "0,8", or "0-8" into slot indices.
     * Slots outside the inventory size are silently dropped.
     */
    private fun parsePositions(positions: String, size: Int): List<Int> =
        positions.split(",").flatMap { part ->
            val t = part.trim()
            if (t.contains("-")) {
                val (a, b) = t.split("-").map { it.trim().toInt() }
                (a..b).toList()
            } else {
                listOf(t.toIntOrNull() ?: return@flatMap emptyList())
            }
        }.filter { it in 0 until size }
}
```

- [ ] **Step 5: Write the FilesystemMenuProvider**

`plugin/src/main/kotlin/net/artisanmc/plugin/provider/FilesystemMenuProvider.kt`:
```kotlin
package net.artisanmc.plugin.provider

import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.yaml.PackReader
import org.bukkit.entity.Player
import java.io.File

class FilesystemMenuProvider(private val packsDir: File) : MenuProvider {
    private val menus = mutableMapOf<String, BundleMenu>()

    override fun load() {
        menus.clear()
        PackReader(packsDir).readAll().forEach { bundle ->
            bundle.menus.forEach { menu -> menus[menu.id] = menu }
        }
    }

    override fun findMenu(menuId: String): BundleMenu? = menus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = menus[menuId] ?: run {
            player.sendMessage("Menu '$menuId' not found.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }
}
```

- [ ] **Step 6: Write the /artisan command**

`plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`:
```kotlin
package net.artisanmc.plugin.command

import net.artisanmc.plugin.ArtisanPlugin
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class ArtisanCommand(private val plugin: ArtisanPlugin) : CommandExecutor {
    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        if (sender !is Player) {
            sender.sendMessage("This command can only be run by a player.")
            return true
        }
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                val menuId = args.getOrNull(1) ?: run {
                    sender.sendMessage("Usage: /artisan menu <id>")
                    return true
                }
                plugin.menuProvider.openMenu(sender, menuId, "en")
            }
            "reload" -> {
                plugin.menuProvider.load()
                sender.sendMessage("Artisan reloaded.")
            }
            else -> sender.sendMessage("Usage: /artisan menu <id> | /artisan reload")
        }
        return true
    }
}
```

- [ ] **Step 7: Wire everything in ArtisanPlugin**

`plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`:
```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.provider.FilesystemMenuProvider
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val packsDir = File(dataFolder.parentFile, config.getString("packs_dir", "plugins/Artisan/packs")!!)
        packsDir.mkdirs()
        menuProvider = FilesystemMenuProvider(packsDir)
        menuProvider.load()
        getCommand("ifz")?.setExecutor(ArtisanCommand(this))
        logger.info("Artisan ${description.version} enabled — packs loaded from $packsDir")
    }

    override fun onDisable() {
        logger.info("Artisan disabled")
    }
}
```

- [ ] **Step 8: Run all tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test
```
Expected: BUILD SUCCESSFUL — all tests pass.

- [ ] **Step 9: Commit**

```bash
git add plugin/src/
git commit -m "feat(plugin): FilesystemMenuProvider, MenuRenderer, /artisan command"
```

---

### Task 4: Backend Bun/Hono scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/drizzle.config.ts`
- Create: `backend/src/db/schema.ts`
- Create: `backend/src/db/index.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/index.ts`
- Create: `backend/src/app.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/app.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("GET /health", () => {
  test("returns 200 with ok: true", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd backend
bun test
```
Expected: error — cannot find module `./app`.

- [ ] **Step 3: Write package.json and tsconfig.json**

`backend/package.json`:
```json
{
  "name": "artisan-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "drizzle-orm": "^0.31.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "drizzle-kit": "^0.22.0",
    "typescript": "^5.4.5"
  }
}
```

`backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "drizzle.config.ts"]
}
```

- [ ] **Step 4: Install dependencies**

```powershell
cd backend
bun install
```
Expected: `bun.lock` created, `node_modules` populated.

- [ ] **Step 5: Write the DB schema and connection**

`backend/src/db/schema.ts`:
```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const serverKeys = sqliteTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

`backend/src/db/index.ts`:
```ts
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

const sqlite = new Database(process.env.DB_PATH ?? "artisan.db");
export const db = drizzle(sqlite, { schema });
```

`backend/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "artisan.db" },
});
```

- [ ] **Step 6: Write the app and server entry**

`backend/src/app.ts`:
```ts
import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
```

`backend/src/index.ts`:
```ts
import { app } from "./app";

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

console.log(`Artisan backend listening on http://localhost:${port}`);
```

- [ ] **Step 7: Run test — confirm it passes**

```powershell
cd backend
bun test
```
Expected: 1 test passed.

- [ ] **Step 8: Push DB schema**

```powershell
cd backend
bun run db:push
```
Expected: `artisan.db` created, `server_keys` table exists.

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold Hono/Bun backend with health endpoint and SQLite schema"
```

---

### Task 5: Server key generation API

**Files:**
- Create: `backend/src/routes/serverKeys.ts`
- Modify: `backend/src/app.ts`
- Create: `backend/src/routes/serverKeys.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/routes/serverKeys.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { app } from "../app";

describe("server keys API", () => {
  test("POST /api/server-keys returns a sk_ key", async () => {
    const res = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "my-server" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; id: string };
    expect(body.key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(body.id).toBeDefined();
  });

  test("GET /api/server-keys lists keys with masked prefix", async () => {
    await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "list-test" }),
    });
    const res = await app.request("/api/server-keys");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; keyPrefix: string }>;
    expect(body.length).toBeGreaterThan(0);
    // keyPrefix masks the stored hash, not the plaintext key
    expect(body[0].keyPrefix).toMatch(/^[0-9a-f]{8}\.\.\.$/);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd backend
bun test src/routes/serverKeys.test.ts
```
Expected: FAIL — 404 on `POST /api/server-keys`.

- [ ] **Step 3: Write the server keys route**

`backend/src/routes/serverKeys.ts`:
```ts
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";

const router = new Hono();

router.post("/", async (c) => {
  const body = await c.req.json<{ label?: string }>();

  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = "sk_" + Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");

  const id = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id,
    hash,
    label: body.label ?? null,
    createdAt: new Date(),
  });

  return c.json({ id, key }, 201);
});

router.get("/", async (c) => {
  const rows = await db.select().from(serverKeys);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      keyPrefix: `${r.hash.slice(0, 8)}...`,
    })),
  );
});

export { router as serverKeysRouter };
```

- [ ] **Step 4: Mount the route in app.ts**

`backend/src/app.ts`:
```ts
import { Hono } from "hono";
import { serverKeysRouter } from "./routes/serverKeys";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
```

- [ ] **Step 5: Run all backend tests — confirm they pass**

```powershell
cd backend
bun test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/
git commit -m "feat(backend): server key generation and listing API"
```

---

### Task 6: WebSocket hub — hello/hello_ack

**Files:**
- Create: `backend/src/protocol.ts`
- Create: `backend/src/ws/hub.ts`
- Create: `backend/src/ws/hub.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the protocol types**

`backend/src/protocol.ts`:
```ts
export interface HelloMessage {
  type: "hello";
  server_key: string;
  plugin_version: string;
  minecraft_version: string;
  current_bundle_hash: string;
}

export interface HelloAckMessage {
  type: "hello_ack";
  session_id: string;
  server_id: string;
  tier: "free" | "crew" | "network";
  needs_sync: boolean;
  latest_bundle_hash: string;
}

export interface BundleAvailableMessage {
  type: "bundle_available";
  pack_id: string;
  url: string;
  hash: string;
  signature: string;
}

export interface DraftUpdateMessage {
  type: "draft_update";
  pack_id: string;
  menu_id: string;
  menu_yaml: string;
}

export interface PingMessage { type: "ping" }
export interface PongMessage { type: "pong" }

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage;

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage;
```

- [ ] **Step 2: Write the failing hub test**

`backend/src/ws/hub.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { handlePluginMessage } from "./hub";
import type { HelloMessage, HelloAckMessage } from "../protocol";

describe("handlePluginMessage", () => {
  test("hello with unknown key returns null", async () => {
    const hello: HelloMessage = {
      type: "hello",
      server_key: "sk_doesnotexist",
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(JSON.stringify(hello));
    expect(result).toBeNull();
  });

  test("hello with valid key returns hello_ack", async () => {
    // First create a key
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "hub-test" }),
    });
    const { key } = (await createRes.json()) as { key: string };

    const hello: HelloMessage = {
      type: "hello",
      server_key: key,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const result = await handlePluginMessage(JSON.stringify(hello));
    expect(result).not.toBeNull();
    const ack = JSON.parse(result!) as HelloAckMessage;
    expect(ack.type).toBe("hello_ack");
    expect(ack.session_id).toBeDefined();
    expect(ack.tier).toBe("free");
  });
});
```

- [ ] **Step 3: Run test — confirm it fails**

```powershell
cd backend
bun test src/ws/hub.test.ts
```
Expected: FAIL — `handlePluginMessage` not found.

- [ ] **Step 4: Write the hub**

`backend/src/ws/hub.ts`:
```ts
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import type { HelloAckMessage, HelloMessage } from "../protocol";

/** session_id → server DB row id */
const activeSessions = new Map<string, string>();

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Processes a raw JSON string received from a plugin WebSocket.
 * Returns a JSON string to send back, or null if no response should be sent.
 */
export async function handlePluginMessage(raw: string): Promise<string | null> {
  let msg: { type: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }

  if (msg.type === "hello") {
    const hello = msg as HelloMessage;
    const keyId = await validateServerKey(hello.server_key);
    if (!keyId) return null;

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, keyId);

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: false,
      latest_bundle_hash: "",
    };
    return JSON.stringify(ack);
  }

  if (msg.type === "pong") return null;

  return null;
}
```

- [ ] **Step 5: Wire WebSocket into the app**

`backend/src/app.ts`:
```ts
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { serverKeysRouter } from "./routes/serverKeys";
import { handlePluginMessage } from "./ws/hub";

const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono();
export { websocket };

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);

app.get(
  "/ws/plugin",
  upgradeWebSocket(() => ({
    async onMessage(evt, ws) {
      const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
      const reply = await handlePluginMessage(raw);
      if (reply) ws.send(reply);
    },
    onError: (err) => console.error("WS error:", err),
  })),
);
```

`backend/src/index.ts`:
```ts
import { app, websocket } from "./app";

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
  websocket,
};

console.log(`Artisan backend on http://localhost:${port}`);
```

- [ ] **Step 6: Run all backend tests — confirm they pass**

```powershell
cd backend
bun test
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/
git commit -m "feat(backend): WebSocket hub with hello/hello_ack handshake and session tracking"
```

---

### Task 7: Frontend WebSocket bridge

**Files:**
- Create: `web/src/lib/ws/pluginBridge.ts`
- Create: `web/src/lib/ws/pluginBridge.test.ts`
- Create: `web/src/state/wsStore.ts`

- [ ] **Step 1: Write the failing test**

`web/src/lib/ws/pluginBridge.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { createPluginBridge } from "./pluginBridge";

describe("createPluginBridge", () => {
  it("calls onMessage handlers when a frame is received", () => {
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: WebSocket.OPEN,
      onopen: null as ((e: Event) => void) | null,
      onmessage: null as ((e: MessageEvent) => void) | null,
      onclose: null as ((e: CloseEvent) => void) | null,
      onerror: null as ((e: Event) => void) | null,
    };
    const factory = vi.fn(() => ws as unknown as WebSocket);

    const received: string[] = [];
    const bridge = createPluginBridge("ws://localhost:3001/ws/plugin", factory);
    bridge.onMessage((msg) => received.push(msg));
    bridge.connect();

    ws.onmessage?.({ data: '{"type":"hello_ack"}' } as MessageEvent);
    expect(received).toEqual(['{"type":"hello_ack"}']);
  });

  it("unregisters handler when returned cleanup is called", () => {
    const ws = { send: vi.fn(), close: vi.fn(), readyState: WebSocket.OPEN,
      onopen: null, onmessage: null, onclose: null, onerror: null };
    const factory = vi.fn(() => ws as unknown as WebSocket);

    const received: string[] = [];
    const bridge = createPluginBridge("ws://x", factory);
    const off = bridge.onMessage((msg) => received.push(msg));
    bridge.connect();
    off();
    ws.onmessage?.({ data: '{"type":"ping"}' } as MessageEvent);
    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd web
rtk vitest run src/lib/ws/pluginBridge.test.ts
```
Expected: FAIL — cannot find `./pluginBridge`.

- [ ] **Step 3: Write the bridge**

`web/src/lib/ws/pluginBridge.ts`:
```ts
type MessageHandler = (raw: string) => void;
type WsFactory = (url: string) => WebSocket;

export interface PluginBridge {
  connect(): void;
  disconnect(): void;
  send(msg: object): void;
  onMessage(handler: MessageHandler): () => void;
}

export function createPluginBridge(
  url: string,
  wsFactory: WsFactory = (u) => new WebSocket(u),
): PluginBridge {
  let ws: WebSocket | null = null;
  const handlers = new Set<MessageHandler>();
  let retryDelay = 1_000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    ws = wsFactory(url);

    ws.onopen = () => {
      retryDelay = 1_000;
    };

    ws.onmessage = (evt) => {
      const raw = typeof evt.data === "string" ? evt.data : "";
      if (raw) handlers.forEach((h) => h(raw));
    };

    ws.onclose = () => {
      if (!stopped) scheduleReconnect();
    };

    ws.onerror = () => ws?.close();
  }

  function scheduleReconnect() {
    retryTimer = setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, 60_000);
      connect();
    }, retryDelay);
  }

  return {
    connect,
    disconnect() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
```

- [ ] **Step 4: Write the Zustand WS store**

`web/src/state/wsStore.ts`:
```ts
import { create } from "zustand";
import { createPluginBridge, type PluginBridge } from "@/lib/ws/pluginBridge";

interface WsState {
  connected: boolean;
  bridge: PluginBridge | null;
  connect(url: string): void;
  disconnect(): void;
}

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  bridge: null,

  connect(url: string) {
    get().bridge?.disconnect();
    const bridge = createPluginBridge(url);
    bridge.onMessage((raw) => {
      try {
        const msg = JSON.parse(raw) as { type: string };
        if (msg.type === "hello_ack") set({ connected: true });
      } catch { /* ignore malformed */ }
    });
    bridge.connect();
    set({ bridge, connected: false });
  },

  disconnect() {
    get().bridge?.disconnect();
    set({ bridge: null, connected: false });
  },
}));
```

- [ ] **Step 5: Run tests — confirm they pass**

```powershell
cd web
rtk vitest run src/lib/ws/pluginBridge.test.ts
```
Expected: 2 tests passed.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/ws/ web/src/state/wsStore.ts
git commit -m "feat(frontend): WebSocket bridge and wsStore for plugin connection"
```

---

### Task 8: Plugin CloudMenuProvider (WS client + live draft)

**Files:**
- Modify: `plugin/build.gradle.kts` — OkHttp already added in Task 1; add `mockwebserver` to tests
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/ws/WsClient.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/CloudMenuProvider.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/WsClientTest.kt`

- [ ] **Step 1: Write the failing WsClient test**

`plugin/src/test/kotlin/net/artisanmc/plugin/WsClientTest.kt`:
```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.ws.WsClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WsClientTest {
    @Test
    fun `sends hello on connect and receives hello_ack`() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    ws.send(
                        """{"type":"hello_ack","session_id":"s1","server_id":"srv1","tier":"free","needs_sync":false,"latest_bundle_hash":""}"""
                    )
                }
            })
        )
        server.start()

        val received = mutableListOf<String>()
        val latch = CountDownLatch(1)
        val client = WsClient(
            url = server.url("/ws/plugin").toString(),
            serverKey = "sk_test",
            onMessage = { msg -> received.add(msg); latch.countDown() },
        )
        client.connect()
        assertTrue(latch.await(5, TimeUnit.SECONDS), "Expected hello_ack within 5s")
        assertEquals(1, received.size)
        assertTrue(received.first().contains("hello_ack"))
        client.disconnect()
        server.shutdown()
    }
}
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "net.artisanmc.plugin.WsClientTest"
```
Expected: FAIL — `WsClient` not found.

- [ ] **Step 3: Write the PluginConfig**

`plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt`:
```kotlin
package net.artisanmc.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class PluginConfig(
    val mode: String,
    val serverKey: String,
    val wsUrl: String,
    val packsDir: String,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            mode     = cfg.getString("mode", "local") ?: "local",
            serverKey = cfg.getString("server_key", "") ?: "",
            wsUrl    = cfg.getString("ws_url", "wss://editor.artisanmc.net/ws/plugin") ?: "",
            packsDir = cfg.getString("packs_dir", "plugins/Artisan/packs") ?: "",
        )
    }
}
```

- [ ] **Step 4: Write the WsClient**

`plugin/src/main/kotlin/net/artisanmc/plugin/ws/WsClient.kt`:
```kotlin
package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

class WsClient(
    private val url: String,
    private val serverKey: String,
    private val onMessage: (String) -> Unit,
    private val logger: Logger? = null,
) {
    private val httpClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val mapper = ObjectMapper()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var retryDelay = 1L

    fun connect() {
        val req = Request.Builder().url(url).build()
        socket = httpClient.newWebSocket(req, Listener())
    }

    fun send(msg: Any) {
        socket?.send(mapper.writeValueAsString(msg))
    }

    fun disconnect() {
        scheduler.shutdownNow()
        socket?.close(1000, "Plugin disabling")
        httpClient.dispatcher.executorService.shutdown()
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            retryDelay = 1
            val hello = mapOf(
                "type" to "hello",
                "server_key" to serverKey,
                "plugin_version" to "1.0.0",
                "minecraft_version" to "1.21.4",
                "current_bundle_hash" to "",
            )
            ws.send(mapper.writeValueAsString(hello))
        }

        override fun onMessage(ws: WebSocket, text: String) = onMessage(text)

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            logger?.warning("WS failure: ${t.message}")
            scheduleReconnect()
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            if (code != 1000) scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        val delay = retryDelay
        retryDelay = minOf(retryDelay * 2, 60L)
        scheduler.schedule(::connect, delay, TimeUnit.SECONDS)
    }
}
```

- [ ] **Step 5: Write the CloudMenuProvider**

`plugin/src/main/kotlin/net/artisanmc/plugin/provider/CloudMenuProvider.kt`:
```kotlin
package net.artisanmc.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.ws.WsClient
import org.bukkit.entity.Player
import java.util.logging.Logger

class CloudMenuProvider(
    private val wsUrl: String,
    private val serverKey: String,
    private val logger: Logger?,
) : MenuProvider {
    private val liveMenus  = mutableMapOf<String, BundleMenu>()
    private val draftMenus = mutableMapOf<String, BundleMenu>()
    private lateinit var wsClient: WsClient
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    override fun load() {
        wsClient = WsClient(wsUrl, serverKey, onMessage = ::handleMessage, logger = logger)
        wsClient.connect()
    }

    override fun findMenu(menuId: String): BundleMenu? = liveMenus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = liveMenus[menuId] ?: run {
            player.sendMessage("Menu '$menuId' not found (cloud mode).")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    /** Opens the admin draft (only for the server operator checking live edits). */
    fun openDraft(player: Player, menuId: String, lang: String) {
        val menu = draftMenus[menuId] ?: liveMenus[menuId] ?: run {
            player.sendMessage("No draft for menu '$menuId'.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" ->
                logger?.info("Connected to Artisan backend (session=${node["session_id"]?.asText()})")

            "draft_update" -> {
                val menuId   = node["menu_id"]?.asText()   ?: return
                val menuYaml = node["menu_yaml"]?.asText() ?: return
                val parsed   = runCatching { yamlMapper.readValue(menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
                draftMenus[menuId] = BundleMenu(parsed, emptyMap())
                logger?.info("Draft updated for menu $menuId")
            }
        }
    }
}
```

- [ ] **Step 6: Update ArtisanPlugin to select provider from config**

`plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`:
```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.provider.CloudMenuProvider
import net.artisanmc.plugin.provider.FilesystemMenuProvider
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        menuProvider = when (cfg.mode) {
            "cloud" -> CloudMenuProvider(cfg.wsUrl, cfg.serverKey, logger)
            else    -> FilesystemMenuProvider(File(dataFolder.parentFile, cfg.packsDir).also { it.mkdirs() })
        }
        menuProvider.load()
        getCommand("ifz")?.setExecutor(ArtisanCommand(this))
        logger.info("Artisan ${description.version} enabled (mode=${cfg.mode})")
    }

    override fun onDisable() {
        logger.info("Artisan disabled")
    }
}
```

- [ ] **Step 7: Run all plugin tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test
```
Expected: BUILD SUCCESSFUL — all tests pass.

- [ ] **Step 8: Commit**

```bash
git add plugin/src/ plugin/build.gradle.kts
git commit -m "feat(plugin): CloudMenuProvider with OkHttp WS client and live draft support"
```

---

## End state

After all 8 tasks, the repo has:

- **`plugin/`** — builds a shadow JAR via `gradlew.bat shadowJar`. Drop it in a Paper 1.21.4 server's `plugins/` folder. Set `mode: local` in `config.yml`, copy an exported ZIP's contents to `plugins/Artisan/packs/`, then `/artisan menu <id>` opens the menu. Set `mode: cloud` with a real `server_key` from the backend to get live draft updates.

- **`backend/`** — runs with `bun run src/index.ts` on port 3001. `POST /api/server-keys` generates keys. WebSocket at `ws://localhost:3001/ws/plugin` accepts plugin connections.

- **`web/`** — gains `useWsStore` that connects to the backend and tracks `connected` state. Wire it to the UI in a follow-up (a status indicator or a "server key" settings panel).

**Not in scope for this scaffold** (follow-up tasks):
- `bundle_available` CDN download in the plugin
- `publish` / `rollback` messages
- Frontend UI for server key management and connection status
- Placeholder / permission / material query messages
- Staging flavor and draft access controls
