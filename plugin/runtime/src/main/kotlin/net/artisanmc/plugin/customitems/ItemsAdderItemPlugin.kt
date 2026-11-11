package net.artisanmc.plugin.customitems

import org.bukkit.inventory.ItemStack

object ItemsAdderItemPlugin : CustomItemPlugin {
    private const val API = "dev.lone.itemsadder.api.CustomStack"

    override val namespace = "itemsadder"
    override val pluginName = "ItemsAdder"
    override val itemsLoadedEvent = "dev.lone.itemsadder.api.Events.CustomItemsLoadedEvent"

    override fun hasApi() = hasClass(API)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val csClass = Class.forName(API)
            @Suppress("UNCHECKED_CAST")
            val items = csClass.getMethod("getAllItems").invoke(null) as Collection<*>
            items.mapNotNull { stack ->
                val id = stack?.javaClass?.getMethod("getId")?.invoke(stack) as? String
                    ?: return@mapNotNull null
                CustomItemEntry(id = "itemsadder:$id", label = id, category = "itemsadder")
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val customStack = Class.forName(API)
        val instance = customStack.getMethod("getInstance", String::class.java).invoke(null, id)
            ?: return@runCatching null
        (instance.javaClass.getMethod("getItemStack").invoke(instance) as ItemStack)
            .clone().also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()
}
