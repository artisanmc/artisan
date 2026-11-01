package net.artisanmc.plugin.command

import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.SubcommandYaml

/**
 * A command's file in a variant (`variants/<name>/commands/<id>.yml`, design `variantes-modules`
 * §17): only what runs, on the module's command. What is registered (name, aliases, permission,
 * arguments, description, cooldown) stays the module's, shared by every variant.
 *
 * ```yaml
 * schema: command/v1
 * actions: open_menu guild_home
 * subcommands:
 *   - name: info          # finds the module's node, never adds one
 *     actions: open_menu info
 * ```
 */
object CommandVariant {
    /** What a variant may set on a node, the root included. */
    val STEPS = listOf("actions", "requirements", "fallback")

    /** Problems are `variant_command_key: <path>.<key>` and `variant_command_node: <path>`. */
    data class Merged(val command: CommandYaml?, val problems: List<String>)

    /** [base] with the steps of [raw]; null with problems when [raw] sets anything else. */
    fun merge(base: CommandYaml, raw: Map<*, *>): Merged {
        val problems = ArrayList<String>()
        val root = base.name.ifEmpty { base.id }
        for (key in raw.keys) {
            if (key != "schema" && key != "subcommands" && key !in STEPS) problems += "variant_command_key: $root.$key"
        }
        val children = merge(base.subcommands, raw["subcommands"], root, problems)
        if (problems.isNotEmpty()) return Merged(null, problems)
        var out = base.copy(subcommands = children)
        if ("actions" in raw) out = out.copy(actions = raw["actions"], steps = "")
        if ("requirements" in raw) out = out.copy(requirements = requirements(raw["requirements"], root, problems))
        if ("fallback" in raw) out = out.copy(fallback = raw["fallback"])
        return if (problems.isEmpty()) Merged(out, emptyList()) else Merged(null, problems)
    }

    private fun merge(nodes: List<SubcommandYaml>, raw: Any?, path: String, problems: MutableList<String>): List<SubcommandYaml> {
        if (raw == null) return nodes
        val list = raw as? List<*> ?: run {
            problems += "variant_command_key: $path.subcommands"
            return nodes
        }
        val byName = HashMap<String, Map<*, *>>()
        for (entry in list) {
            val map = entry as? Map<*, *>
            val name = (map?.get("name") as? String)?.trim()?.lowercase()
            val node = name?.let { n -> nodes.firstOrNull { it.name.trim().lowercase() == n } }
            if (map == null || name == null || node == null || name in byName) {
                problems += "variant_command_node: $path ${name ?: "?"}"
                continue
            }
            for (key in map.keys) {
                if (key != "name" && key != "subcommands" && key !in STEPS) problems += "variant_command_key: $path $name.$key"
            }
            byName[name] = map
        }
        return nodes.map { node ->
            val map = byName[node.name.trim().lowercase()] ?: return@map node
            val nodePath = "$path ${node.name.trim().lowercase()}"
            var out = node.copy(subcommands = merge(node.subcommands, map["subcommands"], nodePath, problems))
            if ("actions" in map) out = out.copy(actions = map["actions"])
            if ("requirements" in map) out = out.copy(requirements = requirements(map["requirements"], nodePath, problems))
            if ("fallback" in map) out = out.copy(fallback = map["fallback"])
            out
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun requirements(raw: Any?, path: String, problems: MutableList<String>): List<Map<String, Any>> {
        if (raw == null) return emptyList()
        val list = raw as? List<*>
        if (list == null || list.any { it !is Map<*, *> }) {
            problems += "variant_command_key: $path.requirements"
            return emptyList()
        }
        return list as List<Map<String, Any>>
    }
}
