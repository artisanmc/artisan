package net.artisanmc.plugin.engine

import java.util.concurrent.atomic.AtomicBoolean
import org.bukkit.Bukkit
import org.bukkit.Material
import net.artisanmc.plugin.integrations.SoftDepRegistry

/** What the server knows of a player's client, for `client_is` and `has_resource_pack`. */
interface ClientProbe {
    fun isBedrock(player: org.bukkit.entity.Player): Boolean
    fun hasPack(player: org.bukkit.entity.Player): Boolean

    /** A Java client without the pack: what a server without Geyser nor pack sees. */
    object None : ClientProbe {
        override fun isBedrock(player: org.bukkit.entity.Player) = false
        override fun hasPack(player: org.bukkit.entity.Player) = false
    }
}

class ConditionEvaluator(
    val deps: SoftDepRegistry,
    val cooldowns: CooldownStore,
    val client: ClientProbe = ClientProbe.None,
) {

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
        is Condition.ClientIs          -> (condition.client == "bedrock") == client.isBedrock(ctx.player)
        Condition.HasResourcePack      -> client.hasPack(ctx.player)
        is Condition.TimeIs            -> evaluateTime(ctx, condition.range)
        is Condition.RandomChance      -> Math.random() < condition.probability
        is Condition.PlayerInRegion    -> deps.worldGuard?.isInRegion(ctx.player, condition.region) ?: false
        is Condition.PaginationAtFirst -> pageInfoFor(ctx, condition.elementId)?.let { it.page <= 0 } ?: true
        is Condition.PaginationAtLast  -> pageInfoFor(ctx, condition.elementId)?.let { it.page >= it.pageCount - 1 } ?: true
        is Condition.Expression        -> evaluateExpression(condition, ctx)
        is Condition.Not               -> !evaluate(condition.inner, ctx)
        is Condition.And               -> condition.all.all { evaluate(it, ctx) }
        is Condition.Or                -> condition.any.any { evaluate(it, ctx) }
    }

    /**
     * Free-comparison condition (ADR action-dsl §6): parses and evaluates the leaf
     * expression against `ctx.resolvedArgs`, resolves `%papi%` through `deps.papi`,
     * coerces to Boolean. Tolerant: any parse/eval error → false (+ a single WARN).
     */
    private fun evaluateExpression(condition: Condition.Expression, ctx: ExecutionContext): Boolean {
        val papi: ((String) -> String?)? = deps.papi?.let { p -> { name -> p.resolve(ctx.player, "%$name%") } }
        val value = try {
            net.artisanmc.plugin.actiondsl.evalLeafOrThrow(condition.expr, ctx.resolvedArgs, papi)
        } catch (e: Exception) {
            if (expressionWarned.compareAndSet(false, true)) {
                Bukkit.getLogger().warning(
                    "[Artisan] unparseable expression condition — treating as false. " +
                        "First seen: '${condition.expr}' (${e.message})",
                )
            }
            return false
        }
        return net.artisanmc.plugin.actiondsl.toLeafBoolean(value)
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

        /** Guards the single WARN for unparseable `expression` conditions. */
        private val expressionWarned = AtomicBoolean(false)
    }
}
