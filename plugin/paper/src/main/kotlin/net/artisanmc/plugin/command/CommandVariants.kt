package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.VariantPlayer
import net.artisanmc.plugin.engine.VariantRule
import net.artisanmc.plugin.engine.VariantRules
import org.bukkit.entity.Player

/**
 * The variants of one command (design `variantes-modules` §17): each a whole compiled tree, the
 * module's merged with the variant's steps, so names, arguments and permissions stay the module's.
 * The first rule that holds and whose variant has this command picks the tree, at each run.
 */
class CommandVariants(
    private val trees: Map<String, CompiledCommand>,
    private val rules: List<VariantRule>,
    private val evaluator: ConditionEvaluator,
    private val isBedrock: (Player) -> Boolean,
    private val hasPack: (Player) -> Boolean,
) {
    val isEmpty: Boolean get() = trees.isEmpty() || rules.isEmpty()

    /** The tree [player] runs: a variant's, or null for the module's own. */
    fun treeFor(player: Player, ctx: ExecutionContext): CompiledCommand? {
        if (isEmpty) return null
        val who = object : VariantPlayer {
            override val bedrock by lazy { isBedrock(player) }
            override val hasPack by lazy { this@CommandVariants.hasPack(player) }
            override fun hasPermission(permission: String) = player.hasPermission(permission)
            override fun test(condition: Condition) = evaluator.evaluate(condition, ctx)
        }
        return VariantRules.select(rules, { it in trees }, who)?.let(trees::get)
    }
}
