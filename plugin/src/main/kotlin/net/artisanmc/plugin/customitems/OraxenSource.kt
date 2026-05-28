package net.artisanmc.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class OraxenSource(@Suppress("UNUSED_PARAMETER") pluginsDir: File) : CustomItemSource {
    override val namespace = "oraxen"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Oraxen") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val oraxenItems = Class.forName("io.th0rgal.oraxen.api.OraxenItems")
            @Suppress("UNCHECKED_CAST")
            val entries = oraxenItems.getMethod("getEntries").invoke(null) as Set<Map.Entry<String, *>>
            entries.map { (id, _) ->
                CustomItemEntry(id = "oraxen:$id", label = id, category = "oraxen")
            }
        } catch (_: Exception) { emptyList() }
    }
}
