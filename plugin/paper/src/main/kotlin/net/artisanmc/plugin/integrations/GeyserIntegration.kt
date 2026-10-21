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
 * Geyser on a proxy (Velocity, BungeeCord) is not reached from here: those
 * players get the chest Geyser translates, as without this integration.
 */
class GeyserIntegration(private val plugin: JavaPlugin) {
    @Volatile private var bridge: GeyserBridge? = null
    @Volatile private var pack: File? = null

    val available: Boolean get() = bridge != null

    fun start() {
        if (plugin.server.pluginManager.getPlugin("Geyser-Spigot") == null) return
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

    fun isBedrock(player: Player): Boolean = bridge?.isBedrock(player.uniqueId) == true

    private fun writeMappings(configDirectory: File) {
        val file = File(configDirectory, "custom_mappings/artisan.json")
        if (file.isFile && file.readText() == MAPPINGS) return
        file.parentFile.mkdirs()
        file.writeText(MAPPINGS)
        plugin.logger.warning("[Artisan] Wrote ${file.path}: restart the server once so Geyser loads the mapping of image buttons")
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
