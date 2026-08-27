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
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.ws.WsClient
import net.artisanmc.plugin.yaml.ProjectReader
import okhttp3.OkHttpClient
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

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

    /**
     * L'**instantané** : les octets bruts de chaque fichier, tels que lus au
     * dernier chargement. projectId → (chemin relatif → contenu).
     *
     * C'est ce que sert `project_read`, et donc ce que l'éditeur affiche : l'état
     * que le serveur exécute réellement, pas le disque courant. Une édition à la
     * main n'apparaît qu'après `/artisan reload` — la sémantique de tous les
     * autres plugins Minecraft.
     *
     * Des **octets bruts**, pas un modèle : le compare-and-swap de l'écriture
     * compare des octets. Un modèle re-sérialisé donnerait les mêmes idées et
     * d'autres octets, donc des `base_hash` faux — conflits sur des fichiers que
     * personne n'a touchés, ou écrasements silencieux. Conséquence gratuite : un
     * fichier illisible y figure aussi, donc reste réparable depuis l'éditeur.
     */
    @Volatile private var snapshot: Map<String, Map<String, String>> = emptyMap()

    /**
     * L'instantané des **binaires** : projectId → (chemin → empreinte + taille).
     *
     * Leur contenu n'y est PAS. Un PNG ne se lit pas en UTF-8 sans se mutiler, et
     * garder tous les octets en mémoire pour les servir une fois de temps en
     * temps coûterait cher pour rien. On garde de quoi les **annoncer** ; les
     * octets se demandent un par un (`asset_read`), lus du disque au moment où on
     * les demande — ADR `assets-on-server-disk`.
     */
    @Volatile private var binarySnapshot: Map<String, Map<String, net.artisanmc.plugin.sync.ProjectFilesReader.BinaryInfo>> = emptyMap()

    /**
     * Les Documents que le dernier chargement n'a **pas** réussi à compiler :
     * projectId → (chemin relatif → raison).
     *
     * Un YAML cassé était sauté en silence des deux côtés — le serveur ne
     * l'exécutait pas, l'éditeur ne l'affichait pas, et rien n'expliquait sa
     * disparition. Il reste dans l'instantané (donc réparable), et cette carte
     * dit pourquoi il ne tourne pas.
     */
    @Volatile private var skipped: Map<String, Map<String, String>> = emptyMap()

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

    @Volatile private var apiUrl: String? = null
    @Volatile private var editorUrl: String? = null
    @Volatile private var networkName: String? = null
    @Volatile private var customItemsManager: CustomItemsManager = CustomItemsManager(emptyList())
    @Volatile private var resourcePackManagerRef: ResourcePackManager? = null

    fun setResourcePackManager(mgr: ResourcePackManager) {
        resourcePackManagerRef = mgr
    }

    private fun rpm(): ResourcePackManager? = resourcePackManager ?: resourcePackManagerRef

    /**
     * Enregistre une racine d'Add-on et reprend l'instantané.
     *
     * Passe aussi par le listener ci-dessous quand l'Add-on appelle
     * `api.projectRoots.register(...)` lui-même — c'est le chemin réel.
     */
    fun registerProjectRoot(projectId: String, dir: File) = roots.register(projectId, dir)

    /**
     * Reprend l'instantané depuis le disque, puis prévient les modules.
     *
     * Exposé aux Add-ons via `api.project.reload()` : celui qui écrit dans sa
     * propre racine (`/boutiqueadmin additem`) est le seul à savoir qu'il a
     * écrit. Sans cet appel, son écriture reste invisible au serveur qui tourne
     * ET à l'éditeur jusqu'à un `/artisan reload` tapé à la main — l'admin
     * capture un item, ne le voit nulle part, et croit la commande cassée.
     *
     * Ce n'est PAS un retour de la surveillance disque : c'est une déclaration
     * explicite, faite par l'auteur de l'écriture, au moment où il l'a faite.
     */
    fun refreshFromDisk() {
        reloadFromDisk()
        onReload?.invoke()
    }

    override fun load() {
        // Un Add-on enregistre sa racine à SON activation, après la nôtre :
        // l'instantané pris ici ne peut pas la contenir. Sans ce réabonnement,
        // son Project répondrait `unknown_project` jusqu'au prochain reload.
        roots.onRegister = { _, _ ->
            reloadFromDisk()
            onReload?.invoke()
        }
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
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
                // Le backend ne détient plus de contenu : il n'a rien à comparer.
                currentBundleHash = "",
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

    // Le SyncScanner a été retiré avec la sémantique de reload : une édition
    // disque ne s'applique qu'à `/artisan reload`, comme pour tout autre plugin
    // Minecraft. Surveiller le disque en continu coûtait la surprise (le serveur
    // changeait sous les pieds de l'admin) sans donner le bénéfice (l'éditeur
    // n'était live pour autant — il ne voyait rien avant un rechargement de page).

    private fun reloadFromDisk() {
        // Declared model docs feed the reader so BARE data files resolve their
        // schema from the JAR declaration (ADR bare-data-files ①).
        val failures = java.util.concurrent.ConcurrentHashMap<String, MutableMap<String, String>>()
        val loaded = ProjectReader(roots, logger, {
            declaredModelsReport().mapNotNull { doc ->
                (doc["id"] as? String)?.let { it to doc }
            }.toMap()
        }, { projectId, rel, reason ->
            failures.getOrPut(projectId) { java.util.concurrent.ConcurrentHashMap() }[rel] = reason
        }).readAll()
        skipped = failures
        // L'instantané se prend AVANT le parsing, sur tous les fichiers : ce qui
        // n'a pas pu être compilé doit rester lisible et réparable.
        snapshot = roots.all().mapValues { (_, dir) ->
            runCatching {
                net.artisanmc.plugin.sync.ProjectFilesReader.readAll(dir)
                    .filterKeys { !isEditorInvisible(it) }
            }.getOrDefault(emptyMap())
        }
        binarySnapshot = roots.all().mapValues { (_, dir) ->
            runCatching {
                net.artisanmc.plugin.sync.ProjectFilesReader.binaries(dir)
                    .filterKeys { !isEditorInvisible(it) }
            }.getOrDefault(emptyMap())
        }
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

                // Plus de `project_hashes` ni de contrôle de synchro : le backend
                // ne détient plus de contenu, il n'y a donc rien à comparer au
                // disque (ADR `server-disk-only-storage`).
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
            // La LISTE des projects se demande, elle ne se mémorise pas côté
            // backend : le disque est la seule vérité, donc un dossier renommé ou
            // supprimé doit se voir immédiatement, sans réconciliation ni élagage
            // (ADR `server-disk-only-storage`). Le nom du dossier EST l'identité.
            "project_list" -> {
                val requestId = node["request_id"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "project_list_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("project_list_result dropped — plugin is stopping")
                    }
                }
                try {
                    httpClient.dispatcher.executorService.execute {
                        try {
                            // Même sémantique que `project_read` : ce que le serveur a
                            // chargé. Sinon on listerait un project qu'on ne peut pas
                            // ouvrir, ou l'inverse — l'incohérence exacte qu'on retire.
                            reply(mapOf("ok" to true, "project_ids" to snapshot.keys.sorted()))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] project_list failed", e)
                            reply(mapOf("ok" to false, "error" to "read_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("project_list dropped — plugin is stopping")
                }
            }

            "project_read" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                // L'empreinte que l'éditeur dit déjà posséder. Égale à la nôtre =
                // il a déjà tout, on ne transporte rien.
                val ifHash = node["if_hash"]?.asText()
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
                            // L'instantané, pas le disque : l'éditeur montre ce que
                            // le serveur a lu. Un project apparu depuis le dernier
                            // chargement n'existe pas encore de son point de vue.
                            val tree = snapshot[projectId] ?: run {
                                reply(mapOf("ok" to false, "error" to "unknown_project"))
                                return@execute
                            }
                            val files = tree.toSortedMap()
                                .map { (rel, content) -> mapOf("path" to rel, "content" to content) }
                            val failed = (skipped[projectId] ?: emptyMap()).toSortedMap()
                                .map { (rel, reason) -> mapOf("path" to rel, "reason" to reason) }
                            // Les binaires sont ANNONCÉS, pas portés : l'éditeur
                            // sait quoi proposer sans télécharger des images dont
                            // il n'a besoin qu'à l'affichage (ADR
                            // `assets-on-server-disk`, décision 4).
                            val binaries = (binarySnapshot[projectId] ?: emptyMap()).toSortedMap()
                                .map { (rel, info) ->
                                    mapOf("path" to rel, "hash" to info.hash, "size" to info.size)
                                }
                            val hash = net.artisanmc.plugin.sync.BundleHasher.snapshotHash(
                                tree,
                                (binarySnapshot[projectId] ?: emptyMap()).mapValues { it.value.hash },
                                skipped[projectId] ?: emptyMap(),
                            )
                            if (ifHash != null && ifHash == hash) {
                                // L'éditeur a déjà exactement ça. Le lui renvoyer
                                // coûterait l'arbre entier pour l'informer qu'il
                                // n'a rien appris.
                                reply(mapOf("ok" to true, "unchanged" to true, "hash" to hash))
                                return@execute
                            }
                            val totalBytes = files.sumOf { it["content"]!!.toByteArray().size }
                            if (totalBytes > MAX_PROJECT_BYTES) {
                                reply(mapOf("ok" to false, "error" to "too_large"))
                            } else {
                                reply(mapOf(
                                    "ok" to true,
                                    "hash" to hash,
                                    "files" to files,
                                    "failed" to failed,
                                    "binaries" to binaries,
                                ))
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

            // Une autre instance a réclamé notre clé serveur. Un seul WARN, pas de
            // prompt ni de retry : personne ne regarde la console au moment où ça
            // tombe, mais tout le monde la lit après coup pour comprendre pourquoi
            // l'éditeur ne voyait plus ce serveur.
            "session_replaced" -> {
                logger?.warning(
                    "[Artisan] Un autre serveur s'est connecté avec CETTE clé serveur — " +
                    "celui-ci est déconnecté de l'éditeur. Une clé = un serveur : " +
                    "génère une clé par serveur dans l'éditeur."
                )
            }

            // Les octets d'UN asset, lus sur le disque au moment de la demande
            // (ADR `assets-on-server-disk`). L'instantané n'en garde que
            // l'empreinte : servir des images depuis la mémoire coûterait cher
            // pour un usage rare, et le hash rendu ici décrit ce qui est rendu.
            "asset_read" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                val path = node["path"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "asset_read_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("asset_read_result dropped — plugin is stopping")
                    }
                }
                if (!isSafeProjectId(projectId) || !isEditorWritablePath(path) ||
                    !net.artisanmc.plugin.sync.ProjectFilesReader.isBinary(path)
                ) {
                    reply(mapOf("ok" to false, "error" to "invalid_path"))
                    return
                }
                try {
                    httpClient.dispatcher.executorService.execute {
                        try {
                            if (!binarySnapshot.containsKey(projectId)) {
                                reply(mapOf("ok" to false, "error" to "unknown_project"))
                                return@execute
                            }
                            val file = java.io.File(roots.dirFor(projectId), path)
                            if (!file.isFile) {
                                reply(mapOf("ok" to false, "error" to "not_found"))
                                return@execute
                            }
                            val bytes = file.readBytes()
                            reply(mapOf(
                                "ok" to true,
                                "content_base64" to java.util.Base64.getEncoder().encodeToString(bytes),
                                "hash" to BundleHasher.hashBytes(bytes),
                            ))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] asset_read '$projectId/$path' failed", e)
                            reply(mapOf("ok" to false, "error" to "read_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("asset_read dropped — plugin is stopping")
                }
            }

            // Écriture d'UN asset, même compare-and-swap que `project_write` :
            // `base_hash` null = « je m'attends à ce que le fichier n'existe pas ».
            // Sans lui, deux admins qui téléversent le même nom s'écrasent en
            // silence.
            // Écriture d'assets binaires, même compare-and-swap que
            // `project_write` : `base_hash` null = « je m'attends à ce que le
            // fichier n'existe pas ». Sans lui, deux admins qui téléversent le
            // même nom s'écrasent en silence.
            //
            // GROUPÉE et tout-ou-rien : une police dépliée, c'est ~96 fichiers
            // (mesuré sur l'ASCII vanilla), et une police à moitié posée serait
            // pire qu'aucune. La forme à un seul fichier reste lue.
            "asset_write" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "asset_write_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("asset_write_result dropped — plugin is stopping")
                    }
                }
                fun baseHashOf(n: com.fasterxml.jackson.databind.JsonNode) =
                    n["base_hash"]?.takeIf { !it.isNull }?.asText()
                // Triplet (chemin, contenu base64 ou null = suppression, base attendue).
                val writes: List<Triple<String, String?, String?>> =
                    node["files"]?.takeIf { it.isArray }?.mapNotNull { f ->
                        val path = f["path"]?.asText() ?: return@mapNotNull null
                        Triple(path, f["content_base64"]?.takeIf { !it.isNull }?.asText(), baseHashOf(f))
                    } ?: listOfNotNull(
                        node["path"]?.asText()?.let { path ->
                            Triple(path, node["content_base64"]?.takeIf { !it.isNull }?.asText(), baseHashOf(node))
                        },
                    )
                if (writes.isEmpty() || !isSafeProjectId(projectId) || writes.any {
                        !isEditorWritablePath(it.first) ||
                            !net.artisanmc.plugin.sync.ProjectFilesReader.isBinary(it.first)
                    }
                ) {
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

                            // Passe 1 — vérifier, sans rien toucher.
                            val conflicts = writes.mapNotNull { (path, _, expected) ->
                                val target = java.io.File(projectDir, path)
                                val actual = target.takeIf { it.isFile }
                                    ?.let { BundleHasher.hashBytes(it.readBytes()) }
                                if (actual == expected) null else mapOf("path" to path, "disk_hash" to actual)
                            }
                            if (conflicts.isNotEmpty()) {
                                reply(mapOf(
                                    "ok" to false,
                                    "error" to "conflict",
                                    "conflicts" to conflicts,
                                    // Compat : la forme à un fichier attendait ce champ.
                                    "disk_hash" to conflicts.first()["disk_hash"],
                                ))
                                return@execute
                            }

                            // Passe 2 — décoder AVANT d'écrire quoi que ce soit :
                            // un base64 cassé au milieu du lot laisserait la
                            // moitié des glyphes posés.
                            val decoded = try {
                                writes.map { (path, b64, _) ->
                                    path to b64?.let { java.util.Base64.getDecoder().decode(it) }
                                }
                            } catch (_: IllegalArgumentException) {
                                reply(mapOf("ok" to false, "error" to "invalid_content"))
                                return@execute
                            }

                            decoded.forEach { (path, bytes) ->
                                val target = java.io.File(projectDir, path)
                                // `content_base64` absent = suppression. Le fichier
                                // passe par la corbeille, comme un Document : une
                                // image supprimée par erreur doit pouvoir revenir.
                                if (bytes == null) {
                                    if (target.isFile) {
                                        archiveToHistory(projectDir, path)
                                        target.delete()
                                    }
                                } else {
                                    archiveToHistory(projectDir, path)
                                    target.parentFile?.mkdirs()
                                    val tmp = java.io.File(target.parentFile, target.name + ".artisan-tmp")
                                    tmp.writeBytes(bytes)
                                    java.nio.file.Files.move(
                                        tmp.toPath(), target.toPath(),
                                        java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                                    )
                                }
                            }
                            // Écrire, c'est savoir qu'on a écrit : sans reprise,
                            // l'éditeur téléverserait une image qu'il ne verrait
                            // pas ensuite (sémantique de reload).
                            reloadFromDisk()
                            onReload?.invoke()
                            reply(mapOf("ok" to true))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] asset_write '$projectId' failed", e)
                            reply(mapOf("ok" to false, "error" to "write_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("asset_write dropped — plugin is stopping")
                }
            }

            "project_history" -> {
                val requestId = node["request_id"]?.asText() ?: return
                val projectId = node["project_id"]?.asText() ?: return
                val path = node["path"]?.asText() ?: return
                fun reply(payload: Map<String, Any?>) {
                    val base = mapOf("type" to "project_history_result", "request_id" to requestId)
                    try {
                        httpClient.dispatcher.executorService.execute {
                            @Suppress("UNCHECKED_CAST")
                            send((base + payload) as Map<String, Any>)
                        }
                    } catch (_: java.util.concurrent.RejectedExecutionException) {
                        logger?.warning("project_history_result dropped — plugin is stopping")
                    }
                }
                // Même garde que l'écriture : on ne lit l'historique que d'un
                // fichier que l'éditeur aurait le droit d'écrire.
                if (!isSafeProjectId(projectId) || !isEditorWritablePath(path)) {
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
                            val dir = java.io.File(projectDir, ".artisan/history/$path")
                            // Un fichier jamais écrasé n'a pas d'archive : liste vide,
                            // pas une erreur — c'est un état normal, pas un incident.
                            val versions = (dir.listFiles() ?: emptyArray())
                                .filter { it.isFile }
                                .sortedByDescending { it.name }
                                .map {
                                    mapOf(
                                        "at" to (it.name.toLongOrNull() ?: 0L),
                                        "content" to it.readText(Charsets.UTF_8),
                                    )
                                }
                            reply(mapOf("ok" to true, "versions" to versions))
                        } catch (e: Throwable) {
                            logger?.log(java.util.logging.Level.WARNING, "[Artisan] project_history '$projectId/$path' failed", e)
                            reply(mapOf("ok" to false, "error" to "read_error", "message" to describeError(e)))
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    logger?.warning("project_history dropped — plugin is stopping")
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
                // Un renommage porte une INTENTION que l'arbre ne peut pas
                // reconstituer : sans elle, un fichier disparaît et un autre
                // apparaît, la corbeille archive une suppression qui n'en est pas
                // une, et l'historique se retrouve orphelin du nouveau nom.
                val renames = node["renames"]?.takeIf { it.isArray }?.mapNotNull { r ->
                    val from = r["from"]?.asText() ?: return@mapNotNull null
                    val to = r["to"]?.asText() ?: return@mapNotNull null
                    Triple(from, to, baseHashOf(r))
                } ?: emptyList()
                if (!isSafeProjectId(projectId) ||
                    writes.any { !isEditorWritablePath(it.first) } ||
                    deletes.any { !isEditorWritablePath(it.first) } ||
                    renames.any { !isEditorWritablePath(it.first) || !isEditorWritablePath(it.second) }
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
            val renameChecks = renames.flatMap { (from, to, expected) ->
                                val source = java.io.File(projectDir, from)
                                val current = source.takeIf { it.isFile }?.readText(Charsets.UTF_8)
                                val actual = current?.let { BundleHasher.hashContent(it) }
                                val dest = java.io.File(projectDir, to)
                                listOfNotNull(
                                    if (actual == expected) null else mapOf("path" to from, "disk" to current),
                                    // La destination doit être libre : écraser un fichier
                                    // existant par un renommage le ferait disparaître sans
                                    // corbeille ni choix de l'admin.
                                    if (dest.exists()) {
                                        mapOf("path" to to, "disk" to dest.takeIf { it.isFile }?.readText(Charsets.UTF_8))
                                    } else null,
                                )
                            }
                            val conflicts = renameChecks + (writes.map { it.first to it.third } + deletes)
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
                                //
                                // Et l'état RÉEL du dossier avec : un renommage fait à la
                                // main ressemble à une suppression pour le CAS. Sans cette
                                // liste, « garder ma version » recréerait l'ancien fichier
                                // en laissant le nouveau — deux fichiers pour un seul menu,
                                // sans que rien ne le signale.
                                val onDisk = net.artisanmc.plugin.sync.ProjectFilesReader
                                    .readAll(projectDir).keys
                                    .filter { !isEditorInvisible(it) }
                                    .sorted()
                                reply(mapOf(
                                    "ok" to false,
                                    "error" to "conflict",
                                    "conflicts" to conflicts,
                                    "disk_files" to onDisk,
                                ))
                                return@execute
                            }

                            // Passe 2 — appliquer. Les renommages d'abord : une
                            // écriture peut viser le nouveau nom (renommer ET
                            // modifier dans le même enregistrement).
                            renames.forEach { (from, to, _) ->
                                val source = java.io.File(projectDir, from)
                                val dest = java.io.File(projectDir, to)
                                dest.parentFile?.mkdirs()
                                java.nio.file.Files.move(source.toPath(), dest.toPath())
                                // Le passé du Document le suit : sinon renommer
                                // reviendrait à perdre sa corbeille.
                                val histFrom = java.io.File(projectDir, ".artisan/history/$from")
                                if (histFrom.isDirectory) {
                                    val histTo = java.io.File(projectDir, ".artisan/history/$to")
                                    histTo.parentFile?.mkdirs()
                                    if (!histTo.exists()) java.nio.file.Files.move(histFrom.toPath(), histTo.toPath())
                                }
                            }
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
                            // Écrit sur disque et rechargé : c'est tout. Il n'y a
                            // plus de copie backend à tenir au courant.
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
