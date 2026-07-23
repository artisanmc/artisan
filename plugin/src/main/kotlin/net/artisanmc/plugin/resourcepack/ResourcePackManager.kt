package net.artisanmc.plugin.resourcepack

import net.artisanmc.plugin.config.ResourcePackConfig
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
    private val delegator: ResourcePackDelegator? = null,
    /** Optional on-disk cache of the last applied pack info ({url, download_url,
     *  hash} JSON). When set, [onUpdate] persists here and [loadFromDisk]
     *  restores at boot — push mode keeps working across a restart during a
     *  backend outage (previously `currentPackInfo` was only ever set from
     *  `hello_ack`, so a backend-down boot pushed nothing). */
    private val cacheFile: java.io.File? = null,
) : Listener {

    @Volatile
    var currentPackInfo: ResourcePackInfo? = null
        private set

    /** Restores [currentPackInfo] from [cacheFile]. No-op without a cache file
     *  or cached entry; any parse error leaves the state null. Call at boot. */
    fun loadFromDisk() {
        val f = cacheFile ?: return
        try {
            if (!f.isFile) return
            val node = com.fasterxml.jackson.databind.ObjectMapper().readTree(f)
            val url = node["url"]?.asText() ?: return
            val hash = node["hash"]?.asText() ?: return
            val downloadUrl = node["download_url"]?.asText() ?: url
            currentPackInfo = ResourcePackInfo.from(url, downloadUrl, hash, config.prompt)
        } catch (_: Throwable) {
            // Swallow: a corrupt cache must never break boot.
        }
    }

    private fun persistToDisk(info: ResourcePackInfo?) {
        val f = cacheFile ?: return
        try {
            if (info == null) {
                f.delete()
                return
            }
            f.parentFile?.mkdirs()
            val json = com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(
                mapOf("url" to info.url, "download_url" to info.downloadUrl, "hash" to info.hash),
            )
            val tmp = java.io.File(f.parentFile, f.name + ".tmp")
            tmp.writeText(json, Charsets.UTF_8)
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
        } catch (_: Throwable) {
            // Cache write failure must never break the update.
        }
    }

    /**
     * UUID of the most recently pushed Artisan pack. Used to remove the old layer from each
     * player's resource pack stack when a new one is pushed, so we don't accumulate orphaned
     * Artisan packs over time (each rebuild produces a new UUID because it's derived from
     * the pack hash).
     *
     * Singleton — we assume every online player is on the same Artisan pack at any moment,
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
        persistToDisk(info)
        if (info == null) {
            // In delegate mode there's nothing on player packs to clean up
            // (we never added). Skip the per-player removal loop.
            if (delegator == null) {
                oldInfo?.let { old ->
                    for (player in plugin.server.onlinePlayers) {
                        removePackSafe(player, old.uuid)
                    }
                }
                previousUuid = null
            }
            return
        }
        assetCatalog?.let { cat -> updateCatalogAsync(cat, info) }
        if (delegator != null) {
            applyDelegateAsync(info)
            return
        }
        if (!config.enabled) return
        for (player in plugin.server.onlinePlayers) {
            pushToPlayer(player)
        }
        // Track the current UUID as "previous" so the NEXT update can remove it cleanly.
        // pushToPlayer reads previousUuid BEFORE we overwrite it here, so the first push
        // sees null and only adds; subsequent pushes see the prior UUID and remove+add.
        previousUuid = info.uuid
    }

    private fun applyDelegateAsync(info: ResourcePackInfo) {
        runDelegate {
            delegator!!.apply(info.downloadUrl, info.hash)
            val reloadCmd = config.delegateReloadCommand
            if (reloadCmd != null) {
                // Bukkit's command dispatch isn't thread-safe — schedule the
                // host's reload command on the main thread. Without this, the
                // host plugin keeps serving its old pack (which doesn't yet
                // contain our `assets/artisan/`) until the admin manually
                // runs the reload command. Players who joined before the
                // extraction completed would see missing-glyph placeholders
                // (Nexo's red barred circle, MC's white square, etc.).
                runMainThread {
                    logger?.info("[delegate] dispatching host reload: /$reloadCmd")
                    plugin.server.dispatchCommand(plugin.server.consoleSender, reloadCmd)
                }
            } else {
                logger?.info("[delegate] pack updated — reload the host RP plugin to apply (set resource-pack.delegate-reload-command to automate)")
            }
        }
    }

    /**
     * Test seam — production hops to the main server thread before dispatching
     * the host reload command. Tests override to run inline.
     */
    protected open fun runMainThread(action: () -> Unit) {
        plugin.server.scheduler.runTask(plugin, Runnable { action() })
    }

    /**
     * Test seam — production runs the delegate apply on a daemon thread so
     * the WS callback isn't blocked by a multi-MB download + extract.
     * Tests override this to run inline for race-free assertions.
     */
    protected open fun runDelegate(action: () -> Unit) {
        Thread {
            try {
                action()
            } catch (t: Throwable) {
                logger?.warning("[delegate] apply failed: ${t.message}")
            }
        }.apply {
            isDaemon = true
            name = "artisan-rp-delegate"
            start()
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
            name = "artisan-asset-catalog-update"
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
        // Remove previous Artisan pack from this player's stack (no-op if not present).
        // We use addResourcePack (additive) instead of setResourcePack (which replaces all
        // packs on the client), so other RP plugins like Nexo/Oraxen/ItemsAdder coexist.
        // But because our UUID changes on every rebuild (it's derived from the hash), we
        // must explicitly remove the previous Artisan UUID to avoid orphan accumulation.
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
        if (delegator != null) return
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
