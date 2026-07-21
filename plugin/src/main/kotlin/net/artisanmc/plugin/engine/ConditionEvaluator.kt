package net.artisanmc.plugin.engine

import java.util.concurrent.atomic.AtomicBoolean
import org.bukkit.Bukkit
import org.bukkit.Material

class ConditionEvaluator(val deps: SoftDepRegistry, val cooldowns: CooldownStore) {

    fun evaluateAll(conditions: List<Condition>, ctx: ExecutionContext): Boolean =
        conditions.all { evaluate(it, ctx) }

    fun evaluate(condition: Condition, ctx: ExecutionContext): Boolean = when (condition) {
        is Condition.HasPermission     -> ctx.player.hasPermission(condition.perm)
        is Condition.HasLevel          -> ctx.player.level >= condition.level
        is Condition.HasXp             -> ctx.player.totalExperience >= condition.amount
        is Condition.HasItem           -> countItems(ctx, condition.material) >= condition.count
        is Condition.HasMoney          -> deps.vault?.balance(ctx.player)?.let { it >= condition.amount } ?: false
        is Condition.PlaceholderEquals -> deps.papi?.resolve(ctx.player, condition.placeholder) == condition.value
        is Condition.PlaceholderMatch  -> deps.papi?.resolve(ctx.player, condition.placeholder)
                                            ?.matches(Regex(condition.regex)) ?: false
        is Condition.CooldownPassed    -> !cooldowns.isOnCooldown(condition.cooldownId, ctx.player.uniqueId, "player")
        is Condition.WorldIs           -> ctx.player.world.name.equals(condition.world, ignoreCase = true)
        is Condition.TimeIs            -> evaluateTime(ctx, condition.range)
        is Condition.RandomChance      -> Math.random() < condition.probability
        is Condition.PlayerInRegion    -> deps.worldGuard?.isInRegion(ctx.player, condition.region) ?: false
        is Condition.PaginationAtFirst -> pageInfoFor(ctx, condition.elementId)?.let { it.page <= 0 } ?: true
        is Condition.PaginationAtLast  -> pageInfoFor(ctx, condition.elementId)?.let { it.page >= it.pageCount - 1 } ?: true
        is Condition.Expression        -> {
            // Leaf evaluator différé (ADR action-dsl §6) : honnête no-op → false.
            if (expressionWarned.compareAndSet(false, true)) {
                Bukkit.getLogger().warning(
                    "[Artisan] free-comparison conditions (expression) are not yet evaluated — " +
                        "treating as false. First seen: '${condition.expr}'",
                )
            }
            false
        }
        is Condition.Not               -> !evaluate(condition.inner, ctx)
        is Condition.And               -> condition.all.all { evaluate(it, ctx) }
        is Condition.Or                -> condition.any.any { evaluate(it, ctx) }
    }

    private fun countItems(ctx: ExecutionContext, materialName: String): Int {
        val material = runCatching { Material.valueOf(materialName.uppercase()) }.getOrNull() ?: return 0
        return ctx.player.inventory.contents.orEmpty()
            .filterNotNull()
            .filter { it.type == material }
            .sumOf { it.amount }
    }

    private fun evaluateTime(ctx: ExecutionContext, range: String): Boolean {
        val time = ctx.player.world.time
        return when (range.lowercase()) {
            "day"   -> time in 0L..12999L
            "night" -> time in 13000L..23999L
            else    -> runCatching {
                val (a, b) = range.split("-").map { it.trim().toLong() }
                time in a..b
            }.getOrDefault(false)
        }
    }

    private fun pageInfoFor(ctx: ExecutionContext, elementId: String?): PageInfo? =
        if (elementId != null) ctx.pageInfo[elementId] else ctx.pageInfo.values.singleOrNull()

    companion object {
        val EMPTY = ConditionEvaluator(SoftDepRegistry.EMPTY, CooldownStore())

        /** Garde du WARN unique pour les conditions `expression` non-évaluées. */
        private val expressionWarned = AtomicBoolean(false)
    }
}
