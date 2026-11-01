package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.variable.VariableRegistry
import org.bukkit.entity.Player

/**
 * The `var` binding of every context (ADR `triggers-and-variables` §10): `var.<module>.<name>` reads
 * a module Variable for the context's player, `var.<module>.<name>["<key>"]` a keyed one. Nothing is
 * read before a path asks for it, and every read goes to the module's resolver: Artisan holds no copy.
 */
object ModuleVariableValues {
    /** `api.variables`, bound once the API exists; null: no `var` binding (tests, the editor's preview). */
    @Volatile
    var registry: VariableRegistry? = null

    /** The `var` value for [player], or null when no registry is bound. */
    fun forPlayer(player: Player): Map<String, Any?>? = registry?.let { Root(it, player) }

    private class Root(private val registry: VariableRegistry, private val player: Player) : AbstractMap<String, Any?>() {
        override fun get(key: String): Any? =
            if (registry.registered().any { it.moduleId == key }) Module(registry, player, key) else null

        override fun containsKey(key: String): Boolean = registry.registered().any { it.moduleId == key }

        override val entries: Set<Map.Entry<String, Any?>>
            get() = registry.registered().map { it.moduleId }.distinct()
                .associateWith<String, Any?> { Module(registry, player, it) }.entries
    }

    private class Module(
        private val registry: VariableRegistry,
        private val player: Player,
        private val moduleId: String,
    ) : AbstractMap<String, Any?>() {
        override fun get(key: String): Any? {
            val variable = registry.find("$moduleId.$key") ?: return null
            return if (variable.declaration.key != null) Keyed(registry, player, variable.qualifiedName)
            else registry.read(player, variable.qualifiedName, null)
        }

        override fun containsKey(key: String): Boolean = registry.find("$moduleId.$key") != null

        override val entries: Set<Map.Entry<String, Any?>>
            get() = registry.registered().filter { it.moduleId == moduleId }
                .associate { it.declaration.name to get(it.declaration.name) }.entries
    }

    /** A keyed variable: indexed by its key, it reads the value; it lists nothing. */
    private class Keyed(
        private val registry: VariableRegistry,
        private val player: Player,
        private val name: String,
    ) : AbstractMap<String, Any?>() {
        override fun get(key: String): Any? = registry.read(player, name, key)

        override fun containsKey(key: String): Boolean = get(key) != null

        override val entries: Set<Map.Entry<String, Any?>> get() = emptySet()
    }
}
