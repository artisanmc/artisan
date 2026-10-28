package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.action.ActionContext
import net.artisanmc.modules.api.action.ActionRegistry
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.plugin.model.LocalizedText
import net.artisanmc.plugin.scheduling.schedulerFor
import net.artisanmc.plugin.text.LenientText
import org.bukkit.Bukkit
import org.bukkit.entity.Player
import org.bukkit.plugin.java.JavaPlugin
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.session.NavigationHistoryStore
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.platform.Chat

/**
 * Runs action chains. Every action, Artisan's own included, goes through the
 * [ActionRegistry]: the step names the action, the declaration binds its wire value to
 * the argument map, the handler runs it (ADR `extensible-document-kinds`, R1). The core
 * actions' game logic lives in [NavigationActions], [PlayerActions] and [ArgActions],
 * which reach the services below (`internal`) through the step's [EngineRuntime]; this
 * class keeps the interpreter and text resolution.
 */
class ActionExecutor(
    private val plugin: JavaPlugin,
    internal val menuProvider: MenuProvider,
    internal val sessions: MenuSessionStore,
    internal val deps: SoftDepRegistry,
    private val cooldowns: CooldownStore,
    private val evaluator: ConditionEvaluator,
    internal val commandRegistry: CommandRegistry? = null,
    internal val history: NavigationHistoryStore? = null,
    /** The vocabulary; defaults to Artisan's own actions alone (tests, tools). */
    private val registry: ActionRegistry = CoreActionHandlers.registry(),
    /** Artisan's messages, for what an action tells the player itself; null in tests and tools. */
    internal val lang: LangManager? = null,
) {
    internal val scheduler by lazy { schedulerFor(plugin) }

    fun handle(handler: ClickHandler, ctx: ExecutionContext) = handle(handler, ctx) { executeSteps(handler.steps, it) }

    /** [handler]'s cooldown, requirements and fallback around [run] instead of its steps: a module command's code. */
    fun handle(handler: ClickHandler, ctx: ExecutionContext, run: (ExecutionContext) -> Unit) {
        val cooldown = handler.cooldown
        if (cooldown != null && cooldowns.isOnCooldown(cooldown.id, ctx.player.uniqueId, cooldown.scope)) {
            cooldown.message?.let { Chat.send(ctx.player, LenientText.parse(it)) }
            return
        }
        if (!evaluator.evaluateAll(handler.requirements, ctx)) {
            executeSteps(handler.fallback, ctx)
            return
        }
        run(ctx)
        if (cooldown != null) {
            cooldowns.set(cooldown.id, ctx.player.uniqueId, cooldown.scope, cooldown.durationSeconds)
        }
    }

    /** Alias of [executeSteps] for callers that hold a flat chain. */
    fun execute(steps: List<Step>, ctx: ExecutionContext): ExecutionContext = executeSteps(steps, ctx)

    /**
     * Runs a canonical tree: flat actions + if/else-if/else branches. The context is
     * folded from action to action so `set_arg*` is visible to the following actions
     * of the same click.
     */
    fun executeSteps(steps: List<Step>, ctx: ExecutionContext): ExecutionContext {
        var cur = ctx
        for (step in steps) cur = when (step) {
            is Step.ActionStep -> dispatch(step, cur)
            is Step.IfStep -> {
                val case = step.cases.firstOrNull { caseMatches(it, cur) }
                executeSteps(case?.steps ?: step.elseSteps, cur)
            }
        }
        return cur
    }

    /**
     * One action: the registry names the handler, the declaration binds the wire value
     * (defaults included), the handler runs with a per-step [EngineRuntime]. A name nobody
     * declares, or a handler that throws, is skipped with one warning: a module's bad data
     * must not break the click.
     */
    private fun dispatch(step: Step.ActionStep, ctx: ExecutionContext): ExecutionContext {
        val decl = registry.find(step.name)
        if (decl == null) {
            warn("unknown action '${step.name}' — skipped (no module declares it)")
            return ctx
        }
        val args = decl.bind(step.value)
        val result = try {
            decl.handler.execute(EngineActionContext(ctx), args, EngineRuntime(this, step.i18n))
        } catch (e: Exception) {
            warn("action '${step.name}' failed: ${e.message}")
            return ctx
        }
        return if (result == null) ctx else context(result)
    }

    /** A module's own [ActionContext] folded back into the engine's: its bindings are kept. */
    fun context(ctx: ActionContext): ExecutionContext =
        (ctx as? EngineActionContext)?.engine
            ?: ExecutionContext(ctx.player, ctx.args, ctx.lang, projectId = ctx.projectId)

    private fun warn(message: String) = Bukkit.getLogger().warning("[Artisan] $message")

    /** `joins` is evaluated left to right without precedence; missing = "and". */
    private fun caseMatches(case: IfCase, ctx: ExecutionContext): Boolean {
        if (case.conditions.isEmpty()) return true
        var result = evaluator.evaluate(case.conditions[0], ctx)
        for (i in 1 until case.conditions.size) {
            val next = evaluator.evaluate(case.conditions[i], ctx)
            result = if (case.joins.getOrNull(i - 1) == "or") result || next else result && next
        }
        return result
    }

    /**
     * [ctx] as [viewer] reads a text of it: the viewer's language and the project's translations
     * in it, everything else (`{player}`, args) unchanged. A null viewer reads the project's
     * default language (the console).
     */
    fun viewerContext(ctx: ExecutionContext, viewer: Player?): ExecutionContext {
        if (viewer != null && viewer.uniqueId == ctx.player.uniqueId) return ctx
        val project = menuProvider.runtimeProjects().firstOrNull { it.projectId == ctx.projectId }
        val viewerLang = when (viewer) {
            null -> project?.defaultLang ?: ctx.defaultLang
            else -> lang?.playerLang(viewer) ?: return ctx
        }
        if (viewerLang == ctx.lang) return ctx
        return ctx.copy(lang = viewerLang, langMap = project?.langMapWithFallback(viewerLang) ?: ctx.langMap)
    }

    fun resolveArgs(text: String, ctx: ExecutionContext): String = ctx.render(text)

    /** [lookupLocalized] against the context's lang map, then `{arg}` and `%papi%`. */
    fun resolveText(text: String, ctx: ExecutionContext, address: String? = null): String {
        var resolved = resolveArgs(lookupLocalized(text, ctx.langMap, address), ctx)
        deps.papi?.let { resolved = it.resolve(ctx.player, resolved) }
        return resolved
    }

    /**
     * Field-local action text (post structured-action-wire): pick the language, then
     * resolve. Unlike [ExecutionContext.localize], a map's value still goes through
     * the bare-text lookup (kept as it was).
     */
    fun resolveText(text: LocalizedText, ctx: ExecutionContext, address: String? = null): String =
        resolveText(text.forLang(ctx.lang, ctx.defaultLang) ?: "", ctx, address)
}
