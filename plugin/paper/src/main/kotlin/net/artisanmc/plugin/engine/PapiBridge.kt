package net.artisanmc.plugin.engine

import me.clip.placeholderapi.expansion.PlaceholderExpansion
import net.artisanmc.modules.api.PlaceholderResolver
import org.bukkit.OfflinePlayer
import org.bukkit.plugin.Plugin

/** Only loaded when PlaceholderAPI is enabled. */
internal object PapiBridge {
    fun register(namespace: String, plugin: Plugin, resolver: PlaceholderResolver): Any? =
        Expansion(namespace, plugin, resolver).takeIf { it.register() }

    fun unregister(expansion: Any) {
        (expansion as PlaceholderExpansion).unregister()
    }

    private class Expansion(
        private val namespace: String,
        private val plugin: Plugin,
        private val resolver: PlaceholderResolver,
    ) : PlaceholderExpansion() {
        override fun getIdentifier() = namespace
        override fun getAuthor() = plugin.name
        override fun getVersion(): String = plugin.description.version
        override fun persist() = true
        override fun onRequest(player: OfflinePlayer?, params: String): String? = resolver.resolve(player?.player, params)
    }
}
