package net.artisanmc.plugin.provider

import net.artisanmc.plugin.scheduling.Scheduler
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.customitems.CustomItemsManager
import net.artisanmc.plugin.assistant.ImportReadResult
import net.artisanmc.plugin.assistant.ImportSelection
import net.artisanmc.plugin.assistant.ImportSourceAccess
import net.artisanmc.plugin.assistant.ImportSourceListing
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
import net.artisanmc.plugin.project.ProjectSnapshot
import net.artisanmc.plugin.protocol.EditorPaths
import net.artisanmc.plugin.protocol.EditorRequest
import net.artisanmc.plugin.protocol.LocalServerLink
import net.artisanmc.plugin.protocol.ProjectReads
import net.artisanmc.plugin.protocol.ProjectWorkspace
import net.artisanmc.plugin.protocol.ProjectWrites
import net.artisanmc.plugin.protocol.Replies
import net.artisanmc.plugin.sync.ProjectFilesReader
import net.artisanmc.plugin.ws.WsClient
import net.artisanmc.plugin.yaml.ProjectReader
import okhttp3.OkHttpClient
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

class SyncedMenuProvider(
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
    private val serverKey: String,
    private val wsUrl: String,
    private val logger: Logger?,
    private val evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
    private val sessions: MenuSessionStore? = null,
    private val history: net.artisanmc.plugin.engine.NavigationHistoryStore? = null,
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
    private val importSources: ImportSourceAccess = object : ImportSourceAccess {
        override fun listAll() = emptyList<ImportSourceListing>()
        override fun read(selections: List<ImportSelection>) = ImportReadResult.Success(emptyList())
    },
    /** Les fetchers touchent l'API Bukkit : ils passent par le thread qui possède l'état lu. */
    private val scheduler: Scheduler = Scheduler.Direct,
    private val editorAccessMode: String = "invitation",
    private val menuWindows: net.artisanmc.plugin.render.MenuWindows? = null,
    private val pluginVersion: String = "1.0.0",
    private val pluginUpdater: (() -> net.artisanmc.plugin.update.PluginUpdater.Result)? = null,
    private val nexoGlyphs: net.artisanmc.plugin.customitems.NexoGlyphReader? = null,
    private val serverConfig: net.artisanmc.plugin.config.ServerConfigAccess? = null,
    /** Annonces sans requête (`projects_reloaded`…) : l'éditeur servi par le plugin les relaie. */
    private val editorEvents: (Map<String, Any?>) -> Unit = {},
) : MenuProvider {
    private var copyMinecraftVersion = "1.21.4"
    /** Ce que `project_read` sert : l'état lu au dernier chargement, jamais le disque courant. */
    @Volatile private var projects = ProjectSnapshot.EMPTY
    @Volatile private var cachedProjectPresence: Map<String, Any> = emptyMap()

    /**
     * Menus et dialogs de tous les projects, résolus par référence (`main`,
     * `boutique:main`) — cf. [net.artisanmc.plugin.engine.DocumentTable]. Les
     * bundles sont chargés dans l'ordre des projects : en cas d'ambiguïté, le
     * dernier gagne, comme la table unique d'avant les namespaces.
     */
    @Volatile private var menuTable = net.artisanmc.plugin.engine.DocumentTable<BundleMenu>(emptyList()) { it.id }
    @Volatile private var dialogTable = net.artisanmc.plugin.engine.DocumentTable<BundleDialog>(emptyList()) { it.id }
    /** Une seule alerte par référence ambiguë et par project appelant : pas un log par clic. */
    private val warnedAmbiguous = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    @Volatile private var bundles = listOf<ProjectBundle>()
    /** `pack:` refs resolve against the live bundle list (survives hot-reload swaps). */
    private val projectDataResolver = net.artisanmc.plugin.engine.ProjectDataResolver { bundles }
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()

    private fun indexDocuments(loaded: List<ProjectBundle>) {
        menuTable = net.artisanmc.plugin.engine.DocumentTable(
            loaded.flatMap { b -> b.menus.map { b.projectId to it } },
        ) { it.id }
        dialogTable = net.artisanmc.plugin.engine.DocumentTable(
            loaded.flatMap { b -> b.dialogs.map { b.projectId to it } },
        ) { it.id }
        warnedAmbiguous.clear()
    }

    private fun <T> resolveRef(
        table: net.artisanmc.plugin.engine.DocumentTable<T>,
        kind: String,
        ref: String,
        fromProject: String?,
    ): T? {
        val r = table.resolve(ref, fromProject)
        if (r is net.artisanmc.plugin.engine.DocumentTable.Ambiguous && warnedAmbiguous.add("$kind|$ref|$fromProject")) {
            logger?.warning(
                "[Artisan] $kind '$ref' is defined by several projects (${r.projects.joinToString()}); " +
                    "opening the last loaded one. Qualify it as <project>:$ref to choose.",
            )
        }
        return r.value
    }
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private val httpClient = OkHttpClient()
    @Volatile private var wsClient: WsClient? = null

    private val workspace = object : ProjectWorkspace {
        override val roots get() = this@SyncedMenuProvider.roots
        override val snapshot get() = projects
        override val io = Executor { task ->
            httpClient.dispatcher.executorService.execute { synchronized(roots) { task.run() } }
        }
        override fun reload(clearDrafts: Boolean) {
            reloadFromDisk()
            if (clearDrafts) draftMenus.clear()
            onReload?.invoke()
        }
        override fun delete(projectId: String) = deleteProject(projectId)
    }
    private val replies = Replies(httpClient.dispatcher.executorService, ::send, logger)
    private val projectReads = ProjectReads(workspace, replies)
    private val projectWrites = ProjectWrites(
        workspace, replies, ::send, logger,
        minecraftVersion = { copyMinecraftVersion },
        installedModuleIds = { installedModules().mapNotNull { it["id"] }.toSet() },
    )
    private val queries = ServerQueries(replies, scheduler, logger, evaluator, dataSources, importSources, nexoGlyphs, serverConfig)
    @Volatile private var testSendOverride: ((String) -> Unit)? = null

    internal fun setSendForTesting(fn: (String) -> Unit) {
        testSendOverride = fn
    }

    /** L'éditeur servi par le plugin : mêmes gestionnaires que le WebSocket, sans réseau. */
    val link = LocalServerLink(::dispatch, java.time.Duration.ofSeconds(30))

    private fun send(payload: Map<String, Any?>) {
        if (link.deliver(payload)) return
        if (payload["request_id"] == null) editorEvents(payload)
        val raw = jsonMapper.writeValueAsString(payload)
        testSendOverride?.invoke(raw) ?: wsClient?.send(payload)
    }

    val minecraftVersion: String get() = copyMinecraftVersion

    /** Module-message escape hatch (api.messages) — fire-and-forget over the WS. */
    fun sendModuleMessage(payload: Map<String, Any>) = send(payload)

    @Volatile private var apiUrl: String? = null
    @Volatile private var editorUrl: String? = null
    @Volatile private var networkName: String? = null
    @Volatile private var customItemsManager: CustomItemsManager = CustomItemsManager(emptyList())

    fun customItems(): List<Map<String, String>> = customItemsManager.items()
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
        val mcVersion = try {
            org.bukkit.Bukkit.getServer().minecraftVersion
        } catch (e: Exception) {
            "1.21.4"
        }
        copyMinecraftVersion = mcVersion
        if (serverKey.isNotEmpty()) {
            val availableSources = customItemsManager.availableSources()
            logger?.info("[ART] Custom item sources available: ${availableSources.ifEmpty { listOf("(none)") }}")
            // Custom items hash is computed off-thread (see registerCustomItemsReloadListeners).
            // hello sends an empty hash; the backend learns the real hash via a follow-up
            // custom_items_changed message once the async task runs. Keeping hashing off
            // the main thread leaves onEnable responsive even for sources we don't control.
            val client = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                editorAccessMode  = editorAccessMode,
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
                projectPresence   = ::projectPresence,
                pluginVersion     = pluginVersion,
                pluginUpdater     = pluginUpdater,
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

    fun addMember(email: String): java.util.concurrent.CompletableFuture<String> =
        wsClient?.addMember(email) ?: java.util.concurrent.CompletableFuture.completedFuture("offline")

    override fun findMenu(menuId: String): BundleMenu? = findMenu(menuId, null)
    override fun findMenu(ref: String, fromProject: String?): BundleMenu? =
        draftMenus[ref] ?: resolveRef(menuTable, "Menu", ref, fromProject)
    override fun listMenuIds(): List<String> = (menuTable.ids + draftMenus.keys).distinct().sorted()
    override fun allBundles(): List<ProjectBundle> = bundles

    override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
        val menu = findMenu(menuId, ctx.projectId) ?: run {
            player.sendMessage(langManager?.get("cmd.menu_not_found", player, "id" to menuId)
                ?: net.kyori.adventure.text.Component.text("Menu '$menuId' not found."))
            return
        }
        // Les clics de ce menu se résolvent dans SON project, pas dans celui d'où l'on vient.
        val opened = ctx.copy(projectId = menu.projectId.ifEmpty { null } ?: ctx.projectId)
        history?.setCurrent(
            player,
            net.artisanmc.plugin.engine.NavigationEntry(
                kind = net.artisanmc.plugin.engine.NavigationEntry.Kind.MENU,
                id = menu.id,
                args = ctx.navigationArgs,
                pagination = ctx.pagination,
                lang = lang,
                projectId = opened.projectId,
            ),
        )
        val session = MenuRenderer.open(
            player, menu, lang, decorateNavigation(player, opened), evaluator, lookupAsset, offsetEncoderProvider(),
            dataSources, projectDataResolver, menuWindows,
        )
        sessions?.set(player, session)
        logger?.info("[ART-DEBUG] openMenu: ${player.name} → $menuId, clickSlots=${session.activeClicks.size}, sessions=${if (sessions != null) "set" else "null"}")
    }

    override fun findDialog(dialogId: String): BundleDialog? = findDialog(dialogId, null)
    override fun findDialog(ref: String, fromProject: String?): BundleDialog? =
        resolveRef(dialogTable, "Dialog", ref, fromProject)

    override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
        val dialog = findDialog(dialogId, ctx.projectId) ?: run {
            player.sendMessage(langManager?.get("cmd.dialog_not_found", player, "id" to dialogId)
                ?: net.kyori.adventure.text.Component.text("Dialog '$dialogId' not found."))
            return
        }
        val executor = executorProvider?.invoke() ?: run {
            logger?.warning("openDialog called but executorProvider is null")
            return
        }
        val opened = ctx.copy(projectId = dialog.projectId.ifEmpty { null } ?: ctx.projectId)
        history?.setCurrent(
            player,
            net.artisanmc.plugin.engine.NavigationEntry(
                kind = net.artisanmc.plugin.engine.NavigationEntry.Kind.DIALOG,
                id = dialog.id,
                args = ctx.args,
                lang = lang,
                projectId = opened.projectId,
            ),
        )
        DialogRenderer.open(player, dialog, lang, decorateNavigation(player, opened), executor)
    }

    /**
     * Injects the navigation-history placeholders into the render scope:
     * `has_previous_menu` (always present) and `previous_menu` (an object with
     * `id` / `title`, only when a previous screen exists). Both are registered
     * as `sourceArgs` so they stay local to THIS screen and are never inherited
     * by a further `open_menu` (a grandchild has its own previous).
     */
    private fun decorateNavigation(player: Player, ctx: ExecutionContext): ExecutionContext {
        val store = history ?: return ctx
        val previous = store.previous(player)
        val extra = buildMap<String, Any> {
            put("has_previous_menu", previous != null)
            if (previous != null) {
                put(
                    "previous_menu",
                    net.artisanmc.plugin.engine.ScreenValue(
                        mapOf("id" to previous.id, "title" to screenTitle(previous)),
                        previous.id,
                    ),
                )
            }
        }
        return ctx.copy(args = ctx.args + extra, sourceArgs = ctx.sourceArgs + extra)
    }

    /** Best-effort display title of a history entry (first text layer / dialog title). */
    private fun screenTitle(entry: net.artisanmc.plugin.engine.NavigationEntry): String =
        when (entry.kind) {
            net.artisanmc.plugin.engine.NavigationEntry.Kind.MENU ->
                findMenu(entry.ref)?.let { firstTitleText(it, entry.lang) } ?: entry.id
            net.artisanmc.plugin.engine.NavigationEntry.Kind.DIALOG ->
                findDialog(entry.ref)?.let { it.yaml.title?.forLang(entry.lang, it.defaultLang) } ?: entry.id
        }

    private fun firstTitleText(menu: BundleMenu, lang: String): String? {
        val langMap = menu.langMapWithFallback(lang)
        for (layer in menu.title) {
            val value = when (layer) {
                is net.artisanmc.plugin.model.MenuTitleLayer.Text -> layer.value
                is net.artisanmc.plugin.model.MenuTitleLayer.Plain -> layer.value
                is net.artisanmc.plugin.model.MenuTitleLayer.Textarea -> layer.value
                else -> continue
            }
            val localized = value.localized
            val resolved = when {
                localized != null ->
                    localized[lang] ?: localized[menu.defaultLang] ?: localized.values.firstOrNull() ?: ""
                value.literal -> value.address?.let { langMap[it] } ?: value.key
                else -> langMap[value.key] ?: value.key
            }
            if (resolved.isNotBlank()) return resolved
        }
        return null
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
            "project_roots" to roots.descriptors(),
            "identity_migrations" to identityMigrations(),
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

    private fun reloadFromDisk() = synchronized(roots) {
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
        // L'instantané se prend sur tous les fichiers, pas seulement ceux qui ont
        // compilé : ce qui a échoué doit rester lisible et réparable.
        val dirs = roots.all()
        projects = ProjectSnapshot(
            files = dirs.mapValues { (_, dir) ->
                runCatching { ProjectFilesReader.readAll(dir).filterKeys { !EditorPaths.isInvisible(it) } }.getOrDefault(emptyMap())
            },
            binaries = dirs.mapValues { (_, dir) ->
                runCatching { ProjectFilesReader.binaries(dir).filterKeys { !EditorPaths.isInvisible(it) } }.getOrDefault(emptyMap())
            },
            skipped = failures,
        )
        bundles = loaded
        indexDocuments(loaded)
        refreshProjectPresence()
        announceReload()
    }

    /**
     * Annonce le rechargement, avec l'empreinte de chaque Project.
     *
     * Une édition faite à la main ne compte qu'au reload : c'est notre règle, et
     * elle a un corollaire que rien ne remplissait — l'éditeur n'avait AUCUN
     * moyen d'apprendre que ce moment était arrivé. Il gardait sa dernière
     * version connue jusqu'à ce que quelqu'un pense à actualiser.
     *
     * L'empreinte voyage avec l'annonce : celui qui a déjà celle-là sait, sans
     * un aller-retour de plus, qu'il n'a rien à refaire. C'est la même que celle
     * de `project_read`, sans quoi chaque reload provoquerait un rapatriement
     * inutile de l'arbre.
     */
    private fun announceReload() {
        val hashes = projects.hashes()
        // Fire-and-forget : sans WS connecté (démarrage, coupure) l'annonce se
        // perd ; le `hello` suivant porte les mêmes empreintes (`snapshot_hashes`).
        runCatching { send(mapOf("type" to "projects_reloaded", "projects" to hashes,
            "project_roots" to roots.descriptors(), "identity_migrations" to identityMigrations())) }
    }

    private fun identityMigrations(): List<Map<String, String>> =
        if (roots.isRegistered("boutique_addon")) listOf(mapOf("from" to "boutique_shop", "to" to "boutique_addon")) else emptyList()

    private fun projectPresence(): Map<String, Any> =
        serverConfig?.let { cachedProjectPresence + ("server_config" to it.report()) } ?: cachedProjectPresence

    internal fun projectPresenceForTesting(): Map<String, Any> = projectPresence()

    /** Called under the project mutation lock; WS callbacks only read the published map. */
    private fun refreshProjectPresence() {
        cachedProjectPresence = mapOf(
            "capabilities" to listOf("project_rename", "project_drafts_v1", "project_mixed_write_v1", "project_copy_v1", "resource_quota_v1", "resource_quota_v2", "vanilla_gui_v1", "snapshot_mirror_v1"),
            "local_project_ids" to projects.projectIds,
            "snapshot_hashes" to projects.hashes(),
            "project_roots" to roots.descriptors(),
            "project_rename_results" to roots.renamer.completed(),
            "identity_migrations" to identityMigrations(),
        )
    }


    private fun handleMessage(raw: String) {
        dispatch(runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return)
    }

    private fun dispatch(node: JsonNode) {
        when (val request = EditorRequest.parse(node) ?: return) {
            is EditorRequest.HelloAck -> onHelloAck(request)
            is EditorRequest.DraftUpdate -> onDraftUpdate(request)
            is EditorRequest.ResourcePackUpdated -> applyResourcePack(request.url, request.hash, "resource_pack_updated payload")
            EditorRequest.SessionReplaced -> logger?.warning(
                "[Artisan] Un autre serveur s'est connecté avec CETTE clé serveur — " +
                    "celui-ci est déconnecté de l'éditeur. Une clé = un serveur : " +
                    "génère une clé par serveur dans l'éditeur.",
            )
            EditorRequest.CustomItemsRequest -> sendCustomItems()
            EditorRequest.Ping -> wsClient?.send(mapOf("type" to "pong"))

            is EditorRequest.OnlinePlayersFetch -> queries.onlinePlayers(request)
            is EditorRequest.PapiPlaceholdersFetch -> queries.papiPlaceholders(request)
            is EditorRequest.HeadTextureFetch -> queries.headTexture(request)
            is EditorRequest.PlayerInventoryFetch -> queries.playerInventory(request)
            is EditorRequest.DataSourceFetch -> queries.dataSource(request)
            is EditorRequest.ServerConfigWrite -> queries.serverConfigWrite(request)
            is EditorRequest.ImportSourcesList -> queries.importSourcesList(request)
            is EditorRequest.ImportSourcesRead -> queries.importSourcesRead(request)
            is EditorRequest.NexoGlyphsList -> queries.nexoGlyphs(request)
            is EditorRequest.NexoGlyphRead -> queries.nexoGlyph(request)

            is EditorRequest.ProjectList -> projectReads.list(request)
            is EditorRequest.ProjectRead -> projectReads.read(request)
            is EditorRequest.ProjectHistory -> projectReads.history(request)
            is EditorRequest.AssetRead -> projectReads.asset(request)
            is EditorRequest.ConfigRead -> projectReads.config(request)

            is EditorRequest.ProjectWrite -> projectWrites.write(request)
            is EditorRequest.AssetWrite -> projectWrites.assets(request)
            is EditorRequest.ConfigWrite -> projectWrites.config(request)
            is EditorRequest.ProjectCopy -> projectWrites.copy(request)
            is EditorRequest.ProjectRename -> projectWrites.rename(request)
            is EditorRequest.ProjectDraft -> projectWrites.draft(request)
            is EditorRequest.ProjectDeleted -> projectWrites.deleted(request)
        }
    }

    private fun onHelloAck(ack: EditorRequest.HelloAck) {
        logger?.info("Connected to Artisan backend (session=${ack.sessionId})")
        apiUrl = ack.bundleUrl
        editorUrl = ack.editorUrl ?: editorUrl
        networkName = ack.networkName ?: networkName
        // Plus de `project_hashes` ni de contrôle de synchro : le backend ne détient
        // plus de contenu, il n'y a rien à comparer au disque (ADR `server-disk-only-storage`).
        when (val pack = ack.resourcePack) {
            EditorRequest.PackUpdate.Cleared -> rpm()?.onUpdate(null)
            is EditorRequest.PackUpdate.Apply -> applyResourcePack(pack.url, pack.hash, "resource_pack info from hello_ack")
            EditorRequest.PackUpdate.Incomplete -> Unit
        }
    }

    private fun applyResourcePack(url: String, hash: String, what: String) {
        try {
            rpm()?.applyFromBackend(url, resolvePluginDownloadUrl(url), hash)
        } catch (t: Throwable) {
            logger?.warning("Invalid $what: ${t.message}")
        }
    }

    private fun onDraftUpdate(draft: EditorRequest.DraftUpdate) {
        val parsed = runCatching { yamlMapper.readValue(draft.menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
        draftMenus[draft.menuId] = BundleCompiler.compile(parsed, emptyMap(), logger)
        logger?.info("Draft updated for ${draft.menuId}")
    }

    private fun sendCustomItems() = replies.offThread("custom_items_request") {
        val result = customItemsManager.buildBundle()
        if (result != null) {
            val (hash, data) = result
            logger?.info("[ART] Sending custom items bundle — hash=${hash.take(8)}…")
            wsClient?.send(mapOf("type" to "custom_items_bundle", "hash" to hash, "data" to data))
        } else {
            logger?.warning("[ART] custom_items_request received but no custom items available — bundle not sent")
        }
    }

    private fun deleteProject(projectId: String) {
        // Atomic switch: drop the project from the in-memory bundles BEFORE touching disk.
        bundles = bundles.filterNot { it.projectId == projectId }
        indexDocuments(bundles)
        // The move-to-trash needs no suppression: the project root disappears, so
        // the scanner simply drops its state instead of seeing an edit.
        net.artisanmc.plugin.sync.ProjectDeleter(roots, logger).delete(projectId)
        projects = projects.without(projectId)
        refreshProjectPresence()
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
