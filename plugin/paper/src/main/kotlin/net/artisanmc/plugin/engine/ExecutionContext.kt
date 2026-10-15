package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.ActionContext
import org.bukkit.entity.Player

/** Current page + page count of an iterating element, computed at render. */
data class PageInfo(val page: Int, val pageCount: Int)

/**
 * The engine's context: what an [ActionContext] shows a module's handler (player, args,
 * language, project), plus Artisan's own navigation and pagination state.
 */
data class ExecutionContext(
    override val player: Player,
    override val args: Map<String, Any> = emptyMap(),
    override val lang: String = "en",
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
    override val projectId: String? = null,
    /** Lore wrap width of the menu being rendered (MC pixels, 0 = never). */
    val loreMaxWidth: Int = 0,
) : ActionContext {
    override fun withArgs(args: Map<String, Any>): ActionContext = copy(args = this.args + args)

    val navigationArgs: Map<String, Any>
        get() = args.filter { (name, value) -> name !in sourceArgs || value !== sourceArgs[name] }

    /**
     * Args + implicit built-ins: `player` = current player (never overrides an arg of
     * the same name bound by the caller). All text resolution goes through here, not
     * through `args` directly.
     */
    val resolvedArgs: Map<String, Any>
        get() = if ("player" in args) args else args + ("player" to player)
}
