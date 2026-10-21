package net.artisanmc.plugin.platform

import org.bukkit.Location
import org.bukkit.OfflinePlayer
import org.bukkit.Server
import org.bukkit.command.Command
import org.bukkit.command.CommandMap
import org.bukkit.command.SimpleCommandMap
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemFlag

/**
 * The server calls that differ between Paper and Spigot. A Paper-only method is reached
 * only when [paper] is true: on Spigot the JVM never links it, so the calling class loads.
 */
object ServerPlatform {
    /** Paper and its forks (Folia, Leaf, Purpur). */
    val paper: Boolean = runCatching {
        Class.forName("io.papermc.paper.threadedregions.scheduler.GlobalRegionScheduler")
    }.isSuccess

    fun teleport(player: Player, location: Location) {
        if (paper) player.teleportAsync(location) else player.teleport(location)
    }

    /** The host the player joined through; null on Spigot, which does not keep it. */
    fun virtualHost(player: Player): String? = if (paper) player.virtualHost?.hostString else null

    /** A player who has joined before, without a lookup to Mojang. */
    fun cachedOfflinePlayer(server: Server, name: String): OfflinePlayer? =
        if (paper) server.getOfflinePlayerIfCached(name)
        else server.offlinePlayers.firstOrNull { it.name.equals(name, ignoreCase = true) }

    /** `1.21.8`, `26.2`. */
    fun minecraftVersion(server: Server): String =
        if (paper) server.minecraftVersion else server.bukkitVersion.substringBefore('-')

    /** Spigot keeps `getCommandMap` on its server implementation only. */
    fun commandMap(server: Server): CommandMap =
        if (paper) server.commandMap
        else server.javaClass.getMethod("getCommandMap").invoke(server) as CommandMap

    /** label → command, writable. Spigot keeps it in a protected field of [SimpleCommandMap]. */
    @Suppress("UNCHECKED_CAST")
    fun knownCommands(map: CommandMap): MutableMap<String, Command> =
        if (paper) map.knownCommands
        else SimpleCommandMap::class.java.getDeclaredField("knownCommands")
            .apply { isAccessible = true }
            .get(map) as MutableMap<String, Command>

    /** An [ItemFlag] by any of its names: Paper and Spigot name some of them differently. */
    fun itemFlag(vararg names: String): ItemFlag? =
        names.firstNotNullOfOrNull { name -> ItemFlag.entries.firstOrNull { it.name == name } }
}
