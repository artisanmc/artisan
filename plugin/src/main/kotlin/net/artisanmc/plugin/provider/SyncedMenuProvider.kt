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
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.render.DialogRenderer
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.artisanmc.plugin.sync.BundleDownloader
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.LocalPushSender
import net.artisanmc.plugin.sync.SyncMetadata
import net.artisanmc.plugin.ws.WsClient
import net.artisanmc.plugin.yaml.ProjectReader
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
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
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
    private val installedModules: () -> List<Map<String, String>> = { emptyList() },
    private val dataSources: net.artisanmc.modules.api.DataSourceRegistry? = null,
    private val dataSourcesReport: () -> List<Map<String, Any?>> = { emptyList() },
    /**
     * Dispatches a task onto the Bukkit main thread (fetchers touch the Bukkit
     * API). Default = synchronous, for tests; ArtisanPlugin injects the scheduler.
     */
    private val runOnMainThread: (() -> Unit) -> Unit = { it() },
) : MenuProvider {
    companion object {
        internal const val MAX_PREVIEW_ROWS = 50
        internal const val MAX_PREVIEW_BYTES = 256 * 1024
    }

    @Volatile private var menus = ConcurrentHashMap<String, BundleMenu>()
    @Volatile private var bundles = listOf<ProjectBundle>()
    /** `pack:` refs resolve against the live bundle list (survives hot-reload swaps). */
    private val projectDataResolver = net.artisanmc.plugin.engine.ProjectDataResolver { bundles }
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

    private fun send(payload: Map<String, Any>) {
        val raw = jsonMapper.writeValueAsString(payload)
        testSendOverride?.invoke(raw) ?: wsClient?.send(payload)
    }

    /** Module-message escape hatch (api.messages) — fire-and-forget over the WS. */
    fun sendModuleMessage(payload: Map<String, Any>) = send(payload)

    /**
     * Human-readable one-liner for a thrown exception, for the `message` field of a
     * failed data-source preview. Falls back to the exception's simple class name
     * when `message` is null/blank (e.g. a bare NPE) so the editor never shows "?".
     */
    private fun describeError(e: Throwable): String =
        e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName

    private val downloadsInFlight = ConcurrentHashMap<String, Boolean>()
    @Volatile private var apiUrl: String? = null
    @Volatile private var editorUrl: String? = null
    @Volatile private var networkName: String? = null
    @Volatile private var customItemsManager: CustomItemsManager = CustomItemsManager(emptyList())
    @Volatile private var resourcePackManagerRef: ResourcePackManager? = null

    fun setResourcePackManager(mgr: ResourcePackManager) {
        resourcePackManagerRef = mgr
    }

    private fun rpm(): ResourcePackManager? = resourcePackManager ?: resourcePackManagerRef

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            val currentHash = BundleHasher.hashAll(roots)
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
                localProjectIds   = bundles.map { it.projectId },
                customItemsHash   = "",
                installedModules  = installedModules,
                dataSources       = dataSourcesReport,
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

    override fun editorInfo(): Pair<String, String>? {
        val url = editorUrl ?: return null
        return url to (networkName ?: "")
    }

    override fun findMenu(menuId: String): BundleMenu? = draftMenus[menuId] ?: menus[menuId]
    override fun listMenuIds(): List<String> = (menus.keys + draftMenus.keys).distinct().sorted()
    override fun allBundles(): List<ProjectBundle> = bundles

    override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
        val menu = findMenu(menuId) ?: run {
            player.sendMessage(langManager?.get("cmd.menu_not_found", player, "id" to menuId)
                ?: net.kyori.adventure.text.Component.text("Menu '$menuId' not found."))
            return
        }
        val session = MenuRenderer.open(
            player, menu, lang, ctx, evaluator, lookupAsset, offsetEncoderProvider(),
            dataSources, projectDataResolver,
        )
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

    /** Re-report presence to the backend after the active module set changed. */
    fun notifyModulesChanged(modules: List<Map<String, String>>) {
        wsClient?.send(mapOf(
            "type" to "modules_changed",
            "server_key" to serverKey,
            "installed_modules" to modules,
            "data_sources" to dataSourcesReport(),
        ))
    }

    fun setCustomItemsManager(manager: CustomItemsManager) {
        customItemsManager = manager
    }

    override fun pushLocalProject(projectId: String, projectDir: java.io.File): String? {
        val msg = LocalPushSender.buildPushMessage(projectId, projectDir)
        send(msg)
        return msg["hash"] as? String
    }

    private fun reloadFromDisk() {
        val loaded = ProjectReader(roots, logger).readAll()
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
                editorUrl = node["server_url"]?.asText() ?: node["editor_url"]?.asText() ?: editorUrl
                networkName = node["network_name"]?.asText() ?: networkName

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

                val projectHashesNode = node["project_hashes"] ?: run {
                    logger?.warning("Backend did not send project_hashes — sync check skipped (old backend?)")
                    return
                }
                val projectHashes: Map<String, String> = runCatching {
                    jsonMapper.convertValue(projectHashesNode, object : TypeReference<Map<String, String>>() {})
                }.getOrDefault(emptyMap())

                val deletedProjectIdsNode = node["deleted_project_ids"]
                if (deletedProjectIdsNode != null && deletedProjectIdsNode.isArray) {
                    deletedProjectIdsNode.forEach { idNode ->
                        val projectId = idNode.asText()
                        if (roots.dirFor(projectId).exists()) {
                            logger?.info("hello_ack: reconciling deletion of $projectId")
                            handleProjectDeletion(projectId)
                        }
                    }
                }

                roots.all().forEach { (projectId, projectDir) ->
                    val backendHash = projectHashes[projectId] ?: run {
                            logger?.fine("Project $projectId not found in backend project_hashes — treating as local-only, no sync")
                            return@forEach
                        }
                    val diskHash = BundleHasher.hash(projectDir)

                    // Backend has an empty stub — auto-push local files via WS local_push
                    if (backendHash.isEmpty() && diskHash.isNotEmpty()) {
                        logger?.info("Pack $projectId: backend reports empty — auto-pushing local content")
                        httpClient.dispatcher.executorService.execute {
                            pushLocalProject(projectId, projectDir)
                        }
                        return@forEach
                    }

                    val meta = SyncMetadata.read(projectDir)
                    val action = detectSyncAction(diskHash, meta.syncedHash, backendHash)
                    when (action) {
                        SyncAction.IN_SYNC    -> logger?.fine("Pack $projectId is in sync")
                        SyncAction.AUTO_SYNC  -> logger?.fine("Pack $projectId: backend is newer — sync will be applied via bundle_available")
                        SyncAction.LOCAL_ONLY, SyncAction.CONFLICT -> {
                            // Plan 1C: backend = source of truth. Local divergence will be overwritten
                            // by the next bundle_available. We log a single WARN line for post-mortem
                            // tracing — no UI, no prompt, no delay. Admins who edited via FTP must use
                            // `/artisan pushLocal <project_id>` to upload local changes before reconnecting.
                            logger?.warning(
                                "[Artisan] Local pack '$projectId' differs from backend (action=$action). " +
                                "Backend version will overwrite local. Use /artisan pushLocal $projectId if local edits were intentional."
                            )
                        }
                    }
                }
            }

            "bundle_available" -> {
                val projectId = node["project_id"]?.asText() ?: return
                val url    = node["url"]?.asText()     ?: return
                if (downloadsInFlight.putIfAbsent(projectId, true) != null) return
                try {
                    httpClient.dispatcher.executorService.execute {
                        try {
                            val downloader = BundleDownloader(httpClient, roots, logger)
                            downloader.download(url = url, serverKey = serverKey, projectId = projectId)
                            reloadFromDisk()
                            draftMenus.clear()
                            logger?.info("[ART-DEBUG] bundle_available: triggering onReload for pack=$projectId")
                            onReload?.invoke()
                        } finally {
                            downloadsInFlight.remove(projectId)
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    downloadsInFlight.remove(projectId)
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

            "player_inventory_fetch" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val playerName = node["player"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "player_inventory_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("player_inventory_result dropped — plugin is stopping")
                    }
                }
                try {
                    runOnMainThread {
                        try {
                            val player = org.bukkit.Bukkit.getPlayerExact(playerName)
                            if (player == null) {
                                reply(mapOf("ok" to false, "error" to "player_not_found"))
                                return@runOnMainThread
                            }
                            val nexo = evaluator.deps.nexoItems
                            val slots = ArrayList<Map<String, Any>>()
                            // 0-35 storage, 36-39 armor, 40 offhand — mirror the
                            // vanilla slot numbering so the editor can label them.
                            val inv = player.inventory
                            val all = inv.contents.toList() + inv.armorContents.toList() + listOf(inv.itemInOffHand)
                            all.forEachIndexed { slot, stack ->
                                if (stack == null || stack.type.isAir) return@forEachIndexed
                                slots.add(
                                    mapOf(
                                        "slot" to slot,
                                        "stack_yaml" to net.artisanmc.plugin.items.ItemDescriptor.serialize(stack),
                                        "display" to net.artisanmc.plugin.items.ItemDescriptor.derive(stack, nexo),
                                    )
                                )
                            }
                            reply(mapOf("ok" to true, "slots" to slots))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] inventory snapshot for '$playerName' failed", e)
                            reply(mapOf("ok" to false, "error" to "fetch_error", "message" to describeError(e)))
                        }
                    }
                } catch (e: Throwable) {
                    logger?.log(java.util.logging.Level.WARNING, "[Artisan] inventory snapshot scheduling failed", e)
                    reply(mapOf("ok" to false, "error" to "fetch_error", "message" to describeError(e)))
                }
            }
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
                try {
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
                            reply(mapOf("ok" to false, "error" to "player_required", "message" to describeError(e)))
                        } catch (e: Throwable) {
                            // A null message (typically an NPE from a fetcher touching
                            // player data in preview mode) would surface as a bare "?"
                            // in the editor — fall back to the exception type and log
                            // the full stack trace for post-mortem.
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] data source preview '$ref' failed", e)
                            reply(mapOf("ok" to false, "error" to "fetch_error", "message" to describeError(e)))
                        }
                    }
                } catch (e: Throwable) {
                    logger?.log(java.util.logging.Level.WARNING, "[Artisan] data source preview '$ref' scheduling failed", e)
                    reply(mapOf("ok" to false, "error" to "fetch_error", "message" to describeError(e)))
                }
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

            "project_deleted" -> {
                val projectId = node["project_id"]?.asText() ?: return
                handleProjectDeletion(projectId)
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }

    private fun handleProjectDeletion(projectId: String) {
        // Atomic switch: drop the project from the in-memory bundles BEFORE touching disk.
        bundles = bundles.filterNot { it.projectId == projectId }
        val freshMenus = ConcurrentHashMap<String, BundleMenu>()
        val freshDialogs = ConcurrentHashMap<String, BundleDialog>()
        bundles.forEach { b ->
            b.menus.forEach { freshMenus[it.id] = it }
            b.dialogs.forEach { freshDialogs[it.id] = it }
        }
        menus = freshMenus
        dialogs = freshDialogs
        net.artisanmc.plugin.sync.ProjectDeleter(roots, logger).delete(projectId)
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
