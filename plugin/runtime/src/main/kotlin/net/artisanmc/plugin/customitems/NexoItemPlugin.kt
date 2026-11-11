package net.artisanmc.plugin.customitems

import org.bukkit.inventory.ItemStack
import java.util.logging.Logger

private val log = Logger.getLogger("Artisan")

object NexoItemPlugin : CustomItemPlugin {
    private const val API = "com.nexomc.nexo.api.NexoItems"

    override val namespace = "nexo"
    override val pluginName = "Nexo"
    // Fires on /nexo reload.
    override val itemsLoadedEvent = "com.nexomc.nexo.api.events.NexoItemsLoadedEvent"

    override fun hasApi() = hasClass(API)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val nexoItems = Class.forName(API)
            @Suppress("UNCHECKED_CAST")
            val names = nexoItems.getMethod("itemNames").invoke(null) as Collection<String>
            log.info("[Artisan] Nexo: ${names.size} item name(s)")
            names.map { id -> CustomItemEntry(id = "nexo:$id", label = id, category = "nexo") }
        } catch (e: Exception) {
            log.warning("[Artisan] Nexo items not listed: ${e.javaClass.name}: ${e.message}")
            emptyList()
        }
    }

    override fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val nexoItems = Class.forName(API)
        val builder = nexoItems.getMethod("itemFromId", String::class.java).invoke(null, id)
            ?: return@runCatching null
        (builder.javaClass.getMethod("getFinalItemStack").invoke(builder) as ItemStack)
            .clone().also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()

    override fun idFrom(stack: ItemStack): String? = runCatching {
        val nexoItems = Class.forName(API)
        nexoItems.getMethod("idFromItem", ItemStack::class.java).invoke(null, stack) as? String
    }.getOrNull()
}
