package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.variable.VariableRegistry
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
        private val player: Player,
        private val projectId: String?,
    ) : AbstractMap<String, Any?>() {
        private fun project(key: String) = projects?.find(projectId, key)

        private fun isModule(key: String) = registry?.registered()?.any { it.moduleId == key } == true

        override fun get(key: String): Any? {
            project(key)?.let { return projects!!.read(it, player) }
            val registry = registry ?: return null
            return if (isModule(key)) Module(registry, player, key) else null
        }

        override fun containsKey(key: String): Boolean = project(key) != null || isModule(key)

        override val entries: Set<Map.Entry<String, Any?>>
            get() {
                val out = LinkedHashMap<String, Any?>()
                registry?.let { r -> r.registered().map { it.moduleId }.distinct().forEach { out[it] = Module(r, player, it) } }
                projectId?.let { id -> projects?.of(id)?.forEach { out[it.id] = projects.read(it, player) } }
                return out.entries
            }
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
