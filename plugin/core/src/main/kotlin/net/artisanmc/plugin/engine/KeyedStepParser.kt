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
 * invalid entry is ignored, like the rest of the Project loader.
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

    /**
     * Strict read of one condition, for a caller that must not let a typo pass
     * (`api.getConditions()`): null when the entry, or a condition nested in it, is
     * unknown, malformed or missing a required argument, where [parseConditions] drops
     * a bad nested entry and defaults a missing argument.
     */
    fun parseConditionStrict(raw: Any?): Condition? =
        parseCondition(raw, strict = true)?.takeIf(::isWellFormed)

    @Suppress("UNCHECKED_CAST")
    private fun parseCondition(raw: Any?, strict: Boolean = false): Condition? {
        val m = raw as? Map<*, *> ?: return null
        // Legacy type-tagged form (`{type: "has_permission", perm: …}`).
        if (m.containsKey("type")) return runCatching { ConditionParser.parse(m as Map<String, Any>) }.getOrNull()
        val (name, value) = singleEntry(m) ?: return null
        val o = value as? Map<*, *>
        fun arg(k: String): String? = o?.get(k)?.toString()
        if (strict && !hasNumbers(name, value, o)) return null
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
            "not" -> parseCondition(value, strict)?.let { Condition.Not(it) }
            "and" -> parseNested(value, strict)?.let { Condition.And(it) }
            "or" -> parseNested(value, strict)?.let { Condition.Or(it) }
            else -> null
        }
    }

    /** `and:` / `or:` operands; strict, an empty list or one bad operand fails the whole. */
    private fun parseNested(value: Any?, strict: Boolean): List<Condition>? {
        val parsed = asList(value).map { parseCondition(it, strict) }
        if (strict && (parsed.isEmpty() || null in parsed)) return null
        return parsed.filterNotNull()
    }

    /** What the tolerant read defaults: blank required strings, an unreadable range or regex. */
    private fun isWellFormed(c: Condition): Boolean = when (c) {
        is Condition.HasPermission -> c.perm.isNotBlank()
        is Condition.HasItem -> c.material.isNotBlank()
        is Condition.WorldIs -> c.world.isNotBlank()
        is Condition.CooldownPassed -> c.cooldownId.isNotBlank()
        is Condition.PlayerInRegion -> c.region.isNotBlank()
        is Condition.PlaceholderEquals -> c.placeholder.isNotBlank()
        is Condition.PlaceholderMatch ->
            c.placeholder.isNotBlank() && runCatching { Regex(c.regex) }.isSuccess
        is Condition.Expression -> c.expr.isNotBlank()
        is Condition.TimeIs -> c.range.lowercase() in setOf("day", "night") ||
            c.range.split("-").let { p -> p.size == 2 && p.all { it.trim().toLongOrNull() != null } }
        is Condition.RandomChance -> c.probability in 0.0..1.0
        is Condition.Not -> isWellFormed(c.inner)
        is Condition.And -> c.all.all(::isWellFormed)
        is Condition.Or -> c.any.all(::isWellFormed)
        is Condition.HasMoney, is Condition.HasXp, is Condition.HasLevel,
        is Condition.PaginationAtFirst, is Condition.PaginationAtLast -> true
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

    /** The numeric arguments the tolerant read turns into 0 when they are not numbers. */
    private fun hasNumbers(name: String, value: Any?, o: Map<*, *>?): Boolean = when (name) {
        "has_xp", "has_level", "random_chance" -> value is Number
        "has_money" -> value is Number || o?.get("amount") is Number
        "has_item" -> o?.get("count").let { it == null || it is Number }
        else -> true
    }

    private fun num(v: Any?): Int = (v as? Number)?.toInt() ?: 0
    private fun numOrZero(v: Any?): Double = (v as? Number)?.toDouble() ?: 0.0
}
