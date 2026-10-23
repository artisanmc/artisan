package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.model.LocalizedText

data class CompiledCommand(
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: LocalizedText?,
    val argDefs: List<ArgDef>,
    val handler: ClickHandler,
    /** Enabled sub-commands, matched by name or alias before [argDefs]. */
    val children: List<CompiledCommand> = emptyList(),
    /** `console: true`: the console may run it, through its single `module_command`. */
    val console: Boolean = false,
) {
    /** The enabled sub-command typed as [token], by name or alias. */
    fun child(token: String): CompiledCommand? =
        children.firstOrNull { c -> c.name.equals(token, ignoreCase = true) || c.aliases.any { it.equals(token, ignoreCase = true) } }

    /** No actions of its own: typing it shows its sub-commands. */
    val isGroup: Boolean get() = children.isNotEmpty() && handler.steps.isEmpty()
}
