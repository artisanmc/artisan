package net.artisanmc.plugin.engine

import net.artisanmc.plugin.expr.Node
import net.artisanmc.plugin.expr.parseExpr

/**
 * Which conditions read a player, for an evaluation without one (`api.getConditions()
 * .testWithoutPlayer`): a console, a scheduled task, a guild or land event.
 *
 * Read from the condition alone, before anything is evaluated, so a list is either evaluated whole
 * or refused whole: a player-bound operand under `not:` or `or:` cannot be "false" without making
 * its parent true.
 *
 * Evaluated without a player: `expression` (on the caller's args and `var`), `has_var`,
 * `random_chance`, `pagination_at_first`/`pagination_at_last` (hold, as with a player outside a
 * menu), `not`/`and`/`or` of those. Everything else reads the player, their world or their
 * client. In an `expression`, a `%placeholder%` and the root name `player` are player-bound too:
 * PlaceholderAPI and Artisan's namespaces resolve for a player.
 */
object PlayerBound {

    /** The player-bound parts of [condition], each as the wire name a validation message quotes; empty when none. */
    fun reasons(condition: Condition): List<String> = when (condition) {
        is Condition.HasPermission -> listOf("has_permission")
        is Condition.HasMoney -> listOf("has_money")
        is Condition.HasItem -> listOf("has_item")
        is Condition.HasXp -> listOf("has_xp")
        is Condition.HasLevel -> listOf("has_level")
        is Condition.PlaceholderEquals -> listOf("placeholder_equals")
        is Condition.PlaceholderMatch -> listOf("placeholder_match")
        is Condition.CooldownPassed -> listOf("cooldown_passed")
        is Condition.WorldIs -> listOf("world_is")
        is Condition.ClientIs -> listOf("client_is")
        Condition.HasResourcePack -> listOf("has_resource_pack")
        is Condition.TimeIs -> listOf("time_is")
        is Condition.PlayerInRegion -> listOf("player_in_region")
        is Condition.Expression -> expression(condition.expr)
        is Condition.Not -> reasons(condition.inner)
        is Condition.And -> condition.all.flatMap(::reasons).distinct()
        is Condition.Or -> condition.any.flatMap(::reasons).distinct()
        is Condition.HasVar, is Condition.RandomChance,
        is Condition.PaginationAtFirst, is Condition.PaginationAtLast -> emptyList()
    }

    /** `%x%` and the root `player` of [expr]; an expression that does not parse reads nothing (its evaluation fails closed). */
    private fun expression(expr: String): List<String> {
        val root = runCatching { parseExpr(expr) }.getOrNull() ?: return emptyList()
        val out = LinkedHashSet<String>()
        walk(root, out)
        return out.toList()
    }

    private fun walk(node: Node, out: MutableSet<String>) {
        when (node) {
            is Node.Papi -> out += "expression placeholder %${node.placeholder}%"
            is Node.Identifier -> if (node.name == "player") out += "expression name 'player'"
            is Node.Literal -> Unit
            is Node.Path -> walk(node.target, out)
            is Node.Index -> { walk(node.target, out); walk(node.index, out) }
            is Node.Method -> { walk(node.target, out); node.args.forEach { walk(it, out) } }
            is Node.Unary -> walk(node.operand, out)
            is Node.Binary -> { walk(node.left, out); walk(node.right, out) }
            is Node.Ternary -> { walk(node.cond, out); walk(node.whenTrue, out); walk(node.whenFalse, out) }
        }
    }
}
