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
 * Determines the sync action for a project given three hashes.
 * "" (empty string) is the canonical sentinel for "no content / never synced".
 * BundleHasher.hash() returns "" for empty directories; SyncMetadata defaults syncedHash to "".
 * When all three are "", the project is considered IN_SYNC (both sides have nothing — correct).
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
    /** Module-declared model/v1 documents, reported verbatim at Presence. */
    private val declaredModelsReport: () -> List<Map<String, Any?>> = { emptyList() },
    /** Module-declared Config screens, reported at Presence (ADR module-config-screens). */
    private val editorScreensReport: () -> List<Map<String, Any?>> = { emptyList() },
    /**
     * Dispatches a task onto the Bukkit main thread (fetchers touch the Bukkit
     * API). Default = synchronous, for tests; ArtisanPlugin injects the scheduler.
     */
    private val runOnMainThread: (() -> Unit) -> Unit = { it() },
    /** Disk scan period — quiescence over two ticks absorbs a multi-file agent burst. */
    private val scanIntervalMs: Long = 3000,
) : MenuProvider {
    companion object {
        internal const val MAX_PREVIEW_ROWS = 50
        internal const val MAX_PREVIEW_BYTES = 256 * 1024
        internal const val MAX_CONFIG_BYTES = 1024 * 1024

        /**
         * Garde-fou de `project_read` — l'arbre entier d'un Project sur le fil.
         * Mesuré le 2026-08-12 sur les deux vrais projects du devstack : 17 et 21
         * fichiers, 7,9 Ko et 43 Ko. Deux ordres de grandeur de marge, donc pas de
         * découpage — juste un plafond qui répond `too_large` au lieu de tronquer.
         */
        internal const val MAX_PROJECT_BYTES = 8 * 1024 * 1024

        /**
         * Ce que `project_read` retire de l'arbre disque. L'éditeur a besoin de
         * `.artisan/editor.yaml` (layout du board, `i18n_mode`) — il n'a rien à
         * faire de la corbeille ni de l'état de sync.
         */
        internal fun isEditorInvisible(rel: String): Boolean {
            val first = rel.substringBefore('/')
            return first == ".artisan-trash" || first == ".artisan-sync.yaml" ||
                rel.startsWith(".artisan/history/")
        }

        /** Profondeur de la corbeille `.artisan/history/<rel>/` — anneau par fichier. */
        internal const val MAX_HISTORY_VERSIONS = 20

        /**
         * Garde de chemin pour `project_write`. Distinct de [isSafeRelPath], qui
         * refuse **tout** `.artisan*` : l'éditeur est propriétaire de
         * `.artisan/editor.yaml` et doit pouvoir l'écrire. Seuls la corbeille et
         * l'état de sync lui restent interdits — ce qu'il ne voit pas en lecture,
         * il ne peut pas l'écrire.
         */
        internal fun isEditorWritablePath(p: String): Boolean {
            if (p.isBlank()) return false
            val norm = p.replace('\\', '/')
            if (norm.startsWith("/") || norm.contains("..") || norm.contains(":")) return false
            return !isEditorInvisible(norm)
        }

        /** Traversal guard for relay-provided relative paths (mirror of ProjectContentReader.resolve). */
        internal fun isSafeRelPath(p: String): Boolean {
            if (p.isBlank()) return false
            val norm = p.replace('\\', '/')
            if (norm.startsWith("/") || norm.contains("..") || norm.contains(":")) return false
            return !norm.substringBefore('/').startsWith(".artisan")
        }

        /** projectId feeds ProjectRoots.dirFor — must be a bare directory name. */
        internal fun isSafeProjectId(id: String): Boolean =
            id.isNotBlank() && !id.contains('/') && !id.contains('\\') &&
                !id.contains("..") && !id.contains(':') && !id.startsWith(".")
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
    /**
     * Copie le contenu actuel de [relPath] dans `.artisan/history/<relPath>/<ms>`
     * avant qu'il soit écrasé ou supprimé, puis purge l'anneau.
     *
     * Ce n'est pas de l'historique de version : c'est une corbeille par fichier
     * (ADR `server-disk-only-storage` décision 5). « Remets ce menu comme il
     * était » marche ; « remets tout le Project à hier soir » non, et c'est
     * assumé. Vit sous `.artisan` donc hors hash, hors scan, hors export.
     * Un échec d'archivage ne bloque pas l'écriture — perdre le filet est
     * regrettable, perdre l'enregistrement de l'admin le serait plus.
     */
    private fun archiveToHistory(projectDir: java.io.File, relPath: String) {
        val source = java.io.File(projectDir, relPath)
        if (!source.isFile) return
        try {
            val dir = java.io.File(projectDir, ".artisan/history/$relPath")
            dir.mkdirs()
            // Nom = millis sur 13 chiffres : l'ordre lexicographique EST l'ordre
            // chronologique, donc la purge n'a pas à parser de dates.
            var stamp = System.currentTimeMillis()
            while (java.io.File(dir, "%013d".format(stamp)).exists()) stamp++
            java.io.File(dir, "%013d".format(stamp)).writeText(source.readText(Charsets.UTF_8))
            val versions = dir.listFiles()?.sortedBy { it.name } ?: return
            if (versions.size > MAX_HISTORY_VERSIONS) {
                versions.take(versions.size - MAX_HISTORY_VERSIONS).forEach { it.delete() }
            }
        } catch (e: Throwable) {
            logger?.log(java.util.logging.Level.WARNING, "[Artisan] archivage corbeille '$relPath' échoué", e)
        }
    }

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
        startScanner()
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
                declaredModels    = declaredModelsReport,
                editorScreens     = editorScreensReport,
                onMessage         = ::handleMessage,
                logger            = logger,
            )
            wsClient = client
            client.connect()
        }
    }

    override fun unload() {
        scanner?.stop()
        scanner = null
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
            "declared_models" to declaredModelsReport(),
            "editor_screens" to editorScreensReport(),
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

    /**
     * Disk hash of the last automatic push, per project. In memory only, on
     * purpose: it closes the echo window between a `local_push` and the
     * `bundle_available` that acknowledges it (several triggers can observe the
     * same LOCAL_ONLY tree — a config_write and the scan a tick later), without
     * ever claiming on disk that something was synced when it may not have
     * landed. Cleared on reconnect and after a download, so a push lost in
     * flight is retried rather than forgotten.
     */
    private val lastPushedHash = ConcurrentHashMap<String, String>()

    /** Automatic (non-forced) push of a LOCAL_ONLY tree, at most once per disk hash. */
    private fun autoPush(projectId: String, projectDir: java.io.File, diskHash: String) {
        if (lastPushedHash[projectId] == diskHash) return
        lastPushedHash[projectId] = diskHash
        pushLocalProject(projectId, projectDir)
    }

    @Volatile private var scanner: net.artisanmc.plugin.sync.SyncScanner? = null

    /**
     * Poll-first disk sync (spec `2026-07-30-poll-first-disk-sync-design`,
     * revising ADR files-first-source-of-truth #6): hand/agent edits hot-reload
     * and auto-push when connected. Content-based, so it behaves identically on
     * Docker bind mounts, NFS and native filesystems. Internal so tests can
     * start it without load()'s WS side effects.
     */
    internal fun startScanner() {
        if (scanner != null) return
        scanner = net.artisanmc.plugin.sync.SyncScanner(
            roots,
            intervalMs = scanIntervalMs,
            logger = logger,
            onProjectsChanged = ::onScanChanged,
        ).also { it.start() }
    }

    /** Runs on the scanner's tick thread — same off-main pattern as bundle_available. */
    private fun onScanChanged(projectIds: Set<String>) {
        reloadFromDisk()
        draftMenus.clear()
        onReload?.invoke()
        if (serverKey.isEmpty()) return
        projectIds.forEach { projectId ->
            val projectDir = roots.dirFor(projectId)
            if (!projectDir.exists()) return@forEach
            val diskHash = BundleHasher.hash(projectDir)
            val meta = SyncMetadata.read(projectDir)
            when (detectSyncAction(diskHash, meta.syncedHash, meta.backendHash)) {
                SyncAction.IN_SYNC, SyncAction.AUTO_SYNC -> {}
                SyncAction.LOCAL_ONLY -> {
                    logger?.warning("[Artisan] '$projectId' changed on disk — hot-reloaded, auto-pushing.")
                    autoPush(projectId, projectDir, diskHash)
                }
                SyncAction.CONFLICT -> {
                    logger?.warning(
                        "[Artisan] '$projectId' changed on disk but the backend also moved since last sync — " +
                        "hot-reloaded locally, NOT pushed; divergence reported to the editor for resolution."
                    )
                    send(LocalPushSender.buildDivergenceMessage(projectId, projectDir, meta.syncedHash))
                }
            }
        }
    }

    private fun reloadFromDisk() {
        // Declared model docs feed the reader so BARE data files resolve their
        // schema from the JAR declaration (ADR bare-data-files ①).
        val loaded = ProjectReader(roots, logger, {
            declaredModelsReport().mapNotNull { doc ->
                (doc["id"] as? String)?.let { it to doc }
            }.toMap()
        }).readAll()
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


    /**
     * Dernier `project_hashes` reçu au hello_ack. Null tant qu'aucun n'est
     * arrivé : sans référence backend, il n'y a rien à comparer.
     */
    @Volatile private var lastProjectHashes: Map<String, String>? = null

    /**
     * Rejoue le contrôle de synchro du hello_ack. Nécessaire parce qu'un module
     * peut écrire des fichiers de project à son activation — donc APRÈS le
     * hello_ack, le contrôle étant déjà passé. Le scan périodique rattraperait
     * au tick suivant ; ce rappel évite simplement d'attendre.
     */
    fun recheckLocalChanges() {
        val hashes = lastProjectHashes ?: return
        checkLocalChangesAgainst(hashes)
    }

    private fun checkLocalChangesAgainst(projectHashes: Map<String, String>) {
        roots.all().forEach { (projectId, projectDir) ->
            val backendHash = projectHashes[projectId] ?: run {
                logger?.fine("Project $projectId not found in backend project_hashes — treating as local-only, no sync")
                return@forEach
            }
            val diskHash = BundleHasher.hash(projectDir)

            // Backend has an empty stub — auto-push local files via WS local_push
            if (backendHash.isEmpty() && diskHash.isNotEmpty()) {
                logger?.info("Project $projectId: backend reports empty — auto-pushing local content")
                httpClient.dispatcher.executorService.execute {
                    autoPush(projectId, projectDir, diskHash)
                }
                return@forEach
            }

            val meta = SyncMetadata.read(projectDir)
            val action = detectSyncAction(diskHash, meta.syncedHash, backendHash)
            when (action) {
                SyncAction.IN_SYNC    -> logger?.fine("Project $projectId is in sync")
                SyncAction.AUTO_SYNC  -> logger?.fine("Project $projectId: backend is newer — sync will be applied via bundle_available")
                SyncAction.LOCAL_ONLY -> {
                    // Files-first (ADR files-first-source-of-truth #6): the disk is the
                    // primary editing surface — local-only changes are AUTO-PUSHED,
                    // silent + one WARN for post-mortem tracing (house "no theater" rule).
                    logger?.warning(
                        "[Artisan] Local project '$projectId' changed on disk (backend unchanged) — auto-pushing local content."
                    )
                    httpClient.dispatcher.executorService.execute {
                        autoPush(projectId, projectDir, diskHash)
                    }
                }
                SyncAction.CONFLICT -> {
                    // True divergence (disk AND web both moved since last sync): no
                    // overwrite in either direction — report the disk state so the
                    // editor can offer per-file resolution (P3c). Re-sent at every
                    // hello_ack until resolved (self-healing if the backend restarts).
                    logger?.warning(
                        "[Artisan] Local project '$projectId' diverged from backend (both changed). " +
                        "Not auto-pushing — divergence reported to the editor for resolution."
                    )
                    httpClient.dispatcher.executorService.execute {
                        send(LocalPushSender.buildDivergenceMessage(projectId, projectDir, meta.syncedHash))
                    }
                }
            }
        }
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" -> {
                val sessionId = node["session_id"]?.asText()
                logger?.info("Connected to Artisan backend (session=$sessionId)")
                // Fresh connection: re-arm auto-push, so anything lost in flight on
                // the previous session is pushed again rather than forgotten.
                lastPushedHash.clear()

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

                lastProjectHashes = projectHashes
                checkLocalChangesAgainst(projectHashes)
            }

            "bundle_available" -> {
                val projectId = node["project_id"]?.asText() ?: return
                val url    = node["url"]?.asText()     ?: return
                // Same gate as hello_ack (ADR files-first #6): never overwrite
                // local-only disk changes. `force: true` (divergence resolution,
                // manual pushLocal) bypasses — the merged tree IS the intent.
                if (node["force"]?.asBoolean() != true) {
                    val bundleHash = node["hash"]?.asText() ?: ""
                    val projectDir = roots.dirFor(projectId)
                    if (projectDir.exists()) {
                        val diskHash = BundleHasher.hash(projectDir)
                        val meta = SyncMetadata.read(projectDir)
                        when (detectSyncAction(diskHash, meta.syncedHash, bundleHash)) {
                            SyncAction.IN_SYNC -> { /* echo of our own state — still download to refresh SyncMetadata */ }
                            SyncAction.AUTO_SYNC -> {}
                            SyncAction.LOCAL_ONLY -> {
                                logger?.warning(
                                    "[Artisan] bundle_available for '$projectId' ignored — disk has local-only changes; auto-pushing instead."
                                )
                                httpClient.dispatcher.executorService.execute {
                                    autoPush(projectId, projectDir, diskHash)
                                }
                                return
                            }
                            SyncAction.CONFLICT -> {
                                logger?.warning(
                                    "[Artisan] bundle_available for '$projectId' ignored — disk and backend both changed; divergence reported."
                                )
                                httpClient.dispatcher.executorService.execute {
                                    send(LocalPushSender.buildDivergenceMessage(projectId, projectDir, meta.syncedHash))
                                }
                                return
                            }
                        }
                    }
                }
                if (downloadsInFlight.putIfAbsent(projectId, true) != null) return
                try {
                    httpClient.dispatcher.executorService.execute {
                        // No self-write suppression needed: the downloader records the
                        // hash it just wrote, so the next scan resolves to IN_SYNC and
                        // nothing is pushed back. Content, not timing.
                        try {
                            val downloader = BundleDownloader(httpClient, roots, logger)
                            downloader.download(url = url, serverKey = serverKey, projectId = projectId)
                            reloadFromDisk()
                            draftMenus.clear()
                            logger?.info("[ART-DEBUG] bundle_available: triggering onReload for project=$projectId")
                            onReload?.invoke()
                        } finally {
                            lastPushedHash.remove(projectId)
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

            // Who is connected right now — the editor needs it to offer a player
            // picker instead of asking an admin to type a name blind (the capture
            // panel and the canvas "preview as" both did).
            "online_players_fetch" -> {
                val requestId = node["request_id"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "online_players_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("online_players_result dropped — plugin is stopping")
                    }
                }
                try {
                    runOnMainThread {
                        try {
                            val names = org.bukkit.Bukkit.getOnlinePlayers()
                                .map { it.name }
                                .sortedBy { it.lowercase() }
                            reply(mapOf("ok" to true, "players" to names))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] online players listing failed", e)
                            reply(mapOf("ok" to false, "error" to "fetch_error", "message" to describeError(e)))
                        }
                    }
                } catch (e: Throwable) {
                    logger?.log(java.util.logging.Level.WARNING, "[Artisan] online players scheduling failed", e)
                    reply(mapOf("ok" to false, "error" to "fetch_error", "message" to describeError(e)))
                }
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
                            logger?.fine(
                                "[Artisan] data source preview '$ref' params=$params -> ${shaped.size} rows",
                            )
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

            // Config screens live channel (ADR module-config-screens): the editor
            // reads/writes a table's files through the backend relay. A write is a
            // plain disk edit from sync's point of view — pushed here through the
            // exact onScanChanged logic, and de-duplicated against the scan that
            // will observe the same tree a tick later.
            "project_read" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "project_read_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("project_read_result dropped — plugin is stopping")
                    }
                }
                if (!isSafeProjectId(projectId)) {
                    reply(mapOf("ok" to false, "error" to "invalid_path"))
                    return
                }
                try {
                    httpClient.dispatcher.executorService.execute {
                        try {
                            val projectDir = roots.dirFor(projectId)
                            if (!projectDir.isDirectory) {
                                reply(mapOf("ok" to false, "error" to "unknown_project"))
                                return@execute
                            }
                            val files = net.artisanmc.plugin.sync.ProjectFilesReader.readAll(projectDir)
                                .filterKeys { !isEditorInvisible(it) }
                                .toSortedMap()
                                .map { (rel, content) -> mapOf("path" to rel, "content" to content) }
                            val totalBytes = files.sumOf { it["content"]!!.toByteArray().size }
                            if (totalBytes > MAX_PROJECT_BYTES) {
                                reply(mapOf("ok" to false, "error" to "too_large"))
                            } else {
                                reply(mapOf("ok" to true, "files" to files))
                            }
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] project_read '$projectId' failed", e)
                            reply(mapOf("ok" to false, "error" to "read_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("project_read dropped — plugin is stopping")
                }
            }

            "project_write" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "project_write_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("project_write_result dropped — plugin is stopping")
                    }
                }
                // base_hash absent OU null = « je m'attends à ce que le fichier
                // n'existe pas » : un fichier neuf et un fichier disparu se
                // décrivent de la même façon, et la comparaison les distingue.
                fun baseHashOf(n: com.fasterxml.jackson.databind.JsonNode) =
                    n["base_hash"]?.takeIf { !it.isNull }?.asText()
                val writes = node["files"]?.takeIf { it.isArray }?.mapNotNull { f ->
                    val path = f["path"]?.asText() ?: return@mapNotNull null
                    val content = f["content"]?.asText() ?: return@mapNotNull null
                    Triple(path, content, baseHashOf(f))
                } ?: emptyList()
                val deletes = node["deletes"]?.takeIf { it.isArray }?.mapNotNull { d ->
                    val path = d["path"]?.asText() ?: return@mapNotNull null
                    path to baseHashOf(d)
                } ?: emptyList()
                val create = node["create"]?.asBoolean() ?: false
                if (!isSafeProjectId(projectId) ||
                    writes.any { !isEditorWritablePath(it.first) } ||
                    deletes.any { !isEditorWritablePath(it.first) }
                ) {
                    reply(mapOf("ok" to false, "error" to "invalid_path"))
                    return
                }
                try {
                    httpClient.dispatcher.executorService.execute {
                        val projectDir = roots.dirFor(projectId)
                        if (!projectDir.isDirectory) {
                            // Un Project neuf (création, import) n'a pas encore de
                            // dossier. On le crée uniquement si l'appelant l'a
                            // demandé : sans ce drapeau, un id mal tapé doit rester
                            // une erreur, pas semer un dossier fantôme.
                            if (!create) {
                                reply(mapOf("ok" to false, "error" to "unknown_project"))
                                return@execute
                            }
                            if (!projectDir.mkdirs()) {
                                reply(mapOf("ok" to false, "error" to "write_error", "message" to "mkdir failed"))
                                return@execute
                            }
                        }
                        try {
                            // Passe 1 — vérifier, sans rien toucher. Un seul fichier
                            // qui a bougé annule l'écriture entière : un enregistrement
                            // à moitié appliqué laisserait un Project incohérent en
                            // ligne, et l'éditeur ne saurait plus de quel état repartir.
                            val conflicts = (writes.map { it.first to it.third } + deletes)
                                .mapNotNull { (path, expected) ->
                                    val target = java.io.File(projectDir, path)
                                    val current = target.takeIf { it.isFile }?.readText(Charsets.UTF_8)
                                    val actual = current?.let { BundleHasher.hashContent(it) }
                                    if (actual == expected) null
                                    else mapOf("path" to path, "disk" to current)
                                }
                            if (conflicts.isNotEmpty()) {
                                // On rend le contenu disque avec le conflit : l'éditeur
                                // affiche le diff sans second aller-retour.
                                reply(mapOf("ok" to false, "error" to "conflict", "conflicts" to conflicts))
                                return@execute
                            }

                            // Passe 2 — appliquer.
                            writes.forEach { (path, content, _) ->
                                val target = java.io.File(projectDir, path)
                                if (target.isFile && target.readText() == content) return@forEach
                                archiveToHistory(projectDir, path)
                                target.parentFile?.mkdirs()
                                val tmp = java.io.File(target.parentFile, target.name + ".artisan-tmp")
                                tmp.writeText(content)
                                java.nio.file.Files.move(
                                    tmp.toPath(), target.toPath(),
                                    java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                                )
                            }
                            deletes.forEach { (path, _) ->
                                val target = java.io.File(projectDir, path)
                                if (target.isFile) {
                                    archiveToHistory(projectDir, path)
                                    target.delete()
                                }
                            }
                            reloadFromDisk()
                            draftMenus.clear()
                            onReload?.invoke()
                            reply(mapOf("ok" to true))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] project_write '$projectId' failed", e)
                            reply(mapOf("ok" to false, "error" to "write_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("project_write dropped — plugin is stopping")
                }
            }

            "config_read" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                val table = node["table"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "config_read_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("config_read_result dropped — plugin is stopping")
                    }
                }
                if (!isSafeProjectId(projectId) || !isSafeRelPath(table)) {
                    reply(mapOf("ok" to false, "error" to "invalid_path"))
                    return
                }
                try {
                    httpClient.dispatcher.executorService.execute {
                        try {
                            val projectDir = roots.dirFor(projectId)
                            if (!projectDir.isDirectory) {
                                reply(mapOf("ok" to false, "error" to "unknown_project"))
                                return@execute
                            }
                            val target = java.io.File(projectDir, table)
                            val files = mutableListOf<Map<String, String>>()
                            if (target.isDirectory) {
                                target.listFiles()?.sortedBy { it.name }?.forEach { f ->
                                    if (f.isFile && !f.name.startsWith(".") &&
                                        (f.name.endsWith(".yaml") || f.name.endsWith(".yml"))
                                    ) {
                                        files.add(mapOf("path" to "$table/${f.name}", "content" to f.readText()))
                                    }
                                }
                            } else {
                                for (rel in listOf("$table.yaml", "$table.yml")) {
                                    val f = java.io.File(projectDir, rel)
                                    if (f.isFile) {
                                        files.add(mapOf("path" to rel, "content" to f.readText()))
                                        break
                                    }
                                }
                            }
                            val totalBytes = files.sumOf { it["content"]!!.toByteArray().size }
                            if (totalBytes > MAX_CONFIG_BYTES) {
                                reply(mapOf("ok" to false, "error" to "too_large"))
                            } else {
                                reply(mapOf("ok" to true, "files" to files))
                            }
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] config_read '$projectId/$table' failed", e)
                            reply(mapOf("ok" to false, "error" to "read_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("config_read dropped — plugin is stopping")
                }
            }

            "config_write" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "config_write_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("config_write_result dropped — plugin is stopping")
                    }
                }
                val writes = node["files"]?.takeIf { it.isArray }?.mapNotNull { f ->
                    val path = f["path"]?.asText() ?: return@mapNotNull null
                    val content = f["content"]?.asText() ?: return@mapNotNull null
                    path to content
                } ?: emptyList()
                val deletes = node["deletes"]?.takeIf { it.isArray }?.mapNotNull { it.asText() } ?: emptyList()
                if (!isSafeProjectId(projectId) ||
                    writes.any { !isSafeRelPath(it.first) } || deletes.any { !isSafeRelPath(it) }
                ) {
                    reply(mapOf("ok" to false, "error" to "invalid_path"))
                    return
                }
                try {
                    httpClient.dispatcher.executorService.execute {
                        val projectDir = roots.dirFor(projectId)
                        if (!projectDir.isDirectory) {
                            reply(mapOf("ok" to false, "error" to "unknown_project"))
                            return@execute
                        }
                        try {
                            writes.forEach { (path, content) ->
                                val target = java.io.File(projectDir, path)
                                if (target.isFile && target.readText() == content) return@forEach
                                target.parentFile?.mkdirs()
                                val tmp = java.io.File(target.parentFile, target.name + ".artisan-tmp")
                                tmp.writeText(content)
                                java.nio.file.Files.move(
                                    tmp.toPath(), target.toPath(),
                                    java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                                )
                            }
                            deletes.forEach { path ->
                                val target = java.io.File(projectDir, path)
                                if (target.isFile) target.delete()
                            }
                            reloadFromDisk()
                            draftMenus.clear()
                            onReload?.invoke()
                            if (serverKey.isNotEmpty()) {
                                val diskHash = BundleHasher.hash(projectDir)
                                val meta = SyncMetadata.read(projectDir)
                                when (detectSyncAction(diskHash, meta.syncedHash, meta.backendHash)) {
                                    SyncAction.IN_SYNC, SyncAction.AUTO_SYNC -> {}
                                    SyncAction.LOCAL_ONLY -> autoPush(projectId, projectDir, diskHash)
                                    SyncAction.CONFLICT ->
                                        send(LocalPushSender.buildDivergenceMessage(projectId, projectDir, meta.syncedHash))
                                }
                            }
                            reply(mapOf("ok" to true))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] config_write '$projectId' failed", e)
                            reply(mapOf("ok" to false, "error" to "write_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("config_write dropped — plugin is stopping")
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
        // The move-to-trash needs no suppression: the project root disappears, so
        // the scanner simply drops its state instead of seeing an edit.
        net.artisanmc.plugin.sync.ProjectDeleter(roots, logger).delete(projectId)
        lastPushedHash.remove(projectId)
        onReload?.invoke()
    }

    /**
     * Resolve the plugin-side download URL for a resource project.
     *
     * The backend sends the player-facing URL in `resource_pack.url` (built from
     * `RESOURCE_PACK_BASE_URL`), which is what the player's MC client needs. In a
     * Docker setup, that URL is typically `http://localhost:3001/...` — which from
     * inside the `minecraft` container resolves to the minecraft container itself,
     * not the backend.
     *
     * To let the plugin download the same project (for [net.artisanmc.plugin.resourcepack.AssetCatalog]),
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
