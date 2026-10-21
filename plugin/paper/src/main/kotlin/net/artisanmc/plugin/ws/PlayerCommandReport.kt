package net.artisanmc.plugin.ws

import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry

/**
 * Builds the `player_commands` wire payload sent in `hello` / `modules_changed`: the commands
 * modules declare, with their default dressing, which the editor's System section shows and an
 * admin's `command_override/v1` changes. No executor: the editor only edits the dressing.
 */
object PlayerCommandReport {
    fun build(registry: PlayerCommandRegistry): List<Map<String, Any?>> =
        registry.declarations().map { wire(it, registry.ownerOf(it.id)) }

    fun wire(declaration: PlayerCommandDeclaration, moduleId: String?): Map<String, Any?> = linkedMapOf(
        "id" to declaration.id,
        "module_id" to moduleId,
        "name" to declaration.name,
        "aliases" to declaration.aliases,
        "permission" to declaration.permission,
        "description" to declaration.description,
        "arguments" to declaration.arguments.map {
            linkedMapOf(
                "name" to it.name,
                "type" to it.type.name.lowercase(),
                "required" to it.isRequired,
                "values" to it.values,
            )
        },
        "console_allowed" to declaration.isConsoleAllowed,
        "children" to declaration.children.map { wire(it, moduleId) },
    )
}
