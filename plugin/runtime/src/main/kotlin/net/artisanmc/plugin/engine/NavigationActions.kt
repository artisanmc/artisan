package net.artisanmc.plugin.engine

import org.bukkit.entity.Player
import net.artisanmc.plugin.session.NavigationEntry

/**
 * Game logic of the core navigation actions: menus, dialogs, the back stack and
 * pagination. Bound to their declarations by [CoreActionHandlers]; each reaches the
 * running engine through the step's [EngineRuntime].
 */
internal object NavigationActions {

    fun openMenu(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val ex = rt.executor
        val player = ctx.player
        val menuId = Args.str(args, "menu_id") ?: return ctx
        // Real navigation: remember the screen we're leaving so a back
        // button can return to it (popPrevious consumes it). Pushed
        // before opening so the new screen renders `has_previous_menu`.
        val leaving = ex.history?.current(player)
        ex.history?.pushCurrent(player)
        // Context values resolve against the EMITTING ctx (the click
        // that binds the iteration row / current args) — the target menu
        // only ever sees already-resolved values.
        val passed = Args.stringMap(args, "context").mapValues { resolveContextValue(it.value, ctx, ex) }
        val newArgs = if (Args.bool(args, "clear_context", false)) passed else ctx.navigationArgs + passed
        // Pagination is per-menu state: never carry it to the target menu
        // (element ids collide across menus, e.g. two "grid").
        ex.menuProvider.openMenu(
            player, menuId, ctx.lang,
            ctx.copy(args = newArgs, pagination = emptyMap(), pageInfo = emptyMap(), sourceArgs = emptyMap()),
        )
        undoPushIfNotShown(player, leaving, ex)
        return ctx
    }

    fun closeMenu(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        ctx.player.closeInventory()
        return ctx
    }

    fun openDialog(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val ex = rt.executor
        val player = ctx.player
        val dialogId = Args.str(args, "dialog_id") ?: return ctx
        // Same as openMenu: a dialog is a navigation step too.
        val leaving = ex.history?.current(player)
        ex.history?.pushCurrent(player)
        // Same rule as openMenu: context values resolve at emit time —
        // the dialog's texts/actions read the passed args only.
        val clear = Args.bool(args, "clear_context", false)
        val passed = Args.stringMap(args, "context").mapValues { resolveContextValue(it.value, ctx, ex) }
        val newArgs = if (clear) passed else ctx.args + passed
        ex.menuProvider.openDialog(player, dialogId, ctx.lang, ctx.copy(
            args = newArgs,
            sourceArgs = if (clear) emptyMap() else ctx.sourceArgs - passed.keys,
        ))
        undoPushIfNotShown(player, leaving, ex)
        return ctx
    }

    fun closeDialog(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        runCatching { ctx.player.javaClass.getMethod("closeDialog").invoke(ctx.player) }
        return ctx
    }

    /**
     * `open_previous_menu`: pops the previous screen and reopens it WITHOUT pushing the
     * current one. The stack shrinks on every return, so two screens can never bounce
     * back and forth forever. Empty stack = no-op.
     */
    fun openPrevious(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val ex = rt.executor
        val player = ctx.player
        val previous = ex.history?.popPrevious(player) ?: return ctx
        val target = ctx.copy(
            args = previous.args,
            lang = previous.lang,
            pagination = previous.pagination,
            pageInfo = emptyMap(),
            sourceArgs = emptyMap(),
        )
        when (previous.kind) {
            NavigationEntry.Kind.MENU -> ex.menuProvider.openMenu(player, previous.ref, previous.lang, target)
            NavigationEntry.Kind.DIALOG -> ex.menuProvider.openDialog(player, previous.ref, previous.lang, target)
        }
        return ctx
    }

    fun paginationNext(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime) =
        paginate(ctx, Args.str(args, "element_id"), +1, rt.executor)

    fun paginationPrev(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime) =
        paginate(ctx, Args.str(args, "element_id"), -1, rt.executor)

    /** Moves the targeted elements' page forward/back (clamped) then re-renders the current menu. */
    private fun paginate(ctx: ExecutionContext, elementId: String?, delta: Int, ex: ActionExecutor): ExecutionContext {
        val session = ex.sessions.get(ctx.player) ?: return ctx
        val targets = if (elementId != null) listOf(elementId) else ctx.pageInfo.keys.toList()
        var pagination = ctx.pagination
        for (t in targets) {
            val info = ctx.pageInfo[t] ?: continue
            val next = (info.page + delta).coerceIn(0, info.pageCount - 1)
            if (next != info.page) pagination = pagination + (t to next)
        }
        if (pagination == ctx.pagination) return ctx
        val newCtx = ctx.copy(pagination = pagination)
        ex.menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, newCtx)
        return newCtx
    }

    private val WHOLE_PLACEHOLDER = Regex("^\\{([a-z][a-z0-9_]*(?:\\.[a-z0-9_]+)?)}$")

    /**
     * Resolves a `context` value (open_menu / open_dialog): a template that is EXACTLY
     * one placeholder (`{cat}`, `{item.final_price}`) passes the RAW value (the whole
     * row Map, a Number…), type-preserving, so `context: { cat: "{cat}" }` lets the
     * target menu use `{cat.name}` everywhere. Any other template interpolates to a string.
     */
    private fun resolveContextValue(template: String, ctx: ExecutionContext, ex: ActionExecutor): Any {
        val m = WHOLE_PLACEHOLDER.matchEntire(template.trim())
        if (m != null) {
            ctx.exprValue(m.groupValues[1])?.let { return it }
        }
        return ex.resolveText(template, ctx)
    }

    /**
     * Undoes the push of a navigation that showed nothing (menu/dialog not found): the
     * provider did not call `setCurrent`, the screen being left is still the current one
     * and must not become its own "previous". When shown, a return wired as `open_menu`
     * is collapsed (see `collapseReturn`).
     */
    private fun undoPushIfNotShown(player: Player, leaving: NavigationEntry?, ex: ActionExecutor) {
        val store = ex.history ?: return
        if (leaving != null && store.current(player) === leaving) store.popPrevious(player)
        else store.collapseReturn(player)
    }
}
