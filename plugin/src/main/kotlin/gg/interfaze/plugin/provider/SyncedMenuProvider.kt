package gg.interfaze.plugin.provider

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.customitems.CustomItemsManager
import gg.interfaze.plugin.engine.ActionExecutor
import gg.interfaze.plugin.resourcepack.ResourcePackManager
import gg.interfaze.plugin.engine.BundleCompiler
import gg.interfaze.plugin.engine.ConditionEvaluator
import gg.interfaze.plugin.engine.ExecutionContext
import gg.interfaze.plugin.engine.MenuSessionStore
import gg.interfaze.plugin.lang.LangManager
import gg.interfaze.plugin.model.BundleDialog
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.MenuYaml
import gg.interfaze.plugin.model.PackBundle
import gg.interfaze.plugin.render.DialogRenderer
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.resourcepack.AssetEntry
import gg.interfaze.plugin.sync.BundleDownloader
import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.sync.BundleUploader
import gg.interfaze.plugin.sync.SyncMetadata
import gg.interfaze.plugin.ws.WsClient
import gg.interfaze.plugin.yaml.PackReader
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
 * BundleHasher.hash() returns "" for empty directories; SyncMetadata defaults syncedHash to "".
 * When all three are "", the pack is considered IN_SYNC (both sides have nothing — correct).
 */
fun detectSyncAction(diskHash: String, syncedHash: String, backendHash: String): SyncAction {
    if (diskHash == backendHash) return SyncAction.IN_SYNC
    if (diskHash == syncedHash) return SyncAction.AUTO_SYNC          // backend is newer, no local changes
    if (backendHash == syncedHash) return SyncAction.LOCAL_ONLY      // local changed, backend unchanged
    return SyncAction.CONFLICT                                        // both sides changed
}

class SyncedMenuProvider(
    private val packsDir: File,
    private val serverKey: String,
    private val wsUrl: String,
    private val logger: Logger?,
    private val evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
    private val sessions: MenuSessionStore? = null,
    private val onReload: (() -> Unit)? = null,
    private val executorProvider: (() -> ActionExecutor)? = null,
    private val langManager: LangManager? = null,
    private val resourcePackManager: ResourcePackManager? = null,
    private val lookupAsset: (String) -> AssetEntry? = { null },
    private val offsetEncoderProvider: () -> gg.interfaze.plugin.render.OffsetEncoder = { gg.interfaze.plugin.render.OffsetEncoder.EMPTY },
) : MenuProvider {
    @Volatile private var menus = ConcurrentHashMap<String, BundleMenu>()
    @Volatile private var bundles = listOf<PackBundle>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    @Volatile private var dialogs = ConcurrentHashMap<String, BundleDialog>()
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private val httpClient = OkHttpClient()
    @Volatile private var wsClient: WsClient? = null
    private val downloadsInFlight = ConcurrentHashMap<String, Boolean>()
    @Volatile private var editorSessionCallback: ((url: String, expiresAt: String) -> Unit)? = null
    @Volatile private var lastTrustCode: String? = null
    @Volatile private var apiUrl: String? = null
    @Volatile private var customItemsManager: CustomItemsManager = CustomItemsManager(emptyList())
    @Volatile private var resourcePackManagerRef: ResourcePackManager? = null

    fun setResourcePackManager(mgr: ResourcePackManager) {
        resourcePackManagerRef = mgr
    }

    private fun rpm(): ResourcePackManager? = resourcePackManager ?: resourcePackManagerRef

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            val currentHash = BundleHasher.hashAll(packsDir)
            val mcVersion = try {
                org.bukkit.Bukkit.getServer().minecraftVersion
            } catch (e: Exception) {
                "1.21.4"
            }
            val availableSources = customItemsManager.availableSources()
            logger?.info("[IFZ] Custom item sources available: ${availableSources.ifEmpty { listOf("(none)") }}")
            // Custom items hash is computed off-thread (see registerCustomItemsReloadListeners).
            // hello sends an empty hash; the backend learns the real hash via a follow-up
            // custom_items_changed message once the async task runs. Keeping hashing off
            // the main thread leaves onEnable responsive even for sources we don't control.
            val client = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                mcVersion         = mcVersion,
                currentBundleHash = currentHash,
                localPackIds      = bundles.map { it.packId },
                customItemsHash   = "",
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

    override fun sendTrustRequest(code: String) {
        wsClient?.send(mapOf("type" to "editor_trust_request", "trust_code" to code))
    }

    override fun findMenu(menuId: String): BundleMenu? = draftMenus[menuId] ?: menus[menuId]
    override fun listMenuIds(): List<String> = (menus.keys + draftMenus.keys).distinct().sorted()
    override fun allBundles(): List<PackBundle> = bundles

    override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
        val menu = findMenu(menuId) ?: run {
            player.sendMessage(langManager?.get("cmd.menu_not_found", player, "id" to menuId)
                ?: net.kyori.adventure.text.Component.text("Menu '$menuId' not found."))
            return
        }
        val session = MenuRenderer.open(player, menu, lang, ctx, evaluator, lookupAsset, offsetEncoderProvider())
        sessions?.set(player, session)
        logger?.info("[IFZ-DEBUG] openMenu: ${player.name} → $menuId, clickSlots=${session.activeClicks.size}, sessions=${if (sessions != null) "set" else "null"}")
    }

    override fun findDialog(dialogId: String): BundleDialog? = dialogs[dialogId]

    override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
        val dialog = findDialog(dialogId) ?: run {
            player.sendMessage(langManager?.get("cmd.dialog_not_found", player, "id" to dialogId)
                ?: net.kyori.adventure.text.Component.text("Dialog '$dialogId' not found."))
            return
        }
        val executor = executorProvider?.invoke() ?: run {
            logger?.warning("openDialog called but executorProvider is null")
            return
        }
        DialogRenderer.open(player, dialog, lang, ctx, executor)
    }

    fun notifyCustomItemsReload() {
        val newHash = customItemsManager.computeHash()
        if (newHash.isNotEmpty()) {
            wsClient?.send(mapOf("type" to "custom_items_changed", "hash" to newHash))
        }
    }

    fun setCustomItemsManager(manager: CustomItemsManager) {
        customItemsManager = manager
    }

    private fun reloadFromDisk() {
        val loaded = PackReader(packsDir, logger).readAll()
        bundles = loaded
        val freshMenus = ConcurrentHashMap<String, BundleMenu>()
        val freshDialogs = ConcurrentHashMap<String, BundleDialog>()
        loaded.forEach { bundle ->
            bundle.menus.forEach { menu -> freshMenus[menu.id] = menu }
            bundle.dialogs.forEach { dialog -> freshDialogs[dialog.id] = dialog }
        }
        menus = freshMenus
        dialogs = freshDialogs
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" -> {
                val sessionId = node["session_id"]?.asText()
                logger?.info("Connected to Interfaze backend (session=$sessionId)")

                apiUrl = node["bundle_url"]?.asText() ?: node["api_url"]?.asText()

                val rpNode = node["resource_pack"]
                if (rpNode == null || rpNode.isNull) {
                    rpm()?.onUpdate(null)
                } else {
                    val url = rpNode["url"]?.asText()
                    val hash = rpNode["hash"]?.asText()
                    if (url != null && hash != null) {
                        try {
                            val downloadUrl = resolvePluginDownloadUrl(url)
                            rpm()?.applyFromBackend(url, downloadUrl, hash)
                        } catch (t: Throwable) {
                            logger?.warning("Invalid resource_pack info from hello_ack: ${t.message}")
                        }
                    }
                }

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

                    // Backend has an empty stub — upload local files regardless of sync state
                    if (backendHash.isEmpty() && diskHash.isNotEmpty()) {
                        val url = apiUrl
                        if (url != null) {
                            logger?.info("Pack $packId: backend stub is empty, uploading local files")
                            httpClient.dispatcher.executorService.execute {
                                BundleUploader(httpClient, url, serverKey, logger).upload(packDir, packId)
                            }
                        }
                        return@forEach
                    }

                    val meta = SyncMetadata.read(packDir)
                    when (detectSyncAction(diskHash, meta.syncedHash, backendHash)) {
                        SyncAction.IN_SYNC    -> logger?.fine("Pack $packId is in sync")
                        SyncAction.AUTO_SYNC  -> logger?.info("Pack $packId: backend is newer — sync will be applied via bundle_available")
                        SyncAction.LOCAL_ONLY -> logger?.warning(
                            "Pack $packId: local files were manually edited (disk differs from last sync). " +
                            "Backend has not changed. Use '/ifz sync accept' to apply local or '/ifz sync reject' to pull backend."
                        )
                        SyncAction.CONFLICT   -> logger?.warning(
                            "Pack $packId: CONFLICT — both local and backend changed since last sync. " +
                            "Backend version will be applied if bundle_available is received. " +
                            "Use '/ifz sync reject' before reconnecting to keep local."
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
                            val downloader = BundleDownloader(httpClient, packsDir, logger)
                            downloader.download(url = url, serverKey = serverKey, packId = packId)
                            reloadFromDisk()
                            draftMenus.clear()
                            logger?.info("[IFZ-DEBUG] bundle_available: triggering onReload for pack=$packId")
                            onReload?.invoke()
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
                val expiresAt = run {
                    val raw = node["expires_at"]?.asText() ?: return
                    try {
                        val fmt = java.time.format.DateTimeFormatter.ofPattern("d MMM, HH:mm")
                            .withZone(java.time.ZoneId.systemDefault())
                        fmt.format(java.time.Instant.parse(raw))
                    } catch (_: Exception) { raw }
                }
                lastTrustCode = node["trust_code"]?.asText()
                val cb = editorSessionCallback
                editorSessionCallback = null
                cb?.invoke(url, expiresAt)
            }

            "custom_items_request" -> {
                httpClient.dispatcher.executorService.execute {
                    val result = customItemsManager.buildBundle()
                    if (result != null) {
                        val (hash, data) = result
                        logger?.info("[IFZ] Sending custom items bundle — hash=${hash.take(8)}…")
                        wsClient?.send(mapOf(
                            "type" to "custom_items_bundle",
                            "hash" to hash,
                            "data" to data,
                        ))
                    } else {
                        logger?.warning("[IFZ] custom_items_request received but no custom items available — bundle not sent")
                    }
                }
            }

            "resource_pack_updated" -> {
                val url = node["url"]?.asText() ?: return
                val hash = node["hash"]?.asText() ?: return
                try {
                    val downloadUrl = resolvePluginDownloadUrl(url)
                    rpm()?.applyFromBackend(url, downloadUrl, hash)
                } catch (t: Throwable) {
                    logger?.warning("Invalid resource_pack_updated payload: ${t.message}")
                }
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }

    /**
     * Resolve the plugin-side download URL for a resource pack.
     *
     * The backend sends the player-facing URL in `resource_pack.url` (built from
     * `RESOURCE_PACK_BASE_URL`), which is what the player's MC client needs. In a
     * Docker setup, that URL is typically `http://localhost:3001/...` — which from
     * inside the `minecraft` container resolves to the minecraft container itself,
     * not the backend.
     *
     * To let the plugin download the same pack (for [gg.interfaze.plugin.resourcepack.AssetCatalog]),
     * we rebuild the URL using [apiUrl] (Docker-internal backend address from
     * `bundle_url` / `api_url` in `hello_ack`) plus the path of the original URL.
     *
     * Falls back to [playerUrl] if [apiUrl] is null (single-host deployments) or if
     * the URL cannot be parsed.
     */
    internal fun resolvePluginDownloadUrl(playerUrl: String): String {
        val base = apiUrl ?: return playerUrl
        return try {
            val parsed = java.net.URI(playerUrl)
            val pathAndQuery = buildString {
                append(parsed.rawPath ?: "")
                parsed.rawQuery?.let { append('?').append(it) }
            }
            // Trim trailing slash on base to avoid double slashes.
            val trimmedBase = if (base.endsWith('/')) base.dropLast(1) else base
            if (pathAndQuery.isEmpty()) playerUrl else trimmedBase + pathAndQuery
        } catch (_: Throwable) {
            playerUrl
        }
    }
}
