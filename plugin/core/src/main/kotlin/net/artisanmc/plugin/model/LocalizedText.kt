package net.artisanmc.plugin.model

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.annotation.JsonDeserialize
import com.fasterxml.jackson.databind.deser.std.StdDeserializer

/**
 * A structural text slot value (ADR `field-local-translations`).
 *
 * On disk a slot is either:
 *  - a bare string → the same text for every language (the default language's
 *    literal, sugar for `{<defaultLang>: text}`);
 *  - a map `{ lang: text }` → per-language, with fallback requested → default.
 *
 * A `{i18n:key}` string is deliberately NOT interpreted here: it stays a plain
 * string and is resolved against the project lang map by the existing
 * `resolveText` path. Action texts (inside the Action DSL string) follow that
 * same ref path — they cannot carry a map.
 */
@JsonDeserialize(using = LocalizedTextDeserializer::class)
data class LocalizedText private constructor(
    private val literal: String?,
    private val byLang: Map<String, String>?,
) {
    /** The text for [lang], falling back to [defaultLang] then any present entry. */
    fun forLang(lang: String, defaultLang: String): String? =
        byLang?.let { it[lang] ?: it[defaultLang] ?: it.values.firstOrNull() } ?: literal

    /** Every concrete string this slot can render — used to warm/validate templates. */
    fun allValues(): List<String> = byLang?.values?.toList() ?: listOfNotNull(literal)

    val isMap: Boolean get() = byLang != null

    override fun toString(): String = byLang?.toString() ?: (literal ?: "")

    companion object {
        fun of(text: String): LocalizedText = LocalizedText(text, null)
        fun ofMap(values: Map<String, String>): LocalizedText = LocalizedText(null, values)
    }
}

internal class LocalizedTextDeserializer : StdDeserializer<LocalizedText>(LocalizedText::class.java) {
    override fun deserialize(p: JsonParser, ctxt: DeserializationContext): LocalizedText {
        val node: JsonNode = p.codec.readTree(p)
        return when {
            node.isObject -> {
                val values = LinkedHashMap<String, String>()
                node.fields().forEach { (k, v) ->
                    // Nested structures are not valid lang values — skip them.
                    if (v.isValueNode) values[k] = if (v.isNull) "" else v.asText()
                }
                LocalizedText.ofMap(values)
            }
            node.isNull -> LocalizedText.of("")
            // Strings (literal or `{i18n:key}`) and numbers both land here.
            else -> LocalizedText.of(node.asText())
        }
    }
}

/**
 * A lore: its lines as [LocalizedText]s. On disk (ADR `field-local-translations` §1) it is
 * either one list per language — `{ en: [...], fr: [...] }`, the canonical form, each
 * language with its own line count — or a list of lines, each a literal or a legacy
 * per-line `{lang: text}` map. A bare string is a one-line lore.
 *
 * The per-language form becomes ONE map whose values are the language's lines joined
 * by `\n`: renderers already split on it, and a missing language falls back as a whole
 * block (requested → default), never line by line.
 */
internal class LoreDeserializer : StdDeserializer<List<LocalizedText>>(List::class.java) {
    override fun deserialize(p: JsonParser, ctxt: DeserializationContext): List<LocalizedText> =
        lore(p.codec.readTree(p))

    override fun getNullValue(ctxt: DeserializationContext): List<LocalizedText> = emptyList()

    companion object {
        fun lore(node: JsonNode?): List<LocalizedText> = when {
            node == null || node.isNull -> emptyList()
            node.isArray -> node.map(::line)
            node.isObject && node.fields().asSequence().any { it.value.isArray } -> {
                val blocks = LinkedHashMap<String, String>()
                node.fields().forEach { (lang, v) ->
                    blocks[lang] = if (v.isArray) v.joinToString("\n") { if (it.isNull) "" else it.asText() } else v.asText()
                }
                listOf(LocalizedText.ofMap(blocks))
            }
            else -> listOf(line(node))
        }

        private fun line(node: JsonNode): LocalizedText = when {
            node.isObject -> LocalizedText.ofMap(
                node.fields().asSequence().filter { it.value.isValueNode }
                    .associate { (k, v) -> k to if (v.isNull) "" else v.asText() },
            )
            node.isNull -> LocalizedText.of("")
            else -> LocalizedText.of(node.asText())
        }
    }
}
