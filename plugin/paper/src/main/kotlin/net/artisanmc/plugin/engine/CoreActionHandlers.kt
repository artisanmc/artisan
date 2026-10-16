package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.ActionDeclaration
import net.artisanmc.modules.api.ActionHandler
import net.artisanmc.modules.api.ActionRegistry

/** A core action's game logic: the engine's context, the bound arguments, the step's runtime. */
private typealias CoreActionBody = (ExecutionContext, Map<String, Any>, EngineRuntime) -> ExecutionContext

/**
 * Artisan's own actions as [ActionDeclaration]s: the schemas of [CoreActions] joined to
 * their game logic ([NavigationActions], [PlayerActions], [ArgActions]) in one table. They are registered once in the API's
 * [ActionRegistry] when the plugin builds its API, like a module's actions, and the
 * executor dispatches to them like to any module's (ADR `extensible-document-kinds`, R1).
 *
 * A core handler is stateless: it reaches the executor of the running engine through the
 * step's [EngineRuntime], so a reload (which recreates the executor) needs no re-registration.
 */
object CoreActionHandlers {

    /**
     * THE table of Artisan's own actions: each schema of [CoreActions] (name, arguments,
     * wire forms) next to the function that runs it. Adding a core action is one line
     * here plus its schema and its body.
     */
    private val TABLE: List<Pair<ActionSchema, CoreActionBody>> = listOf(
        CoreActions.RUN_COMMAND to PlayerActions::runCommand,
        CoreActions.OPEN_MENU to NavigationActions::openMenu,
        CoreActions.CLOSE_MENU to NavigationActions::closeMenu,
        CoreActions.OPEN_PREVIOUS_MENU to NavigationActions::openPrevious,
        CoreActions.GIVE_ITEM to PlayerActions::giveItem,
        CoreActions.TAKE_ITEM to PlayerActions::takeItem,
        CoreActions.GIVE_MONEY to PlayerActions::giveMoney,
        CoreActions.TAKE_MONEY to PlayerActions::takeMoney,
        CoreActions.GIVE_XP to PlayerActions::giveXp,
        CoreActions.GIVE_LEVEL to PlayerActions::giveLevel,
        CoreActions.SEND_MESSAGE to PlayerActions::sendMessage,
        CoreActions.BROADCAST to PlayerActions::broadcast,
        CoreActions.PLAY_SOUND to PlayerActions::playSound,
        CoreActions.TELEPORT to PlayerActions::teleport,
        CoreActions.PAGINATION_NEXT to NavigationActions::paginationNext,
        CoreActions.PAGINATION_PREV to NavigationActions::paginationPrev,
        CoreActions.SHOW_TITLE to PlayerActions::showTitle,
        CoreActions.OPEN_DIALOG to NavigationActions::openDialog,
        CoreActions.CLOSE_DIALOG to NavigationActions::closeDialog,
        CoreActions.SET_ARG to ArgActions::setArg,
        CoreActions.SET_ARG_CYCLE_NEXT to ArgActions::setArgCycleNext,
        CoreActions.SET_ARG_CYCLE_PREV to ArgActions::setArgCyclePrev,
        CoreActions.RUN_ACTIONS to ArgActions::runActions,
    )

    fun declarations(): List<ActionDeclaration> = TABLE.map { (action, body) -> action.declare(core(body)) }

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
    private fun core(body: CoreActionBody): ActionHandler =
        ActionHandler { ctx, args, runtime ->
            val engine = runtime as? EngineRuntime
                ?: error("core actions run inside Artisan's engine only")
            EngineActionContext(body(engine.executor.context(ctx), args, engine))
        }
}
