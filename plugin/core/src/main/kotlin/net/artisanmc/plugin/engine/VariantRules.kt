package net.artisanmc.plugin.engine


/**
 * One display rule of a module's `variants.yml` (design `variantes-modules`): when [test] holds
 * for a player, the module's menus and dialogs come from [variant] — each from the first enabled
 * rule that holds **and** whose variant has that file, else from the module itself.
 *
 * The conditions of a rule are all required (and): [client] (`bedrock` or `java`), [hasPack]
 * (the player's client loaded the server's pack: Java pack, or Bedrock pack for a Bedrock
 * player), [permission], and [condition], any condition of the engine (`ConditionParser`).
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
        return VariantRule(id, variant, enabled, client, hasPack, w["permission"]?.toString(), condition)
    }

    /** Whether [rule] holds for [player]. */
    fun holds(rule: VariantRule, player: VariantPlayer): Boolean =
        rule.enabled &&
            (rule.client == null || (rule.client == "bedrock") == player.bedrock) &&
            (rule.hasPack == null || rule.hasPack == player.hasPack) &&
            (rule.permission == null || player.hasPermission(rule.permission)) &&
            (rule.condition == null || player.test(rule.condition))

    /**
     * The variant [player] gets for a file: the variant of the first rule that holds and is in
     * [has], `null` for the module's own file. Rules are evaluated lazily, in order.
     */
    fun select(rules: List<VariantRule>, has: (variant: String) -> Boolean, player: VariantPlayer): String? =
        rules.firstOrNull { has(it.variant) && holds(it, player) }?.variant
}
