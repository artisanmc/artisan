package net.artisanmc.plugin.customitems

import org.bukkit.Bukkit
import java.io.File
import java.util.logging.Logger

private val log = Logger.getLogger("Artisan")

class NexoSource(@Suppress("UNUSED_PARAMETER") pluginsDir: File) : CustomItemSource {
    override val namespace = "nexo"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Nexo") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
            @Suppress("UNCHECKED_CAST")
            val names = nexoItems.getMethod("itemNames").invoke(null) as Collection<String>
            log.info("[ART] NexoSource: ${names.size} item name(s) from Nexo")
            names.map { id -> CustomItemEntry(id = "nexo:$id", label = id, category = "nexo") }
        } catch (e: Exception) {
            log.warning("[ART] NexoSource.collectItems() failed: ${e.javaClass.name}: ${e.message}")
            emptyList()
        }
    }
}
