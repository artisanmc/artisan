package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class OraxenSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "oraxen"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Oraxen") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val oraxenItems = Class.forName("io.th0rgal.oraxen.api.OraxenItems")
            @Suppress("UNCHECKED_CAST")
            val entries = oraxenItems.getMethod("getEntries").invoke(null) as Set<Map.Entry<String, *>>
            entries.mapNotNull { (id, _) ->
                CustomItemEntry(id = "oraxen:$id", label = id, texturePath = "oraxen/$id")
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        val id = texturePath.removePrefix("oraxen/")
        // Oraxen generates its resource pack at plugins/Oraxen/pack/
        val packDir = File(pluginsDir, "Oraxen/pack")
        val candidates = listOf(
            File(packDir, "assets/oraxen/textures/item/$id.png"),
            File(packDir, "assets/oraxen/textures/$id.png"),
        )
        return candidates.firstOrNull { it.exists() }?.readBytes()
    }
}
