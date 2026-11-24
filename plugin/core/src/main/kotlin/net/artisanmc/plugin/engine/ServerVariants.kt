package net.artisanmc.plugin.engine

/**
 * A variant declared by the server (`menu-variants` of `config.yml`), on top of the three every
 * server has ([ServerVariants.BUILTIN]). A module that has no version of a file for it falls back
 * to [parent], then to the parent's parent, down to `default`, the module's own file.
 *
 * [conditions] (an action's `if:`, all required) say who may see it: in auto mode, the first
 * declared variant whose conditions hold is picked; a variant without conditions is only shown
 * to the players who choose it. [selectable] false: never offered by `/artisan variant`.
 */
data class ServerVariant(
    val name: String,
    val parent: String = ServerVariants.DEFAULT,
    val conditions: List<Condition> = emptyList(),
    val selectable: Boolean = true,
)

/**
 * The menu variants of the server (design `variantes-modules`, "variants declared by the
 * server"): `default`, `bedrock` and `textured`, always there, and the server's own [custom]
 * ones. A module only ships versions of its files for them, in `variants/<name>/`; which one a
 * player sees is decided here, the same for every module, so a player can pick theirs.
 *
 * - `bedrock`: a Bedrock player (Geyser). Falls back to `default`.
 * - `textured`: a Java player whose client loaded the server's pack. Falls back to `default`.
 *
 * A player's choice ([VariantPlayer.preference], `/artisan variant`) wins when the variant
 * is offered to them ([offered]); `auto` or nothing: [auto].
 */
class ServerVariants(val custom: List<ServerVariant> = emptyList()) {
    private val byName = custom.associateBy { it.name }

    /** Every variant, the built-in ones first. */
    val names: List<String> = BUILTIN + custom.map { it.name }

    fun isDeclared(name: String): Boolean = name in BUILTIN || name in byName

    /**
     * [name], then its parents, `default` left out: the variants whose version of a file is
     * looked for, in order. Empty for `default` or a name not declared.
     */
    fun chain(name: String): List<String> {
        val out = mutableListOf<String>()
        var current: String? = name
        while (current != null && current != DEFAULT && current !in out) {
            if (!isDeclared(current)) return out
            out += current
            current = parentOf(current)
        }
        return out
    }

    private fun parentOf(name: String): String? = when (name) {
        DEFAULT -> null
        BEDROCK, TEXTURED -> DEFAULT
        else -> byName[name]?.parent
    }

    /**
     * Whether [player] can see [name]: each variant of its [chain] holds for them (`bedrock`:
     * plays on Bedrock; `textured`: on Java with the pack loaded; a custom one: its conditions).
     */
    fun available(name: String, player: VariantPlayer): Boolean =
        isDeclared(name) && chain(name).all { v ->
            when (v) {
                BEDROCK -> player.bedrock
                TEXTURED -> !player.bedrock && player.hasPack
                else -> byName[v]?.conditions.orEmpty().all(player::test)
            }
        }

    /** What [player] may choose with `/artisan variant`, `default` first. */
    fun offered(player: VariantPlayer): List<String> =
        names.filter { it == DEFAULT || (byName[it]?.selectable != false && available(it, player)) }

    /**
     * The variant [player] gets without a choice: the first custom variant with conditions that
     * holds, else `bedrock` for a Bedrock player, `textured` with the pack, `default` otherwise.
     */
    fun auto(player: VariantPlayer): String =
        custom.firstOrNull { it.conditions.isNotEmpty() && available(it.name, player) }?.name
            ?: when {
                player.bedrock -> BEDROCK
                available(TEXTURED, player) -> TEXTURED
                else -> DEFAULT
            }

    /** The variant [player] sees: their choice when it is still offered to them, else [auto]. */
    fun current(player: VariantPlayer): String =
        player.preference?.takeIf { it != AUTO && it in offered(player) } ?: auto(player)

    /**
     * The variant whose version of one file [player] sees, `null` for the module's own: the
     * first of their variant's [chain] the module [has]. A module that still has display rules
     * of its own ([legacy], `show:` of its `variants.yml`) keeps them while the player has not
     * chosen: what it showed before the server declared its variants.
     */
    fun select(legacy: List<VariantRule>, has: (variant: String) -> Boolean, player: VariantPlayer): String? {
        val chosen = player.preference?.takeIf { it != AUTO && it in offered(player) }
        if (chosen == null && legacy.isNotEmpty()) return VariantRules.select(legacy, has, player)
        return chain(chosen ?: auto(player)).firstOrNull(has)
    }

    /** `menu-variants`, read: its variants and one message per entry left out. */
    data class Parsed(val variants: ServerVariants, val problems: List<String>)

    companion object {
        const val DEFAULT = "default"
        const val BEDROCK = "bedrock"
        const val TEXTURED = "textured"
        /** A player's choice that means "no choice": [auto]. */
        const val AUTO = "auto"
        val BUILTIN = listOf(DEFAULT, BEDROCK, TEXTURED)

        /**
         * Where a player's choice is kept: a value of the Variable store, so `artisan_vars` keeps
         * it and the network shares it. `@` keeps it apart from every Project's `project/id`.
         */
        const val PREFERENCE_REF = "@artisan/menu_variant"

        /** A variant's name, the same as a `variants/<name>/` folder of a module. */
        val NAME = Regex("[a-z0-9][a-z0-9_-]{0,31}")

        private val KEYS = setOf("name", "parent", "if", "selectable")

        /**
         * Reads `menu-variants`: a list of `{name, parent, if, selectable}`. An entry left out
         * (bad name, built-in name, unknown parent, a loop of parents…) is reported; the others
         * load.
         */
        fun parse(raw: Any?): Parsed {
            if (raw == null) return Parsed(ServerVariants(), emptyList())
            if (raw !is List<*>) return Parsed(ServerVariants(), listOf("menu-variants must be a list"))
            val problems = mutableListOf<String>()
            val read = linkedMapOf<String, ServerVariant>()
            raw.forEachIndexed { i, item ->
                val where = "menu-variants ${i + 1}"
                val m = item as? Map<*, *> ?: return@forEachIndexed run { problems += "$where: not a mapping" }
                val name = m["name"]?.toString()?.trim().orEmpty()
                val unknown = m.keys.map { it.toString() } - KEYS
                when {
                    !NAME.matches(name) -> problems += "$where: name '$name' must be lowercase letters, digits, - or _ (32 at most)"
                    name in BUILTIN || name == AUTO -> problems += "$where: '$name' is built in"
                    name in read -> problems += "$where: '$name' already declared"
                    unknown.isNotEmpty() -> problems += "$where ($name): unknown key '${unknown.first()}' (expected ${KEYS.sorted().joinToString()})"
                    else -> runCatching { variant(name, m) }
                        .onSuccess { read[name] = it }
                        .onFailure { problems += "$where ($name): ${it.message}" }
                }
            }
            // Parents: declared, and no loop. A variant whose chain breaks is left out, with the
            // ones that build on it.
            var kept = read.toMap()
            while (true) {
                val broken = kept.values.firstOrNull { v -> !reaches(v.name, kept) } ?: break
                problems += "menu-variants (${broken.name}): parent '${broken.parent}' is not declared or loops back"
                kept = kept - broken.name
            }
            return Parsed(ServerVariants(read.values.filter { it.name in kept }), problems)
        }

        /** Whether the parents of [name] reach a built-in variant through [declared] alone. */
        private fun reaches(name: String, declared: Map<String, ServerVariant>): Boolean {
            val seen = mutableSetOf<String>()
            var current = name
            while (current !in BUILTIN) {
                if (!seen.add(current)) return false
                current = declared[current]?.parent ?: return false
            }
            return true
        }

        private fun variant(name: String, m: Map<*, *>): ServerVariant {
            val parent = m["parent"]?.toString()?.trim()?.ifEmpty { null } ?: DEFAULT
            require(parent != name) { "parent cannot be itself" }
            val selectable = when (val s = m["selectable"]) {
                null -> true
                is Boolean -> s
                else -> throw IllegalArgumentException("selectable must be true or false")
            }
            val conditions = when (val list = m["if"]) {
                null -> emptyList()
                is List<*> -> list.mapIndexed { i, c ->
                    KeyedStepParser.parseConditionStrict(c) ?: throw IllegalArgumentException("if: condition ${i + 1} is not a condition: $c")
                }
                else -> listOf(KeyedStepParser.parseConditionStrict(list) ?: throw IllegalArgumentException("if: not a condition: $list"))
            }
            return ServerVariant(name, parent, conditions, selectable)
        }
    }
}
