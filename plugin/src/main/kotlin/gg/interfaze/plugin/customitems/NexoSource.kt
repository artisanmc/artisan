package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class NexoSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "nexo"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Nexo") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
            @Suppress("UNCHECKED_CAST")
            val names = nexoItems.getMethod("itemNames").invoke(null) as Collection<String>
            names.mapNotNull { id ->
                val itemObj = nexoItems.getMethod("itemFromId", String::class.java).invoke(null, id)
                    ?: return@mapNotNull null
                val displayName = try {
                    val stack = itemObj.javaClass.getMethod("itemStack").invoke(itemObj)
                    val meta = (stack as org.bukkit.inventory.ItemStack).itemMeta
                    meta?.displayName()?.let { net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(it) }
                        ?: id
                } catch (_: Exception) { id }
                CustomItemEntry(id = "nexo:$id", label = displayName, texturePath = "nexo/$id")
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        val id = texturePath.removePrefix("nexo/")
        // Nexo generates its resource pack at plugins/Nexo/pack/
        // Textures follow: assets/nexo/textures/item/{id}.png
        val packDir = File(pluginsDir, "Nexo/pack")
        val candidates = listOf(
            File(packDir, "assets/nexo/textures/item/$id.png"),
            File(packDir, "assets/nexo/textures/$id.png"),
        )
        return candidates.firstOrNull { it.exists() }?.readBytes()
    }
}
