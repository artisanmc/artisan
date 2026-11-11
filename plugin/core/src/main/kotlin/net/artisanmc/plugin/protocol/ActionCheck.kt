package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode

/**
 * The `actions` stage of [DocumentCheck]: each module action a Document names (`guilds:rank_delete`)
 * must be one this server declares, with arguments it declares. The schemas only know that a
 * module's action is prefixed by its namespace, and the engine skips an unknown name at the click
 * with a warning: without this stage, `guilds:rank_delet` loads and does nothing.
 *
 * An action step is a one-key map whose key is namespaced, as a list item or as a click (`left:`).
 * Under a condition list (`if:`, `open_requirements:`…) such a map is a condition, never checked here.
 */
class ActionCheck(
    /** The server's `declared_actions` (`{name, args, primary?}`): [ServerAnnouncement.actions]. */
    declared: List<Map<String, Any?>>,
) {
    private val byName = declared.filter { it["name"] is String }.associateBy { it["name"] as String }

    /** The problems of [document], each a sentence naming the step. */
    fun problems(document: JsonNode): List<String> {
        if (byName.isEmpty()) return emptyList()
        val out = mutableListOf<String>()
        walk(document, out)
        return out.distinct()
    }

    private fun walk(node: JsonNode, out: MutableList<String>, parentKey: String? = null) {
        when {
            node.isArray -> for (item in node) {
                if (parentKey !in CONDITION_LISTS && stepName(item) != null) step(item, out)
                walk(item, out, parentKey)
            }
            node.isObject -> for ((key, value) in node.fields()) {
                if (key in CLICKS && stepName(value) != null) step(value, out)
                if (key in CONDITION_LISTS || key in CONDITION_KEYS) continue
                walk(value, out, key)
            }
        }
    }

    private fun stepName(node: JsonNode): String? =
        node.takeIf { it.isObject && it.size() == 1 }?.fieldNames()?.next()?.takeIf { NAMESPACED.matches(it) }

    @Suppress("UNCHECKED_CAST")
    private fun step(node: JsonNode, out: MutableList<String>) {
        val name = stepName(node) ?: return
        val declaration = byName[name]
        if (declaration == null) {
            val near = suggestion(name)?.let { ". Did you mean `$it`?" }.orEmpty()
            out += "action `$name`: no module on this server declares it$near"
            return
        }
        val args = (declaration["args"] as? List<Map<String, Any?>>).orEmpty()
        val names = args.mapNotNull { it["name"] as? String }.toSet()
        val primary = declaration["primary"] as? String
        val value = node.get(name)
        val given: Set<String> = when {
            value == null || value.isNull -> emptySet()
            value.isObject && value.fieldNames().asSequence().all { it in names } -> value.fieldNames().asSequence().toSet()
            value.isObject && (primary == null || kindOf(args, primary) !in OPEN_VALUES) -> {
                val unknown = value.fieldNames().asSequence().filter { it !in names }.toList()
                out += "action `$name`: unknown argument${if (unknown.size > 1) "s" else ""} ${unknown.joinToString { "`$it`" }}; " +
                    "it takes ${if (names.isEmpty()) "no arguments" else names.joinToString { "`$it`" }}"
                value.fieldNames().asSequence().filter { it in names }.toSet()
            }
            primary != null -> setOf(primary)
            else -> {
                out += "action `$name` takes ${if (names.isEmpty()) "no arguments" else "a map of ${names.joinToString { "`$it`" }}"}, not a value"
                return
            }
        }
        val missing = args.filter { it["required"] == true && it["default"] == null && it["name"] !in given }.mapNotNull { it["name"] as? String }
        if (missing.isNotEmpty()) out += "action `$name`: missing ${missing.joinToString { "`$it`" }}"
    }

    @Suppress("UNCHECKED_CAST")
    private fun kindOf(args: List<Map<String, Any?>>, arg: String): String? =
        (args.firstOrNull { it["name"] == arg }?.get("type") as? Map<String, Any?>)?.get("kind") as? String

    /** The declared name closest to [name], when one is a typo away. */
    private fun suggestion(name: String): String? =
        byName.keys.map { it to distance(it, name) }.filter { it.second <= 2 }.minByOrNull { it.second }?.first

    private fun distance(a: String, b: String): Int {
        var previous = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val current = IntArray(b.length + 1)
            current[0] = i
            for (j in 1..b.length) {
                current[j] = minOf(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            }
            previous = current
        }
        return previous[b.length]
    }

    private companion object {
        val NAMESPACED = Regex("[a-z0-9_.-]+:[a-z0-9_./-]+")
        val CLICKS = setOf("left", "right", "shift_left", "shift_right", "middle")
        val CONDITION_LISTS = setOf("if", "open_requirements", "requirements", "view_requirements", "and", "or")
        val CONDITION_KEYS = setOf("not")
        /** Kinds whose value is itself a map: a language map for a text, a map argument. */
        val OPEN_VALUES = setOf("ltext", "minimessage", "minimessage_multiline", "map", "object")
    }
}
