package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.VariantRule
import net.artisanmc.plugin.provider.MenuVariants
import org.bukkit.entity.Player

/**
 * The variants of one command (design `variantes-modules` §17): each a whole compiled tree, the
 * module's merged with the variant's steps, so names, arguments and permissions stay the module's.
 * At each run, the player's variant ([MenuVariants]) picks the tree, falling back along its
 * parents; the module's [rules], while it still has its own, decide for a player who did not choose.
 */
class CommandVariants(
    private val trees: Map<String, CompiledCommand>,
    private val rules: List<VariantRule>,
    private val evaluator: ConditionEvaluator,
    private val variants: MenuVariants,
) {
    val isEmpty: Boolean get() = trees.isEmpty()

    /** The tree [player] runs: a variant's, or null for the module's own. */
    fun treeFor(player: Player, ctx: ExecutionContext): CompiledCommand? {
        if (isEmpty) return null
        return variants.select(player, { evaluator.evaluate(it, ctx) }, rules) { it in trees }?.let(trees::get)
    }
}
