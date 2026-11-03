package net.artisanmc.modules.variables

import net.artisanmc.modules.api.placeholder.PlaceholderResolver
import net.artisanmc.modules.api.variable.VariableRegistry
import net.artisanmc.plugin.engine.LocationValue
import net.artisanmc.plugin.engine.ProjectVariables
import org.bukkit.entity.Player

/**
 * `%artisan_var_<name>%` (ADR `triggers-and-variables` §5, §10): a Variable as text, for
 * scoreboards and other plugins. `<name>` is a Project variable `project/id` (or its bare `id`
 * when one project alone declares it), or a module Variable `module.name`, keyed as
 * `module.name:key`. Absent: an empty text.
 */
internal class VariablePlaceholders(
    private val projects: () -> ProjectVariables?,
    private val registry: () -> VariableRegistry,
) : PlaceholderResolver {
    override fun resolve(player: Player?, key: String): String? {
        if (player == null || !key.startsWith(PREFIX)) return null
        val name = key.removePrefix(PREFIX)
        return format(read(player, name))
    }

    private fun read(player: Player, name: String): Any? {
        val p = projects()
        if (p != null) {
            p.ensureLoaded()
            val variable = if ('/' in name) p.definitions[name]
            else p.definitions.values.filter { it.id == name }.singleOrNull()
            if (variable != null) return p.read(variable, player)
        }
        val qualified = name.substringBefore(':')
        val variableKey = name.substringAfter(':', "").ifEmpty { null }
        return registry().read(player, qualified, variableKey)
    }

    companion object {
        const val PREFIX = "var_"

        fun format(value: Any?): String = when (value) {
            null -> ""
            is LocationValue -> value.toString()
            is Double -> if (value == Math.floor(value) && !value.isInfinite()) value.toLong().toString() else value.toString()
            else -> value.toString()
        }
    }
}
