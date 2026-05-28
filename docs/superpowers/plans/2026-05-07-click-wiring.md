# Click Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `2026-05-07-engine-layer.md` must be complete.

**Goal:** Wire the engine layer into the rendering pipeline — condition-aware appearance selection, MenuSession creation, and click routing to ActionExecutor.

**Architecture:** `MenuRenderer.open()` gains `ctx + evaluator` params and returns a `MenuSession`. `MenuListener` routes clicks to `ActionExecutor` via the session store. `SyncedMenuProvider` gains `evaluator + sessions` constructor params. `ArtisanPlugin` assembles all components.

**Tech Stack:** Kotlin 2.0, Paper API 1.21.4, MockBukkit 3.133.2

---

### Task 1: Update MenuRenderer — condition-aware rendering

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`

The `open()` method gains `ctx: ExecutionContext` and `evaluator: ConditionEvaluator`, selects the first matching `CompiledAppearance` per element, and returns a `MenuSession`.

- [ ] **Step 1: Rewrite MenuRenderer.kt**

```kotlin
package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.kyori.adventure.text.format.Style
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.InventoryHolder
import org.bukkit.inventory.ItemStack

class ArtisanMenuHolder : InventoryHolder {
    override fun getInventory(): Inventory = error("not used")
}

object MenuRenderer {

    private val mm = MiniMessage.miniMessage()
    private val noItalic = Style.style(TextDecoration.ITALIC.withState(false))

    private fun parse(text: String) = mm.deserialize(text).applyFallbackStyle(noItalic)

    fun open(
        player: Player,
        menu: BundleMenu,
        lang: String,
        ctx: ExecutionContext = ExecutionContext(player),
        evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
    ): MenuSession {
        val title = mm.deserialize(menu.resolveTitle(lang))
        val inv = Bukkit.createInventory(ArtisanMenuHolder(), menu.yaml.size, title)
        val activeClicks = mutableMapOf<Int, Map<ClickType, ClickHandler>>()
        val langMap = menu.langMaps[lang] ?: emptyMap()

        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
                val chosen = compiledList.firstOrNull { ca ->
                    evaluator.evaluateAll(ca.conditions, ctx)
                } ?: continue

                val item = buildItem(chosen.yaml, langMap)
                val slots = parsePositions(element.positions, menu.yaml.size)
                for (slot in slots) {
                    inv.setItem(slot, item)
                    if (chosen.clicks.isNotEmpty()) activeClicks[slot] = chosen.clicks
                }
            }
        }

        player.openInventory(inv)
        return MenuSession(menu.id, ctx.copy(lang = lang), activeClicks)
    }

    private fun buildItem(app: AppearanceYaml, langMap: Map<String, String>): ItemStack {
        val material = app.material
            ?.let { runCatching { Material.valueOf(it.uppercase()) }.getOrNull() }
            ?: Material.STONE
        val item = ItemStack(material, app.count.coerceAtLeast(1))
        val meta = item.itemMeta ?: return item
        if (app.title != null) meta.displayName(parse(resolveI18n(app.title, langMap)))
        if (app.lore.isNotEmpty()) {
            meta.lore(app.lore.flatMap { raw ->
                resolveI18n(raw, langMap).split("\n").map { parse(it) }
            })
        }
        item.itemMeta = meta
        return item
    }

    private fun resolveI18n(raw: String, langMap: Map<String, String>): String {
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMap[key] ?: raw
    }

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

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Run existing tests to check for regressions**

```bash
cd plugin && ./gradlew test
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt
rtk git commit -m "feat(plugin): MenuRenderer — condition-aware appearance selection, returns MenuSession"
```

---

### Task 2: Rewrite MenuListener — click routing

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuListener.kt`

- [ ] **Step 1: Rewrite MenuListener.kt**

```kotlin
package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.*
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.inventory.InventoryClickEvent
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.inventory.InventoryDragEvent

class MenuListener(
    private val sessions: MenuSessionStore,
    private val executor: ActionExecutor,
) : Listener {

    @EventHandler
    fun onClick(event: InventoryClickEvent) {
        if (event.inventory.holder !is ArtisanMenuHolder) return
        event.isCancelled = true
        val player = event.whoClicked as? Player ?: return
        val session = sessions.get(player) ?: return
        val clickType = event.click.toIfzClickType() ?: return
        val handler = session.activeClicks[event.rawSlot]?.get(clickType) ?: return
        executor.handle(handler, session.ctx)
    }

    @EventHandler
    fun onDrag(event: InventoryDragEvent) {
        if (event.inventory.holder is ArtisanMenuHolder) event.isCancelled = true
    }

    @EventHandler
    fun onClose(event: InventoryCloseEvent) {
        if (event.inventory.holder is ArtisanMenuHolder) {
            sessions.remove(event.player as? Player ?: return)
        }
    }
}

private fun org.bukkit.event.inventory.ClickType.toIfzClickType(): ClickType? = when (this) {
    org.bukkit.event.inventory.ClickType.LEFT         -> ClickType.LEFT
    org.bukkit.event.inventory.ClickType.RIGHT        -> ClickType.RIGHT
    org.bukkit.event.inventory.ClickType.SHIFT_LEFT   -> ClickType.SHIFT_LEFT
    org.bukkit.event.inventory.ClickType.SHIFT_RIGHT  -> ClickType.SHIFT_RIGHT
    org.bukkit.event.inventory.ClickType.MIDDLE       -> ClickType.MIDDLE
    else                                               -> null
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuListener.kt
rtk git commit -m "feat(plugin): MenuListener — route clicks to ActionExecutor via MenuSession"
```

---

### Task 3: Update SyncedMenuProvider

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`

Add `evaluator` and `sessions` constructor params. Implement `openMenu(player, menuId, lang, ctx)`. Implement `allBundles()`. Update `draft_update` handler to use `BundleCompiler`.

- [ ] **Step 1: Update SyncedMenuProvider.kt**

```kotlin
package net.artisanmc.plugin.provider

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.model.PackBundle
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.sync.BundleDownloader
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.SyncMetadata
import net.artisanmc.plugin.ws.WsClient
import net.artisanmc.plugin.yaml.PackReader
import okhttp3.OkHttpClient
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

enum class SyncAction { IN_SYNC, AUTO_SYNC, LOCAL_ONLY, CONFLICT }

/**
 * Determines the sync action for a pack given three hashes.
 * "" (empty string) is the canonical sentinel for "no content / never synced".
 */
fun detectSyncAction(diskHash: String, syncedHash: String, backendHash: String): SyncAction {
    if (diskHash == backendHash) return SyncAction.IN_SYNC
    if (diskHash == syncedHash) return SyncAction.AUTO_SYNC
    if (backendHash == syncedHash) return SyncAction.LOCAL_ONLY
    return SyncAction.CONFLICT
}

class SyncedMenuProvider(
    private val packsDir: File,
    private val serverKey: String,
    private val wsUrl: String,
    private val logger: Logger?,
    private val evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
    private val sessions: MenuSessionStore? = null,
) : MenuProvider {
    @Volatile private var menus = ConcurrentHashMap<String, BundleMenu>()
    @Volatile private var bundles = listOf<PackBundle>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private val httpClient = OkHttpClient()
    @Volatile private var wsClient: WsClient? = null
    private val downloadsInFlight = ConcurrentHashMap<String, Boolean>()
    @Volatile private var editorSessionCallback: ((url: String, expiresAt: String) -> Unit)? = null

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            val currentHash = BundleHasher.hashAll(packsDir)
            val client = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                currentBundleHash = currentHash,
                onMessage         = ::handleMessage,
                logger            = logger,
            )
            wsClient = client
            client.connect()
        }
    }

    override fun unload() {
        wsClient?.disconnect()
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
    }

    override fun requestEditorSession(sender: String, onReady: (url: String, expiresAt: String) -> Unit) {
        editorSessionCallback = onReady
        wsClient?.send(mapOf("type" to "editor_session_request", "sender" to sender))
    }

    override fun revokeEditorSessions() {
        wsClient?.send(mapOf("type" to "editor_session_revoke"))
    }

    override fun findMenu(menuId: String): BundleMenu? = draftMenus[menuId] ?: menus[menuId]
    override fun listMenuIds(): List<String> = (menus.keys + draftMenus.keys).distinct().sorted()
    override fun allBundles(): List<PackBundle> = bundles

    override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
        val menu = findMenu(menuId) ?: run {
            player.sendMessage("Menu '$menuId' not found.")
            return
        }
        val session = MenuRenderer.open(player, menu, lang, ctx, evaluator)
        sessions?.set(player, session)
    }

    private fun reloadFromDisk() {
        val loaded = PackReader(packsDir, logger).readAll()
        bundles = loaded
        val fresh = ConcurrentHashMap<String, BundleMenu>()
        loaded.forEach { bundle -> bundle.menus.forEach { menu -> fresh[menu.id] = menu } }
        menus = fresh
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" -> {
                val sessionId = node["session_id"]?.asText()
                logger?.info("Connected to Artisan backend (session=$sessionId)")

                val packHashesNode = node["pack_hashes"] ?: run {
                    logger?.warning("Backend did not send pack_hashes — sync check skipped (old backend?)")
                    return
                }
                val packHashes: Map<String, String> = runCatching {
                    jsonMapper.convertValue(packHashesNode, object : TypeReference<Map<String, String>>() {})
                }.getOrDefault(emptyMap())

                packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }?.forEach { packDir ->
                    val packId = packDir.name
                    val backendHash = packHashes[packId] ?: run {
                        logger?.fine("Pack $packId not found in backend pack_hashes — treating as local-only, no sync")
                        return@forEach
                    }
                    val diskHash = BundleHasher.hash(packDir)
                    val meta = SyncMetadata.read(packDir)

                    when (detectSyncAction(diskHash, meta.syncedHash, backendHash)) {
                        SyncAction.IN_SYNC    -> logger?.fine("Pack $packId is in sync")
                        SyncAction.AUTO_SYNC  -> logger?.info("Pack $packId: backend is newer — sync will be applied via bundle_available")
                        SyncAction.LOCAL_ONLY -> logger?.warning(
                            "Pack $packId: local files were manually edited. Use '/artisan sync accept' or '/artisan sync reject'."
                        )
                        SyncAction.CONFLICT   -> logger?.warning(
                            "Pack $packId: CONFLICT — both local and backend changed since last sync."
                        )
                    }
                }
            }

            "bundle_available" -> {
                val packId = node["pack_id"]?.asText() ?: return
                val url    = node["url"]?.asText()     ?: return
                if (downloadsInFlight.putIfAbsent(packId, true) != null) return
                try {
                    httpClient.dispatcher.executorService.execute {
                        try {
                            BundleDownloader(httpClient, packsDir, logger).download(url = url, serverKey = serverKey, packId = packId)
                            reloadFromDisk()
                            draftMenus.clear()
                        } finally {
                            downloadsInFlight.remove(packId)
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    downloadsInFlight.remove(packId)
                    logger?.warning("Bundle download rejected — plugin is stopping")
                }
            }

            "draft_update" -> {
                val menuId   = node["menu_id"]?.asText()   ?: return
                val menuYaml = node["menu_yaml"]?.asText() ?: return
                val parsed   = runCatching { yamlMapper.readValue(menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
                draftMenus[menuId] = BundleCompiler.compile(parsed, emptyMap(), logger)
                logger?.info("Draft updated for $menuId")
            }

            "editor_session_ready" -> {
                val url = node["url"]?.asText() ?: return
                val expiresAt = node["expires_at"]?.asText() ?: return
                val cb = editorSessionCallback
                editorSessionCallback = null
                cb?.invoke(url, expiresAt)
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Run full test suite**

```bash
cd plugin && ./gradlew test
```
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt
rtk git commit -m "feat(plugin): SyncedMenuProvider — evaluator+sessions params, allBundles(), condition-aware openMenu"
```

---

### Task 4: Wire everything in ArtisanPlugin

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`

- [ ] **Step 1: Update ArtisanPlugin.kt**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.render.MenuListener
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set
    private lateinit var ifzCommand: ArtisanCommand
    private lateinit var executor: ActionExecutor
    private lateinit var sessions: MenuSessionStore
    private lateinit var cooldowns: CooldownStore

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val serverRoot = dataFolder.parentFile.parentFile
        val packsDir = File(serverRoot, cfg.packsDir).also { it.mkdirs() }

        val softDeps = SoftDepRegistry(this)
        cooldowns = CooldownStore()
        sessions = MenuSessionStore()
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
            evaluator = evaluator,
            sessions  = sessions,
        )
        menuProvider.load()

        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)

        ifzCommand = ArtisanCommand(this)
        getCommand("ifz")?.setExecutor(ifzCommand)
        getCommand("ifz")?.tabCompleter = ifzCommand
        server.pluginManager.registerEvents(MenuListener(sessions, executor), this)
        logger.info("Artisan ${description.version} enabled")
    }

    override fun onDisable() {
        ifzCommand.shutdown()
        menuProvider.unload()
        logger.info("Artisan disabled")
    }

    fun reinit(cfg: PluginConfig) {
        menuProvider.unload()
        val packsDir = File(dataFolder.parentFile.parentFile, cfg.packsDir).also { it.mkdirs() }

        val softDeps = SoftDepRegistry(this)
        val evaluator = ConditionEvaluator(softDeps, cooldowns)

        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
            evaluator = evaluator,
            sessions  = sessions,
        )
        menuProvider.load()
        executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Run full test suite**

```bash
cd plugin && ./gradlew test
```
Expected: All tests pass

- [ ] **Step 4: Build the JAR**

```bash
cd plugin && ./gradlew shadowJar
```
Expected: `BUILD SUCCESSFUL`, JAR at `build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar`

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt
rtk git commit -m "feat(plugin): wire SoftDepRegistry, ConditionEvaluator, ActionExecutor, MenuListener into ArtisanPlugin"
```
