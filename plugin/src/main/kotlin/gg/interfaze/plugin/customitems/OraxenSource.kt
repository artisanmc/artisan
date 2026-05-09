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
                CustomItemEntry(
                    id = "oraxen:$id",
                    label = id,
                    texturePath = "oraxen/$id",
                    modelJson = loadModelJson(id),
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        val id = texturePath.removePrefix("oraxen/")
        val name = id.substringAfterLast("/")
        val packDir = File(pluginsDir, "Oraxen/pack")
        if (!packDir.exists()) return null
        val candidates = listOf(
            File(packDir, "assets/oraxen/textures/item/$id.png"),
            File(packDir, "assets/oraxen/textures/$id.png"),
        )
        candidates.firstOrNull { it.exists() }?.let { return it.readBytes() }
        return packDir.walkTopDown()
            .firstOrNull { it.isFile && it.name == "$name.png" && it.path.contains("textures") }
            ?.readBytes()
    }

    private fun loadModelJson(id: String): String? {
        val packDir = File(pluginsDir, "Oraxen/pack")
        val candidates = listOf(
            File(packDir, "assets/oraxen/models/item/$id.json"),
            File(packDir, "assets/oraxen/models/$id.json"),
        )
        return candidates.firstOrNull { it.exists() }?.readText()
    }
}
