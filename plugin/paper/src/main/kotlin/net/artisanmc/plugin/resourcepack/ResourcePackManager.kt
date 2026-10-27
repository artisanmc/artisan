package net.artisanmc.plugin.resourcepack

import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.scheduling.schedulerFor
import net.kyori.adventure.resource.ResourcePackRequest
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.plugin.java.JavaPlugin
import java.util.UUID
import java.util.logging.Logger

/**
 * Brings the pack built by the editor to players, one of two ways:
 * - delegation: with a [delegator], the pack goes into a host resource-pack plugin
 *   (Nexo, Oraxen, ItemsAdder), which sends it;
 * - direct: otherwise, and if `resource-pack.enabled`, Artisan adds its pack to each
 *   player's pack stack itself, next to any other pack.
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
    /** Records the packs sent here, so a player counts once one of them is loaded. */
    private val packLoads: PackLoadTracker? = null,
    /** The prompt when `resource-pack.prompt` is empty, in the player's language. */
    private val defaultPrompt: (Player) -> Component = { Component.text("Artisan") },
) : Listener {
    init {
        packLoads?.delegated = delegator != null
    }

    private val scheduler by lazy { schedulerFor(plugin) }

    /** Direct sending: no delegate, and `resource-pack.enabled`. */
    private val sendsDirectly: Boolean get() = delegator == null && config.enabled

    /**
     * Id of the pack last sent here, removed from each player's pack stack when a new one
     * replaces it: each rebuild has a new id (derived from its hash), and the old one would
     * otherwise stay loaded under it. Every player is on the same pack (one per server).
     */
    @Volatile
    private var previousUuid: UUID? = null

    @Volatile
    var currentPackInfo: ResourcePackInfo? = null
        private set

    /** The hash applied in this process (delegated or sent): the same pack announced again (a reconnection, `/artisan reload`) is not downloaded nor sent again. */
    @Volatile private var appliedHash: String? = null

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
            currentPackInfo = ResourcePackInfo.from(url, downloadUrl, hash).also { previousUuid = it.uuid }
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
        if (info == null) {
            appliedHash = null
            // Delegated, nothing was added to players: nothing to remove.
            if (delegator == null) {
                previousUuid?.let { old ->
                    for (player in plugin.server.onlinePlayers) {
                        scheduler.onPlayer(player.uniqueId) { removePackSafe(player, old) }
                    }
                }
                previousUuid = null
            }
            return
        }
        if (info.hash == appliedHash) {
            logger?.info("[resource-pack] pack ${info.hash} already applied, nothing to download")
            return
        }
        assetCatalog?.let { cat -> updateCatalogAsync(cat, info) }
        when {
            delegator != null -> applyDelegateAsync(info)
            sendsDirectly -> sendToOnlinePlayers(info)
            else -> logger?.warning(
                "[resource-pack] pack ${info.hash} not applied: resource-pack.enabled is false and " +
                    "resource-pack.delegate-to-dir is empty",
            )
        }
    }

    private fun sendToOnlinePlayers(info: ResourcePackInfo) {
        logger?.info("[resource-pack] sending pack ${info.hash} to players from ${info.url}")
        if (isLoopback(info.url)) {
            logger?.warning("[resource-pack] ${info.url} only resolves on this machine: set web.url in environment.yml to an address players can reach")
        }
        appliedHash = info.hash
        // Captured before the overwrite below: a send deferred to the player's thread
        // must still remove the pack this update replaces.
        val replaced = previousUuid
        previousUuid = info.uuid
        for (player in plugin.server.onlinePlayers) {
            scheduler.onPlayer(player.uniqueId) { sendTo(player, replaced) }
        }
    }

    /**
     * Adds the current pack to [player]'s pack stack and removes [replaced]. A player whose
     * client already loaded this very pack is left alone: `/artisan reload` or a hub
     * reconnection announces the same pack again, and would otherwise reload every client.
     */
    fun sendTo(player: Player, replaced: UUID? = previousUuid) {
        if (!sendsDirectly) return
        val info = currentPackInfo ?: return
        if (packLoads?.hasLoaded(player.uniqueId, info.uuid) == true) return
        if (replaced != null && replaced != info.uuid) removePackSafe(player, replaced)
        try {
            packLoads?.pushed(info.uuid)
            addPack(player, info, prompt(player))
        } catch (t: Throwable) {
            logger?.warning("[resource-pack] sending the pack to ${player.name} failed: ${t.message}")
        }
    }

    private fun isLoopback(url: String): Boolean {
        val host = runCatching { java.net.URI(url).host }.getOrNull() ?: return false
        return host == "localhost" || host.startsWith("127.") || host == "[::1]" || host == "0.0.0.0"
    }

    private fun prompt(player: Player): Component =
        config.prompt?.let { MiniMessage.miniMessage().deserialize(it) } ?: defaultPrompt(player)

    private fun removePackSafe(player: Player, uuid: UUID) {
        try {
            removePack(player, uuid)
        } catch (t: Throwable) {
            logger?.warning("[resource-pack] removing pack $uuid from ${player.name} failed: ${t.message}")
        }
    }

    /**
     * Test seam: MockBukkit does not implement the pack stack. Additive (`replace(false)`),
     * so the packs of other plugins stay loaded.
     */
    protected open fun addPack(player: Player, info: ResourcePackInfo, prompt: Component) {
        val pack = net.kyori.adventure.resource.ResourcePackInfo.resourcePackInfo(info.uuid, java.net.URI.create(info.url), info.hash)
        player.sendResourcePacks(
            ResourcePackRequest.resourcePackRequest()
                .packs(pack)
                .prompt(prompt)
                .required(config.required)
                .replace(false)
                .build(),
        )
    }

    /** Test seam, see [addPack]. */
    protected open fun removePack(player: Player, uuid: UUID) {
        player.removeResourcePacks(uuid)
    }

    fun onJoin(player: Player) {
        if (!sendsDirectly || !config.sendOnJoin) return
        if (config.sendDelayTicks <= 0L) return sendTo(player)
        val id = player.uniqueId
        scheduler.playerLater(id, config.sendDelayTicks) {
            plugin.server.getPlayer(id)?.takeIf { it.isOnline }?.let { sendTo(it) }
        }
    }

    @EventHandler
    fun onPlayerJoin(event: PlayerJoinEvent) {
        onJoin(event.player)
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
            appliedHash = info.hash
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
     * Test seam — production runs the delegate apply on the scheduler's async pool so
     * the WS callback isn't blocked by a multi-MB download + extract.
     * Tests override this to run inline for race-free assertions.
     */
    protected open fun runDelegate(action: () -> Unit) {
        scheduler.async {
            try {
                action()
            } catch (t: Throwable) {
                logger?.warning("[delegate] apply failed: ${t.message}")
            }
        }
    }

    private fun updateCatalogAsync(catalog: AssetCatalog, info: ResourcePackInfo) {
        scheduler.async {
            try {
                // Use the plugin-side download URL (Docker-internal), NOT the player-facing URL.
                catalog.update(info.downloadUrl, info.hash)
            } catch (t: Throwable) {
                logger?.warning("[asset-catalog] update failed: ${t.message}")
            }
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
