package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.ActionContext
import net.artisanmc.modules.api.ActionRegistry
import net.artisanmc.modules.api.CommandRegistry
import net.artisanmc.plugin.command.ModuleCommandLine
import net.artisanmc.plugin.model.LocalizedText
import net.artisanmc.plugin.scheduling.schedulerFor
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.render.LenientText
import net.kyori.adventure.text.minimessage.MiniMessage
import net.kyori.adventure.title.Title
import java.time.Duration
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.Sound
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import org.bukkit.plugin.java.JavaPlugin

/**
 * Runs action chains. Every action, Artisan's own included, goes through the
 * [ActionRegistry]: the step names the action, the declaration binds its wire value to
 * the argument map, the handler runs it (ADR `extensible-document-kinds`, R1). The core
 * handlers ([CoreActionHandlers]) call back into this class for the game logic.
 */
class ActionExecutor(
    private val plugin: JavaPlugin,
    private val menuProvider: MenuProvider,
    private val sessions: MenuSessionStore,
    private val deps: SoftDepRegistry,
    private val cooldowns: CooldownStore,
    private val evaluator: ConditionEvaluator,
    private val commandRegistry: CommandRegistry? = null,
    private val history: NavigationHistoryStore? = null,
    /** The vocabulary; defaults to Artisan's own actions alone (tests, tools). */
    private val registry: ActionRegistry = CoreActionHandlers.registry(),
) {
    private val scheduler by lazy { schedulerFor(plugin) }

    fun handle(handler: ClickHandler, ctx: ExecutionContext) {
        val cooldown = handler.cooldown
        if (cooldown != null && cooldowns.isOnCooldown(cooldown.id, ctx.player.uniqueId, cooldown.scope)) {
            cooldown.message?.let { ctx.player.sendMessage(LenientText.parse(it)) }
            return
        }
        if (!evaluator.evaluateAll(handler.requirements, ctx)) {
            executeSteps(handler.fallback, ctx)
            return
        }
        executeSteps(handler.steps, ctx)
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
            decl.handler.execute(ctx, args, EngineRuntime(this, step.i18n))
        } catch (e: Exception) {
            warn("action '${step.name}' failed: ${e.message}")
            return ctx
        }
        return if (result == null) ctx else context(result)
    }

    /** A module's own [ActionContext] folded back into the engine's: its bindings are kept. */
    fun context(ctx: ActionContext): ExecutionContext =
        ctx as? ExecutionContext ?: ExecutionContext(ctx.player, ctx.args, ctx.lang, projectId = ctx.projectId)

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

    fun resolveArgs(text: String, ctx: ExecutionContext): String = ctx.render(text)

    /**
     * Explicit `{i18n:key}` ref wins; otherwise the literal is looked up at its
     * canonical ADDRESS (inline mode — the literal is the default language, the
     * other languages sit at `address` in `lang/<lang>.yaml`); otherwise the
     * literal stands as written.
     */
    fun resolveText(text: String, ctx: ExecutionContext, address: String? = null): String {
        var resolved = if (text.startsWith("{i18n:")) {
            val key = text.removePrefix("{i18n:").removeSuffix("}")
            ctx.langMap[key] ?: text
        } else address?.let { ctx.langMap[it] } ?: text
        resolved = resolveArgs(resolved, ctx)
        deps.papi?.let { resolved = it.resolve(ctx.player, resolved) }
        return resolved
    }

    /** Field-local action text (post structured-action-wire): pick the language, then resolve. */
    fun resolveText(text: LocalizedText, ctx: ExecutionContext, address: String? = null): String =
        resolveText(text.forLang(ctx.lang, ctx.defaultLang) ?: "", ctx, address)

    private val WHOLE_PLACEHOLDER = Regex("^\\{([a-z][a-z0-9_]*(?:\\.[a-z0-9_]+)?)}$")

    /**
     * Resolves a `context` value (open_menu / open_dialog): a template that is EXACTLY
     * one placeholder (`{cat}`, `{item.final_price}`) passes the RAW value (the whole
     * row Map, a Number…), type-preserving, so `context: { cat: "{cat}" }` lets the
     * target menu use `{cat.name}` everywhere. Any other template interpolates to a string.
     */
    private fun resolveContextValue(template: String, ctx: ExecutionContext): Any {
        val m = WHOLE_PLACEHOLDER.matchEntire(template.trim())
        if (m != null) {
            ctx.exprValue(m.groupValues[1])?.let { return it }
        }
        return resolveText(template, ctx)
    }

    // ---- core handlers' game logic (bound by CoreActionHandlers) ----

    internal fun runCommand(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val player = ctx.player
        val cmd = rt.text(ctx, args, "command").trimStart('/')
        val asConsole = Args.str(args, "as") == "console"
        val bridged = if (!asConsole) tryRegistryDispatch(cmd, player) else false
        if (!bridged) {
            if (asConsole) scheduler.onGlobal { Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd) }
            else player.performCommand(cmd)
        }
        return ctx
    }

    internal fun openMenu(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        val player = ctx.player
        val menuId = Args.str(args, "menu_id") ?: return ctx
        // Real navigation: remember the screen we're leaving so a back
        // button can return to it (popPrevious consumes it). Pushed
        // before opening so the new screen renders `has_previous_menu`.
        val leaving = history?.current(player)
        history?.pushCurrent(player)
        // Context values resolve against the EMITTING ctx (the click
        // that binds the iteration row / current args) — the target menu
        // only ever sees already-resolved values.
        val passed = Args.stringMap(args, "context").mapValues { resolveContextValue(it.value, ctx) }
        val newArgs = if (Args.bool(args, "clear_context", false)) passed else ctx.navigationArgs + passed
        // Pagination is per-menu state: never carry it to the target menu
        // (element ids collide across menus, e.g. two "grid").
        menuProvider.openMenu(
            player, menuId, ctx.lang,
            ctx.copy(args = newArgs, pagination = emptyMap(), pageInfo = emptyMap(), sourceArgs = emptyMap()),
        )
        undoPushIfNotShown(player, leaving)
        return ctx
    }

    internal fun closeMenu(ctx: ExecutionContext): ExecutionContext {
        ctx.player.closeInventory()
        return ctx
    }

    internal fun openDialog(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        val player = ctx.player
        val dialogId = Args.str(args, "dialog_id") ?: return ctx
        // Same as openMenu: a dialog is a navigation step too.
        val leaving = history?.current(player)
        history?.pushCurrent(player)
        // Same rule as openMenu: context values resolve at emit time —
        // the dialog's texts/actions read the passed args only.
        val clear = Args.bool(args, "clear_context", false)
        val passed = Args.stringMap(args, "context").mapValues { resolveContextValue(it.value, ctx) }
        val newArgs = if (clear) passed else ctx.args + passed
        menuProvider.openDialog(player, dialogId, ctx.lang, ctx.copy(
            args = newArgs,
            sourceArgs = if (clear) emptyMap() else ctx.sourceArgs - passed.keys,
        ))
        undoPushIfNotShown(player, leaving)
        return ctx
    }

    internal fun closeDialog(ctx: ExecutionContext): ExecutionContext {
        runCatching { ctx.player.javaClass.getMethod("closeDialog").invoke(ctx.player) }
        return ctx
    }

    internal fun giveItem(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val material = Material.matchMaterial(Args.str(args, "material") ?: return ctx) ?: return ctx
        val item = ItemStack(material, Args.int(args, "count", 1))
        val name = args["name"]
        val lore = Args.ltextList(args, "lore")
        if (name != null || lore.isNotEmpty()) {
            val meta = item.itemMeta
            if (name != null) meta.displayName(LenientText.parse(rt.text(ctx, args, "name")))
            if (lore.isNotEmpty()) meta.lore(lore.map { LenientText.parse(resolveText(it, ctx)) })
            item.itemMeta = meta
        }
        ctx.player.inventory.addItem(item)
        return ctx
    }

    internal fun takeItem(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        val material = Material.matchMaterial(Args.str(args, "material") ?: return ctx) ?: return ctx
        var toRemove = Args.int(args, "count", 1)
        val inventory = ctx.player.inventory
        inventory.contents.orEmpty().forEachIndexed { i, item ->
            if (item != null && item.type == material && toRemove > 0) {
                val take = minOf(toRemove, item.amount)
                toRemove -= take
                if (item.amount - take <= 0) inventory.setItem(i, null)
                else item.amount -= take
            }
        }
        return ctx
    }

    internal fun giveMoney(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        deps.vault?.deposit(ctx.player, Args.double(args, "amount", 0.0))
        return ctx
    }

    internal fun takeMoney(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        deps.vault?.withdraw(ctx.player, Args.double(args, "amount", 0.0))
        return ctx
    }

    internal fun giveXp(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        ctx.player.giveExp(Args.int(args, "amount", 0))
        return ctx
    }

    internal fun giveLevel(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        ctx.player.giveExpLevels(Args.int(args, "amount", 0))
        return ctx
    }

    internal fun sendMessage(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        ctx.player.sendMessage(LenientText.parse(rt.text(ctx, args, "text")))
        return ctx
    }

    internal fun broadcast(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        Bukkit.getServer().broadcast(LenientText.parse(rt.text(ctx, args, "text")))
        return ctx
    }

    internal fun playSound(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        val sound = Args.str(args, "sound") ?: return ctx
        runCatching {
            ctx.player.playSound(
                ctx.player.location, Sound.valueOf(sound.uppercase()),
                Args.float(args, "volume", 1f), Args.float(args, "pitch", 1f),
            )
        }
        return ctx
    }

    internal fun teleport(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext {
        val world = Args.str(args, "world")?.let { Bukkit.getWorld(it) } ?: return ctx
        ctx.player.teleportAsync(org.bukkit.Location(
            world,
            Args.double(args, "x", 0.0), Args.double(args, "y", 0.0), Args.double(args, "z", 0.0),
            Args.float(args, "yaw", 0f), Args.float(args, "pitch", 0f),
        ))
        return ctx
    }

    internal fun showTitle(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val titleComponent = LenientText.parse(rt.text(ctx, args, "title"))
        val subtitleComponent =
            if (args["subtitle"] != null) LenientText.parse(rt.text(ctx, args, "subtitle"))
            else net.kyori.adventure.text.Component.empty()
        val times = Title.Times.times(
            Duration.ofMillis(Args.int(args, "fade_in", 10) * 50L),  // 1 tick = 50ms
            Duration.ofMillis(Args.int(args, "stay", 70) * 50L),
            Duration.ofMillis(Args.int(args, "fade_out", 20) * 50L),
        )
        ctx.player.showTitle(Title.title(titleComponent, subtitleComponent, times))
        return ctx
    }

    internal fun paginationNext(ctx: ExecutionContext, args: Map<String, Any>) = paginate(ctx, Args.str(args, "element_id"), +1)
    internal fun paginationPrev(ctx: ExecutionContext, args: Map<String, Any>) = paginate(ctx, Args.str(args, "element_id"), -1)

    internal fun setArg(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val arg = Args.str(args, "arg") ?: return ctx
        return applyArg(ctx, arg, rt.text(ctx, args, "value"))
    }

    internal fun setArgCycle(ctx: ExecutionContext, args: Map<String, Any>, forward: Boolean): ExecutionContext {
        val arg = Args.str(args, "arg") ?: return ctx
        return cycleArg(ctx, arg, Args.str(args, "list") ?: "", forward)
    }

    internal fun runActions(ctx: ExecutionContext, args: Map<String, Any>): ExecutionContext =
        runActions(Args.str(args, "actions") ?: return ctx, ctx)

    /**
     * Bridge (modules.md §4.2): a "namespace:name args…" known to the CommandRegistry is
     * dispatched to the module (args = {"argv": tokens, "raw": raw string}) instead of
     * Bukkit. Unknown ref → Bukkit fallback (a Bukkit command may legitimately be named
     * "plugin:label").
     */
    private fun tryRegistryDispatch(cmd: String, player: Player): Boolean {
        val registry = commandRegistry ?: return false
        val line = ModuleCommandLine.parse(cmd, registry.names()) ?: return false
        runCatching { registry.dispatch(line.ref, player, mapOf("argv" to line.argv, "raw" to line.raw)) }
            .onFailure { Bukkit.getLogger().warning("[Artisan] command '${line.ref}' failed: ${it.message}") }
        return true
    }

    /** Updates a context arg and re-renders the player's current menu (if any). */
    private fun applyArg(ctx: ExecutionContext, arg: String, value: String): ExecutionContext {
        val newCtx = ctx.copy(args = ctx.args + (arg to value))
        sessions.get(ctx.player)?.let { session ->
            // Without what the menu fetched: its sources run again, so the repaint
            // shows data a previous action changed (a module command) and filters
            // that read the new arg.
            val renderCtx = newCtx.copy(args = newCtx.navigationArgs, sourceArgs = emptyMap())
            menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, renderCtx)
        }
        return newCtx
    }

    private fun cycleArg(ctx: ExecutionContext, arg: String, list: String, forward: Boolean): ExecutionContext {
        val values = list.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (values.isEmpty()) return ctx
        val idx = values.indexOf(ctx.args[arg]?.toString())
        val next = when {
            idx < 0 -> if (forward) values.first() else values.last()
            forward -> values[(idx + 1) % values.size]
            else    -> values[(idx - 1 + values.size) % values.size]
        }
        return applyArg(ctx, arg, next)
    }

    /**
     * `run_actions <expr>` (ADR action-dsl §run_actions): resolves the action chain
     * carried by a source (e.g. `item.on_buy`), compiles it and runs it IN PLACE with the
     * source object bound as a local root (`self` + bare fields). Tolerant: a missing /
     * empty / unparseable value is a no-op + one WARN. Call depth is capped at 16
     * (anti-cycle). Returns the CALLER's context: self-bindings do not leak further.
     */
    private fun runActions(expr: String, ctx: ExecutionContext): ExecutionContext {
        if (ctx.runActionsDepth >= MAX_RUN_ACTIONS_DEPTH) {
            Bukkit.getLogger().warning(
                "[Artisan] run_actions depth limit ($MAX_RUN_ACTIONS_DEPTH) reached at '$expr' — skipping",
            )
            return ctx
        }
        val raw = ctx.exprValue(expr)
        if (raw == null || (raw is String && raw.isBlank())) {
            Bukkit.getLogger().warning("[Artisan] run_actions '$expr' resolved to no action chain — skipping")
            return ctx
        }
        // Keyed structured steps (canonical) or a legacy Action DSL string.
        val steps = runCatching { ActionChainCompiler.compile(raw) }.getOrElse {
            Bukkit.getLogger().warning("[Artisan] run_actions '$expr' failed to parse: ${it.message}")
            return ctx
        }

        // Self-binding: the object the expression reads from (the row / the config
        // object) becomes a local root, so the chain addresses its fields bare
        // (`{price}`) and as `{self.price}`. The caller's context stays above.
        val base = expr.substringBefore('.')
        val baseVal = ctx.exprValue(base)
        val newArgs: Map<String, Any> = when {
            baseVal is Map<*, *> -> {
                val rowMap = baseVal.entries
                    .filter { it.key is String && it.value != null }
                    .associate { (it.key as String) to (it.value as Any) }
                ctx.args + rowMap + ("self" to baseVal)
            }
            baseVal != null -> ctx.args + ("self" to baseVal)
            else -> ctx.args
        }

        executeSteps(steps, ctx.copy(args = newArgs, runActionsDepth = ctx.runActionsDepth + 1))
        return ctx
    }

    /**
     * Undoes the push of a navigation that showed nothing (menu/dialog not found): the
     * provider did not call `setCurrent`, the screen being left is still the current one
     * and must not become its own "previous". When shown, a return wired as `open_menu`
     * is collapsed (see `collapseReturn`).
     */
    private fun undoPushIfNotShown(player: Player, leaving: NavigationEntry?) {
        val store = history ?: return
        if (leaving != null && store.current(player) === leaving) store.popPrevious(player)
        else store.collapseReturn(player)
    }

    /**
     * `open_previous_menu`: pops the previous screen and reopens it WITHOUT pushing the
     * current one. The stack shrinks on every return, so two screens can never bounce
     * back and forth forever. Empty stack = no-op.
     */
    internal fun openPrevious(ctx: ExecutionContext): ExecutionContext {
        val player = ctx.player
        val previous = history?.popPrevious(player) ?: return ctx
        val target = ctx.copy(
            args = previous.args,
            lang = previous.lang,
            pagination = previous.pagination,
            pageInfo = emptyMap(),
            sourceArgs = emptyMap(),
        )
        when (previous.kind) {
            NavigationEntry.Kind.MENU -> menuProvider.openMenu(player, previous.ref, previous.lang, target)
            NavigationEntry.Kind.DIALOG -> menuProvider.openDialog(player, previous.ref, previous.lang, target)
        }
        return ctx
    }

    /** Moves the targeted elements' page forward/back (clamped) then re-renders the current menu. */
    private fun paginate(ctx: ExecutionContext, elementId: String?, delta: Int): ExecutionContext {
        val session = sessions.get(ctx.player) ?: return ctx
        val targets = if (elementId != null) listOf(elementId) else ctx.pageInfo.keys.toList()
        var pagination = ctx.pagination
        for (t in targets) {
            val info = ctx.pageInfo[t] ?: continue
            val next = (info.page + delta).coerceIn(0, info.pageCount - 1)
            if (next != info.page) pagination = pagination + (t to next)
        }
        if (pagination == ctx.pagination) return ctx
        val newCtx = ctx.copy(pagination = pagination)
        menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, newCtx)
        return newCtx
    }

    companion object {
        /** `run_actions` anti-cycle guard. */
        private const val MAX_RUN_ACTIONS_DEPTH = 16
    }
}
