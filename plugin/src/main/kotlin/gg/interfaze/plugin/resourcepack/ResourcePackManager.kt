package gg.interfaze.plugin.resourcepack

import gg.interfaze.plugin.config.ResourcePackConfig
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.plugin.java.JavaPlugin
import java.util.UUID
import java.util.logging.Logger

open class ResourcePackManager(
    private val plugin: JavaPlugin,
    private val config: ResourcePackConfig,
    private val logger: Logger? = null,
    private val assetCatalog: AssetCatalog? = null,
) : Listener {

    @Volatile
    var currentPackInfo: ResourcePackInfo? = null
        private set

    /**
     * UUID of the most recently pushed Interfaze pack. Used to remove the old layer from each
     * player's resource pack stack when a new one is pushed, so we don't accumulate orphaned
     * Interfaze packs over time (each rebuild produces a new UUID because it's derived from
     * the pack hash).
     *
     * Singleton — we assume every online player is on the same Interfaze pack at any moment,
     * which is currently true: the backend serves one resource pack per server_key and all
     * online players share that server_key.
     */
    @Volatile
    private var previousUuid: UUID? = null

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
     * @param playerUrl   External URL the player's client uses (sent via `addResourcePack`).
     * @param downloadUrl Plugin-side URL the plugin uses to download the pack itself (for
     *                    [AssetCatalog]). In Docker, this should be the internal backend URL.
     * @param hash        40-char hex SHA-1.
     */
    fun applyFromBackend(playerUrl: String, downloadUrl: String, hash: String) {
        onUpdate(ResourcePackInfo.from(playerUrl, downloadUrl, hash, config.prompt))
    }

    fun onUpdate(info: ResourcePackInfo?) {
        val oldInfo = currentPackInfo
        currentPackInfo = info
        if (info == null) {
            // Pack removed entirely — clean up any lingering Interfaze pack on online players
            // so we don't leave clients with a stale Interfaze layer on their stack.
            oldInfo?.let { old ->
                for (player in plugin.server.onlinePlayers) {
                    removePackSafe(player, old.uuid)
                }
            }
            previousUuid = null
            return
        }
        assetCatalog?.let { cat -> updateCatalogAsync(cat, info) }
        if (!config.enabled) return
        for (player in plugin.server.onlinePlayers) {
            pushToPlayer(player)
        }
        // Track the current UUID as "previous" so the NEXT update can remove it cleanly.
        // pushToPlayer reads previousUuid BEFORE we overwrite it here, so the first push
        // sees null and only adds; subsequent pushes see the prior UUID and remove+add.
        previousUuid = info.uuid
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
        // Remove previous Interfaze pack from this player's stack (no-op if not present).
        // We use addResourcePack (additive) instead of setResourcePack (which replaces all
        // packs on the client), so other RP plugins like Nexo/Oraxen/ItemsAdder coexist.
        // But because our UUID changes on every rebuild (it's derived from the hash), we
        // must explicitly remove the previous Interfaze UUID to avoid orphan accumulation.
        previousUuid?.let { prev ->
            if (prev != info.uuid) {
                removePackSafe(player, prev)
            }
        }
        try {
            logger?.info("[resource-pack] pushing pack to ${player.name}: ${info.url} hash=${info.hash}")
            addPack(player, info)
        } catch (t: Throwable) {
            logger?.warning("[resource-pack] addResourcePack failed for ${player.name}: ${t.message}")
        }
    }

    private fun removePackSafe(player: Player, uuid: UUID) {
        try {
            removePack(player, uuid)
        } catch (t: Throwable) {
            logger?.warning("[resource-pack] removeResourcePack failed for ${player.name}: ${t.message}")
        }
    }

    /**
     * Test seam — override in tests to capture the Bukkit API call without exercising the
     * underlying [Player.addResourcePack] (which throws `UnimplementedOperationException`
     * under MockBukkit).
     */
    protected open fun addPack(player: Player, info: ResourcePackInfo) {
        // Paper's additive addResourcePack takes a plain-text prompt (the Component overload
        // only exists on the deprecated setResourcePack form). Serialize the prompt component
        // to a legacy §-coded string so colors/formatting still survive in the prompt dialog.
        val promptText = LegacyComponentSerializer.legacySection().serialize(info.prompt)
        player.addResourcePack(info.uuid, info.url, info.sha1Bytes, promptText, false)
    }

    /** Test seam — see [addPack]. */
    protected open fun removePack(player: Player, uuid: UUID) {
        player.removeResourcePack(uuid)
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
