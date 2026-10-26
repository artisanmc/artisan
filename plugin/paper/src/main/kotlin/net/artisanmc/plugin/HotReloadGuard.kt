package net.artisanmc.plugin

/**
 * Paper cannot unload a plugin: a plugin reloader (PlugMan...) does it by reflection, and a plugin
 * that uses the classes of the reloaded jar keeps the old ones, closed. Nothing fixes that from the
 * inside; the guard names the plugins left in that state and what to do, instead of a silent break.
 */
internal object HotReloadGuard {
    /** A plugin as the guard sees it: its name, whether it runs, and the plugins it depends on. */
    data class Entry(val name: String, val enabled: Boolean, val dependsOn: Set<String>)

    /**
     * The enabled plugins that depend on [name], directly or through one another (MSQuests, then
     * the plugin that uses MSQuests), nearest first. Names compare without case, as Bukkit does.
     */
    fun dependents(name: String, plugins: List<Entry>): List<String> {
        val found = mutableListOf<String>()
        val seen = mutableSetOf(name.lowercase())
        var frontier = setOf(name.lowercase())
        while (frontier.isNotEmpty()) {
            val next = plugins.filter { p ->
                p.enabled && p.name.lowercase() !in seen && p.dependsOn.any { it.lowercase() in frontier }
            }
            next.forEach { seen += it.name.lowercase(); found += it.name }
            frontier = next.map { it.name.lowercase() }.toSet()
        }
        return found
    }

    /** Artisan enabling while plugins that depend on it already run: Artisan was reloaded, they were not. */
    fun reloadedWarning(dependents: List<String>): String? = dependents.takeIf { it.isNotEmpty() }?.let {
        "[Artisan] Artisan was enabled while ${it.joinToString()} already ran: a plugin reloader reloaded it. " +
            "They keep the previous Artisan and stay broken (menus, actions, data sources) until the server restarts. " +
            "Restart the server to update Artisan, never reload it."
    }

    /** [disabled] going away while the server keeps running, and the plugins that still use it. */
    fun disabledWarning(disabled: String, dependents: List<String>): String? = dependents.takeIf { it.isNotEmpty() }?.let {
        "[Artisan] $disabled is disabled while the server keeps running, and ${it.joinToString()} still use it: " +
            "they keep its old classes until the server restarts. To reload $disabled, disable them first and enable them " +
            "after it, in that order; or restart the server."
    }
}
