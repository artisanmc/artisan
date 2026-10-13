package net.artisanmc.plugin.engine

/**
 * Canonical menu/v1 execution tree of a click (or a command): a sequence of flat
 * actions and if / else-if / else branches.
 */
sealed class Step {
    data class ActionStep(val action: Action) : Step()
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

object StepParser {
    fun parseAll(raw: List<Map<String, Any>>): List<Step> = raw.map { parse(it) }

    @Suppress("UNCHECKED_CAST")
    fun parse(raw: Map<String, Any>): Step = when (val kind = raw["kind"]?.toString()) {
        "action" -> {
            val action = raw["action"] as? Map<String, Any>
                ?: throw IllegalArgumentException("Step kind 'action' missing 'action' map: $raw")
            Step.ActionStep(ActionParser.parse(action))
        }
        "if" -> {
            val cases = (raw["cases"] as? List<*>).orEmpty().map { case ->
                val m = case as Map<String, Any>
                IfCase(
                    conditions = (m["conditions"] as? List<*>).orEmpty()
                        .map { ConditionParser.parse(it as Map<String, Any>) },
                    joins = (m["joins"] as? List<*>).orEmpty().map { it.toString() },
                    steps = parseAll((m["steps"] as? List<*>).orEmpty().map { it as Map<String, Any> }),
                )
            }
            val elseSteps = parseAll((raw["else"] as? List<*>).orEmpty().map { it as Map<String, Any> })
            Step.IfStep(cases, elseSteps)
        }
        else -> throw IllegalArgumentException("Unknown step kind: $kind")
    }
}
