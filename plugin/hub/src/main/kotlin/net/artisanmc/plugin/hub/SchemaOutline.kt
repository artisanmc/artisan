package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode

/**
 * A JSON schema as a short text a model reads: each field on one line, with its type and
 * description, then each type it uses, once. Legacy forms (still read, never written) are
 * left out: the model should not write them. `get_kind_guide` returns this; the schema
 * itself stays available with `detail: "schema"`.
 */
class SchemaOutline(private val schema: JsonNode) {
    private val defs = schema.path("\$defs")
    private val queued = LinkedHashSet<String>()
    private val out = StringBuilder()

    fun render(): String {
        out.append("## Fields\n")
        fields(schema, "")
        var done = 0
        while (done < queued.size) {
            val name = queued.elementAt(done++)
            section(name, defs.path(name))
        }
        return out.toString()
    }

    private fun section(name: String, node: JsonNode) {
        out.append("\n## ").append(name).append('\n')
        describe(node)?.let { out.append(it).append('\n') }
        val keyed = keyedVariants(node)
        val union = branches(node)
        when {
            keyed != null -> {
                keyed.forEach { (key, value, description) -> line("- $key: ${signature(value)}", description) }
                union.filter { keyOf(it) == null }.forEach { line("- other: ${signature(it)}", describe(it)) }
            }
            properties(node).isNotEmpty() || includes(node).isNotEmpty() -> fields(node, "")
            union.isNotEmpty() && signature(node).length > INLINE -> union.forEach { line("- ${signature(it)}", describe(it)) }
            else -> out.append(signature(node)).append('\n')
        }
    }

    private fun line(text: String, description: String?) {
        out.append(text)
        description?.let { out.append(" — ").append(it) }
        out.append('\n')
    }

    /** One line per field, nested objects indented under theirs, shared field sets by name. */
    private fun fields(node: JsonNode, indent: String) {
        val required = requiredOf(node)
        val own = properties(node)
        for ((name, field) in own) {
            if (legacy(field)) continue
            val nested = inlineObject(field)
            val label = if (name in required) "$name (required)" else name
            line("$indent- $label: ${if (nested != null) "object" else signature(field)}", describe(field))
            if (nested != null) fields(nested, "$indent  ")
        }
        for (shared in includes(node)) {
            queued += shared
            out.append(indent).append("- …and every field of ").append(shared).append('\n')
        }
        val elsewhere = required - own.map { it.first }.toSet()
        if (elsewhere.isNotEmpty()) out.append(indent).append("- Required here: ").append(elsewhere.joinToString(", ")).append('\n')
    }

    /** A field's type, short: `string`, `list of Element`, `"menu/v1"`, `integer 1–64`, `{command, as?}`… */
    private fun signature(node: JsonNode): String {
        node.get("\$ref")?.let { return ref(it.asText()) }
        node.get("const")?.let { return it.toString() }
        node.get("enum")?.let { values -> return values.joinToString(" | ") { if (it.isTextual) it.asText() else it.toString() } }
        if (node.has("oneOf") || node.has("anyOf")) return branches(node).map { signature(it) }.distinct().joinToString(" | ").ifEmpty { "any" }
        if (!node.has("properties") && !node.has("type") && includes(node).isNotEmpty()) return includes(node).joinToString(" & ") { ref("#/\$defs/$it") }
        return when (val type = node.path("type").let { if (it.isArray) it.joinToString(" | ") { t -> t.asText() } else it.asText("") }) {
            "array" -> "list of " + node.get("items")?.let { signature(it) }.orEmpty().let { if (" | " in it) "($it)" else it }
            "object", "" -> objectSignature(node)
            "integer", "number" -> type + range(node)
            else -> type
        }
    }

    private fun objectSignature(node: JsonNode): String {
        val properties = properties(node).filterNot { legacy(it.second) }
        if (properties.isEmpty()) {
            val values = node.get("additionalProperties")?.takeIf { it.isObject }
                ?: node.get("patternProperties")?.elements()?.asSequence()?.firstOrNull()
            return when {
                values != null -> "map of " + signature(values)
                node.has("propertyNames") && node.path("maxProperties").asInt(0) == 1 -> "{<name>: arguments}"
                else -> "object"
            }
        }
        val required = requiredOf(node)
        return properties.joinToString(", ", "{", "}") { (name, field) -> "$name${if (name in required) "" else "?"}: ${signature(field)}" }
    }

    private fun range(node: JsonNode): String {
        val min = node.get("minimum")
        val max = node.get("maximum")
        return when {
            min != null && max != null -> " ${min.asText()}–${max.asText()}"
            node.has("exclusiveMinimum") -> " > ${node.get("exclusiveMinimum").asText()}"
            min != null -> " ≥ ${min.asText()}"
            max != null -> " ≤ ${max.asText()}"
            else -> ""
        }
    }

    /** `#/$defs/Element` → `Element`, explained in its own section, or spelled out in place when short. */
    private fun ref(pointer: String): String {
        val name = pointer.substringAfterLast('/')
        val node = defs.path(name)
        if (properties(node).isEmpty() && includes(node).isEmpty() && keyedVariants(node) == null) {
            val short = signature(node)
            if (short.length <= INLINE) return short
        }
        queued += name
        return name
    }

    /** An object with fields worth listing under their parent, rather than squeezed on one line. */
    private fun inlineObject(node: JsonNode): JsonNode? {
        val target = if (node.path("type").asText() == "array") node.path("items") else node
        if (target.has("\$ref") || properties(target).isEmpty()) return null
        return target.takeIf { objectSignature(it).length > INLINE }
    }

    /** The branches of a union, its legacy ones left out. */
    private fun branches(node: JsonNode): List<JsonNode> = (node.get("oneOf") ?: node.get("anyOf"))?.filterNot(::legacy).orEmpty()

    /** A union of one-key objects (actions, conditions): each key with its argument. */
    private fun keyedVariants(node: JsonNode): List<Triple<String, JsonNode, String?>>? {
        val keyed = branches(node).mapNotNull { branch ->
            val key = keyOf(branch) ?: return@mapNotNull null
            val value = properties(branch).single().second
            Triple(key, value, describe(branch) ?: describe(value))
        }
        return keyed.takeIf { it.size >= 3 }
    }

    private fun keyOf(branch: JsonNode): String? {
        val props = properties(branch)
        return props.singleOrNull()?.first?.takeIf { requiredOf(branch) == setOf(it) && includes(branch).isEmpty() }
    }

    /** An object's own fields, with those of its inline `allOf` parts. */
    private fun properties(node: JsonNode): List<Pair<String, JsonNode>> {
        val own = node.path("properties").fields().asSequence().map { it.key to it.value }.toList()
        val inline = node.path("allOf").filter { !it.has("\$ref") && !it.has("if") }.flatMap(::properties)
        return (own + inline).distinctBy { it.first }
    }

    /** The shared field sets an object takes whole (`allOf: [$ref]`): an Element carries its look's fields flat. */
    private fun includes(node: JsonNode): List<String> =
        node.path("allOf").mapNotNull { it.get("\$ref")?.asText()?.substringAfterLast('/') }

    private fun requiredOf(node: JsonNode): Set<String> =
        (node.path("required").map { it.asText() } + node.path("allOf").filter { !it.has("\$ref") && !it.has("if") }.flatMap(::requiredOf)).toSet()

    private fun describe(node: JsonNode): String? = node.get("description")?.asText()?.takeIf { it.isNotBlank() }

    /** Still read, never written: marked so in its description, named so, or an object of legacy fields only. */
    private fun legacy(node: JsonNode): Boolean {
        if (describe(node)?.let { it.startsWith("LEGACY") || it.startsWith("Legacy") } == true) return true
        if (node.get("\$ref")?.asText()?.endsWith("Legacy") == true) return true
        val props = node.path("properties")
        return props.size() > 0 && props.all(::legacy)
    }

    private companion object {
        /** Longer than this, a type gets its own section instead of being spelled out in place. */
        const val INLINE = 90
    }
}
