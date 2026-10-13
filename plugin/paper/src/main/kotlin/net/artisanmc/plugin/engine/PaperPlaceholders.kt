package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.PlaceholderRegistry
import net.artisanmc.modules.api.PlaceholderResolver
import org.bukkit.entity.Player
import org.bukkit.plugin.Plugin
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Level

/**
 * `api.placeholders`. Survives `/artisan reload`; each runtime's [SoftDepRegistry]
 * resolves `%…%` through [pipeline], so menus see the namespaces before PlaceholderAPI.
 */
class PaperPlaceholders(private val plugin: Plugin) : PlaceholderRegistry {
    private val resolvers = ConcurrentHashMap<String, PlaceholderResolver>()

    /** PlaceholderAPI expansions, typed `Any` so this class loads without PlaceholderAPI. */
    private val expansions = ConcurrentHashMap<String, Any>()
    private val papi by lazy { PapiProvider.tryInit() }

    override fun register(namespace: String, resolver: PlaceholderResolver) = register(namespace, resolver, false)

    override fun register(namespace: String, resolver: PlaceholderResolver, exposeToPapi: Boolean) {
        require(isPlaceholderNamespace(namespace)) { "Placeholder namespace '$namespace' must match [a-z][a-z0-9]*" }
        check(resolvers.putIfAbsent(namespace, resolver) == null) { "Placeholder namespace '$namespace' is already registered" }
        if (exposeToPapi && plugin.server.pluginManager.isPluginEnabled("PlaceholderAPI")) {
            try {
                val expansion = PapiBridge.register(namespace, plugin, resolver)
                if (expansion != null) expansions[namespace] = expansion
                else plugin.logger.warning("[Artisan] PlaceholderAPI refused the expansion '$namespace'")
            } catch (e: LinkageError) {
                plugin.logger.log(Level.WARNING, "[Artisan] PlaceholderAPI expansion '$namespace' not registered", e)
            }
        }
    }

    override fun unregister(namespace: String) {
        resolvers.remove(namespace)
        expansions.remove(namespace)?.let { PapiBridge.unregister(it) }
    }

    override fun namespaces(): Set<String> = resolvers.keys.toSet()

    override fun resolve(player: Player, text: String): String = pipeline(papi).resolve(player, text)

    /** The `%…%` resolver menus use: these namespaces, then [delegate] (PlaceholderAPI) if any. */
    fun pipeline(delegate: PapiProvider?): PapiProvider = object : PapiProvider() {
        override fun declaredPlaceholders() = delegate?.declaredPlaceholders() ?: PapiPlaceholderCatalog(emptyList())

        override fun resolve(player: Player, text: String): String {
            val expanded =
                if (resolvers.isEmpty()) text
                else expandPlaceholders(text) { ns, key -> resolvers[ns]?.let { r -> safely(ns) { r.resolve(player, key) } } }
            return delegate?.resolve(player, expanded) ?: expanded
        }
    }

    private fun safely(namespace: String, resolve: () -> String?): String? =
        try {
            resolve()
        } catch (e: Exception) {
            plugin.logger.log(Level.WARNING, "[Artisan] placeholder namespace '$namespace' failed", e)
            null
        }
}
