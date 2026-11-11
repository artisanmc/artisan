package net.artisanmc.modules.variables

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule
import net.artisanmc.modules.api.document.DocumentKindDeclaration
import net.artisanmc.modules.triggers.CoreGameEvents
import net.artisanmc.plugin.engine.ModuleVariableValues
import net.artisanmc.plugin.engine.ProjectVariable
import net.artisanmc.plugin.engine.ProjectVariables
import org.bukkit.entity.Player

/**
 * Variables (ADR `triggers-and-variables` §5, §10): the `variable` Document kind, the Variables of
 * every project loaded into the server's [ProjectVariables] (values kept by `VariableSync`), the
 * core Game event `variable_changed` fired for both provenances, and the `%artisan_var_<name>%`
 * placeholders for scoreboards. The actions (`set_var`, `add_var`, `clear_var`, `chat_button`) and
 * the `has_var` condition are core: they run in any chain.
 */
class VariablesModule : ArtisanModule {
    private var api: ArtisanAPI? = null
    @Volatile private var loaded = false

    override fun getId() = "variables"
    override fun getSchemaVersion() = ProjectVariable.SCHEMA

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
        api.documentKinds.register(DocumentKindDeclaration(ProjectVariable.KIND, ProjectVariable.DIR, listOf(ProjectVariable.SCHEMA), "v_"))
        api.gameEvents.register(CoreGameEvents.VARIABLE_CHANGED)
        api.variables.bindChanges { player, name, key -> fire(player, name, "", key.orEmpty()) }
        projects()?.onChange = { player, variable -> fire(player, variable.id, variable.projectId, "") }
        projects()?.ensureLoaded = ::ensureLoaded
        api.placeholders.register("artisan", VariablePlaceholders(::projects) { api.variables }, true)
    }

    override fun onDisable() {
        api?.placeholders?.unregister("artisan")
        projects()?.onChange = null
        projects()?.ensureLoaded = {}
        api?.variables?.bindChanges { _, _, _ -> }
        api = null
        loaded = false
    }

    override fun onReload() {
        load()
    }

    private fun projects(): ProjectVariables? = ModuleVariableValues.projects

    private fun fire(player: Player, name: String, project: String, key: String) {
        val events = api?.gameEvents ?: return
        if (!events.isObserved(CoreGameEvents.VARIABLE_CHANGED.name)) return
        events.fire(CoreGameEvents.VARIABLE_CHANGED.name, player, mapOf("var" to name, "project" to project, "key" to key))
    }

    private fun ensureLoaded() {
        if (!loaded) load()
    }

    /** Reads every project's `variables/`; a Variable that cannot be used is reported once, here. */
    private fun load() {
        val api = api ?: return
        val projects = projects() ?: return
        if (!loaded) loaded = true
        val warn: (String) -> Unit = { api.plugin.logger.warning("[Artisan] $it") }
        projects.definitions = api.project.projectIds().flatMap { projectId ->
            api.project.documents(projectId, ProjectVariable.KIND).mapNotNull { doc ->
                ProjectVariable.parse(projectId, doc).onFailure { warn("variable skipped — ${it.message}") }.getOrNull()
            }
        }.associateBy { it.ref }
    }
}
