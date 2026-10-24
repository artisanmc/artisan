package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule
import net.artisanmc.modules.api.document.DocumentKindDeclaration
import org.bukkit.event.EventPriority
import org.bukkit.event.HandlerList
import org.bukkit.event.Listener

/**
 * Triggers (ADR `triggers-and-variables`): the `trigger` Document kind, Artisan's catalog of Game
 * events with their Bukkit listeners, the `cancel_event` / `set_event` actions, and the dispatcher
 * that runs a Trigger's chain when its event fires.
 *
 * The listeners run at priority HIGH and skip what is already cancelled: a protection plugin that
 * cancelled a block break, at a lower priority, has the last word, and no Trigger runs for it.
 */
class TriggersModule : ArtisanModule {
    private var api: ArtisanAPI? = null
    private var listener: Listener? = null
    private var dispatcher: TriggerDispatcher? = null
    /** False until the first read: the projects load after the modules enable. */
    @Volatile private var loaded = false

    override fun getId() = "triggers"
    override fun getSchemaVersion() = Trigger.SCHEMA

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
        api.documentKinds.register(DocumentKindDeclaration(Trigger.KIND, Trigger.DIR, listOf(Trigger.SCHEMA), "trigger_"))
        EventActions.declarations().forEach(api.actionRegistry::register)
        CoreGameEvents.ALL.forEach { api.gameEvents.register(it.declaration) }

        val warn: (String) -> Unit = { api.plugin.logger.warning("[Artisan] $it") }
        val dispatcher = TriggerDispatcher({ api.actions }, { api.conditions }, warn).also { this.dispatcher = it }
        api.gameEvents.addListener(object : net.artisanmc.modules.api.gameevent.GameEventListener {
            override fun onGameEvent(frame: net.artisanmc.modules.api.gameevent.GameEventFrame) {
                ensureLoaded()
                dispatcher.onGameEvent(frame)
            }
            override fun observes(name: String): Boolean {
                ensureLoaded()
                return dispatcher.observes(name)
            }
        })

        val listener = object : Listener {}.also { this.listener = it }
        val pm = api.plugin.server.pluginManager
        for (entry in CoreGameEvents.ALL) {
            pm.registerEvent(entry.type, listener, EventPriority.HIGH, { _, event ->
                entry.handle(event, api.gameEvents, api.text)
            }, api.plugin, entry.ignoreCancelled)
        }
    }

    override fun onDisable() {
        listener?.let(HandlerList::unregisterAll)
        listener = null
        dispatcher = null
        api = null
        loaded = false
    }

    override fun onReload() {
        load()
    }

    private fun ensureLoaded() {
        if (!loaded) load()
    }

    /** Reads every project's `triggers/`; a Trigger that cannot run is reported once, here. */
    private fun load() {
        val api = api ?: return
        val dispatcher = dispatcher ?: return
        loaded = true
        val warn: (String) -> Unit = { api.plugin.logger.warning("[Artisan] $it") }
        val triggers = api.project.projectIds().flatMap { projectId ->
            api.project.documents(projectId, Trigger.KIND).mapNotNull { doc ->
                Trigger.parse(projectId, doc).onFailure { warn("trigger skipped — ${it.message}") }.getOrNull()
            }
        }
        for (t in triggers) {
            if (!api.gameEvents.has(t.on)) warn("trigger ${t.ref}: unknown game event '${t.on}' (a module not installed?)")
            api.conditions.validate(t.conditions).forEach { warn("trigger ${t.ref}: $it") }
        }
        dispatcher.load(triggers)
    }
}
