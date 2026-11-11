package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.variable.VariableScope
import org.bukkit.entity.Player

/**
 * The Project variables of the server (ADR `triggers-and-variables` §5): their declarations, read
 * from every project's `variables/`, and their values in [store]. Reads go through the `var`
 * binding ([ModuleVariableValues]) and `has_var`; writes through `set_var`, `add_var`, `clear_var`
 * ([VariableActions]). Bound once by the `variables` module ([ModuleVariableValues.projects]).
 */
class ProjectVariables(val store: VariableStore) {
    init {
        store.decode = ::decode
    }

    /** Declarations by qualified ref `project/id`; replaced whole at each reload. */
    @Volatile
    var definitions: Map<String, ProjectVariable> = emptyMap()

    /** Called after a write that changed a value: fires `variable_changed` (paper). */
    @Volatile
    var onChange: ((player: Player, variable: ProjectVariable) -> Unit)? = null

    /** Reads the declarations when nothing read them yet (a chain run before the first reload); the `variables` module's. */
    @Volatile
    var ensureLoaded: () -> Unit = {}

    /** [name] (`id` in [projectId], or `project/id`), or null. */
    fun find(projectId: String?, name: String): ProjectVariable? {
        ensureLoaded()
        return if ('/' in name) definitions[name] else projectId?.let { definitions["$it/$name"] }
    }

    /** Every declaration of [projectId]. */
    fun of(projectId: String): List<ProjectVariable> {
        ensureLoaded()
        return definitions.values.filter { it.projectId == projectId }
    }

    fun owner(variable: ProjectVariable, player: Player): String =
        if (variable.scope == VariableScope.SERVER) VariableStore.SERVER else player.uniqueId.toString()

    /** The stored value for [player], else the declared default, else null. */
    fun read(variable: ProjectVariable, player: Player): Any? =
        store.get(variable.ref, owner(variable, player)) ?: variable.default

    /** True when a value is stored and not expired: the default does not count. */
    fun has(variable: ProjectVariable, player: Player): Boolean = store.get(variable.ref, owner(variable, player)) != null

    fun set(variable: ProjectVariable, player: Player, value: Any) {
        val before = store.get(variable.ref, owner(variable, player))
        store.set(variable.ref, owner(variable, player), value, variable.expiresSeconds)
        if (before != value) onChange?.invoke(player, variable)
    }

    fun clear(variable: ProjectVariable, player: Player) {
        if (store.clear(variable.ref, owner(variable, player))) onChange?.invoke(player, variable)
    }

    /** `add_var`: current value (or the default, or 0) plus [amount], in one step. */
    fun add(variable: ProjectVariable, player: Player, amount: Double): Double? {
        val next = store.update(variable.ref, owner(variable, player), variable.expiresSeconds) { current ->
            ((current ?: variable.default) as? Number ?: 0.0).toDouble() + amount
        } as? Double
        if (next != null && amount != 0.0) onChange?.invoke(player, variable)
        return next
    }

    /** A stored JSON value of [ref] as its Variable's type, or null (unknown Variable, type changed). */
    fun decode(ref: String, json: String): Any? =
        definitions[ref]?.let { ProjectVariable.decode(it.type, json) }
}
