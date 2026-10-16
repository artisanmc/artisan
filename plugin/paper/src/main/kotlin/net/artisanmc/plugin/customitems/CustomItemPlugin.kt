package net.artisanmc.plugin.customitems

import org.bukkit.Bukkit
import org.bukkit.inventory.ItemStack

/**
 * A custom-items plugin (Nexo, Oraxen, ItemsAdder), integrated in one place: the items it
 * lists for the editor ([collectItems]), how a `<namespace>:<id>` material is built
 * ([buildStack]), how a captured stack is recognized ([idFrom]), and the event it fires once
 * its items are (re)loaded ([itemsLoadedEvent]). Everything goes through reflection: none of
 * these plugins is needed to run Artisan.
 */
interface CustomItemPlugin : CustomItemSource {
    /** Its Bukkit plugin name. */
    val pluginName: String

    /** Class name of the event it fires once its items are (re)loaded, looked up only when it is installed. */
    val itemsLoadedEvent: String

    /** Installed: its items are listed. */
    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin(pluginName) != null }.getOrDefault(false)

    /** Its API classes load: [buildStack] and [idFrom] can answer. */
    fun hasApi(): Boolean

    /** The stack of its item [id], [count] at least 1; null when unknown or its API fails. */
    fun buildStack(id: String, count: Int): ItemStack?

    /** Reverse lookup: its id for an arbitrary stack (capture enrichment), null when not one of its items. */
    fun idFrom(stack: ItemStack): String? = null
}

/** The custom-items plugins Artisan integrates, in the order their items are listed and their listeners registered. */
object CustomItemPlugins {
    val ALL: List<CustomItemPlugin> = listOf(NexoItemPlugin, OraxenItemPlugin, ItemsAdderItemPlugin)

    /** Those whose API loads: what menus build stacks with and captures are recognized by. */
    fun withApi(): List<CustomItemPlugin> = ALL.filter { it.hasApi() }
}

internal fun hasClass(name: String): Boolean = runCatching { Class.forName(name) }.isSuccess
