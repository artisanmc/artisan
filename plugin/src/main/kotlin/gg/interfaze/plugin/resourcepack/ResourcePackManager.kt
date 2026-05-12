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
    private val assetCatalog: AssetCatalog? = null,
) : Listener {

    @Volatile
    var currentPackInfo: ResourcePackInfo? = null
        private set

    /**
     * Build and apply a [ResourcePackInfo] from a backend-supplied URL + hash.
     *
     * @param url  External URL used to push the pack to the player.
     * @param hash 40-char hex SHA-1.
     */
    fun applyFromBackend(url: String, hash: String) {
        applyFromBackend(url, url, hash)
    }

    /**
     * Build and apply a [ResourcePackInfo] with split URLs.
     *
     * @param playerUrl   External URL the player's client uses (sent via `setResourcePack`).
     * @param downloadUrl Plugin-side URL the plugin uses to download the pack itself (for
     *                    [AssetCatalog]). In Docker, this should be the internal backend URL.
     * @param hash        40-char hex SHA-1.
     */
    fun applyFromBackend(playerUrl: String, downloadUrl: String, hash: String) {
        onUpdate(ResourcePackInfo.from(playerUrl, downloadUrl, hash, config.prompt))
    }

    fun onUpdate(info: ResourcePackInfo?) {
        currentPackInfo = info
        if (info == null) return
        assetCatalog?.let { cat -> updateCatalogAsync(cat, info) }
        if (!config.enabled) return
        for (player in plugin.server.onlinePlayers) {
            pushToPlayer(player)
        }
    }

    private fun updateCatalogAsync(catalog: AssetCatalog, info: ResourcePackInfo) {
        Thread {
            try {
                // Use the plugin-side download URL (Docker-internal), NOT the player-facing URL.
                catalog.update(info.downloadUrl, info.hash)
            } catch (t: Throwable) {
                logger?.warning("[asset-catalog] update failed: ${t.message}")
            }
        }.apply {
            isDaemon = true
            name = "interfaze-asset-catalog-update"
            start()
        }
    }

    fun pushToPlayer(player: Player) {
        if (!config.enabled) {
            logger?.info("[resource-pack] pushToPlayer: pack disabled for ${player.name}")
            return
        }
        val info = currentPackInfo
        if (info == null) {
            logger?.warning("[resource-pack] pushToPlayer: no pack info available for ${player.name} (currentPackInfo is null)")
            return
        }
        try {
            logger?.info("[resource-pack] pushing pack to ${player.name}: ${info.url} hash=${info.hash}")
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
