package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.CommandRegistry
import net.artisanmc.plugin.actiondsl.dslToEngineSteps
import net.artisanmc.plugin.actiondsl.parseActionDsl
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

class ActionExecutor(
    private val plugin: JavaPlugin,
    private val menuProvider: MenuProvider,
    private val sessions: MenuSessionStore,
    private val deps: SoftDepRegistry,
    private val cooldowns: CooldownStore,
    private val evaluator: ConditionEvaluator,
    private val commandRegistry: CommandRegistry? = null,
    private val history: NavigationHistoryStore? = null,
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
        if (handler.steps.isNotEmpty()) executeSteps(handler.steps, ctx)
        else execute(handler.actions, ctx)
        if (cooldown != null) {
            cooldowns.set(cooldown.id, ctx.player.uniqueId, cooldown.scope, cooldown.durationSeconds)
        }
    }

    fun execute(actions: List<Action>, ctx: ExecutionContext) {
        actions.fold(ctx) { cur, action -> executeOne(action, cur) }
    }

    /**
     * Runs a canonical tree: flat actions + if/else-if/else branches. The context is
     * folded from action to action so `set_arg*` is visible to the following actions
     * of the same click.
     */
    fun executeSteps(steps: List<Step>, ctx: ExecutionContext): ExecutionContext {
        var cur = ctx
        for (step in steps) cur = when (step) {
            is Step.ActionStep -> executeOne(step.action, cur)
            is Step.IfStep -> {
                val case = step.cases.firstOrNull { caseMatches(it, cur) }
                executeSteps(case?.steps ?: step.elseSteps, cur)
            }
        }
        return cur
    }

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

    /** Runs one action and returns the context, updated by `set_arg*` for the following actions. */
    private fun executeOne(action: Action, ctx: ExecutionContext): ExecutionContext {
        val player = ctx.player
        when (action) {
            is Action.RunCommand -> {
                val cmd = resolveText(action.command, ctx).trimStart('/')
                val bridged = if (!action.asConsole) tryRegistryDispatch(cmd, player) else false
                if (!bridged) {
                    if (action.asConsole) scheduler.onGlobal { Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd) }
                    else player.performCommand(cmd)
                }
            }
            is Action.OpenMenu -> {
                // Real navigation: remember the screen we're leaving so a back
                // button can return to it (popPrevious consumes it). Pushed
                // before opening so the new screen renders `has_previous_menu`.
                val leaving = history?.current(player)
                history?.pushCurrent(player)
                // Context values resolve against the EMITTING ctx (the click
                // that binds the iteration row / current args) — the target menu
                // only ever sees already-resolved values.
                val passed = action.context.mapValues { resolveContextValue(it.value, ctx) }
                val newArgs = if (action.clearContext) passed else ctx.navigationArgs + passed
                // Pagination is per-menu state: never carry it to the target menu
                // (element ids collide across menus, e.g. two "grid").
                menuProvider.openMenu(
                    player, action.menuId, ctx.lang,
                    ctx.copy(args = newArgs, pagination = emptyMap(), pageInfo = emptyMap(), sourceArgs = emptyMap()),
                )
                undoPushIfNotShown(player, leaving)
            }
            is Action.CloseMenu -> player.closeInventory()
            is Action.OpenPreviousMenu -> return openPrevious(player, ctx)
            is Action.OpenDialog -> {
                // Same as OpenMenu: a dialog is a navigation step too.
                val leaving = history?.current(player)
                history?.pushCurrent(player)
                // Same rule as OpenMenu: context values resolve at emit time —
                // the dialog's texts/actions read the passed args only.
                val passed = action.context.mapValues { resolveContextValue(it.value, ctx) }
                val newArgs = if (action.clearContext) passed else ctx.args + passed
                menuProvider.openDialog(player, action.dialogId, ctx.lang, ctx.copy(
                    args = newArgs,
                    sourceArgs = if (action.clearContext) emptyMap() else ctx.sourceArgs - passed.keys,
                ))
                undoPushIfNotShown(player, leaving)
            }
            is Action.CloseDialog -> runCatching { player.javaClass.getMethod("closeDialog").invoke(player) }
            is Action.GiveItem  -> {
                val material = Material.matchMaterial(action.material) ?: return ctx
                val item = ItemStack(material, action.count)
                if (action.name != null || action.lore.isNotEmpty()) {
                    val meta = item.itemMeta
                    action.name?.let { meta.displayName(LenientText.parse(resolveText(it, ctx))) }
                    if (action.lore.isNotEmpty()) meta.lore(action.lore.map { LenientText.parse(resolveText(it, ctx)) })
                    item.itemMeta = meta
                }
                player.inventory.addItem(item)
            }
            is Action.TakeItem -> {
                val material = Material.matchMaterial(action.material) ?: return ctx
                var toRemove = action.count
                player.inventory.contents.orEmpty().forEachIndexed { i, item ->
                    if (item != null && item.type == material && toRemove > 0) {
                        val take = minOf(toRemove, item.amount)
                        toRemove -= take
                        if (item.amount - take <= 0) player.inventory.setItem(i, null)
                        else item.amount -= take
                    }
                }
            }
            is Action.GiveMoney -> deps.vault?.deposit(player, action.amount)
            is Action.TakeMoney -> deps.vault?.withdraw(player, action.amount)
            is Action.GiveXp    -> player.giveExp(action.amount)
            is Action.GiveLevel -> player.giveExpLevels(action.amount)
            is Action.SendMessage  -> player.sendMessage(LenientText.parse(resolveText(action.text, ctx, action.i18n)))
            is Action.Broadcast    -> Bukkit.getServer().broadcast(LenientText.parse(resolveText(action.text, ctx, action.i18n)))
            is Action.PlaySound    -> runCatching {
                player.playSound(player.location, Sound.valueOf(action.sound.uppercase()), action.volume, action.pitch)
            }
            is Action.Teleport -> {
                val world = action.world?.let { Bukkit.getWorld(it) } ?: return ctx
                player.teleportAsync(org.bukkit.Location(world, action.x, action.y, action.z, action.yaw, action.pitch))
            }
            is Action.PaginationNext -> return paginate(ctx, action.elementId, +1)
            is Action.PaginationPrev -> return paginate(ctx, action.elementId, -1)
            is Action.RunActions -> return runActions(action, ctx)
            is Action.SetArg -> return applyArg(ctx, action.arg, resolveText(action.value, ctx))
            is Action.SetArgCycleNext -> return cycleArg(ctx, action.arg, action.list, forward = true)
            is Action.SetArgCyclePrev -> return cycleArg(ctx, action.arg, action.list, forward = false)
            is Action.ShowTitle -> {
                val titleComponent    = LenientText.parse(resolveText(action.title, ctx, action.i18nTitle))
                val subtitleComponent = action.subtitle?.let { LenientText.parse(resolveText(it, ctx, action.i18nSubtitle)) }
                                            ?: net.kyori.adventure.text.Component.empty()
                val times = Title.Times.times(
                    Duration.ofMillis(action.fadeIn  * 50L),  // 1 tick = 50ms
                    Duration.ofMillis(action.stay    * 50L),
                    Duration.ofMillis(action.fadeOut * 50L),
                )
                player.showTitle(Title.title(titleComponent, subtitleComponent, times))
            }
        }
        return ctx
    }

    /**
     * Bridge (modules.md §4.2): a "namespace:name args…" known to the CommandRegistry is
     * dispatched to the module (args = {"argv": tokens, "raw": raw string}) instead of
     * Bukkit. Unknown ref → Bukkit fallback (a Bukkit command may legitimately be named
     * "plugin:label").
     */
    private fun tryRegistryDispatch(cmd: String, player: Player): Boolean {
        val registry = commandRegistry ?: return false
        val space = cmd.indexOf(' ')
        val ref = if (space == -1) cmd else cmd.substring(0, space)
        if (!Regex("^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$").matches(ref)) return false
        if (!registry.has(ref)) return false
        val raw = if (space == -1) "" else cmd.substring(space + 1)
        val argv = if (raw.isEmpty()) emptyList() else raw.split(' ').filter { it.isNotEmpty() }
        runCatching { registry.dispatch(ref, player, mapOf("argv" to argv, "raw" to raw)) }
            .onFailure { Bukkit.getLogger().warning("[Artisan] command '$ref' failed: ${it.message}") }
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
    private fun runActions(action: Action.RunActions, ctx: ExecutionContext): ExecutionContext {
        if (ctx.runActionsDepth >= MAX_RUN_ACTIONS_DEPTH) {
            Bukkit.getLogger().warning(
                "[Artisan] run_actions depth limit ($MAX_RUN_ACTIONS_DEPTH) reached at '${action.actions}' — skipping",
            )
            return ctx
        }
        val raw = ctx.exprValue(action.actions)
        if (raw == null || (raw is String && raw.isBlank())) {
            Bukkit.getLogger().warning("[Artisan] run_actions '${action.actions}' resolved to no action chain — skipping")
            return ctx
        }
        // Keyed structured steps (canonical) or a legacy Action DSL string.
        val steps = runCatching { ActionChainCompiler.compile(raw) }.getOrElse {
            Bukkit.getLogger().warning("[Artisan] run_actions '${action.actions}' failed to parse: ${it.message}")
            return ctx
        }

        // Self-binding: the object the expression reads from (the row / the config
        // object) becomes a local root, so the chain addresses its fields bare
        // (`{price}`) and as `{self.price}`. The caller's context stays above.
        val base = action.actions.substringBefore('.')
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
    private fun openPrevious(player: Player, ctx: ExecutionContext): ExecutionContext {
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
