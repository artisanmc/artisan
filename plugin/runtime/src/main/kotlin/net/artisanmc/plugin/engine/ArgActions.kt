package net.artisanmc.plugin.engine

import org.bukkit.Bukkit

/**
 * Game logic of the core actions on the context's args: `set_arg`, the cycles and
 * `run_actions`. Bound to their declarations by [CoreActionHandlers].
 */
internal object ArgActions {
    /** `run_actions` anti-cycle guard. */
    private const val MAX_RUN_ACTIONS_DEPTH = 16

    fun setArg(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val arg = Args.str(args, "arg") ?: return ctx
        return applyArg(ctx, arg, rt.text(ctx, args, "value"), rt.executor)
    }

    fun setArgCycleNext(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime) =
        setArgCycle(ctx, args, forward = true, rt.executor)

    fun setArgCyclePrev(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime) =
        setArgCycle(ctx, args, forward = false, rt.executor)

    private fun setArgCycle(ctx: ExecutionContext, args: Map<String, Any>, forward: Boolean, ex: ActionExecutor): ExecutionContext {
        val arg = Args.str(args, "arg") ?: return ctx
        return cycleArg(ctx, arg, Args.str(args, "list") ?: "", forward, ex)
    }

    fun runActions(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val expr = Args.str(args, "actions") ?: return ctx
        return runActions(expr, ctx, rt.executor)
    }

    /** Updates a context arg and re-renders the player's current menu (if any). */
    private fun applyArg(ctx: ExecutionContext, arg: String, value: String, ex: ActionExecutor): ExecutionContext {
        val newCtx = ctx.copy(args = ctx.args + (arg to value))
        ex.sessions.get(ctx.player)?.let { session ->
            // Without what the menu fetched: its sources run again, so the repaint
            // shows data a previous action changed (a module command) and filters
            // that read the new arg.
            val renderCtx = newCtx.copy(args = newCtx.navigationArgs, sourceArgs = emptyMap())
            ex.menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, renderCtx)
        }
        return newCtx
    }

    private fun cycleArg(ctx: ExecutionContext, arg: String, list: String, forward: Boolean, ex: ActionExecutor): ExecutionContext {
        val values = list.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (values.isEmpty()) return ctx
        val idx = values.indexOf(ctx.args[arg]?.toString())
        val next = when {
            idx < 0 -> if (forward) values.first() else values.last()
            forward -> values[(idx + 1) % values.size]
            else    -> values[(idx - 1 + values.size) % values.size]
        }
        return applyArg(ctx, arg, next, ex)
    }

    /**
     * `run_actions <expr>` (ADR action-dsl §run_actions): resolves the action chain
     * carried by a source (e.g. `item.on_buy`), compiles it and runs it IN PLACE with the
     * source object bound as a local root (`self` + bare fields). Tolerant: a missing /
     * empty / unparseable value is a no-op + one WARN. Call depth is capped at 16
     * (anti-cycle). Returns the CALLER's context: self-bindings do not leak further.
     */
    private fun runActions(expr: String, ctx: ExecutionContext, ex: ActionExecutor): ExecutionContext {
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

        ex.executeSteps(steps, ctx.copy(args = newArgs, runActionsDepth = ctx.runActionsDepth + 1))
        return ctx
    }
}
