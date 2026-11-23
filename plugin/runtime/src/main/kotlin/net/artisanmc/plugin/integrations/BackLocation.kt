package net.artisanmc.plugin.integrations

import org.bukkit.Bukkit
import org.bukkit.Location
import org.bukkit.entity.Player
import java.lang.reflect.Method
import java.util.logging.Logger

/**
 * Where `/back` returns: the place a player leaves when Artisan moves them (the `teleport`
 * action, a network teleport or a server switch). Saved in EssentialsX when it is enabled;
 * nothing otherwise. Reached by reflection, so Artisan loads and runs without EssentialsX.
 *
 * Called on the player's thread, just before the move: a teleport cancelled during its delay
 * leaves `/back` as it was.
 */
object BackLocation {
    private val logger: Logger = Logger.getLogger("Artisan")

    /** `getUser(Player)` and `setLastLocation(Location)`, by class: resolved once per class. */
    private val methods = HashMap<Pair<Class<*>, String>, Method?>()

    @Volatile private var warned = false

    fun record(player: Player) {
        if (player.hasMetadata("NPC")) return
        val essentials = Bukkit.getPluginManager().getPlugin(ESSENTIALS)?.takeIf { it.isEnabled } ?: return
        record(essentials, player, player.location)
    }

    /** [essentials] is the EssentialsX plugin (`IEssentials`), typed `Any` to stay off its API. */
    internal fun record(essentials: Any, player: Player, from: Location): Boolean = try {
        val user = method(essentials.javaClass, "getUser", Player::class.java)?.invoke(essentials, player)
        val set = user?.let { method(it.javaClass, "setLastLocation", Location::class.java) }
        set?.invoke(user, from.clone())
        set != null
    } catch (e: ReflectiveOperationException) {
        warnOnce(e)
        false
    } catch (e: RuntimeException) {
        warnOnce(e)
        false
    }

    private fun method(owner: Class<*>, name: String, parameter: Class<*>): Method? = synchronized(methods) {
        methods.getOrPut(owner to name) {
            runCatching { owner.getMethod(name, parameter) }.getOrNull().also {
                if (it == null) warnOnce(NoSuchMethodException("${owner.name}.$name(${parameter.simpleName})"))
            }
        }
    }

    private fun warnOnce(e: Exception) {
        if (warned) return
        warned = true
        logger.warning("[Artisan] EssentialsX /back not updated on teleport: ${e.cause ?: e}")
    }

    const val ESSENTIALS = "Essentials"
}
