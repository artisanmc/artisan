package gg.interfaze.plugin.resourcepack

import gg.interfaze.plugin.config.ResourcePackConfig
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

class ResourcePackManager(
    private val plugin: JavaPlugin,
    private val config: ResourcePackConfig,
    private val logger: Logger? = null,
) : Listener {

    @Volatile
    var currentPackInfo: ResourcePackInfo? = null
        private set

    fun applyFromBackend(url: String, hash: String) {
        onUpdate(ResourcePackInfo.from(url, hash, config.prompt))
    }

    fun onUpdate(info: ResourcePackInfo?) {
        currentPackInfo = info
        if (info == null) return
        if (!config.enabled) return
        for (player in plugin.server.onlinePlayers) {
            pushToPlayer(player)
        }
    }

    fun pushToPlayer(player: Player) {
        if (!config.enabled) return
        val info = currentPackInfo ?: return
        try {
            player.setResourcePack(info.uuid, info.url, info.sha1Bytes, info.prompt, false)
        } catch (t: Throwable) {
            logger?.warning("[resource-pack] setResourcePack failed for ${player.name}: ${t.message}")
        }
    }

    fun onJoin(player: Player) {
        if (!config.enabled || !config.sendOnJoin) return
        if (config.sendDelayTicks <= 0L) {
            pushToPlayer(player)
        } else {
            plugin.server.scheduler.runTaskLater(plugin, Runnable { pushToPlayer(player) }, config.sendDelayTicks)
        }
    }

    @EventHandler
    fun onPlayerJoin(event: PlayerJoinEvent) { onJoin(event.player) }

    @EventHandler
    fun onPackStatus(event: PlayerResourcePackStatusEvent) {
        when (event.status) {
            PlayerResourcePackStatusEvent.Status.DECLINED,
            PlayerResourcePackStatusEvent.Status.FAILED_DOWNLOAD ->
                logger?.warning("[resource-pack] ${event.player.name}: ${event.status}")
            else -> { }
        }
    }
}
