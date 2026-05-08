package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class ItemsAdderSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "itemsadder"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("ItemsAdder") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val csClass = Class.forName("dev.lone.itemsadder.api.CustomStack")
            @Suppress("UNCHECKED_CAST")
            val items = csClass.getMethod("getAllItems").invoke(null) as Collection<*>
            items.mapNotNull { stack ->
                val id = stack?.javaClass?.getMethod("getId")?.invoke(stack) as? String ?: return@mapNotNull null
                val ns = id.substringBefore(":")
                val name = id.substringAfter(":")
                CustomItemEntry(
                    id = "itemsadder:$id",
                    label = name,
                    texturePath = "itemsadder/$ns/$name",
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        // texturePath = "itemsadder/{namespace}/{name}"
        val parts = texturePath.removePrefix("itemsadder/").split("/", limit = 2)
        if (parts.size < 2) return null
        val (ns, name) = parts
        val packDir = File(pluginsDir, "ItemsAdder/data/resource_pack")
        val candidates = listOf(
            File(packDir, "assets/$ns/textures/item/$name.png"),
            File(packDir, "assets/$ns/textures/$name.png"),
        )
        return candidates.firstOrNull { it.exists() }?.readBytes()
    }
}
