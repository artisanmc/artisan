package net.artisanmc.plugin.engine

/**
 * Canonical menu/v1 execution tree of a click (or a command): a sequence of flat
 * actions and if / else-if / else branches.
 */
sealed class Step {
    /**
     * One action of the chain, as the wire names it (ADR `structured-action-wire`): the
     * action's [name] (`open_menu`, `quests:start`) and its wire [value] — null for a bare
     * name, a scalar for the primary argument, a map of arguments. The engine folds the
     * value into the declared arguments at dispatch ([net.artisanmc.modules.api.action.ActionDeclaration.normalize]);
     * the core knows no action by name (ADR `extensible-document-kinds`, R1).
     *
     * [i18n] holds the canonical i18n ADDRESS of the text arguments stamped by
     * [assignI18nAddresses] (legacy DSL inline mode), keyed by argument name.
     */
    data class ActionStep(
        val name: String,
        val value: Any? = null,
        val i18n: Map<String, String> = emptyMap(),
    ) : Step()

    data class IfStep(val cases: List<IfCase>, val elseSteps: List<Step> = emptyList()) : Step()
}

/**
 * One case of a [Step.IfStep]. `joins` holds the operators ("and"/"or") between
 * consecutive conditions, evaluated left to right without precedence; missing or
 * shorter than needed = "and".
 */
data class IfCase(
    val conditions: List<Condition>,
    val joins: List<String> = emptyList(),
    val steps: List<Step> = emptyList(),
)
