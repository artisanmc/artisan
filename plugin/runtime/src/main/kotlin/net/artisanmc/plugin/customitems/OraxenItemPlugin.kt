package net.artisanmc.plugin.customitems

import org.bukkit.inventory.ItemStack

object OraxenItemPlugin : CustomItemPlugin {
    private const val API = "io.th0rgal.oraxen.api.OraxenItems"

    override val namespace = "oraxen"
    override val pluginName = "Oraxen"
    override val itemsLoadedEvent = "io.th0rgal.oraxen.api.events.OraxenItemsLoadedEvent"

    override fun hasApi() = hasClass(API)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val oraxenItems = Class.forName(API)
            @Suppress("UNCHECKED_CAST")
            val entries = oraxenItems.getMethod("getEntries").invoke(null) as Set<Map.Entry<String, *>>
            entries.map { (id, _) ->
                CustomItemEntry(id = "oraxen:$id", label = id, category = "oraxen")
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val oraxenItems = Class.forName(API)
        val builder = oraxenItems.getMethod("getItemById", String::class.java).invoke(null, id)
            ?: return@runCatching null
        (builder.javaClass.getMethod("build").invoke(builder) as ItemStack)
            .also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()
}
