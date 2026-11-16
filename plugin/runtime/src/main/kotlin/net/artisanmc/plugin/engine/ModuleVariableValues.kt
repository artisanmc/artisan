package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.variable.VariableRegistry
import net.artisanmc.modules.api.variable.VariableScope
import org.bukkit.entity.Player

/**
 * The `var` binding of every context (ADR `triggers-and-variables` §5 and §10): `var.<id>` reads a
 * Project variable of the context's project (`var["<project>/<id>"]` one of another project),
 * `var.<module>.<name>` a module Variable for the context's player, `var.<module>.<name>["<key>"]` a
 * keyed one. A Project variable named like a module hides that module's variables in its project.
 * Nothing is read before a path asks for it; module values go to the module's resolver each time.
 */
object ModuleVariableValues {
    /** `api.variables`, bound once the API exists; null: no module variables (tests, the editor's preview). */
    @Volatile
    var registry: VariableRegistry? = null

    /** The Project variables, bound by the `variables` module; null: none. */
    @Volatile
    var projects: ProjectVariables? = null

    /** The `var` value for [player] in [projectId], or null when nothing is bound. */
    fun forPlayer(player: Player, projectId: String? = null): Map<String, Any?>? {
        val registry = registry
        val projects = projects
        if (registry == null && projects == null) return null
        return Root(registry, projects, player, projectId)
    }

    /**
     * The `var` value of an evaluation without a player (`testWithoutPlayer`), or null when nothing
     * is bound: only server-scoped variables answer, a Project variable's stored value and a module
     * Variable declared [VariableScope.SERVER] (its resolver gets a null player, which it ignores);
     * a player-scoped one reads as null.
     */
    fun withoutPlayer(projectId: String? = null): Map<String, Any?>? {
        val registry = registry
        val projects = projects
        if (registry == null && projects == null) return null
        return Root(registry, projects, null, projectId)
    }

    /** [has] without a player: a server-scoped variable holds a value. */
    fun hasWithoutPlayer(projectId: String?, name: String): Boolean {
        val trimmed = name.trim()
        projects?.let { p -> p.find(projectId, trimmed)?.let { return p.hasWithoutPlayer(it) } }
        val registry = registry ?: return false
        val m = KEYED.matchEntire(trimmed) ?: return false
        if (registry.find(m.groupValues[1])?.declaration?.scope != VariableScope.SERVER) return false
        val key = m.groups[2]?.value?.replace(Regex("\\\\(.)"), "$1")
        return read(registry, null, m.groupValues[1], key) != null
    }

    /**
     * [VariableRegistry.read] for [player], or for no player: then only a [VariableScope.SERVER]
     * variable is read, its resolver given null (the Java API types it non-null, a server-scoped
     * resolver ignores it).
     */
    private fun read(registry: VariableRegistry, player: Player?, name: String, key: String?): Any? {
        if (player != null) return registry.read(player, name, key)
        if (registry.find(name)?.declaration?.scope != VariableScope.SERVER) return null
        return registry.read(null, name, key)
    }

    /**
     * True when `has_var` holds for [name]: a Project variable with a stored value, or a module
     * Variable (`<module>.<name>`, `<module>.<name>["<key>"]`) whose module returns one.
     */
    fun has(player: Player, projectId: String?, name: String): Boolean {
        val trimmed = name.trim()
        projects?.let { p -> p.find(projectId, trimmed)?.let { return p.has(it, player) } }
        val registry = registry ?: return false
        val m = KEYED.matchEntire(trimmed) ?: return false
        val key = m.groups[2]?.value?.replace(Regex("\\\\(.)"), "$1")
        return registry.read(player, m.groupValues[1], key) != null
    }

    private val KEYED = Regex("^([a-z][a-z0-9_-]*\\.[a-z][a-z0-9_]*)(?:\\[\"((?:[^\"\\\\]|\\\\.)*)\"])?$")

    private class Root(
        private val registry: VariableRegistry?,
        private val projects: ProjectVariables?,
        /** Null: an evaluation without a player, server-scoped variables only. */
        private val player: Player?,
        private val projectId: String?,
    ) : AbstractMap<String, Any?>() {
        private fun project(key: String) = projects?.find(projectId, key)

        private fun isModule(key: String) = registry?.registered()?.any { it.moduleId == key } == true

        override fun get(key: String): Any? {
            project(key)?.let { return value(it) }
            val registry = registry ?: return null
            return if (isModule(key)) Module(registry, player, key) else null
        }

        override fun containsKey(key: String): Boolean = project(key) != null || isModule(key)

        override val entries: Set<Map.Entry<String, Any?>>
            get() {
                val out = LinkedHashMap<String, Any?>()
                registry?.let { r -> r.registered().map { it.moduleId }.distinct().forEach { out[it] = Module(r, player, it) } }
                projectId?.let { id -> projects?.of(id)?.forEach { out[it.id] = value(it) } }
                return out.entries
            }

        private fun value(variable: ProjectVariable): Any? =
            if (player != null) projects!!.read(variable, player) else projects!!.readWithoutPlayer(variable)
    }

    private class Module(
        private val registry: VariableRegistry,
        private val player: Player?,
        private val moduleId: String,
    ) : AbstractMap<String, Any?>() {
        override fun get(key: String): Any? {
            val variable = registry.find("$moduleId.$key") ?: return null
            return if (variable.declaration.key != null) Keyed(registry, player, variable.qualifiedName)
            else read(registry, player, variable.qualifiedName, null)
        }

        override fun containsKey(key: String): Boolean = registry.find("$moduleId.$key") != null

        override val entries: Set<Map.Entry<String, Any?>>
            get() = registry.registered().filter { it.moduleId == moduleId }
                .associate { it.declaration.name to get(it.declaration.name) }.entries
    }

    /** A keyed variable: indexed by its key, it reads the value; it lists nothing. */
    private class Keyed(
        private val registry: VariableRegistry,
        private val player: Player?,
        private val name: String,
    ) : AbstractMap<String, Any?>() {
        override fun get(key: String): Any? = read(registry, player, name, key)

        override fun containsKey(key: String): Boolean = get(key) != null

        override val entries: Set<Map.Entry<String, Any?>> get() = emptySet()
    }
}
