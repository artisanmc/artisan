package net.artisanmc.plugin.resourcepack

import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.scheduling.schedulerFor
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

/**
 * Hands the pack built by the editor to a host resource-pack plugin (Nexo, Oraxen,
 * ItemsAdder) through [delegator]; that plugin sends it to players. Artisan never
 * sends a pack to players itself.
 */
open class ResourcePackManager(
    private val plugin: JavaPlugin,
    private val config: ResourcePackConfig,
    private val logger: Logger? = null,
    private val assetCatalog: AssetCatalog? = null,
    private val delegator: ResourcePackDelegator? = null,
    /** Optional on-disk cache of the last applied pack info ({url, download_url,
     *  hash} JSON). When set, [onUpdate] persists here and [loadFromDisk]
     *  restores at boot, even before a leaf reaches its hub. */
    private val cacheFile: java.io.File? = null,
) : Listener {
    private val scheduler by lazy { schedulerFor(plugin) }

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
            currentPackInfo = ResourcePackInfo.from(url, downloadUrl, hash)
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
     * Build and apply a [ResourcePackInfo] from a pack URL + hash.
     *
     * @param url  URL of the pack on the hub.
     * @param hash 40-char hex SHA-1.
     */
    fun applyPack(url: String, hash: String) {
        applyPack(url, url, hash)
    }

    /**
     * Build and apply a [ResourcePackInfo] with split URLs.
     *
     * @param playerUrl   External URL of the pack on the hub.
     * @param downloadUrl Plugin-side URL the plugin uses to download the pack itself (for
     *                    delegation and [AssetCatalog]). In Docker, this is the hub's internal address.
     * @param hash        40-char hex SHA-1.
     */
    fun applyPack(playerUrl: String, downloadUrl: String, hash: String) {
        onUpdate(ResourcePackInfo.from(playerUrl, downloadUrl, hash))
    }

    fun onUpdate(info: ResourcePackInfo?) {
        currentPackInfo = info
        persistToDisk(info)
        if (info == null) return
        assetCatalog?.let { cat -> updateCatalogAsync(cat, info) }
        if (delegator != null) {
            applyDelegateAsync(info)
        } else {
            logger?.warning(
                "[resource-pack] pack ${info.hash} not applied: set resource-pack.delegate-to-dir " +
                    "to the pack folder of Nexo, Oraxen or ItemsAdder",
            )
        }
    }

    private fun applyDelegateAsync(info: ResourcePackInfo) {
        runDelegate {
            // The URL goes into the log: in delegation, a failing download (internal
            // address unreachable from this server) looks exactly like a message never
            // received: no zip written, no host reload.
            logger?.info("[delegate] applying pack ${info.hash} from ${info.downloadUrl}")
            try {
                delegator!!.apply(info.downloadUrl, info.hash)
            } catch (t: Throwable) {
                throw IllegalStateException("download or extract of ${info.downloadUrl} failed: ${t.message}", t)
            }
            val reloadCmd = config.delegateReloadCommand
            if (reloadCmd != null) {
                // Bukkit's command dispatch isn't thread-safe: schedule the host's
                // reload command on the global thread. Without the reload, the host
                // plugin keeps serving its old pack (without our `assets/artisan/`)
                // and players see missing-glyph placeholders.
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
     * Test seam — production hops to the global thread before dispatching
     * the host reload command. Tests override to run inline.
     */
    protected open fun runMainThread(action: () -> Unit) {
        scheduler.global(action)
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

    @EventHandler
    fun onPackStatus(event: PlayerResourcePackStatusEvent) {
        // Every outcome is logged: a pack that never finishes loading (invalid
        // URL, failed reload, discarded) otherwise leaves no trace at all.
        val msg = "[resource-pack] ${event.player.name}: ${event.status} (pack ${event.id})"
        when (event.status) {
            PlayerResourcePackStatusEvent.Status.ACCEPTED,
            PlayerResourcePackStatusEvent.Status.DOWNLOADED,
            PlayerResourcePackStatusEvent.Status.SUCCESSFULLY_LOADED -> logger?.info(msg)
            else -> logger?.warning(msg)
        }
    }
}
