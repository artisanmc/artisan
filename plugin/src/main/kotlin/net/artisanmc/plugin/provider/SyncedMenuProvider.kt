package net.artisanmc.plugin.provider

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.customitems.CustomItemsManager
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.MenuSessionStore
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.BundleDialog
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.model.PackBundle
import net.artisanmc.plugin.render.DialogRenderer
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.artisanmc.plugin.sync.BundleDownloader
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.LocalPushSender
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
    private val offsetEncoderProvider: () -> net.artisanmc.plugin.render.OffsetEncoder = { net.artisanmc.plugin.render.OffsetEncoder.EMPTY },
    private val installedModules: List<Map<String, String>> = emptyList(),
) : MenuProvider {
    @Volatile private var menus = ConcurrentHashMap<String, BundleMenu>()
    @Volatile private var bundles = listOf<PackBundle>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    @Volatile private var dialogs = ConcurrentHashMap<String, BundleDialog>()
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private val httpClient = OkHttpClient()
    @Volatile private var wsClient: WsClient? = null
    @Volatile private var testSendOverride: ((String) -> Unit)? = null

    internal fun setSendForTesting(fn: (String) -> Unit) {
        testSendOverride = fn
    }

    private fun send(payload: Map<String, Any>) {
        val raw = jsonMapper.writeValueAsString(payload)
        testSendOverride?.invoke(raw) ?: wsClient?.send(payload)
    }

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
            logger?.info("[ART] Custom item sources available: ${availableSources.ifEmpty { listOf("(none)") }}")
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
                installedModules  = installedModules,
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
        // Executor is intentionally NOT shut down here — it is shared across load/unload
        // cycles (e.g. /artisan reload) and shutting it would break subsequent bundle downloads.
        // The hard tear-down lives in shutdown().
    }

    override fun shutdown() {
        unload()
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
        logger?.info("[ART-DEBUG] openMenu: ${player.name} → $menuId, clickSlots=${session.activeClicks.size}, sessions=${if (sessions != null) "set" else "null"}")
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

    override fun pushLocalPack(packId: String, packDir: java.io.File): String? {
        val msg = LocalPushSender.buildPushMessage(packId, packDir)
        send(msg)
        return msg["hash"] as? String
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
                logger?.info("Connected to Artisan backend (session=$sessionId)")

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

                val deletedPackIdsNode = node["deleted_pack_ids"]
                if (deletedPackIdsNode != null && deletedPackIdsNode.isArray) {
                    deletedPackIdsNode.forEach { idNode ->
                        val packId = idNode.asText()
                        if (File(packsDir, packId).exists()) {
                            logger?.info("hello_ack: reconciling deletion of $packId")
                            handlePackDeletion(packId)
                        }
                    }
                }

                packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }?.forEach { packDir ->
                    val packId = packDir.name
                    val backendHash = packHashes[packId] ?: run {
                            logger?.fine("Pack $packId not found in backend pack_hashes — treating as local-only, no sync")
                            return@forEach
                        }
                    val diskHash = BundleHasher.hash(packDir)

                    // Backend has an empty stub — auto-push local files via WS local_push
                    if (backendHash.isEmpty() && diskHash.isNotEmpty()) {
                        logger?.info("Pack $packId: backend reports empty — auto-pushing local content")
                        httpClient.dispatcher.executorService.execute {
                            pushLocalPack(packId, packDir)
                        }
                        return@forEach
                    }

                    val meta = SyncMetadata.read(packDir)
                    val action = detectSyncAction(diskHash, meta.syncedHash, backendHash)
                    when (action) {
                        SyncAction.IN_SYNC    -> logger?.fine("Pack $packId is in sync")
                        SyncAction.AUTO_SYNC  -> logger?.fine("Pack $packId: backend is newer — sync will be applied via bundle_available")
                        SyncAction.LOCAL_ONLY, SyncAction.CONFLICT -> {
                            // Plan 1C: backend = source of truth. Local divergence will be overwritten
                            // by the next bundle_available. We log a single WARN line for post-mortem
                            // tracing — no UI, no prompt, no delay. Admins who edited via FTP must use
                            // `/artisan pushLocal <pack_id>` to upload local changes before reconnecting.
                            logger?.warning(
                                "[Artisan] Local pack '$packId' differs from backend (action=$action). " +
                                "Backend version will overwrite local. Use /artisan pushLocal $packId if local edits were intentional."
                            )
                        }
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
                            logger?.info("[ART-DEBUG] bundle_available: triggering onReload for pack=$packId")
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
                        logger?.info("[ART] Sending custom items bundle — hash=${hash.take(8)}…")
                        wsClient?.send(mapOf(
                            "type" to "custom_items_bundle",
                            "hash" to hash,
                            "data" to data,
                        ))
                    } else {
                        logger?.warning("[ART] custom_items_request received but no custom items available — bundle not sent")
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

            "pack_deleted" -> {
                val packId = node["pack_id"]?.asText() ?: return
                handlePackDeletion(packId)
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }

    private fun handlePackDeletion(packId: String) {
        // Atomic switch: drop the pack from the in-memory bundles BEFORE touching disk.
        bundles = bundles.filterNot { it.packId == packId }
        val freshMenus = ConcurrentHashMap<String, BundleMenu>()
        val freshDialogs = ConcurrentHashMap<String, BundleDialog>()
        bundles.forEach { b ->
            b.menus.forEach { freshMenus[it.id] = it }
            b.dialogs.forEach { freshDialogs[it.id] = it }
        }
        menus = freshMenus
        dialogs = freshDialogs
        net.artisanmc.plugin.sync.PackDeleter(packsDir, logger).delete(packId)
        onReload?.invoke()
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
     * To let the plugin download the same pack (for [net.artisanmc.plugin.resourcepack.AssetCatalog]),
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

    internal fun handleMessageForTesting(raw: String) = handleMessage(raw)
}
