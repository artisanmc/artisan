package net.artisanmc.plugin.provider

import net.artisanmc.plugin.engine.MenuProvider
import net.artisanmc.plugin.scheduling.Scheduler
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.customitems.CustomItemsManager
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.MenuSessionStore
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.model.RuntimeDocument
import net.artisanmc.plugin.model.DocumentKind
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.render.dialog.DialogRenderer
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.artisanmc.plugin.project.ProjectSnapshot
import net.artisanmc.plugin.protocol.EditorPaths
import net.artisanmc.plugin.protocol.EditorRequest
import net.artisanmc.plugin.protocol.LocalServerLink
import net.artisanmc.plugin.protocol.ProjectReads
import net.artisanmc.plugin.protocol.ProjectWorkspace
import net.artisanmc.plugin.protocol.ProjectWrites
import net.artisanmc.plugin.protocol.Replies
import net.artisanmc.plugin.project.ProjectFilesReader
import net.artisanmc.plugin.ws.HubLink
import net.artisanmc.plugin.ws.WsClient
import net.artisanmc.plugin.yaml.ProjectReader
import okhttp3.OkHttpClient
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import net.artisanmc.plugin.platform.Chat
import net.artisanmc.plugin.platform.ServerPlatform

class SyncedMenuProvider(
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
    private val logger: Logger?,
    private val evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
    private val sessions: MenuSessionStore? = null,
    private val history: net.artisanmc.plugin.session.NavigationHistoryStore? = null,
    private val onReload: ((modules: Set<String>?) -> Unit)? = null,
    private val executorProvider: (() -> ActionExecutor)? = null,
    private val langManager: LangManager? = null,
    private val resourcePackManager: ResourcePackManager? = null,
    private val lookupAsset: (String) -> AssetEntry? = { null },
    private val offsetEncoderProvider: () -> net.artisanmc.plugin.render.OffsetEncoder = { net.artisanmc.plugin.render.OffsetEncoder.EMPTY },
    private val dataSources: net.artisanmc.modules.api.datasource.DataSourceRegistry? = null,
    /** A module's editor view by module id, served to the hub on `editor_bundle_fetch`. */
    private val editorBundles: (String) -> net.artisanmc.modules.api.editor.EditorBundleDeclaration? = { null },
    /** The modules' templates, served on `template_fetch` and copied on `template_copy` or once at seed. */
    private val templates: () -> net.artisanmc.plugin.project.ModuleTemplates? = { null },
    /** The server's language, given to the projects a template seeds. */
    private val seedLang: () -> String = { "en" },
    /** Merges the old command overrides into the commands' files; true when it wrote one (`CommandOverrideMigration`). */
    private val migrateCommandOverrides: () -> Boolean = { false },
    /** What this server announces at Presence: in its `hello` and each `modules_changed`. */
    private val announcement: () -> net.artisanmc.plugin.protocol.ServerAnnouncement = { net.artisanmc.plugin.protocol.ServerAnnouncement.EMPTY },
    /** Told before each `modules_changed`: what [announcement] is built from moved, a kept copy is stale. */
    private val announcementChanged: () -> Unit = {},
    /** Module-declared model/v1 documents: bare data files resolve their schema from them (ADR bare-data-files). */
    private val declaredModels: () -> List<Map<String, Any?>> = { emptyList() },
    /** Fetchers touch the Bukkit API: they run on the thread that owns the state they read. */
    private val scheduler: Scheduler = Scheduler.Direct,
    private val menuWindows: net.artisanmc.plugin.render.packets.MenuWindows? = null,
    private val pluginVersion: String = "1.0.0",
    private val nexoGlyphs: net.artisanmc.plugin.customitems.NexoGlyphReader? = null,
    private val serverConfig: net.artisanmc.plugin.config.ServerConfigAccess? = null,
    /** Unrequested announcements (`projects_reloaded`…): the editor served by the plugin relays them. */
    private val editorEvents: (Map<String, Any?>) -> Unit = {},
    /** On a leaf, the hub to connect to; null on the hub or a standalone server. */
    private val hub: HubLink? = null,
    /** The other servers that serve their own editor (ADR `peer-servers`): this one joins each as a leaf. */
    private val peers: () -> List<HubLink> = { emptyList() },
    /** `api.menus` listeners and the Bukkit menu events. */
    private val menuEvents: net.artisanmc.plugin.listener.MenuEventDispatcher? = null,
    /** Each loaded Snapshot, with the editor players whose publication it loads, by project id. */
    /** Each loaded Snapshot, with its publications' authors by project id; [done] announces the reload once it is recorded. */
    private val onSnapshot: (ProjectSnapshot, Map<String, net.artisanmc.plugin.project.PublicationAuthor>, done: () -> Unit) -> Unit =
        { _, _, done -> done() },
    /**
     * Where a reload asked after [load] reads the disk and parses the YAML ([refreshFromDisk]):
     * never a game thread (issue #42). The caller's thread by default, for the tests.
     */
    private val reloadExecutor: Executor = Executor { it.run() },
) : MenuProvider {
    private val pendingAuthors = java.util.concurrent.ConcurrentHashMap<String, net.artisanmc.plugin.project.PublicationAuthor>()
    private var copyMinecraftVersion = "1.21.4"
    /** What `project_read` serves: the state read at the last load, never the current disk. */
    @Volatile private var projects = ProjectSnapshot.EMPTY

    /**
     * Menus and dialogs of every project, resolved by reference (`main`,
     * `boutique:main`); see [net.artisanmc.plugin.engine.DocumentTable]. Projects
     * load in project order: on ambiguity, the last one wins.
     */
    @Volatile private var tables: Map<String, net.artisanmc.plugin.engine.DocumentTable<RuntimeDocument>> = emptyMap()
    @Suppress("UNCHECKED_CAST")
    private fun <T : RuntimeDocument> table(kind: DocumentKind): net.artisanmc.plugin.engine.DocumentTable<T> =
        (tables[kind.kind] ?: net.artisanmc.plugin.engine.DocumentTable<RuntimeDocument>(emptyList()) { it.id })
            as net.artisanmc.plugin.engine.DocumentTable<T>
    private val menuTable: net.artisanmc.plugin.engine.DocumentTable<RuntimeMenu> get() = table(DocumentKinds.MENU)
    private val dialogTable: net.artisanmc.plugin.engine.DocumentTable<RuntimeDialog> get() = table(DocumentKinds.DIALOG)
    /** One warning per ambiguous reference and calling project, not one log per click. */
    private val warnedAmbiguous = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    @Volatile private var runtimes = listOf<RuntimeProject>()
    /** `pack:` refs resolve against the live Project list (survives hot-reload swaps). */
    private val projectDataResolver = net.artisanmc.plugin.engine.ProjectDataResolver { runtimes }

    /** One table per registered kind (ADR `extensible-document-kinds`): a module's kind resolves by reference like a menu. */
    private fun indexDocuments(loaded: List<RuntimeProject>) {
        tables = DocumentKinds.all().associate { kind ->
            kind.kind to net.artisanmc.plugin.engine.DocumentTable<RuntimeDocument>(
                loaded.flatMap { b -> b.documents[kind.kind].orEmpty().map { b.projectId to it } },
            ) { it.id }
        }
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
    private val httpClient = OkHttpClient()
    @Volatile private var wsClient: WsClient? = null
    /** One link per peer server, keyed by its addresses: a peer that moves gets a new link. */
    private val peerClients = java.util.concurrent.ConcurrentHashMap<String, WsClient>()
    @Volatile private var loaded = false
    /** The link each request came from, so the reply goes back to it; bounded, a request may have several replies. */
    private val origins = java.util.Collections.synchronizedMap(object : LinkedHashMap<String, WsClient>(64, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, WsClient>) = size > MAX_ORIGINS
    })

    private fun clients(): List<WsClient> = listOfNotNull(wsClient) + peerClients.values

    /** An unrequested announcement (`modules_changed`…): every hub this server is linked to. */
    private fun broadcast(payload: Map<String, Any?>) = clients().forEach { it.send(payload) }

    private val workspace = object : ProjectWorkspace {
        override val roots get() = this@SyncedMenuProvider.roots
        override val snapshot get() = projects
        override val io = Executor { task ->
            httpClient.dispatcher.executorService.execute { synchronized(diskLock) { task.run() } }
        }
        override fun reload(projectIds: Set<String>?) {
            reloadFromDisk(projectIds)
            onReload?.invoke(null)
        }
        override fun authoredBy(projectId: String, author: net.artisanmc.plugin.project.PublicationAuthor) {
            pendingAuthors[projectId] = author
        }
    }
    private val replies = Replies(httpClient.dispatcher.executorService, ::send, logger)
    private val projectReads = ProjectReads(workspace, replies)
    private val projectWrites = ProjectWrites(workspace, replies, ::send, logger)
    private val templateRequests = net.artisanmc.plugin.protocol.TemplateRequests(workspace, replies, templates)
    private val queries = ServerQueries(replies, scheduler, logger, evaluator, dataSources, nexoGlyphs, serverConfig, editorBundles)
    @Volatile private var testSendOverride: ((String) -> Unit)? = null

    internal fun setSendForTesting(fn: (String) -> Unit) {
        testSendOverride = fn
    }

    /** The editor served by the plugin: same handlers as the WebSocket, without the network. */
    val link = LocalServerLink(::dispatch, java.time.Duration.ofSeconds(30))

    private fun send(payload: Map<String, Any?>) {
        if (link.deliver(payload)) return
        if (payload["request_id"] == null) editorEvents(payload)
        val raw = jsonMapper.writeValueAsString(payload)
        testSendOverride?.invoke(raw) ?: run {
            val origin = (payload["request_id"] as? String)?.let { origins[it] }
            when {
                origin != null -> origin.send(payload)
                payload["request_id"] == null -> broadcast(payload)
                else -> wsClient?.send(payload)
            }
        }
    }

    val minecraftVersion: String get() = copyMinecraftVersion

    /** Module-message escape hatch (editor_permissions) — fire-and-forget over the WS. */
    fun sendModuleMessage(payload: Map<String, Any>) = send(payload)

    /** The hub serves packs at its public address; a leaf downloads them through the address it joined. */
    private val hubBaseUrl: String? = hub?.let { net.artisanmc.plugin.config.deriveHttpBaseUrl(it.url).ifEmpty { null } }
    @Volatile private var customItemsManager: CustomItemsManager = CustomItemsManager(emptyList())

    fun customItems(): List<Map<String, String>> = customItemsManager.items()
    @Volatile private var resourcePackManagerRef: ResourcePackManager? = null

    fun setResourcePackManager(mgr: ResourcePackManager) {
        resourcePackManagerRef = mgr
    }

    private fun rpm(): ResourcePackManager? = resourcePackManager ?: resourcePackManagerRef

    /**
     * Registers an Add-on root; the snapshot is reloaded through `roots.onRegister`,
     * which is also the path taken when the Add-on calls `api.projectRoots.register(...)`.
     */
    fun registerProjectRoot(projectId: String, dir: File) = roots.register(projectId, dir)

    private val reloadQueued = java.util.concurrent.atomic.AtomicBoolean(false)
    private val readEverything = java.util.concurrent.atomic.AtomicBoolean(false)
    private val readFolders: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    private val notifyAll = java.util.concurrent.atomic.AtomicBoolean(false)
    private val notifyOwners: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    private val registerQueued = java.util.concurrent.atomic.AtomicBoolean(false)
    private val registeredFolders: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()

    /**
     * Reloads the snapshot from disk, then notifies the modules.
     *
     * Exposed to Add-ons as `api.project.reload()`: whoever writes into its own root
     * (`/boutiqueadmin additem`) is the only one who knows it wrote. Without this call
     * the write stays invisible to the running server AND to the editor until someone
     * types `/artisan reload`.
     *
     * This is NOT disk watching: it is an explicit declaration by the writer, at the
     * moment of the write.
     *
     * The disk is read on [reloadExecutor], whatever thread asks: a reload of a few projects
     * takes seconds on a slow bind mount. Only [onReload] (command map, modules' `onReload()`)
     * goes back to the global thread, through the scheduler, once the snapshot is swapped.
     */
    fun refreshFromDisk() = refresh(folders = null, notifyModules = true)

    /**
     * Asks that pile up before the read starts make one reload; an ask made during a read
     * queues one more. It reads [folders] only (the folders just registered), or every
     * project when an ask names none. [onReload] gets the modules to notify: every one when
     * an ask has [notifyModules] (an editor publication, `api.project.reload()`), else only
     * those whose folder was registered meanwhile (`notifyOwners`), which read it from the
     * snapshot. Files Artisan wrote notify none.
     */
    private fun refresh(folders: Set<String>?, notifyModules: Boolean) {
        if (folders == null) readEverything.set(true) else readFolders.addAll(folders)
        if (notifyModules) notifyAll.set(true)
        if (!reloadQueued.compareAndSet(false, true)) return
        reloadExecutor.execute {
            reloadQueued.set(false)
            val everything = readEverything.getAndSet(false)
            val some = readFolders.toSet().also { readFolders.removeAll(it) }
            val everyModule = notifyAll.getAndSet(false)
            val owners = notifyOwners.toSet().also { notifyOwners.removeAll(it) }
            reloadFromDisk(if (everything) null else some)
            onReload?.invoke(if (everyModule) null else owners)
        }
    }

    override fun load() {
        // An Add-on registers its root when IT enables, after us: the snapshot taken
        // here cannot contain it. Without this hook, its Project would answer
        // `unknown_project` until the next reload. Deferred to the next tick so the
        // Add-on's onEnable has returned: its bootstrap writes are read, and its
        // onReload() never runs before its onEnable is done. The tick only orders the
        // reload; the disk work itself leaves the global thread (refreshFromDisk). The
        // modules enabled at startup register before the first tick: one reload for all,
        // which notifies the folders' modules only, not every module each time.
        roots.onRegister = { projectId, _ ->
            registeredFolders += projectId
            roots.ownerOf(projectId)?.let(notifyOwners::add)
            if (registerQueued.compareAndSet(false, true)) scheduler.global {
                registerQueued.set(false)
                val folders = registeredFolders.toSet().also { registeredFolders.removeAll(it) }
                refresh(folders, notifyModules = false)
            }
        }
        // The first load, and `/artisan reload`, read on the calling thread: menus and
        // commands exist when the server opens, and the admin's reply says they do.
        reloadFromDisk()
        // Modules enabled before this load: their templates are seeded now, the others on
        // their registration (notifyModulesChanged).
        seedTemplates()
        val mcVersion = try {
            net.artisanmc.plugin.platform.ServerPlatform.minecraftVersion(org.bukkit.Bukkit.getServer())
        } catch (e: Exception) {
            "1.21.4"
        }
        copyMinecraftVersion = mcVersion
        if (hub != null) {
            val availableSources = customItemsManager.availableSources()
            logger?.info("[ART] Custom item sources available: ${availableSources.ifEmpty { listOf("(none)") }}")
            // The hello goes out without the custom items hash: it follows as `custom_items_changed`,
            // computed off the main thread (registerCustomItemsReloadListeners).
            val client = newClient(hub)
            wsClient = client
            client.connect()
        }
        loaded = true
        syncPeers(peers())
    }

    private fun newClient(link: HubLink): WsClient {
        lateinit var client: WsClient
        client = WsClient(
            hub               = link,
            mcVersion         = copyMinecraftVersion,
            announcement      = announcement,
            serverConfig      = { serverConfig?.report() },
            onMessage         = { receive(it, client, link) },
            logger            = logger,
            pluginVersion     = pluginVersion,
        )
        return client
    }

    /**
     * Joins each of [links] as a leaf and leaves the peers no longer listed (ADR `peer-servers`).
     * Called on each discovery round; nothing before [load] or after [unload].
     */
    fun syncPeers(links: List<HubLink>) {
        if (!loaded) return
        val wanted = links.associateBy { it.urls.joinToString(" ") }
        peerClients.keys.filter { it !in wanted }.forEach { peerClients.remove(it)?.disconnect() }
        wanted.forEach { (key, link) -> peerClients.computeIfAbsent(key) { newClient(link).also(WsClient::connect) } }
    }

    override fun unload() {
        loaded = false
        peerClients.values.forEach(WsClient::disconnect)
        peerClients.clear()
        wsClient?.disconnect()
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        // The executor is intentionally NOT shut down here: it is shared across load/unload
        // cycles (e.g. /artisan reload). The hard tear-down lives in shutdown().
    }

    override fun shutdown() {
        unload()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
    }

    /** On a leaf, the editor link comes from the hub; null if it does not answer. */
    fun requestEditorLink(player: java.util.UUID, name: String, permissions: Set<String>, host: String?) =
        wsClient?.request(mapOf(
            "type" to "editor_link", "player_id" to player.toString(), "player_name" to name,
            "permissions" to permissions.toList(), "host" to host,
        )) ?: java.util.concurrent.CompletableFuture.completedFuture(null)

    /** On a leaf, the hub closes the player's editor sessions; null if it does not answer. */
    fun requestEditorLogout(player: java.util.UUID) =
        wsClient?.request(mapOf("type" to "editor_logout", "player_id" to player.toString()))
            ?: java.util.concurrent.CompletableFuture.completedFuture(null)

    override fun findMenu(menuId: String): RuntimeMenu? = findMenu(menuId, null)
    override fun findMenu(ref: String, fromProject: String?): RuntimeMenu? =
        resolveRef(menuTable, "Menu", ref, fromProject)
    override fun listMenuIds(): List<String> = menuTable.ids.distinct().sorted()
    override fun runtimeProjects(): List<RuntimeProject> = runtimes
    /** The loaded files, what `api.project.list/read` answer from. */
    fun snapshot(): ProjectSnapshot = projects
    /** The loaded Snapshot's project dirs, without the registry lock a reload in progress holds. */
    fun projectDirs(): Map<String, File> = projects.projectIds.associateWith(roots::dirFor)

    override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
        val menu = findMenu(menuId, ctx.projectId) ?: run {
            Chat.send(player, langManager?.get("cmd.menu_not_found", player, "id" to menuId)
                ?: net.kyori.adventure.text.Component.text("Menu '$menuId' not found."))
            return
        }
        // This menu's clicks resolve in ITS project, not in the one we came from.
        val opened = ctx.copy(projectId = menu.projectId.ifEmpty { null } ?: ctx.projectId)
        val ref = net.artisanmc.modules.api.menu.MenuRef(opened.projectId, menu.id)
        if (menuEvents?.open(net.artisanmc.modules.api.menu.MenuOpenEvent(player, ref, ctx.navigationArgs)) == false) return
        history?.setCurrent(
            player,
            net.artisanmc.plugin.session.NavigationEntry(
                kind = net.artisanmc.plugin.session.NavigationEntry.Kind.MENU,
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
    }

    override fun findDialog(dialogId: String): RuntimeDialog? = findDialog(dialogId, null)
    override fun findDialog(ref: String, fromProject: String?): RuntimeDialog? =
        resolveRef(dialogTable, "Dialog", ref, fromProject)

    override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {
        val dialog = findDialog(dialogId, ctx.projectId) ?: run {
            Chat.send(player, langManager?.get("cmd.dialog_not_found", player, "id" to dialogId)
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
            net.artisanmc.plugin.session.NavigationEntry(
                kind = net.artisanmc.plugin.session.NavigationEntry.Kind.DIALOG,
                id = dialog.id,
                args = ctx.args,
                lang = lang,
                projectId = opened.projectId,
            ),
        )
        val decorated = decorateNavigation(player, opened)
        // Paper's dialog API on Paper, the BungeeCord one Spigot ships elsewhere.
        if (ServerPlatform.paper) {
            DialogRenderer.open(player, dialog, lang, decorated, executor)
        } else {
            runCatching { net.artisanmc.plugin.render.dialog.SpigotDialogRenderer.open(player, dialog, lang, decorated, executor) }
                .onFailure { logger?.warning("[Artisan] dialog '$dialogId' not opened for ${player.name}: ${it.message}") }
        }
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
                    net.artisanmc.plugin.session.ScreenValue(
                        mapOf("id" to previous.id, "title" to screenTitle(previous)),
                        previous.id,
                    ),
                )
            }
        }
        return ctx.copy(args = ctx.args + extra, sourceArgs = ctx.sourceArgs + extra)
    }

    /** Best-effort display title of a history entry (first text layer / dialog title). */
    private fun screenTitle(entry: net.artisanmc.plugin.session.NavigationEntry): String =
        when (entry.kind) {
            net.artisanmc.plugin.session.NavigationEntry.Kind.MENU ->
                findMenu(entry.ref)?.let { firstTitleText(it, entry.lang) } ?: entry.id
            net.artisanmc.plugin.session.NavigationEntry.Kind.DIALOG ->
                findDialog(entry.ref)?.let { it.yaml.title?.forLang(entry.lang, it.defaultLang) } ?: entry.id
        }

    private fun firstTitleText(menu: RuntimeMenu, lang: String): String? {
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
            broadcast(mapOf("type" to "custom_items_changed", "hash" to newHash))
        }
    }

    private val modulesChangedQueued = java.util.concurrent.atomic.AtomicBoolean(false)

    /**
     * Re-reports presence to the hub and seeds the templates after the active module set
     * or its commands changed. The changes of one tick make one report and one seed: at
     * start, every module and each of its commands announces itself before the first
     * tick, and each announcement used to seed every template of every module.
     */
    fun notifyModulesChanged() {
        // Now, so a GET of the hub between this signal and the next tick builds afresh; again at the tick,
        // for what registered in between.
        announcementChanged()
        if (!modulesChangedQueued.compareAndSet(false, true)) return
        scheduler.global {
            modulesChangedQueued.set(false)
            announcementChanged()
            broadcast(mapOf("type" to "modules_changed") + announcement().toMap())
            seedTemplates()
        }
    }

    /**
     * Copies, once per server, the templates that name a seed project and were never seeded
     * (`TemplateSeeds`), merges the old command overrides into the commands' files, keeps the
     * modules' system elements in their folders (`SystemFiles`), then reloads when something
     * was written. Off the game threads, with the other disk writes.
     */
    fun seedTemplates() {
        val registry = templates()
        workspace.io.execute {
            val seeds = net.artisanmc.plugin.project.TemplateSeeds(roots, logger, seedLang)
            var wrote = false
            registry?.registered()?.forEach { (moduleId, list) ->
                list.forEach { template ->
                    runCatching { if (seeds.seed(moduleId, template)) wrote = true }
                        .onFailure { logger?.warning("[Artisan] Template '$moduleId/${template.id}' not seeded: ${it.message}") }
                }
            }
            // Before the system files: a command's file holds its overrides before it is written as shipped.
            runCatching { if (migrateCommandOverrides()) wrote = true }
                .onFailure { logger?.warning("[Artisan] Command overrides not migrated: ${it.message}") }
            registry?.registered()?.forEach { (moduleId, list) ->
                list.filter { it.isSystem }.forEach { template ->
                    runCatching { if (syncSystemFiles(moduleId, template)) wrote = true }
                        .onFailure { logger?.warning("[Artisan] System elements '$moduleId/${template.id}' not written: ${it.message}") }
                }
            }
            if (wrote) refresh(folders = null, notifyModules = false)
        }
    }

    /**
     * Keeps [template]'s system elements in [moduleId]'s first folder by name (`SystemFiles`);
     * a module without a folder has nowhere to keep them. True when files were written.
     */
    private fun syncSystemFiles(moduleId: String, template: net.artisanmc.modules.api.template.TemplateDeclaration): Boolean {
        val folder = roots.all().entries.filter { roots.ownerOf(it.key) == moduleId }.minByOrNull { it.key }
        if (folder == null) {
            // Its commands run from memory without one (`CommandRegistrar`): nothing to say.
            if (template.id == net.artisanmc.plugin.command.ModuleCommandFiles.TEMPLATE_ID) return false
            logger?.warning("[Artisan] Module '$moduleId' declares system elements but has no folder: call moduleFolder() in its onEnable.")
            return false
        }
        val written = net.artisanmc.plugin.project.SystemFiles.sync(folder.value, moduleId, template)
        if (written.isNotEmpty()) logger?.info("[Artisan] System elements of '$moduleId' written in '${folder.key}': ${written.joinToString()}.")
        return written.isNotEmpty()
    }

    fun setCustomItemsManager(manager: CustomItemsManager) {
        customItemsManager = manager
    }

    // A hand edit on disk applies only on `/artisan reload`, like any other Minecraft
    // plugin: the disk is deliberately not watched.

    /**
     * Held by a reload and by each disk write of the editor ([workspace]`.io`): the
     * provider's own lock, not the registry's, so a module's `onEnable` (which registers
     * its folder) and `api.project` never wait behind it.
     */
    private val diskLock = Any()
    /** The binaries' hashes across reloads: a png unchanged in size and mtime is not read again. */
    private val binaryHashes = ProjectFilesReader.BinaryHashCache()

    /** Every project, or only [only]: the other projects keep what the last reload read. */
    private fun reloadFromDisk(only: Set<String>? = null) = synchronized(diskLock) {
        val started = System.nanoTime()
        // A folder created by hand, or by the editor, shows in the listing from here on.
        roots.invalidate()
        // Declared model docs feed the reader so BARE data files resolve their
        // schema from the JAR declaration (ADR bare-data-files ①).
        val failures = java.util.concurrent.ConcurrentHashMap<String, MutableMap<String, String>>()
        val reader = ProjectReader(roots, logger, {
            declaredModels().mapNotNull { doc ->
                (doc["id"] as? String)?.let { it to doc }
            }.toMap()
        }, { projectId, rel, reason ->
            failures.getOrPut(projectId) { java.util.concurrent.ConcurrentHashMap() }[rel] = reason
        })
        val read = if (only == null) reader.readAll() else reader.read(only)
        // The snapshot covers every file, not only those that compiled: what failed
        // must stay readable and fixable.
        val all = roots.all()
        val dirs = if (only == null) all else all.filterKeys { it in only }
        // One walk per project: its texts and its binaries, the latter hashed only when changed.
        val scanned = dirs.mapValues { (_, dir) -> runCatching { ProjectFilesReader.scan(dir, binaryHashes) }.getOrNull() }
        val files = scanned.mapValues { (_, s) -> s?.texts.orEmpty().filterKeys { !EditorPaths.isInvisible(it) } }
        val binaries = scanned.mapValues { (_, s) -> s?.binaries.orEmpty().filterKeys { !EditorPaths.isInvisible(it) } }
        val loaded: List<RuntimeProject>
        if (only == null) {
            binaryHashes.prune(scanned.flatMap { (id, s) -> s?.binaries.orEmpty().keys.map { File(dirs.getValue(id), it).absolutePath } }.toSet())
            projects = ProjectSnapshot(files = files, binaries = binaries, skipped = failures)
            loaded = read
        } else {
            val previous = projects
            val kept = all.keys.filter { it !in only }
            fun <V> kept(map: Map<String, V>) = map.filterKeys { it in kept }
            projects = ProjectSnapshot(
                files = kept(previous.files) + files,
                binaries = kept(previous.binaries) + binaries,
                skipped = kept(previous.skipped) + failures,
            ).also { it.inheritHashes(previous, kept) }
            loaded = (runtimes.filter { it.projectId in all && it.projectId !in only } + read).sortedBy { it.projectId }
        }
        runtimes = loaded
        indexDocuments(loaded)
        val authors = HashMap(pendingAuthors).also { pendingAuthors.clear() }
        runCatching { onSnapshot(projects, authors, ::announceReload) }.onFailure {
            logger?.warning("[Artisan] Versions not recorded: ${it.message}")
            announceReload()
        }
        val millis = (System.nanoTime() - started) / 1_000_000
        // Every editor write waits behind this: a slow disk (Docker bind mount on Windows) shows up here, not as a timeout.
        if (millis > 2_000) logger?.warning("[Artisan] Reload of ${dirs.size} projects took ${millis} ms")
    }

    /**
     * Announces the reload, with each Project's fingerprint, so the editor learns that
     * hand edits now apply.
     *
     * The fingerprint is the same as `project_read`'s: a client that already holds it
     * knows, without another round trip, that it has nothing to refetch.
     */
    private fun announceReload() {
        val hashes = projects.hashes()
        // Fire-and-forget: without a reachable hub the announcement is lost; `project_read` returns the same fingerprint.
        runCatching { send(mapOf("type" to "projects_reloaded", "projects" to hashes)) }
    }

    private fun handleMessage(raw: String) {
        dispatch(runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return)
    }

    /**
     * A message from a hub this server is linked to. A peer keeps this server's pack as it is
     * when it accepts it: the pack it remembers may be older than one published elsewhere since.
     */
    private fun receive(raw: String, client: WsClient, link: HubLink) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        node.path("request_id").takeIf { it.isTextual }?.let { origins[it.asText()] = client }
        if (link.peer) when (val request = EditorRequest.parse(node)) {
            is EditorRequest.HelloAck -> return logger?.info("[Artisan] Joined the network server at ${client.url}") ?: Unit
            is EditorRequest.ResourcePackUpdated ->
                return applyResourcePack(request.url, request.hash, "resource_pack_updated payload", net.artisanmc.plugin.config.deriveHttpBaseUrl(client.url))
            else -> Unit
        }
        dispatch(node)
    }

    private fun dispatch(node: JsonNode) {
        when (val request = EditorRequest.parse(node) ?: return) {
            is EditorRequest.HelloAck -> onHelloAck(request)
            is EditorRequest.ResourcePackUpdated -> applyResourcePack(request.url, request.hash, "resource_pack_updated payload")
            EditorRequest.SessionReplaced -> logger?.warning(
                "[Artisan] Another server joined the hub with this server's name (name in environment.yml); this one is disconnected from the editor.",
            )
            EditorRequest.CustomItemsRequest -> sendCustomItems()

            is EditorRequest.OnlinePlayersFetch -> queries.onlinePlayers(request)
            is EditorRequest.PapiPlaceholdersFetch -> queries.papiPlaceholders(request)
            is EditorRequest.HeadTextureFetch -> queries.headTexture(request)
            is EditorRequest.PlayerInventoryFetch -> queries.playerInventory(request)
            is EditorRequest.EditorBundleFetch -> queries.editorBundle(request)
            is EditorRequest.TemplateFetch -> templateRequests.fetch(request)
            is EditorRequest.TemplateCopy -> templateRequests.copy(request)
            is EditorRequest.ProjectOriginsFetch -> templateRequests.origins(request)
            is EditorRequest.DataSourceFetch -> queries.dataSource(request)
            is EditorRequest.ServerConfigWrite -> queries.serverConfigWrite(request)
            is EditorRequest.NexoGlyphsList -> queries.nexoGlyphs(request)
            is EditorRequest.NexoGlyphRead -> queries.nexoGlyph(request)

            is EditorRequest.ProjectList -> projectReads.list(request)
            is EditorRequest.ProjectRead -> projectReads.read(request)
            is EditorRequest.ProjectHistory -> projectReads.history(request)
            is EditorRequest.AssetRead -> projectReads.asset(request)
            is EditorRequest.ConfigRead -> projectReads.config(request)

            is EditorRequest.ProjectWrite -> projectWrites.write(request)
            is EditorRequest.ConfigWrite -> projectWrites.config(request)
            is EditorRequest.ProjectDraftPublish -> projectWrites.publishDraft(request)
            is EditorRequest.ProjectCreate -> projectWrites.create(request)
            is EditorRequest.ProjectDelete -> projectWrites.delete(request)
            is EditorRequest.ProjectRename -> projectWrites.rename(request)
        }
    }

    private fun onHelloAck(ack: EditorRequest.HelloAck) {
        logger?.info("Connected to the Artisan hub (session=${ack.sessionId})")
        when (val pack = ack.resourcePack) {
            EditorRequest.PackUpdate.Cleared -> rpm()?.onUpdate(null)
            is EditorRequest.PackUpdate.Apply -> applyResourcePack(pack.url, pack.hash, "resource_pack info from hello_ack")
            EditorRequest.PackUpdate.Incomplete -> Unit
        }
    }

    /** A pack built by the editor and served by the hub: [downloadUrl] is the hub's local address. */
    fun applyLocalResourcePack(playerUrl: String, downloadUrl: String, hash: String) {
        rpm()?.applyPack(playerUrl, downloadUrl, hash)
    }

    private fun applyResourcePack(url: String, hash: String, what: String, base: String? = hubBaseUrl) {
        try {
            rpm()?.applyPack(url, resolvePluginDownloadUrl(url, base), hash)
        } catch (t: Throwable) {
            logger?.warning("Invalid $what: ${t.message}")
        }
    }

    private fun sendCustomItems() = replies.offThread("custom_items_request") {
        val result = customItemsManager.buildBundle()
        if (result != null) {
            val (hash, data) = result
            logger?.info("[ART] Sending custom items bundle — hash=${hash.take(8)}…")
            broadcast(mapOf("type" to "custom_items_bundle", "hash" to hash, "data" to data))
        } else {
            logger?.warning("[ART] custom_items_request received but no custom items available — bundle not sent")
        }
    }

    /**
     * The hub hands out the player-facing pack URL, which may not resolve from this
     * server (e.g. `localhost` inside a container). The download for the
     * [net.artisanmc.plugin.resourcepack.AssetCatalog] keeps its path but goes to the
     * hub address this leaf joined. Falls back to [playerUrl].
     */
    internal fun resolvePluginDownloadUrl(playerUrl: String, hubBase: String? = hubBaseUrl): String {
        val base = hubBase?.ifEmpty { null } ?: return playerUrl
        return try {
            val parsed = java.net.URI(playerUrl)
            val pathAndQuery = buildString {
                append(parsed.rawPath ?: "")
                parsed.rawQuery?.let { append('?').append(it) }
            }
            val trimmedBase = if (base.endsWith('/')) base.dropLast(1) else base
            if (pathAndQuery.isEmpty()) playerUrl else trimmedBase + pathAndQuery
        } catch (_: Throwable) {
            playerUrl
        }
    }

    internal fun handleMessageForTesting(raw: String) = handleMessage(raw)

    private companion object {
        const val MAX_ORIGINS = 4096
    }
}
