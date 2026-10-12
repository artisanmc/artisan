package net.artisanmc.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class ItemsAdderSource(@Suppress("UNUSED_PARAMETER") pluginsDir: File) : CustomItemSource {
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
                val id = stack?.javaClass?.getMethod("getId")?.invoke(stack) as? String
                    ?: return@mapNotNull null
                CustomItemEntry(id = "itemsadder:$id", label = id, category = "itemsadder")
            }
        } catch (_: Exception) { emptyList() }
    }
}
