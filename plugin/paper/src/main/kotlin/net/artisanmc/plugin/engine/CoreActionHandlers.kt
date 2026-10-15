package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.ActionDeclaration
import net.artisanmc.modules.api.ActionHandler
import net.artisanmc.modules.api.ActionRegistry

/**
 * Artisan's own actions as [ActionDeclaration]s: the schemas of [CoreActions] joined to
 * their game logic in [ActionExecutor]. They are registered once in the API's
 * [ActionRegistry] when the plugin builds its API, like a module's actions, and the
 * executor dispatches to them like to any module's (ADR `extensible-document-kinds`, R1).
 *
 * A core handler is stateless: it reaches the executor of the running engine through the
 * step's [EngineRuntime], so a reload (which recreates the executor) needs no re-registration.
 */
object CoreActionHandlers {

    fun declarations(): List<ActionDeclaration> = listOf(
        CoreActions.RUN_COMMAND.declare(core { ctx, args, rt -> rt.executor.runCommand(ctx, args, rt) }),
        CoreActions.OPEN_MENU.declare(core { ctx, args, rt -> rt.executor.openMenu(ctx, args) }),
        CoreActions.CLOSE_MENU.declare(core { ctx, _, rt -> rt.executor.closeMenu(ctx) }),
        CoreActions.OPEN_PREVIOUS_MENU.declare(core { ctx, _, rt -> rt.executor.openPrevious(ctx) }),
        CoreActions.GIVE_ITEM.declare(core { ctx, args, rt -> rt.executor.giveItem(ctx, args, rt) }),
        CoreActions.TAKE_ITEM.declare(core { ctx, args, rt -> rt.executor.takeItem(ctx, args) }),
        CoreActions.GIVE_MONEY.declare(core { ctx, args, rt -> rt.executor.giveMoney(ctx, args) }),
        CoreActions.TAKE_MONEY.declare(core { ctx, args, rt -> rt.executor.takeMoney(ctx, args) }),
        CoreActions.GIVE_XP.declare(core { ctx, args, rt -> rt.executor.giveXp(ctx, args) }),
        CoreActions.GIVE_LEVEL.declare(core { ctx, args, rt -> rt.executor.giveLevel(ctx, args) }),
        CoreActions.SEND_MESSAGE.declare(core { ctx, args, rt -> rt.executor.sendMessage(ctx, args, rt) }),
        CoreActions.BROADCAST.declare(core { ctx, args, rt -> rt.executor.broadcast(ctx, args, rt) }),
        CoreActions.PLAY_SOUND.declare(core { ctx, args, rt -> rt.executor.playSound(ctx, args) }),
        CoreActions.TELEPORT.declare(core { ctx, args, rt -> rt.executor.teleport(ctx, args) }),
        CoreActions.PAGINATION_NEXT.declare(core { ctx, args, rt -> rt.executor.paginationNext(ctx, args) }),
        CoreActions.PAGINATION_PREV.declare(core { ctx, args, rt -> rt.executor.paginationPrev(ctx, args) }),
        CoreActions.SHOW_TITLE.declare(core { ctx, args, rt -> rt.executor.showTitle(ctx, args, rt) }),
        CoreActions.OPEN_DIALOG.declare(core { ctx, args, rt -> rt.executor.openDialog(ctx, args) }),
        CoreActions.CLOSE_DIALOG.declare(core { ctx, _, rt -> rt.executor.closeDialog(ctx) }),
        CoreActions.SET_ARG.declare(core { ctx, args, rt -> rt.executor.setArg(ctx, args, rt) }),
        CoreActions.SET_ARG_CYCLE_NEXT.declare(core { ctx, args, rt -> rt.executor.setArgCycle(ctx, args, forward = true) }),
        CoreActions.SET_ARG_CYCLE_PREV.declare(core { ctx, args, rt -> rt.executor.setArgCycle(ctx, args, forward = false) }),
        CoreActions.RUN_ACTIONS.declare(core { ctx, args, rt -> rt.executor.runActions(ctx, args) }),
    )

    /** Registers every core action; throws on a name already taken (a module loaded first). */
    fun registerAll(registry: ActionRegistry) {
        declarations().forEach(registry::register)
    }

    /** A registry holding the core actions alone. */
    fun registry(): ActionRegistry = ActionRegistry().also(::registerAll)

    /**
     * A core handler runs inside Artisan's engine: the context is the engine's and the
     * runtime is the engine's, so the casts hold; a module never builds either.
     */
    private fun core(body: (ExecutionContext, Map<String, Any>, EngineRuntime) -> ExecutionContext): ActionHandler =
        ActionHandler { ctx, args, runtime ->
            val engine = runtime as? EngineRuntime
                ?: error("core actions run inside Artisan's engine only")
            EngineActionContext(body(engine.executor.context(ctx), args, engine))
        }
}
