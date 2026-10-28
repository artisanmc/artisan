package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.engine.Step
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

    /** The module command its actions are, alone: what the console may run ([console]). */
    val moduleCommand: String? get() = (handler.steps.singleOrNull() as? Step.ActionStep)?.let(::moduleCommandOf)

    /** The module commands its own chains call (actions and fallback), at any depth. */
    fun moduleCommandsCalled(): Set<String> = (handler.steps + handler.fallback).flatMapTo(linkedSetOf(), ::moduleCommandsIn)

    companion object {
        /** The command id a `module_command` step names (`module_command: id` or `{command: id}`); null for another step. */
        fun moduleCommandOf(step: Step.ActionStep): String? {
            if (step.name != ModuleCommandFiles.ACTION) return null
            val value = step.value
            val id = (value as? Map<*, *>)?.get("command") ?: value
            return (id as? String)?.trim()?.takeIf { it.isNotEmpty() }
        }

        private fun moduleCommandsIn(step: Step): List<String> = when (step) {
            is Step.ActionStep -> listOfNotNull(moduleCommandOf(step))
            is Step.IfStep -> (step.cases.flatMap { it.steps } + step.elseSteps).flatMap(::moduleCommandsIn)
        }
    }
}
