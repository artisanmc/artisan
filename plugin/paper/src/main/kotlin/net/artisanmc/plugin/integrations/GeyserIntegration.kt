package net.artisanmc.plugin.integrations

import net.artisanmc.plugin.resourcepack.BedrockPackManager
import org.bukkit.entity.Player
import org.bukkit.plugin.java.JavaPlugin
import java.io.File
import java.util.UUID
import java.util.logging.Level

/**
 * Geyser, when it runs on this server (`Geyser-Spigot`, soft dependency):
 *
 * - each Bedrock player receives the server's Bedrock pack at connection
 *   (`SessionLoadResourcePacksEvent`), so a new pack reaches them without a
 *   restart, at their next connection;
 * - `custom_mappings/artisan.json` tells Geyser to show the click item under an
 *   image button (`artisan:buttons/hit_area`) as a transparent icon. Geyser
 *   reads that folder at startup only: written once, then a restart;
 * - [isBedrock] tells the renderer who gets the title the pack reads.
 *
 * Geyser on a proxy (Velocity, BungeeCord) is not reached from here: the pack
 * and the mapping have to reach that Geyser by other means (its `packs/` and
 * `custom_mappings/` folders, for now). Bedrock players are still recognised,
 * through Floodgate when it runs here, else by the UUID Floodgate gives them
 * (`00000000-0000-0000-xxxx-xxxxxxxxxxxx`: the Xbox id in the low bits, the
 * high bits zero, which no Java account has). The mapping is also written
 * under Artisan's own `cache/geyser/` so an admin can copy it.
 */
class GeyserIntegration(private val plugin: JavaPlugin) {
    @Volatile private var bridge: GeyserBridge? = null
    @Volatile private var pack: File? = null

    val available: Boolean get() = bridge != null

    fun start() {
        writeMappings(File(plugin.dataFolder, "cache/geyser"), announce = false)
        if (plugin.server.pluginManager.getPlugin("Geyser-Spigot") == null) {
            plugin.logger.info("[Artisan] Geyser is not on this server: Bedrock players are recognised by their Floodgate UUID, " +
                "the menus' Bedrock pack and ${File(plugin.dataFolder, "cache/geyser/custom_mappings/artisan.json").path} go to the proxy's Geyser by hand")
            return
        }
        try {
            val bridge = GeyserBridge(plugin) { pack }
            bridge.subscribe()
            this.bridge = bridge
            writeMappings(bridge.configDirectory())
            plugin.logger.info("[Artisan] Geyser found: Bedrock players receive the menus' Bedrock pack")
        } catch (e: LinkageError) {
            plugin.logger.log(Level.WARNING, "[Artisan] Geyser found but its API is not the expected one: Bedrock packs are not sent", e)
        } catch (e: Exception) {
            plugin.logger.log(Level.WARNING, "[Artisan] Geyser integration failed: Bedrock packs are not sent", e)
        }
    }

    /** The pack sent from now on follows [packs]; swapped on `/artisan reload`. */
    fun follow(packs: BedrockPackManager) {
        packs.onChange { pack = it }
    }

    fun isBedrock(player: Player): Boolean =
        bridge?.isBedrock(player.uniqueId) == true || isFloodgatePlayer(player.uniqueId)

    /** The pack file an admin copies to a proxy's Geyser when Geyser is not on this server. */
    fun currentPack(): File? = pack

    private fun writeMappings(configDirectory: File, announce: Boolean = true) {
        val file = File(configDirectory, "custom_mappings/artisan.json")
        if (file.isFile && file.readText() == MAPPINGS) return
        file.parentFile.mkdirs()
        file.writeText(MAPPINGS)
        if (announce) plugin.logger.warning("[Artisan] Wrote ${file.path}: restart the server once so Geyser loads the mapping of image buttons")
    }

    /** Floodgate's answer when it runs on this server, else the shape of the UUIDs it hands out. */
    private fun isFloodgatePlayer(uuid: UUID): Boolean {
        floodgate?.let { return it(uuid) }
        return uuid.mostSignificantBits == 0L
    }

    private val floodgate: ((UUID) -> Boolean)? by lazy {
        runCatching {
            val apiClass = Class.forName("org.geysermc.floodgate.api.FloodgateApi")
            val api = apiClass.getMethod("getInstance").invoke(null)
            val isFloodgatePlayer = apiClass.getMethod("isFloodgatePlayer", UUID::class.java)
            val check: (UUID) -> Boolean = { isFloodgatePlayer.invoke(api, it) as Boolean }
            check
        }.getOrNull()
    }

    companion object {
        /** Geyser custom item mappings (format 2): the click item under an image button, drawn transparent. */
        const val MAPPINGS = """{
  "format_version": 2,
  "items": {
    "minecraft:paper": [
      {
        "type": "definition",
        "model": "artisan:buttons/hit_area",
        "bedrock_identifier": "artisan:hit_area",
        "display_name": "Artisan hit area",
        "bedrock_options": { "icon": "artisan_hit_area" }
      }
    ]
  }
}
"""
    }
}

/** The calls into Geyser's API, in a class that loads only when Geyser is there. */
private class GeyserBridge(private val plugin: JavaPlugin, private val pack: () -> File?) {
    private val api = org.geysermc.geyser.api.GeyserApi.api()

    fun configDirectory(): File = api.configDirectory().toFile()

    fun isBedrock(uuid: UUID): Boolean = api.connectionByUuid(uuid) != null

    fun subscribe() {
        api.eventBus().subscribe(
            org.geysermc.geyser.api.event.EventRegistrar.of(plugin),
            org.geysermc.geyser.api.event.bedrock.SessionLoadResourcePacksEvent::class.java,
        ) { event ->
            val file = pack() ?: return@subscribe
            try {
                event.register(org.geysermc.geyser.api.pack.ResourcePack.create(org.geysermc.geyser.api.pack.PackCodec.path(file.toPath())))
            } catch (e: Exception) {
                plugin.logger.warning("[Artisan] Bedrock pack ${file.name} refused by Geyser: ${e.message}")
            }
        }
    }
}
