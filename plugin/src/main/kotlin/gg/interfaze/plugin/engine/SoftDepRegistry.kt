package gg.interfaze.plugin.engine

import net.milkbowl.vault.economy.Economy
import org.bukkit.entity.Player
import org.bukkit.plugin.java.JavaPlugin

class VaultProvider(private val economy: Economy) {
    fun balance(player: Player): Double = economy.getBalance(player)
    fun withdraw(player: Player, amount: Double): Boolean =
        economy.withdrawPlayer(player, amount).transactionSuccess()
    fun deposit(player: Player, amount: Double) { economy.depositPlayer(player, amount) }

    companion object {
        fun tryInit(plugin: JavaPlugin): VaultProvider? = runCatching {
            val reg = plugin.server.servicesManager
                .getRegistration(Economy::class.java) ?: return null
            VaultProvider(reg.provider)
        }.getOrNull()
    }
}

class PapiProvider {
    fun resolve(player: Player, text: String): String =
        me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(player, text)

    companion object {
        fun tryInit(): PapiProvider? = runCatching {
            Class.forName("me.clip.placeholderapi.PlaceholderAPI")
            PapiProvider()
        }.getOrNull()
    }
}

class WorldGuardProvider {
    fun isInRegion(player: Player, region: String): Boolean = runCatching {
        val wg = com.sk89q.worldguard.WorldGuard.getInstance()
        val loc = com.sk89q.worldedit.bukkit.BukkitAdapter.adapt(player.location)
        val container = wg.platform.regionContainer
        val regions = container.createQuery().getApplicableRegions(loc)
        regions.regions.any { it.id.equals(region, ignoreCase = true) }
    }.getOrDefault(false)

    companion object {
        fun tryInit(): WorldGuardProvider? = runCatching {
            Class.forName("com.sk89q.worldguard.WorldGuard")
            WorldGuardProvider()
        }.getOrNull()
    }
}

class SoftDepRegistry(
    val vault: VaultProvider?,
    val papi: PapiProvider?,
    val worldGuard: WorldGuardProvider?,
) {
    constructor(plugin: JavaPlugin) : this(
        vault      = VaultProvider.tryInit(plugin),
        papi       = PapiProvider.tryInit(),
        worldGuard = WorldGuardProvider.tryInit(),
    )

    companion object {
        val EMPTY = SoftDepRegistry(vault = null, papi = null, worldGuard = null)
    }
}
