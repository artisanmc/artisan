package net.artisanmc.plugin.provider

import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.ServerVariants
import net.artisanmc.plugin.engine.VariableStore
import net.artisanmc.plugin.engine.VariantPlayer
import net.artisanmc.plugin.engine.VariantRule
import org.bukkit.entity.Player

/**
 * The server's menu variants seen from the game (design `variantes-modules`, variants declared
 * by the server): what a player's client is, what they chose, and so the variant of each file
 * they see. Shared by the menus, the dialogs and the commands, so a player sees the same variant
 * in every module. Lives across `/artisan reload`; [declared] is replaced by it.
 *
 * A player's choice is a value of [store] under [ServerVariants.PREFERENCE_REF]: `artisan_vars`
 * keeps it, it follows the player across the network, and it loads with their other values.
 */
class MenuVariants(
    private val store: () -> VariableStore?,
    private val isBedrock: (Player) -> Boolean,
    private val hasPack: (Player) -> Boolean,
) {
    @Volatile var declared: ServerVariants = ServerVariants()

    /** What [player] chose, null for auto. */
    fun preference(player: Player): String? =
        (store()?.get(ServerVariants.PREFERENCE_REF, player.uniqueId.toString()) as? String)
            ?.takeIf { it != ServerVariants.AUTO }

    /** Keeps [variant] as [player]'s choice; `auto` clears it. */
    fun choose(player: Player, variant: String) {
        val s = store() ?: return
        val owner = player.uniqueId.toString()
        if (variant == ServerVariants.AUTO) s.clear(ServerVariants.PREFERENCE_REF, owner)
        else s.set(ServerVariants.PREFERENCE_REF, owner, variant, 0)
    }

    /** [player] for the rules; [test] evaluates an engine condition in the current context. */
    fun player(player: Player, test: (Condition) -> Boolean): VariantPlayer = object : VariantPlayer {
        override val bedrock by lazy { isBedrock(player) }
        override val hasPack by lazy { this@MenuVariants.hasPack(player) }
        override val preference by lazy { preference(player) }
        override fun hasPermission(permission: String) = player.hasPermission(permission)
        override fun test(condition: Condition) = test(condition)
    }

    /** The variant whose version of a file [player] sees ([ServerVariants.select]), null for the module's own. */
    fun select(player: Player, test: (Condition) -> Boolean, legacy: List<VariantRule>, has: (String) -> Boolean): String? =
        declared.select(legacy, has, player(player, test))
}
