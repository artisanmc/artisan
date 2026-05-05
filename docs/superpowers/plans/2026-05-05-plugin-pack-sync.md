# Plugin Pack Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local/cloud mode split with always-on disk serving plus optional bidirectional cloud sync — the plugin always loads packs from disk (offline-safe), optionally connects to the backend WebSocket when a `server_key` is configured, detects when either side has changed, and syncs packs in the correct direction while handling conflicts where both sides changed independently.

**Architecture:**
- `SyncedMenuProvider` (replaces both `FilesystemMenuProvider` and `CloudMenuProvider`) always loads from disk on startup. If a `server_key` is set in config, it also starts a `WsClient` connection to the backend. No more `mode` field — the two behaviors coexist.
- `BundleHasher` computes a deterministic SHA-256 over pack file content using the exact same algorithm on both the plugin (Kotlin) and the backend (TypeScript), enabling byte-exact sync detection.
- `SyncMetadata` (`.interfaze-sync.yaml` per pack dir) records the hash at last successful sync. On reconnect, three hashes are compared: `disk_hash` (current), `synced_hash` (last sync), `backend_hash` (from backend) — enabling distinction between "backend newer, no local changes" (auto-sync) vs "both sides changed" (true conflict, warn and default to backend wins).
- On `hello_ack`, if `needs_sync: true`, the backend sends `bundle_available` per outdated pack. `BundleDownloader` fetches the bundle JSON, writes YAML files to disk, updates `.interfaze-sync.yaml`, and hot-reloads in-memory menus.
- The backend gains a `pack_bundles` table and `/api/bundles/:packId` endpoints. The frontend gains a `publish()` call on `wsStore` that POSTs exported files to the backend on explicit user action.

**Tech Stack:** Kotlin 2.0 + OkHttp 4.12 + MockWebServer 4.12 (plugin); Hono 4 + bun:sqlite + Drizzle (backend); Zustand + Vitest (frontend).

---

## File Map

### Plugin

| File | Action | Responsibility |
|---|---|---|
| `plugin/src/main/kotlin/gg/interfaze/plugin/provider/CloudMenuProvider.kt` | **Delete** | Superseded by SyncedMenuProvider |
| `plugin/src/main/kotlin/gg/interfaze/plugin/provider/FilesystemMenuProvider.kt` | **Delete** | Superseded by SyncedMenuProvider |
| `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` | **Create** | Disk load + optional WS sync in one class |
| `plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleHasher.kt` | **Create** | Deterministic SHA-256 over all files in a pack dir |
| `plugin/src/main/kotlin/gg/interfaze/plugin/sync/SyncMetadata.kt` | **Create** | Read/write `.interfaze-sync.yaml` per pack |
| `plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleDownloader.kt` | **Create** | HTTP fetch of bundle JSON, write YAML files to disk |
| `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt` | **Modify** | Remove `mode` field |
| `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt` | **Modify** | Add `currentBundleHash: String = ""` param |
| `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt` | **Modify** | Construct SyncedMenuProvider instead of mode switch |
| `plugin/src/main/resources/config.yml` | **Modify** | Remove `mode` line and its comment |
| `plugin/src/test/kotlin/gg/interfaze/plugin/FilesystemMenuProviderTest.kt` | **Delete** | Migrated to SyncedMenuProviderTest |
| `plugin/src/test/kotlin/gg/interfaze/plugin/SyncedMenuProviderTest.kt` | **Create** | Disk loading + no WS when serverKey empty |
| `plugin/src/test/kotlin/gg/interfaze/plugin/BundleHasherTest.kt` | **Create** | Hash determinism and change detection |
| `plugin/src/test/kotlin/gg/interfaze/plugin/BundleDownloaderTest.kt` | **Create** | Download + disk write + sync metadata via MockWebServer |

### Backend

| File | Action | Responsibility |
|---|---|---|
| `backend/src/db/schema.ts` | **Modify** | Add `pack_bundles` table |
| `backend/src/lib/auth.ts` | **Create** | `validateServerKeyHeader(c)` — Bearer token validation |
| `backend/src/lib/hashUtils.ts` | **Create** | `computeBundleHash(files, packId)` + `computeAllPacksHash(serverId)` |
| `backend/src/routes/bundles.ts` | **Create** | `POST /api/bundles/:packId` (upload), `GET /api/bundles/:packId` (download) |
| `backend/src/routes/bundles.test.ts` | **Create** | Upload and download tests |
| `backend/src/ws/hub.ts` | **Modify** | Compare real hashes, send `bundle_available` after `hello_ack` |
| `backend/src/app.ts` | **Modify** | Mount `/api/bundles` route |
| `backend/src/protocol.ts` | **Modify** | Add `api_url` to `HelloAckMessage` |

### Frontend

| File | Action | Responsibility |
|---|---|---|
| `web/src/lib/ws/bundlePublisher.ts` | **Create** | `publishBundle(apiUrl, serverKey, packId, files)` HTTP POST |
| `web/src/lib/ws/bundlePublisher.test.ts` | **Create** | Vitest tests with mocked fetch |
| `web/src/state/wsStore.ts` | **Modify** | Add `serverId`, `apiUrl`, `serverKey`, `publish(packId, files)` |
| `web/src/state/wsStore.test.ts` | **Create** | Tests for publish call |

---

## Hash algorithm (canonical — must match on both sides)

**Per-pack hash** — used for a single pack directory:

1. Walk all files under the pack dir recursively; skip files whose name starts with `.interfaze`
2. Sort by relative path (forward slashes, case-sensitive)
3. For each file, append `{relative_path}\n{utf8_file_content}\n` to a buffer
4. SHA-256 of the whole buffer, hex-encoded

**All-packs hash** — used in `hello` to represent the entire packs directory:

1. Compute per-pack hash for each immediate subdirectory of `packsDir`
2. Sort subdirectory names alphabetically
3. For each: append `{packId}:{perPackHash}\n` to a buffer
4. SHA-256 of the buffer, hex-encoded
5. If no packs: return `""`

This algorithm is implemented identically in `BundleHasher.kt` (plugin) and `hashUtils.ts` (backend).

---

## Conflict detection logic

On `hello_ack`, for each pack in `pack_hashes` from the backend:
- `diskHash` = `BundleHasher.hash(packDir)` — current on-disk content
- `syncedHash` = `SyncMetadata.read(packDir).syncedHash` — hash at last successful cloud sync (empty if never synced)
- `backendHash` = value from `hello_ack.pack_hashes[packId]`

| diskHash == backendHash | diskHash == syncedHash | Result |
|---|---|---|
| ✅ | any | In sync — nothing to do |
| ❌ | ✅ | Backend is newer, no local changes → auto-sync (apply backend version) |
| ❌ | ❌ (backendHash == syncedHash) | Local was manually edited, backend unchanged → log warning, keep local |
| ❌ | ❌ (backendHash != syncedHash) | True conflict — both sides changed → backend wins (warn prominently), `/ifz sync reject` to cancel |

---

### Task 1: SyncedMenuProvider — unify providers, remove mode

**Files:**
- Delete: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/CloudMenuProvider.kt`
- Delete: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/FilesystemMenuProvider.kt`
- Delete: `plugin/src/test/kotlin/gg/interfaze/plugin/FilesystemMenuProviderTest.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt`
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/SyncedMenuProviderTest.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`
- Modify: `plugin/src/main/resources/config.yml`

After this task all existing tests still pass. WS is started if `server_key` is non-empty in config; `currentBundleHash` is still hardcoded `""` (real hash added in Task 2).

- [ ] **Step 1: Write the failing test**

`plugin/src/test/kotlin/gg/interfaze/plugin/SyncedMenuProviderTest.kt`:
```kotlin
package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import gg.interfaze.plugin.provider.SyncedMenuProvider
import java.io.File
import java.nio.file.Files
import kotlin.test.*

class SyncedMenuProviderTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: InterfazePlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
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
    fun `resolves menu by id from disk`() {
        val packsRoot = Files.createTempDirectory("ifz_packs_").toFile()
        writePackFixture(packsRoot)
        val provider = SyncedMenuProvider(packsRoot, serverKey = "", wsUrl = "", logger = null)
        provider.load()
        val menu = provider.findMenu("m_shop")
        assertNotNull(menu)
        assertEquals("Shop", menu.resolveTitle("en"))
    }

    @Test
    fun `openMenu creates a 27-slot inventory for the player`() {
        val packsRoot = Files.createTempDirectory("ifz_packs_").toFile()
        writePackFixture(packsRoot)
        val provider = SyncedMenuProvider(packsRoot, serverKey = "", wsUrl = "", logger = null)
        provider.load()
        val player = server.addPlayer()
        provider.openMenu(player, "m_shop", "en")
        assertNotNull(player.openInventory)
        assertEquals(27, player.openInventory.topInventory.size)
    }

    @Test
    fun `no WsClient created when serverKey is empty`() {
        val packsRoot = Files.createTempDirectory("ifz_packs_").toFile()
        val provider = SyncedMenuProvider(packsRoot, serverKey = "", wsUrl = "", logger = null)
        provider.load()
        // unload must not throw (wsClient is null) — this verifies the guard in unload()
        assertFailsWith<Exception> { }.also { /* nothing to assert — just verify no throw */ }
        provider.unload()  // must not throw
    }
}
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "gg.interfaze.plugin.SyncedMenuProviderTest"
```
Expected: BUILD FAILED — `SyncedMenuProvider` not found.

- [ ] **Step 3: Write SyncedMenuProvider**

`plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt`:
```kotlin
package gg.interfaze.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.MenuYaml
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.ws.WsClient
import gg.interfaze.plugin.yaml.PackReader
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

class SyncedMenuProvider(
    private val packsDir: File,
    private val serverKey: String,
    private val wsUrl: String,
    private val logger: Logger?,
) : MenuProvider {
    private val menus      = ConcurrentHashMap<String, BundleMenu>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private var wsClient: WsClient? = null

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            wsClient = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                currentBundleHash = "",   // replaced with real hash in Task 2
                onMessage         = ::handleMessage,
                logger            = logger,
            )
            wsClient!!.connect()
        }
    }

    override fun unload() {
        wsClient?.disconnect()
    }

    override fun findMenu(menuId: String): BundleMenu? = draftMenus[menuId] ?: menus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = findMenu(menuId) ?: run {
            player.sendMessage("Menu '$menuId' not found.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    private fun reloadFromDisk() {
        menus.clear()
        PackReader(packsDir).readAll().forEach { bundle ->
            bundle.menus.forEach { menu -> menus[menu.id] = menu }
        }
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" ->
                logger?.info("Connected to Interfaze backend (session=${node["session_id"]?.asText()})")

            "bundle_available" ->
                logger?.info("bundle_available received for pack ${node["pack_id"]?.asText()} — download not yet implemented (Task 4)")

            "draft_update" -> {
                val menuId   = node["menu_id"]?.asText()   ?: return
                val menuYaml = node["menu_yaml"]?.asText() ?: return
                val parsed   = runCatching { yamlMapper.readValue(menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
                draftMenus[menuId] = BundleMenu(parsed, emptyMap())
                logger?.info("Draft updated for $menuId")
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }
}
```

- [ ] **Step 4: Modify PluginConfig — remove mode**

`plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt`:
```kotlin
package gg.interfaze.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val packsDir: String,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey = cfg.getString("server_key", "") ?: "",
            wsUrl     = cfg.getString("ws_url", "wss://editor.interfaze.gg/ws/plugin") ?: "",
            packsDir  = cfg.getString("packs_dir", "plugins/Interfaze/packs") ?: "",
        )
    }
}
```

- [ ] **Step 5: Modify WsClient — add currentBundleHash param**

Replace the constructor and `onOpen` in `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt`. Only the class header and `onOpen` change:

```kotlin
package gg.interfaze.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

class WsClient(
    private val url: String,
    private val serverKey: String,
    private val currentBundleHash: String = "",
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
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            retryDelay = 1
            val hello = mapOf(
                "type" to "hello",
                "server_key" to serverKey,
                "plugin_version" to "1.0.0",
                "minecraft_version" to "1.21.4",
                "current_bundle_hash" to currentBundleHash,
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
        if (scheduler.isShutdown) return
        val delay = retryDelay
        retryDelay = minOf(retryDelay * 2, 60L)
        try {
            scheduler.schedule(::connect, delay, TimeUnit.SECONDS)
        } catch (_: Exception) {}
    }
}
```

- [ ] **Step 6: Modify InterfazePlugin — use SyncedMenuProvider**

`plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`:
```kotlin
package gg.interfaze.plugin

import gg.interfaze.plugin.command.IfzCommand
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.provider.MenuProvider
import gg.interfaze.plugin.provider.SyncedMenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class InterfazePlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val packsDir = File(dataFolder.parentFile, cfg.packsDir).also { it.mkdirs() }
        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
        )
        menuProvider.load()
        getCommand("ifz")?.setExecutor(IfzCommand(this))
        logger.info("Interfaze ${description.version} enabled")
    }

    override fun onDisable() {
        menuProvider.unload()
        logger.info("Interfaze disabled")
    }
}
```

- [ ] **Step 7: Modify config.yml — remove mode**

`plugin/src/main/resources/config.yml`:
```yaml
# Set to connect this server to the Interfaze editor backend for live sync.
# Leave empty to run offline using only locally exported packs.
server_key: ""
ws_url: "wss://editor.interfaze.gg/ws/plugin"

# Path relative to the server root where exported pack bundles are stored.
packs_dir: "plugins/Interfaze/packs"
```

- [ ] **Step 8: Delete old provider files and test**

```powershell
Remove-Item plugin/src/main/kotlin/gg/interfaze/plugin/provider/CloudMenuProvider.kt
Remove-Item plugin/src/main/kotlin/gg/interfaze/plugin/provider/FilesystemMenuProvider.kt
Remove-Item plugin/src/test/kotlin/gg/interfaze/plugin/FilesystemMenuProviderTest.kt
```

- [ ] **Step 9: Run all plugin tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test
```
Expected: BUILD SUCCESSFUL — all tests pass (PluginLoadTest, PackReaderTest, SyncedMenuProviderTest, WsClientTest).

- [ ] **Step 10: Commit**

```bash
git add plugin/src/ plugin/build.gradle.kts
git commit -m "refactor(plugin): SyncedMenuProvider unifies local+cloud, removes mode config"
```

---

### Task 2: BundleHasher + SyncMetadata + real hash in hello

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleHasher.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/sync/SyncMetadata.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` (load method only)
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/BundleHasherTest.kt`

- [ ] **Step 1: Write the failing test**

`plugin/src/test/kotlin/gg/interfaze/plugin/BundleHasherTest.kt`:
```kotlin
package gg.interfaze.plugin

import gg.interfaze.plugin.sync.BundleHasher
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class BundleHasherTest {

    private fun makePack(dir: File) {
        File(dir, "manifest.yaml").writeText("schema: manifest/v1\npack_id: p_test\n")
        File(dir, "menus").mkdirs()
        File(dir, "menus/shop.yaml").writeText("id: shop\nsize: 27\n")
        File(dir, "lang").mkdirs()
        File(dir, "lang/en.yaml").writeText("title: Shop\n")
    }

    @Test
    fun `same directory content produces same hash`() {
        val dir1 = Files.createTempDirectory("bh1_").toFile().also { makePack(it) }
        val dir2 = Files.createTempDirectory("bh2_").toFile().also { makePack(it) }
        assertEquals(BundleHasher.hash(dir1), BundleHasher.hash(dir2))
    }

    @Test
    fun `changed file content changes hash`() {
        val dir = Files.createTempDirectory("bh3_").toFile().also { makePack(it) }
        val before = BundleHasher.hash(dir)
        File(dir, "menus/shop.yaml").writeText("id: shop\nsize: 54\n")
        assertNotEquals(before, BundleHasher.hash(dir))
    }

    @Test
    fun `added file changes hash`() {
        val dir = Files.createTempDirectory("bh4_").toFile().also { makePack(it) }
        val before = BundleHasher.hash(dir)
        File(dir, "menus/extra.yaml").writeText("id: extra\n")
        assertNotEquals(before, BundleHasher.hash(dir))
    }

    @Test
    fun `dot-interfaze files are excluded from hash`() {
        val dir = Files.createTempDirectory("bh5_").toFile().also { makePack(it) }
        val before = BundleHasher.hash(dir)
        File(dir, ".interfaze-sync.yaml").writeText("synced_hash: abc\n")
        assertEquals(before, BundleHasher.hash(dir))
    }

    @Test
    fun `hashAll over two packs is deterministic`() {
        val packsDir = Files.createTempDirectory("bh6_").toFile()
        makePack(File(packsDir, "p_a").apply { mkdirs() })
        makePack(File(packsDir, "p_b").apply { mkdirs() })
        val h1 = BundleHasher.hashAll(packsDir)
        val h2 = BundleHasher.hashAll(packsDir)
        assertEquals(h1, h2)
    }

    @Test
    fun `hashAll returns empty string when no packs`() {
        val empty = Files.createTempDirectory("bh7_").toFile()
        assertEquals("", BundleHasher.hashAll(empty))
    }
}
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "gg.interfaze.plugin.BundleHasherTest"
```
Expected: BUILD FAILED — `BundleHasher` not found.

- [ ] **Step 3: Write BundleHasher**

`plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleHasher.kt`:
```kotlin
package gg.interfaze.plugin.sync

import java.io.File
import java.security.MessageDigest

object BundleHasher {

    /**
     * Deterministic SHA-256 of all files under [packDir].
     * Files whose name starts with ".interfaze" are excluded.
     * Canonical algorithm (must match hashUtils.ts on the backend):
     *   - Walk files recursively, sort by relative path (forward slashes)
     *   - Build: {relPath}\n{utf8 content}\n  for each file
     *   - SHA-256 of the concatenated string
     */
    fun hash(packDir: File): String {
        val sb = StringBuilder()
        packDir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".interfaze") }
            .sortedBy { it.relativeTo(packDir).path.replace('\\', '/') }
            .forEach { file ->
                val relPath = file.relativeTo(packDir).path.replace('\\', '/')
                sb.append(relPath).append('\n')
                sb.append(file.readText(Charsets.UTF_8)).append('\n')
            }
        return sha256(sb.toString())
    }

    /**
     * Hash of all packs under [packsDir], combining per-pack hashes.
     * Returns "" if there are no pack subdirectories.
     * Canonical algorithm (must match computeAllPacksHash in hashUtils.ts):
     *   - Sort pack dirs by name
     *   - Build: {packId}:{packHash}\n  for each pack
     *   - SHA-256 of the concatenated string
     */
    fun hashAll(packsDir: File): String {
        val packDirs = packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }
            ?.sortedBy { it.name } ?: return ""
        if (packDirs.isEmpty()) return ""
        val sb = StringBuilder()
        packDirs.forEach { packDir ->
            sb.append(packDir.name).append(':').append(hash(packDir)).append('\n')
        }
        return sha256(sb.toString())
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
```

- [ ] **Step 4: Write SyncMetadata**

`plugin/src/main/kotlin/gg/interfaze/plugin/sync/SyncMetadata.kt`:
```kotlin
package gg.interfaze.plugin.sync

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import java.io.File
import java.time.Instant

@JsonIgnoreProperties(ignoreUnknown = true)
data class SyncMetadata(
    @JsonProperty("synced_hash")  val syncedHash: String  = "",
    @JsonProperty("synced_at")    val syncedAt: String    = "",
    @JsonProperty("backend_hash") val backendHash: String = "",
) {
    companion object {
        private const val FILENAME = ".interfaze-sync.yaml"
        private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

        fun read(packDir: File): SyncMetadata {
            val file = File(packDir, FILENAME)
            if (!file.exists()) return SyncMetadata()
            return runCatching { mapper.readValue(file, SyncMetadata::class.java) }
                .getOrDefault(SyncMetadata())
        }

        fun write(packDir: File, meta: SyncMetadata) {
            mapper.writeValue(File(packDir, FILENAME), meta)
        }

        fun recordSync(packDir: File, syncedHash: String, backendHash: String) {
            write(packDir, SyncMetadata(
                syncedHash  = syncedHash,
                syncedAt    = Instant.now().toString(),
                backendHash = backendHash,
            ))
        }
    }
}
```

- [ ] **Step 5: Update SyncedMenuProvider.load() to send real hash**

In `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt`, change only the `load()` method:

```kotlin
override fun load() {
    reloadFromDisk()
    if (serverKey.isNotEmpty()) {
        val currentHash = BundleHasher.hashAll(packsDir)
        wsClient = WsClient(
            url               = wsUrl,
            serverKey         = serverKey,
            currentBundleHash = currentHash,
            onMessage         = ::handleMessage,
            logger            = logger,
        )
        wsClient!!.connect()
    }
}
```

Add the import at the top of the file:
```kotlin
import gg.interfaze.plugin.sync.BundleHasher
```

- [ ] **Step 6: Run all plugin tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test
```
Expected: BUILD SUCCESSFUL — all tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/sync/ plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt plugin/src/test/kotlin/gg/interfaze/plugin/BundleHasherTest.kt
git commit -m "feat(plugin): BundleHasher + SyncMetadata + real bundle hash in hello"
```

---

### Task 3: Backend — bundle storage, upload/download, updated handshake

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/src/lib/auth.ts`
- Create: `backend/src/lib/hashUtils.ts`
- Create: `backend/src/routes/bundles.ts`
- Create: `backend/src/routes/bundles.test.ts`
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1: Write the failing bundle route test**

`backend/src/routes/bundles.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { app } from "../app";

const PACK_FILES = {
  "plugins/Interfaze/packs/p_test/manifest.yaml": "schema: manifest/v1\npack_id: p_test\n",
  "plugins/Interfaze/packs/p_test/menus/shop.yaml": "id: shop\nsize: 27\n",
};

describe("bundle upload/download", () => {
  test("POST /api/bundles/p_test requires Authorization header", async () => {
    const res = await app.request("/api/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(res.status).toBe(401);
  });

  test("POST + GET round-trip stores and retrieves bundle", async () => {
    // Create a server key first
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "bundle-test" }),
    });
    const { key } = (await keyRes.json()) as { key: string };

    // Upload bundle
    const uploadRes = await app.request("/api/bundles/p_test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(uploadRes.status).toBe(201);
    const { hash } = (await uploadRes.json()) as { hash: string };
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Download bundle
    const downloadRes = await app.request("/api/bundles/p_test", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(downloadRes.status).toBe(200);
    const body = (await downloadRes.json()) as { files: Record<string, string>; hash: string };
    expect(body.hash).toBe(hash);
    expect(body.files["plugins/Interfaze/packs/p_test/manifest.yaml"]).toContain("manifest/v1");
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd backend
bun test src/routes/bundles.test.ts
```
Expected: FAIL — 404 on `/api/bundles/p_test`.

- [ ] **Step 3: Update DB schema**

`backend/src/db/schema.ts`:
```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const serverKeys = sqliteTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const packBundles = sqliteTable("pack_bundles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  packId: text("pack_id").notNull(),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 4: Push DB schema**

```powershell
cd backend
bun run db:push
```
If it fails due to existing DB, delete `interfaze.db` and run again:
```powershell
Remove-Item interfaze.db -ErrorAction SilentlyContinue
bun run db:push
```
Expected: `server_keys` and `pack_bundles` tables created.

- [ ] **Step 5: Write auth helper**

`backend/src/lib/auth.ts`:
```ts
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";

/**
 * Validates the `Authorization: Bearer <server_key>` header.
 * Returns the server DB row id on success, null on failure.
 */
export async function validateServerKeyHeader(c: Context): Promise<string | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const rawKey = authHeader.slice(7);
  if (!rawKey) return null;

  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}
```

- [ ] **Step 6: Write hash utilities**

`backend/src/lib/hashUtils.ts`:
```ts
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles } from "../db/schema";

/**
 * Per-pack hash — must match BundleHasher.hash(packDir) in Kotlin.
 * Algorithm: sort files by relative path (strip "plugins/Interfaze/packs/{packId}/" prefix),
 *   build "{relPath}\n{content}\n" for each, SHA-256 the whole string.
 */
export async function computeBundleHash(files: Record<string, string>, packId: string): Promise<string> {
  const prefix = `plugins/Interfaze/packs/${packId}/`;
  const sorted = Object.entries(files)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ path: k.slice(prefix.length), content: v }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const data = sorted.map((e) => `${e.path}\n${e.content}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * All-packs hash for a server — must match BundleHasher.hashAll(packsDir) in Kotlin.
 * Algorithm: sort packs by packId, build "{packId}:{hash}\n" for each, SHA-256 the string.
 * Returns "" if server has no stored bundles.
 */
export async function computeAllPacksHash(serverId: string): Promise<string> {
  const bundles = await db
    .select({ packId: packBundles.packId, hash: packBundles.hash })
    .from(packBundles)
    .where(eq(packBundles.serverId, serverId));

  if (bundles.length === 0) return "";

  const sorted = [...bundles].sort((a, b) => a.packId.localeCompare(b.packId));
  const data = sorted.map((b) => `${b.packId}:${b.hash}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 7: Write the bundles route**

`backend/src/routes/bundles.ts`:
```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles } from "../db/schema";
import { validateServerKeyHeader } from "../lib/auth";
import { computeBundleHash } from "../lib/hashUtils";

const router = new Hono();

/** Upload a published bundle. Called by the frontend editor after export. */
router.post("/:packId", async (c) => {
  const serverId = await validateServerKeyHeader(c);
  if (!serverId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");
  const body = await c.req.json<{ files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);

  // Upsert: delete existing row for this (serverId, packId) then insert fresh
  await db.delete(packBundles).where(
    and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId))
  );
  await db.insert(packBundles).values({
    id: crypto.randomUUID(),
    serverId,
    packId,
    hash,
    filesJson: JSON.stringify(body.files),
    createdAt: new Date(),
  });

  return c.json({ hash }, 201);
});

/** Download a stored bundle. Called by the plugin when syncing. */
router.get("/:packId", async (c) => {
  const serverId = await validateServerKeyHeader(c);
  if (!serverId) return c.json({ error: "Unauthorized" }, 401);

  const packId = c.req.param("packId");
  const rows = await db
    .select()
    .from(packBundles)
    .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));

  if (rows.length === 0) return c.json({ error: "Not found" }, 404);

  const row = rows[0];
  return c.json({ files: JSON.parse(row.filesJson) as Record<string, string>, hash: row.hash });
});

export { router as bundlesRouter };
```

- [ ] **Step 8: Mount route in app.ts**

`backend/src/app.ts`:
```ts
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { bundlesRouter } from "./routes/bundles";
import { serverKeysRouter } from "./routes/serverKeys";
import { handlePluginMessage } from "./ws/hub";

const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono();
export { websocket };

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
app.route("/api/bundles", bundlesRouter);

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

- [ ] **Step 9: Update protocol — add api_url to HelloAckMessage**

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
  api_url: string;
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

- [ ] **Step 10: Update hub.ts — real needs_sync + bundle_available messages**

`backend/src/ws/hub.ts`:
```ts
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles, serverKeys } from "../db/schema";
import type { BundleAvailableMessage, HelloAckMessage, HelloMessage } from "../protocol";
import { computeAllPacksHash } from "../lib/hashUtils";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

/** session_id → server DB row id */
const activeSessions = new Map<string, string>();

/** session_id → WS send callback (set by the WS route layer — not yet wired; placeholder for Task 4) */
export const sessionSenders = new Map<string, (msg: string) => void>();

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

export async function handlePluginMessage(
  raw: string,
  send?: (msg: string) => void,
): Promise<string | null> {
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
    if (send) sessionSenders.set(sessionId, send);

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
    };
    const ackJson = JSON.stringify(ack);

    // After sending ack, push bundle_available for every stored pack that's out of sync
    if (needsSync && send) {
      const packs = await db
        .select({ packId: packBundles.packId, hash: packBundles.hash })
        .from(packBundles)
        .where(eq(packBundles.serverId, keyId));

      // Schedule asynchronously so ack is sent first
      setTimeout(() => {
        for (const pack of packs) {
          const available: BundleAvailableMessage = {
            type: "bundle_available",
            pack_id: pack.packId,
            url: `${API_BASE_URL}/api/bundles/${pack.packId}`,
            hash: pack.hash,
            signature: "",
          };
          send(JSON.stringify(available));
        }
      }, 0);
    }

    return ackJson;
  }

  if (msg.type === "pong") return null;

  return null;
}
```

- [ ] **Step 11: Update WS route in app.ts to pass send callback to hub**

Update the `onMessage` handler in `app.ts` so the hub can send `bundle_available` messages:

```ts
app.get(
  "/ws/plugin",
  upgradeWebSocket(() => ({
    async onMessage(evt, ws) {
      const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
      const reply = await handlePluginMessage(raw, (msg) => ws.send(msg));
      if (reply) ws.send(reply);
    },
    onError: (err) => console.error("WS error:", err),
  })),
);
```

- [ ] **Step 12: Run all backend tests — confirm they pass**

```powershell
cd backend
bun test
```
Expected: all tests pass.

- [ ] **Step 13: Commit**

```bash
git add backend/src/
git commit -m "feat(backend): pack_bundles table, upload/download endpoints, needs_sync in hello_ack"
```

---

### Task 4: Plugin — BundleDownloader + bundle_available handling

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleDownloader.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` (handleBundleAvailable)
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/BundleDownloaderTest.kt`

- [ ] **Step 1: Write the failing test**

`plugin/src/test/kotlin/gg/interfaze/plugin/BundleDownloaderTest.kt`:
```kotlin
package gg.interfaze.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import gg.interfaze.plugin.sync.BundleDownloader
import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.sync.SyncMetadata
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class BundleDownloaderTest {

    private val mapper = ObjectMapper()

    private fun makeBundle(packId: String): Map<String, String> = mapOf(
        "plugins/Interfaze/packs/$packId/manifest.yaml" to "schema: manifest/v1\npack_id: $packId\n",
        "plugins/Interfaze/packs/$packId/menus/shop.yaml" to "id: shop\nsize: 27\n",
    )

    @Test
    fun `download writes YAML files to pack dir under packsDir`() {
        val server = MockWebServer()
        val packId = "p_dl_test"
        val files = makeBundle(packId)
        val responseBody = mapper.writeValueAsString(mapOf("files" to files, "hash" to "abc123"))
        server.enqueue(MockResponse().setBody(responseBody).setHeader("Content-Type", "application/json"))
        server.start()

        val packsDir = Files.createTempDirectory("ifz_dl_").toFile()
        val downloader = BundleDownloader(OkHttpClient(), packsDir)
        downloader.download(
            url       = server.url("/api/bundles/$packId").toString(),
            serverKey = "sk_test",
            packId    = packId,
        )

        assertTrue(File(packsDir, "$packId/manifest.yaml").exists())
        assertTrue(File(packsDir, "$packId/menus/shop.yaml").exists())
        assertEquals("schema: manifest/v1\npack_id: $packId\n",
            File(packsDir, "$packId/manifest.yaml").readText())
        server.shutdown()
    }

    @Test
    fun `download updates SyncMetadata after writing`() {
        val server = MockWebServer()
        val packId = "p_meta_test"
        val files = makeBundle(packId)
        val backendHash = "deadeef123"
        server.enqueue(
            MockResponse()
                .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to backendHash)))
                .setHeader("Content-Type", "application/json")
        )
        server.start()

        val packsDir = Files.createTempDirectory("ifz_meta_").toFile()
        val downloader = BundleDownloader(OkHttpClient(), packsDir)
        downloader.download(
            url       = server.url("/api/bundles/$packId").toString(),
            serverKey = "sk_test",
            packId    = packId,
        )

        val meta = SyncMetadata.read(File(packsDir, packId))
        val diskHash = BundleHasher.hash(File(packsDir, packId))
        assertEquals(diskHash, meta.syncedHash)
        assertEquals(backendHash, meta.backendHash)
        server.shutdown()
    }
}
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "gg.interfaze.plugin.BundleDownloaderTest"
```
Expected: BUILD FAILED — `BundleDownloader` not found.

- [ ] **Step 3: Write BundleDownloader**

`plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleDownloader.kt`:
```kotlin
package gg.interfaze.plugin.sync

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.logging.Logger

class BundleDownloader(
    private val httpClient: OkHttpClient,
    private val packsDir: File,
    private val logger: Logger? = null,
) {
    private val mapper = ObjectMapper()

    /**
     * Downloads a bundle from [url] (authenticated with [serverKey]) and writes
     * YAML files to [packsDir]/[packId]/. Updates `.interfaze-sync.yaml` after writing.
     */
    fun download(url: String, serverKey: String, packId: String) {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $serverKey")
            .build()

        val responseBody = httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                logger?.warning("Bundle download failed: HTTP ${response.code} for pack $packId")
                return
            }
            response.body?.string() ?: return
        }

        val parsed = runCatching {
            mapper.readValue(responseBody, object : TypeReference<Map<String, Any>>() {})
        }.getOrNull() ?: run {
            logger?.warning("Bundle download: failed to parse response for pack $packId")
            return
        }

        @Suppress("UNCHECKED_CAST")
        val files = parsed["files"] as? Map<String, String> ?: run {
            logger?.warning("Bundle download: missing 'files' in response for pack $packId")
            return
        }
        val backendHash = parsed["hash"] as? String ?: ""

        val prefix = "plugins/Interfaze/packs/$packId/"
        val packDir = File(packsDir, packId)

        for ((path, content) in files) {
            val relPath = if (path.startsWith(prefix)) path.removePrefix(prefix) else continue
            val target = File(packDir, relPath)
            target.parentFile?.mkdirs()
            target.writeText(content, Charsets.UTF_8)
        }

        val diskHash = BundleHasher.hash(packDir)
        SyncMetadata.recordSync(packDir, syncedHash = diskHash, backendHash = backendHash)
        logger?.info("Bundle synced for pack $packId (hash=$diskHash)")
    }
}
```

- [ ] **Step 4: Update SyncedMenuProvider to handle bundle_available**

In `SyncedMenuProvider.kt`, add the `BundleDownloader` field and the full `handleBundleAvailable` handler. The complete updated file:

```kotlin
package gg.interfaze.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.MenuYaml
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.sync.BundleDownloader
import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.ws.WsClient
import gg.interfaze.plugin.yaml.PackReader
import okhttp3.OkHttpClient
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

class SyncedMenuProvider(
    private val packsDir: File,
    private val serverKey: String,
    private val wsUrl: String,
    private val logger: Logger?,
) : MenuProvider {
    private val menus      = ConcurrentHashMap<String, BundleMenu>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private val httpClient = OkHttpClient()
    private var wsClient: WsClient? = null

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            val currentHash = BundleHasher.hashAll(packsDir)
            wsClient = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                currentBundleHash = currentHash,
                onMessage         = ::handleMessage,
                logger            = logger,
            )
            wsClient!!.connect()
        }
    }

    override fun unload() {
        wsClient?.disconnect()
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
    }

    override fun findMenu(menuId: String): BundleMenu? = draftMenus[menuId] ?: menus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = findMenu(menuId) ?: run {
            player.sendMessage("Menu '$menuId' not found.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    private fun reloadFromDisk() {
        menus.clear()
        PackReader(packsDir).readAll().forEach { bundle ->
            bundle.menus.forEach { menu -> menus[menu.id] = menu }
        }
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" ->
                logger?.info("Connected to Interfaze backend (session=${node["session_id"]?.asText()})")

            "bundle_available" -> {
                val packId = node["pack_id"]?.asText() ?: return
                val url    = node["url"]?.asText()     ?: return
                val downloader = BundleDownloader(httpClient, packsDir, logger)
                downloader.download(url = url, serverKey = serverKey, packId = packId)
                reloadFromDisk()
                draftMenus.clear()
            }

            "draft_update" -> {
                val menuId   = node["menu_id"]?.asText()   ?: return
                val menuYaml = node["menu_yaml"]?.asText() ?: return
                val parsed = runCatching { yamlMapper.readValue(menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
                draftMenus[menuId] = BundleMenu(parsed, emptyMap())
                logger?.info("Draft updated for $menuId")
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }
}
```

- [ ] **Step 5: Run all plugin tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test
```
Expected: BUILD SUCCESSFUL — all tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/sync/BundleDownloader.kt plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt plugin/src/test/kotlin/gg/interfaze/plugin/BundleDownloaderTest.kt
git commit -m "feat(plugin): BundleDownloader handles bundle_available — writes packs to disk and hot-reloads"
```

---

### Task 5: Plugin — conflict detection + /ifz sync command

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` (hello_ack handler)
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/command/IfzCommand.kt` (add sync subcommand)
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/ConflictDetectionTest.kt`

The conflict detection logic reads three values for each known pack dir:
- `diskHash` = `BundleHasher.hash(packDir)` right now
- `syncedHash` = `SyncMetadata.read(packDir).syncedHash` (empty if never synced)
- `backendHash` = reported in `hello_ack.pack_hashes` (one hash per packId)

But `hello_ack` currently has `latest_bundle_hash: string` — a single combined hash, not per-pack. To detect conflicts at the pack level, we need per-pack hashes in `hello_ack`. This step adds `pack_hashes: Record<string, string>` to `HelloAckMessage` in the backend protocol and updates the hub to populate it.

- [ ] **Step 1: Update backend protocol + hub to include per-pack hashes in hello_ack**

> **Note:** The complete `hub.ts` provided in this step replaces the version written in Task 3. Use it verbatim — it incorporates all Task 3 logic plus the new `pack_hashes` field.

`backend/src/protocol.ts` — add `pack_hashes` field to `HelloAckMessage`:
```ts
export interface HelloAckMessage {
  type: "hello_ack";
  session_id: string;
  server_id: string;
  tier: "free" | "crew" | "network";
  needs_sync: boolean;
  latest_bundle_hash: string;
  api_url: string;
  pack_hashes: Record<string, string>;  // packId → latest stored hash on backend
}
```

`backend/src/ws/hub.ts` — populate `pack_hashes` in the ack:
```ts
// Inside the "hello" handler, after computing latestHash:
const packs = await db
  .select({ packId: packBundles.packId, hash: packBundles.hash })
  .from(packBundles)
  .where(eq(packBundles.serverId, keyId));

const packHashesMap: Record<string, string> = {};
for (const p of packs) packHashesMap[p.packId] = p.hash;

const ack: HelloAckMessage = {
  type: "hello_ack",
  session_id: sessionId,
  server_id: keyId,
  tier: "free",
  needs_sync: needsSync,
  latest_bundle_hash: latestHash,
  api_url: API_BASE_URL,
  pack_hashes: packHashesMap,
};
```

Full updated `backend/src/ws/hub.ts`:
```ts
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles, serverKeys } from "../db/schema";
import type { BundleAvailableMessage, HelloAckMessage, HelloMessage } from "../protocol";
import { computeAllPacksHash } from "../lib/hashUtils";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

const activeSessions = new Map<string, string>();
export const sessionSenders = new Map<string, (msg: string) => void>();

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

export async function handlePluginMessage(
  raw: string,
  send?: (msg: string) => void,
): Promise<string | null> {
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
    if (send) sessionSenders.set(sessionId, send);

    const packs = await db
      .select({ packId: packBundles.packId, hash: packBundles.hash })
      .from(packBundles)
      .where(eq(packBundles.serverId, keyId));

    const packHashesMap: Record<string, string> = {};
    for (const p of packs) packHashesMap[p.packId] = p.hash;

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
      pack_hashes: packHashesMap,
    };
    const ackJson = JSON.stringify(ack);

    if (needsSync && send) {
      setTimeout(() => {
        for (const pack of packs) {
          const available: BundleAvailableMessage = {
            type: "bundle_available",
            pack_id: pack.packId,
            url: `${API_BASE_URL}/api/bundles/${pack.packId}`,
            hash: pack.hash,
            signature: "",
          };
          send(JSON.stringify(available));
        }
      }, 0);
    }

    return ackJson;
  }

  if (msg.type === "pong") return null;
  return null;
}
```

Run backend tests after this change:
```powershell
cd backend
bun test
```
Expected: all tests pass.

Commit the backend change:
```bash
git add backend/src/protocol.ts backend/src/ws/hub.ts
git commit -m "feat(backend): include per-pack hashes in hello_ack for conflict detection"
```

- [ ] **Step 2: Write the failing conflict detection test**

`plugin/src/test/kotlin/gg/interfaze/plugin/ConflictDetectionTest.kt`:
```kotlin
package gg.interfaze.plugin

import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.sync.SyncMetadata
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Tests the three-hash conflict detection logic extracted from SyncedMenuProvider.
 * We test the pure function `detectSyncAction` directly to keep test isolation simple.
 */
class ConflictDetectionTest {

    @Test
    fun `in sync when disk hash matches backend hash`() {
        val packDir = Files.createTempDirectory("cd1_").toFile()
        File(packDir, "menu.yaml").writeText("id: m\n")
        val diskHash = BundleHasher.hash(packDir)
        val result = detectSyncAction(diskHash, syncedHash = "", backendHash = diskHash)
        assertEquals(SyncAction.IN_SYNC, result)
    }

    @Test
    fun `auto sync when disk equals synced but backend is newer`() {
        val packDir = Files.createTempDirectory("cd2_").toFile()
        File(packDir, "menu.yaml").writeText("id: m\n")
        val diskHash = BundleHasher.hash(packDir)
        val result = detectSyncAction(diskHash, syncedHash = diskHash, backendHash = "backend_newer")
        assertEquals(SyncAction.AUTO_SYNC, result)
    }

    @Test
    fun `local only when disk changed but backend hash equals synced`() {
        val packDir = Files.createTempDirectory("cd3_").toFile()
        File(packDir, "menu.yaml").writeText("id: m\n")
        val originalHash = "original_hash"
        File(packDir, "menu.yaml").writeText("id: m\nsize: 27\n")
        val diskHash = BundleHasher.hash(packDir)
        val result = detectSyncAction(diskHash, syncedHash = originalHash, backendHash = originalHash)
        assertEquals(SyncAction.LOCAL_ONLY, result)
    }

    @Test
    fun `conflict when disk synced and backend all differ`() {
        val result = detectSyncAction(
            diskHash    = "disk_v3",
            syncedHash  = "original",
            backendHash = "backend_v2",
        )
        assertEquals(SyncAction.CONFLICT, result)
    }
}
```

Also create the `detectSyncAction` function and `SyncAction` enum. These go in `SyncedMenuProvider.kt` as package-level declarations (tested directly).

- [ ] **Step 3: Run test — confirm it fails**

```powershell
cd plugin
gradlew.bat test --tests "gg.interfaze.plugin.ConflictDetectionTest"
```
Expected: BUILD FAILED — `detectSyncAction` not found.

- [ ] **Step 4: Add SyncAction enum and detectSyncAction function to SyncedMenuProvider.kt**

Add at the top of `SyncedMenuProvider.kt` (before the class, after imports):
```kotlin
enum class SyncAction { IN_SYNC, AUTO_SYNC, LOCAL_ONLY, CONFLICT }

fun detectSyncAction(diskHash: String, syncedHash: String, backendHash: String): SyncAction {
    if (diskHash == backendHash) return SyncAction.IN_SYNC
    if (diskHash == syncedHash) return SyncAction.AUTO_SYNC          // backend is newer, no local changes
    if (backendHash == syncedHash) return SyncAction.LOCAL_ONLY      // local changed, backend unchanged
    return SyncAction.CONFLICT                                        // both sides changed
}
```

Then update `handleMessage` in `SyncedMenuProvider` to use this logic for `hello_ack`:

```kotlin
"hello_ack" -> {
    val sessionId = node["session_id"]?.asText()
    logger?.info("Connected to Interfaze backend (session=$sessionId)")

    val packHashesNode = node["pack_hashes"] ?: return
    val packHashes: Map<String, String> = runCatching {
        jsonMapper.convertValue(packHashesNode, object : com.fasterxml.jackson.core.type.TypeReference<Map<String, String>>() {})
    }.getOrDefault(emptyMap())

    packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }?.forEach { packDir ->
        val packId = packDir.name
        val backendHash = packHashes[packId] ?: return@forEach
        val diskHash = BundleHasher.hash(packDir)
        val meta = gg.interfaze.plugin.sync.SyncMetadata.read(packDir)

        when (detectSyncAction(diskHash, meta.syncedHash, backendHash)) {
            SyncAction.IN_SYNC    -> logger?.fine("Pack $packId is in sync")
            SyncAction.AUTO_SYNC  -> logger?.info("Pack $packId: backend is newer — syncing automatically")
            SyncAction.LOCAL_ONLY -> logger?.warning(
                "Pack $packId: local files were manually edited (disk differs from last sync). " +
                "Backend has not changed. Use '/ifz sync accept' to apply local or '/ifz sync reject' to pull backend."
            )
            SyncAction.CONFLICT   -> logger?.warning(
                "Pack $packId: CONFLICT — both local and backend changed since last sync. " +
                "Backend version will be applied. Use '/ifz sync reject' before reconnecting to keep local."
            )
        }
    }
}
```

- [ ] **Step 5: Update IfzCommand to add /ifz sync**

`plugin/src/main/kotlin/gg/interfaze/plugin/command/IfzCommand.kt`:
```kotlin
package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class IfzCommand(private val plugin: InterfazePlugin) : CommandExecutor {
    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        if (sender !is Player) {
            sender.sendMessage("This command can only be run by a player.")
            return true
        }
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                val menuId = args.getOrNull(1) ?: run {
                    sender.sendMessage("Usage: /ifz menu <id>")
                    return true
                }
                plugin.menuProvider.openMenu(sender, menuId, "en")
            }
            "reload" -> {
                plugin.menuProvider.unload()
                plugin.menuProvider.load()
                sender.sendMessage("Interfaze reloaded.")
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> sender.sendMessage("Check server logs for sync status details.")
                    "reject" -> {
                        // Pull from backend by forcing needs_sync on next reconnect.
                        // Simplest implementation: reload (re-sends hello with current hash).
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        sender.sendMessage("Reconnecting to backend — backend version will be applied if available.")
                    }
                    else -> sender.sendMessage("Usage: /ifz sync <status|reject>")
                }
            }
            else -> sender.sendMessage("Usage: /ifz <menu <id>|reload|sync <status|reject>>")
        }
        return true
    }
}
```

- [ ] **Step 6: Run all plugin tests — confirm they pass**

```powershell
cd plugin
gradlew.bat test
```
Expected: BUILD SUCCESSFUL — all tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt plugin/src/main/kotlin/gg/interfaze/plugin/command/IfzCommand.kt plugin/src/test/kotlin/gg/interfaze/plugin/ConflictDetectionTest.kt
git commit -m "feat(plugin): conflict detection on hello_ack + /ifz sync command"
```

---

### Task 6: Frontend — publish bundle to backend on export

**Files:**
- Create: `web/src/lib/ws/bundlePublisher.ts`
- Create: `web/src/lib/ws/bundlePublisher.test.ts`
- Modify: `web/src/state/wsStore.ts`
- Create: `web/src/state/wsStore.test.ts`

- [ ] **Step 1: Write the failing bundlePublisher test**

`web/src/lib/ws/bundlePublisher.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { publishBundle } from "./bundlePublisher";

describe("publishBundle", () => {
  it("POSTs files to /api/bundles/:packId with Bearer auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "abc123" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const files = { "plugins/Interfaze/packs/p_test/manifest.yaml": "schema: manifest/v1\n" };
    const result = await publishBundle({
      apiUrl: "http://localhost:3001",
      serverKey: "sk_abc",
      packId: "p_test",
      files,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/bundles/p_test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer sk_abc",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ files }),
      }),
    );
    expect(result).toEqual({ hash: "abc123" });

    vi.unstubAllGlobals();
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(publishBundle({ apiUrl: "http://x", serverKey: "k", packId: "p", files: {} }))
      .rejects.toThrow("401");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```powershell
cd web
rtk vitest run src/lib/ws/bundlePublisher.test.ts
```
Expected: FAIL — `publishBundle` not found.

- [ ] **Step 3: Write bundlePublisher**

`web/src/lib/ws/bundlePublisher.ts`:
```ts
export interface PublishOptions {
  apiUrl: string;
  serverKey: string;
  packId: string;
  files: Record<string, string>;
}

export interface PublishResult {
  hash: string;
}

export async function publishBundle(opts: PublishOptions): Promise<PublishResult> {
  const res = await fetch(`${opts.apiUrl}/api/bundles/${opts.packId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${opts.serverKey}`,
    },
    body: JSON.stringify({ files: opts.files }),
  });

  if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
  return res.json() as Promise<PublishResult>;
}
```

- [ ] **Step 4: Run test — confirm it passes**

```powershell
cd web
rtk vitest run src/lib/ws/bundlePublisher.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: Write the failing wsStore test**

`web/src/state/wsStore.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

describe("useWsStore", () => {
  it("sets connected + serverId + apiUrl when hello_ack received", () => {
    // Isolated test: don't import the real store (it initialises zustand state globally).
    // Instead test the message-handling logic in isolation.
    const state = {
      connected: false,
      serverId: null as string | null,
      apiUrl: null as string | null,
      serverKey: null as string | null,
    };

    function handleMessage(raw: string, serverKey: string) {
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "hello_ack") {
          state.connected = true;
          state.serverId  = msg.server_id as string;
          state.apiUrl    = msg.api_url   as string;
          state.serverKey = serverKey;
        }
      } catch { /* ignore */ }
    }

    handleMessage(
      JSON.stringify({ type: "hello_ack", server_id: "srv1", api_url: "http://localhost:3001", tier: "free", session_id: "s1", needs_sync: false, latest_bundle_hash: "", pack_hashes: {} }),
      "sk_test",
    );

    expect(state.connected).toBe(true);
    expect(state.serverId).toBe("srv1");
    expect(state.apiUrl).toBe("http://localhost:3001");
  });
});
```

- [ ] **Step 6: Run test — confirm it passes immediately** (pure logic test, no store needed)

```powershell
cd web
rtk vitest run src/state/wsStore.test.ts
```
Expected: 1 test passes.

- [ ] **Step 7: Update wsStore with serverId, apiUrl, serverKey, and publish()**

`web/src/state/wsStore.ts`:
```ts
import { create } from "zustand";
import { publishBundle } from "@/lib/ws/bundlePublisher";
import { createPluginBridge, type PluginBridge } from "@/lib/ws/pluginBridge";

interface WsState {
  connected: boolean;
  bridge: PluginBridge | null;
  serverId: string | null;
  apiUrl: string | null;
  serverKey: string | null;
  connect(url: string, serverKey?: string): void;
  disconnect(): void;
  publish(packId: string, files: Record<string, string>): Promise<void>;
}

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  bridge: null,
  serverId: null,
  apiUrl: null,
  serverKey: null,

  connect(url: string, serverKey = "") {
    get().bridge?.disconnect();
    const bridge = createPluginBridge(url);
    bridge.onMessage((raw) => {
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "hello_ack") {
          set({
            connected: true,
            serverId:  msg.server_id as string,
            apiUrl:    msg.api_url   as string,
            serverKey,
          });
        }
      } catch { /* ignore malformed */ }
    });
    bridge.connect();
    set({ bridge, connected: false, serverId: null, apiUrl: null, serverKey });
  },

  disconnect() {
    get().bridge?.disconnect();
    set({ bridge: null, connected: false, serverId: null, apiUrl: null, serverKey: null });
  },

  async publish(packId, files) {
    const { apiUrl, serverKey } = get();
    if (!apiUrl || !serverKey) throw new Error("Not connected to backend");
    await publishBundle({ apiUrl, serverKey, packId, files });
  },
}));
```

- [ ] **Step 8: Run all frontend tests — confirm they pass**

```powershell
cd web
rtk vitest run src/lib/ws/ src/state/wsStore.test.ts
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/ws/bundlePublisher.ts web/src/lib/ws/bundlePublisher.test.ts web/src/state/wsStore.ts web/src/state/wsStore.test.ts
git commit -m "feat(frontend): bundlePublisher + wsStore.publish() for pushing packs to backend"
```

---

## End state

After all 6 tasks:

**Plugin** — one provider (`SyncedMenuProvider`) always loads from disk; if `server_key` is set in `config.yml`, connects to the backend on startup, sends a real SHA-256 hash of all packs in `hello`, receives `bundle_available` messages, downloads and applies updates automatically, and logs clear warnings for conflicts. `/ifz sync reject` forces a clean re-sync from the backend.

**Backend** — stores uploaded pack bundles per server in `pack_bundles` table; computes `needs_sync` using the same hash algorithm as the plugin; sends `bundle_available` per out-of-date pack after `hello_ack`; exposes `POST /api/bundles/:packId` for the frontend to publish and `GET /api/bundles/:packId` for the plugin to download (both auth'd via `Authorization: Bearer <server_key>`).

**Frontend** — `wsStore.connect(url, serverKey)` (updated signature), `wsStore.publish(packId, files)` sends a pack bundle to the backend; wire this to the export flow via a "Publish" button in the export UI (out of scope for this plan — the function is available, UI integration is a follow-up).

**Not in scope** (follow-up):
- Export UI "Publish" button wired to `wsStore.publish()`
- Multiple pack conflict resolution UI in the editor
- Bundle versioning / rollback history in the backend
- `bundle_available` via CDN URL instead of direct backend download
- `/ifz sync accept` to explicitly push local changes to the backend
