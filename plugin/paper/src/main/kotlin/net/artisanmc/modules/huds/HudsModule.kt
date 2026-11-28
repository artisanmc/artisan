package net.artisanmc.modules.huds

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule
import net.artisanmc.modules.api.action.ActionContext
import net.artisanmc.modules.api.action.ActionDeclaration
import net.artisanmc.modules.api.document.DocumentKindDeclaration
import net.artisanmc.modules.api.gameevent.GameEventFrame
import net.artisanmc.modules.api.gameevent.GameEventListener
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.modules.triggers.CoreGameEvents
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.render
import net.artisanmc.plugin.provider.projectLangMap
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.HandlerList
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent

/**
 * Server HUDs (ADR `server-huds`): the `hud` Document kind (`huds/<id>.yaml`), drawn for each player
 * in the overlay slot it names, and the `show_hud` / `hide_hud` actions for a temporary one. The
 * texts are Templates: `{var.…}`, `{player}`, `%papi%`; a `{…}` value is drawn as text, never read
 * as MiniMessage.
 */
class HudsModule : ArtisanModule {
    private var api: ArtisanAPI? = null
    private var runtime: HudRuntime? = null
    private var listener: Listener? = null
    @Volatile private var loaded = false

    override fun getId() = "huds"
    override fun getSchemaVersion() = Hud.SCHEMA

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
        api.documentKinds.register(
            DocumentKindDeclaration(Hud.KIND, Hud.DIR, listOf(Hud.SCHEMA), "h_").withPackImages { doc, _ -> Hud.packImages(doc) },
        )
        val tasks = api.scheduler.forPlugin(api.plugin)
        val warn: (String) -> Unit = { api.plugin.logger.warning("[Artisan] $it") }
        val runtime = HudRuntime(
            overlay = { api.overlay },
            passes = { player, hud -> hud.conditions.isEmpty() || api.conditions.test(player, hud.conditions) },
            render = { player, hud, template -> render(api, player, hud, template) },
            later = { player, delay, task -> tasks.runForLater(player, delay) { task() } },
            warn = warn,
        ).also { this.runtime = it }

        actions(runtime, warn).forEach(api.actionRegistry::register)
        api.gameEvents.addListener(object : GameEventListener {
            override fun onGameEvent(frame: GameEventFrame) {
                val player = frame.player
                tasks.runFor(player) { if (player.isOnline) runtime.update(player) }
            }
            override fun observes(name: String): Boolean {
                if (name != CoreGameEvents.VARIABLE_CHANGED.name) return false
                ensureLoaded()
                return runtime.all.isNotEmpty()
            }
        })

        val listener = object : Listener {
            @EventHandler(priority = EventPriority.MONITOR)
            fun onJoin(event: PlayerJoinEvent) {
                ensureLoaded()
                runtime.start(event.player)
                runtime.update(event.player)
            }

            @EventHandler(priority = EventPriority.MONITOR)
            fun onQuit(event: PlayerQuitEvent) = runtime.forget(event.player)

            @EventHandler(priority = EventPriority.MONITOR)
            fun onPack(event: PlayerResourcePackStatusEvent) {
                if (event.status != PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED) return
                // A tick later: Artisan's own pack tracker reads the same event.
                tasks.runForLater(event.player, 1) { if (event.player.isOnline) runtime.update(event.player) }
            }
        }.also { this.listener = it }
        api.plugin.server.pluginManager.registerEvents(listener, api.plugin)
        // A reload of Artisan while players are online.
        api.plugin.server.onlinePlayers.forEach { player -> tasks.runFor(player) { runtime.start(player) } }
    }

    override fun onDisable() {
        listener?.let(HandlerList::unregisterAll)
        listener = null
        api?.let { api -> runtime?.stop(api.plugin.server.onlinePlayers) }
        runtime = null
        api = null
        loaded = false
    }

    override fun onReload() {
        load()
        val api = api ?: return
        val runtime = runtime ?: return
        val tasks = api.scheduler.forPlugin(api.plugin)
        api.plugin.server.onlinePlayers.forEach { player ->
            tasks.runFor(player) {
                runtime.start(player)
                runtime.update(player)
            }
        }
    }

    private fun ensureLoaded() {
        if (!loaded) load()
    }

    /** Reads every project's `huds/`; what a HUD leaves out is reported once, here. */
    private fun load() {
        val api = api ?: return
        val runtime = runtime ?: return
        loaded = true
        val warn: (String) -> Unit = { api.plugin.logger.warning("[Artisan] $it") }
        val huds = api.project.projectIds().flatMap { projectId ->
            api.project.documents(projectId, Hud.KIND).mapNotNull { doc ->
                Hud.parse(projectId, doc).onFailure { warn("hud skipped — ${it.message}") }.getOrNull()
            }
        }
        for (hud in huds) {
            hud.problems.forEach { warn("hud ${hud.ref}: $it") }
            if (hud.conditions.isNotEmpty()) {
                runCatching { api.conditions.validate(hud.conditions) }.getOrDefault(emptyList())
                    .forEach { warn("hud ${hud.ref}: when: $it") }
            }
        }
        runtime.load(huds)
    }

    private fun actions(runtime: HudRuntime, warn: (String) -> Unit): List<ActionDeclaration> {
        fun hudOf(ctx: ActionContext, args: Map<String, Any>, action: String): Hud? {
            ensureLoaded()
            val ref = args["hud"]?.toString()?.trim().orEmpty()
            if (ref.isEmpty()) return null.also { warn("$action: no hud given") }
            return runtime.resolve(ref, ctx.projectId) ?: null.also { warn("$action: no HUD '$ref'") }
        }
        return listOf(
            ActionDeclaration(
                SHOW,
                listOf(
                    ModelField("hud", ModelFieldType.documentRef(Hud.KIND), true),
                    ModelField("duration", ModelFieldType.integer()),
                ),
                "hud",
            ) { ctx, args, _ ->
                val hud = hudOf(ctx, args, SHOW) ?: return@ActionDeclaration ctx
                val duration = when (val d = args["duration"]) {
                    is Number -> d.toLong()
                    is String -> d.trim().toLongOrNull() ?: 0L
                    else -> 0L
                }
                runtime.start(ctx.player)
                runtime.show(ctx.player, hud, duration)
                ctx
            },
            ActionDeclaration(HIDE, listOf(ModelField("hud", ModelFieldType.documentRef(Hud.KIND), true))) { ctx, args, _ ->
                val hud = hudOf(ctx, args, HIDE) ?: return@ActionDeclaration ctx
                runtime.hide(ctx.player, hud)
                ctx
            },
        )
    }

    companion object {
        const val SHOW = "show_hud"
        const val HIDE = "hide_hud"
        private val mm = MiniMessage.miniMessage()

        /**
         * [template] resolved for [player] in [hud]'s project and language: `{…}` values escaped as
         * text; PlaceholderAPI values as the server's other texts take them.
         */
        private fun render(api: ArtisanAPI, player: Player, hud: Hud, template: String): String {
            if (template.isEmpty()) return ""
            val plugin = api.plugin as? ArtisanPlugin
            val lang = plugin?.langManagerOrNull?.playerLang(player) ?: "en"
            val runtimes = plugin?.menuProviderOrNull?.runtimeProjects() ?: emptyList()
            val langMap = projectLangMap(runtimes, hud.projectId, lang)
            val papi = plugin?.runtime?.evaluatorOrNull?.deps?.papi
            val ctx = ExecutionContext(player, lang = lang, langMap = langMap, projectId = hud.projectId)
            return ctx.render(template, papi, mm::escapeTags) { langMap[it] }
        }
    }
}
