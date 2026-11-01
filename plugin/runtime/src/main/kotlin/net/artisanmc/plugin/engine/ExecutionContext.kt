package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.action.ActionContext
import org.bukkit.entity.Player

/** Current page + page count of an iterating element, computed at render. */
data class PageInfo(val page: Int, val pageCount: Int)

/**
 * The engine's context: what a module's handler sees through [EngineActionContext]
 * (player, args, language, project), plus Artisan's own navigation and pagination state.
 */
data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(),
    val lang: String = "en",
    /** Project default language — fallback for field-local maps ([LocalizedText]). */
    val defaultLang: String = "en",
    val langMap: Map<String, String> = emptyMap(),
    /** Requested page per iterating element (elementId → page). Written by pagination_next/prev. */
    val pagination: Map<String, Int> = emptyMap(),
    /** Snapshot of the last render (clamps + pageCount). Read by the pagination_at_* conditions. */
    val pageInfo: Map<String, PageInfo> = emptyMap(),
    /** Nesting depth of `run_actions` calls: anti-cycle guard (max 16). */
    val runActionsDepth: Int = 0,
    /** Values fetched by the renderer, retained locally but not inherited by another menu. */
    val sourceArgs: Map<String, Any> = emptyMap(),
    /**
     * Project of the Document the actions come from (clicked menu, command, dialog).
     * An `open_menu` / `open_dialog` with a bare id resolves there first.
     * `null` = no project (API, `/artisan menu`): resolved server-wide.
     */
    val projectId: String? = null,
    /** Lore wrap width of the menu being rendered (MC pixels, 0 = never). */
    val loreMaxWidth: Int = 0,
) {
    val navigationArgs: Map<String, Any>
        get() = args.filter { (name, value) -> name !in sourceArgs || value !== sourceArgs[name] }

    /**
     * Args + implicit built-ins: `player` = current player, `var` = the Variables (the project's and the modules')
     * (neither overrides an arg of the same name bound by the caller). All text resolution goes through here, not
     * through `args` directly.
     */
    val resolvedArgs: Map<String, Any>
        get() {
            val withPlayer = if ("player" in args) args else args + ("player" to player)
            // `var.<id>` and `var.<module>.<name>`: the Variables, read lazily (ADR `triggers-and-variables` §5, §10).
            if ("var" in withPlayer) return withPlayer
            val variables = ModuleVariableValues.forPlayer(player, projectId) ?: return withPlayer
            return withPlayer + ("var" to variables)
        }
}

/**
 * The engine's context as the API shows it to a handler ([ActionContext]). A Kotlin
 * property cannot implement a Java getter, so this view wraps [engine] instead of
 * [ExecutionContext] implementing the interface; [ActionExecutor.context] unwraps it.
 */
class EngineActionContext(val engine: ExecutionContext) : ActionContext {
    override fun getPlayer(): Player = engine.player
    override fun getArgs(): Map<String, Any> = engine.args
    override fun getLang(): String = engine.lang
    override fun getProjectId(): String? = engine.projectId
    override fun withArgs(args: Map<String, Any>): ActionContext =
        EngineActionContext(engine.copy(args = engine.args + args))
}
