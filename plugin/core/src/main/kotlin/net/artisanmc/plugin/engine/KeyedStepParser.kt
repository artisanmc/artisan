package net.artisanmc.plugin.engine


/**
 * Parser for the **name-keyed structured** action wire (ADR `structured-action-wire`).
 * An action is `{ <name>: args }`, a condition `{ <name>: args }`; `if` is a list
 * (implicit AND), `or:`/`and:` a list, `not:` a condition; text is a [LocalizedText].
 *
 * Tolerant read: a **string** handler is the old Action DSL; a `{steps: "<dsl>"}`
 * object is the legacy wrapped form; a **string list entry** is an action without
 * arguments. An action is kept as its name and wire value ([Step.ActionStep]): the
 * vocabulary lives in the action registry, not here. The parser never throws: an
 * invalid entry is ignored, like the rest of the bundle loader.
 */
object KeyedStepParser {

    /**
     * Parse a **keyed** wire (map = single step, list = steps). A string is an action
     * without arguments (for list entries, not a whole handler: a string handler is
     * the old DSL, see [ActionChainCompiler]).
     */
    fun parseKeyed(raw: Any?): List<Step> = when (raw) {
        null -> emptyList()
        is List<*> -> raw.mapNotNull { parseStep(it) }
        is Map<*, *> -> listOfNotNull(parseStep(raw))
        is String -> listOfNotNull(parseStep(raw))
        else -> emptyList()
    }

    private fun parseStep(raw: Any?): Step? = when {
        raw is String -> Step.ActionStep(raw)
        raw is Map<*, *> ->
            if (raw.containsKey("if")) parseIf(raw)
            // An action is its wire name and its value: the engine binds the value to the
            // declared arguments at dispatch, so an unknown name (a module's action) passes
            // through here and is reported when it runs.
            else singleEntry(raw)?.let { (name, value) -> Step.ActionStep(name, value) }
        else -> null
    }

    private fun parseIf(root: Map<*, *>): Step {
        var node: Map<*, *> = root
        val cases = mutableListOf<IfCase>()
        var elseSteps: List<Step> = emptyList()
        var guard = 0
        while (guard++ < 64) {
            cases += IfCase(
                conditions = asList(node["if"]).mapNotNull { parseCondition(it) },
                steps = asList(node["do"]).mapNotNull { parseStep(it) },
            )
            val els = asList(node["else"])
            val first = els.firstOrNull()
            if (els.size == 1 && first is Map<*, *> && first.containsKey("if")) {
                node = first
                continue
            }
            elseSteps = els.mapNotNull { parseStep(it) }
            break
        }
        return Step.IfStep(cases, elseSteps)
    }

    /** Parse a list of keyed (or legacy `{type}`) conditions: an appearance's `if`. */
    fun parseConditions(raw: Any?): List<Condition> = asList(raw).mapNotNull { parseCondition(it) }

    @Suppress("UNCHECKED_CAST")
    private fun parseCondition(raw: Any?): Condition? {
        val m = raw as? Map<*, *> ?: return null
        // Legacy type-tagged form (`{type: "has_permission", perm: …}`).
        if (m.containsKey("type")) return runCatching { ConditionParser.parse(m as Map<String, Any>) }.getOrNull()
        val (name, value) = singleEntry(m) ?: return null
        val o = value as? Map<*, *>
        fun arg(k: String): String? = o?.get(k)?.toString()
        return when (name) {
            "has_permission" -> Condition.HasPermission(value?.toString() ?: "")
            "has_money" -> Condition.HasMoney((value as? Number)?.toDouble() ?: numOrZero(o?.get("amount")), arg("currency"))
            "has_item" -> Condition.HasItem(arg("material") ?: "", (o?.get("count") as? Number)?.toInt() ?: 1)
            "has_xp" -> Condition.HasXp(num(value))
            "has_level" -> Condition.HasLevel(num(value))
            "world_is" -> Condition.WorldIs(value?.toString() ?: "")
            "random_chance" -> Condition.RandomChance((value as? Number)?.toDouble() ?: 0.0)
            "cooldown_passed" -> Condition.CooldownPassed(value?.toString() ?: "")
            "player_in_region" -> Condition.PlayerInRegion(value?.toString() ?: "")
            "time_is" ->
                if (value is Map<*, *>)
                    Condition.TimeIs("${(value["from_ticks"] as? Number)?.toLong()}-${(value["to_ticks"] as? Number)?.toLong()}")
                else Condition.TimeIs(value?.toString() ?: "day")
            "placeholder_equals" -> Condition.PlaceholderEquals(arg("placeholder") ?: "", arg("value") ?: "")
            "placeholder_match" -> Condition.PlaceholderMatch(arg("placeholder") ?: "", arg("regex") ?: "")
            "pagination_at_first" -> Condition.PaginationAtFirst((value as? String)?.ifEmpty { null })
            "pagination_at_last" -> Condition.PaginationAtLast((value as? String)?.ifEmpty { null })
            "expression" -> Condition.Expression(value?.toString() ?: "")
            "not" -> parseCondition(value)?.let { Condition.Not(it) }
            "and" -> Condition.And(asList(value).mapNotNull { parseCondition(it) })
            "or" -> Condition.Or(asList(value).mapNotNull { parseCondition(it) })
            else -> null
        }
    }

    private fun asList(v: Any?): List<*> = when (v) {
        null -> emptyList<Any?>()
        is List<*> -> v
        else -> listOf(v)
    }

    private fun singleEntry(m: Map<*, *>): Pair<String, Any?>? {
        if (m.size != 1) return null
        val e = m.entries.first()
        return e.key.toString() to e.value
    }

    private fun num(v: Any?): Int = (v as? Number)?.toInt() ?: 0
    private fun numOrZero(v: Any?): Double = (v as? Number)?.toDouble() ?: 0.0
}
