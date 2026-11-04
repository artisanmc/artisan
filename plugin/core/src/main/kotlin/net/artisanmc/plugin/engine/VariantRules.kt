package net.artisanmc.plugin.engine


/**
 * One display rule of a module's `variants.yml` (design `variantes-modules`): when [test] holds
 * for a player, the module's menus and dialogs come from [variant] — each from the first enabled
 * rule that holds **and** whose variant has that file, else from the module itself.
 *
 * The conditions of a rule are all required (and): [client] (`bedrock` or `java`), [hasPack]
 * (the player's client loaded the server's pack: Java pack, or Bedrock pack for a Bedrock
 * player), [permission], and [condition], any condition of the engine (`ConditionParser`).
 * `if:` lists conditions of the action engine (keyed, as in an action's `if:`), all required too:
 * the editor writes this form, `client_is` and `has_resource_pack` among them.
 * A rule without any is always true.
 */
data class VariantRule(
    val id: String,
    val variant: String,
    val enabled: Boolean = true,
    val client: String? = null,
    val hasPack: Boolean? = null,
    val permission: String? = null,
    val condition: Condition? = null,
    /** `if:`, the editor's form: conditions of the action engine, all required. */
    val conditions: List<Condition> = emptyList(),
    /**
     * A step of the `show:` tree: the player's path ends here. Its variant serves each file it
     * has, the module the others; no later rule is tried.
     */
    val terminal: Boolean = false,
)

/** What a player is, for the rules: answered by the server, tested by [VariantRules.select]. */
interface VariantPlayer {
    val bedrock: Boolean
    val hasPack: Boolean
    fun hasPermission(permission: String): Boolean
    fun test(condition: Condition): Boolean
}

/** `variants.yml`: its rules, read and checked. */
object VariantRules {
    const val SCHEMA = "variants/v1"

    /** The rules of [root], and one message per rule left out (unknown key, missing variant…). */
    data class Parsed(val rules: List<VariantRule>, val problems: List<String>)

    private val CLIENTS = setOf("bedrock", "java")
    private val WHEN_KEYS = setOf("client", "has_pack", "permission", "condition")

    /**
     * Reads [root] (the file's mapping); a rule naming a variant outside [variants] is left out,
     * reported unless it is off.
     */
    @Suppress("UNCHECKED_CAST")
    fun parse(root: Map<String, Any?>, variants: Set<String>): Parsed {
        val problems = mutableListOf<String>()
        val schema = root["schema"]?.toString().orEmpty()
        if (schema.isNotEmpty() && schema != SCHEMA) return Parsed(emptyList(), listOf("unsupported schema '$schema', expected $SCHEMA"))
        if (root.containsKey("show")) return parseShow(root["show"])
        val raw = root["rules"] ?: return Parsed(emptyList(), emptyList())
        if (raw !is List<*>) return Parsed(emptyList(), listOf("rules must be a list"))
        val seen = mutableSetOf<String>()
        val rules = raw.mapIndexedNotNull { i, item ->
            val where = "rule ${i + 1}"
            val r = item as? Map<String, Any?> ?: return@mapIndexedNotNull null.also { problems += "$where: not a mapping" }
            val variant = r["variant"]?.toString().orEmpty()
            val id = r["id"]?.toString()?.ifEmpty { null } ?: variant
            when {
                variant.isEmpty() -> problems += "$where: variant missing"
                // A variant just created in the editor has a rule, off, and no file yet: nothing to say.
                variant !in variants -> if (r["enabled"] != false) problems += "$where ($id): no variant '$variant' in variants/"
                !seen.add(id) -> problems += "$where: id '$id' already used"
                else -> return@mapIndexedNotNull runCatching { rule(id, variant, r) }
                    .onFailure { problems += "$where ($id): ${it.message}" }
                    .getOrNull()
            }
            null
        }
        return Parsed(rules, problems)
    }

    const val SHOW_VARIANT = "show_variant"
    const val SHOW_DEFAULT = "show_default"

    /**
     * `show:`, the editor's form: a step tree like an action chain (`if` / `do` / `else`)
     * whose actions are `show_variant: <name>` and `show_default`. Read as the rules it means,
     * in order: each `show` step is a [VariantRule.terminal] rule holding on its path (the
     * conditions of the `if` cases it is under, the cases before them false); a list stops at
     * its first `show` step. A player's path ends at the first that holds: its variant for the
     * files it has, the module for the rest. `show_default` is variant "", the module's.
     */
    fun parseShow(raw: Any?): Parsed {
        val problems = mutableListOf<String>()
        val rules = mutableListOf<VariantRule>()
        fun walk(steps: List<Step>, guard: List<Condition>) {
            for (step in steps) when (step) {
                is Step.ActionStep -> when (step.name) {
                    SHOW_VARIANT -> {
                        val variant = when (val v = step.value) {
                            is String -> v
                            is Map<*, *> -> v["variant"]?.toString().orEmpty()
                            else -> ""
                        }
                        if (variant.isEmpty()) problems += "show step ${rules.size + 1}: show_variant without a variant"
                        else rules += VariantRule("show ${rules.size + 1}", variant, conditions = guard, terminal = true)
                        return
                    }
                    SHOW_DEFAULT -> {
                        rules += VariantRule("show ${rules.size + 1}", "", conditions = guard, terminal = true)
                        return
                    }
                    else -> problems += "unknown step '${step.name}' (expected $SHOW_VARIANT or $SHOW_DEFAULT)"
                }
                is Step.IfStep -> {
                    val before = mutableListOf<Condition>()
                    for (case in step.cases) {
                        val holds = caseCondition(case)
                        walk(case.steps, guard + before + holds)
                        before += Condition.Not(holds)
                    }
                    walk(step.elseSteps, guard + before)
                }
            }
        }
        walk(KeyedStepParser.parseKeyed(raw), emptyList())
        return Parsed(rules, problems)
    }

    /** An `if` case's conditions as one, joined left to right like `ActionExecutor.caseMatches`. */
    private fun caseCondition(case: IfCase): Condition {
        if (case.conditions.isEmpty()) return Condition.And(emptyList())
        var out = case.conditions[0]
        for (i in 1 until case.conditions.size) {
            val next = case.conditions[i]
            out = if (case.joins.getOrNull(i - 1) == "or") Condition.Or(listOf(out, next)) else Condition.And(listOf(out, next))
        }
        return out
    }

    @Suppress("UNCHECKED_CAST")
    private fun rule(id: String, variant: String, r: Map<String, Any?>): VariantRule {
        val enabled = when (val e = r["enabled"]) {
            null -> true
            is Boolean -> e
            else -> throw IllegalArgumentException("enabled must be true or false")
        }
        val w = when (val raw = r["when"]) {
            null -> emptyMap()
            is Map<*, *> -> raw as Map<String, Any?>
            else -> throw IllegalArgumentException("when must be a mapping")
        }
        (w.keys - WHEN_KEYS).firstOrNull()?.let {
            throw IllegalArgumentException("unknown condition '$it' (expected ${WHEN_KEYS.sorted().joinToString()})")
        }
        val client = w["client"]?.toString()?.lowercase()
        require(client == null || client in CLIENTS) { "client must be bedrock or java" }
        val hasPack = w["has_pack"]?.let { it as? Boolean ?: throw IllegalArgumentException("has_pack must be true or false") }
        val condition = w["condition"]?.let {
            ConditionParser.parse(it as? Map<String, Any> ?: throw IllegalArgumentException("condition must be a mapping"))
        }
        val conditions = when (val list = r["if"]) {
            null -> emptyList()
            is List<*> -> list.mapIndexed { i, c ->
                KeyedStepParser.parseConditionStrict(c) ?: throw IllegalArgumentException("if: condition ${i + 1} is not a condition: $c")
            }
            else -> listOfNotNull(KeyedStepParser.parseConditionStrict(list) ?: throw IllegalArgumentException("if: not a condition: $list"))
        }
        return VariantRule(id, variant, enabled, client, hasPack, w["permission"]?.toString(), condition, conditions)
    }

    /** Whether [rule] holds for [player]. */
    fun holds(rule: VariantRule, player: VariantPlayer): Boolean =
        rule.enabled &&
            (rule.client == null || (rule.client == "bedrock") == player.bedrock) &&
            (rule.hasPack == null || rule.hasPack == player.hasPack) &&
            (rule.permission == null || player.hasPermission(rule.permission)) &&
            (rule.condition == null || player.test(rule.condition)) &&
            rule.conditions.all(player::test)

    /**
     * The variant [player] gets for a file: the variant of the first rule that holds and is in
     * [has], `null` for the module's own file. Rules are evaluated lazily, in order.
     */
    fun select(rules: List<VariantRule>, has: (variant: String) -> Boolean, player: VariantPlayer): String? =
        rules.firstOrNull { (it.terminal || it.variant.isEmpty() || has(it.variant)) && holds(it, player) }
            ?.variant?.takeIf { it.isNotEmpty() && has(it) }
}
