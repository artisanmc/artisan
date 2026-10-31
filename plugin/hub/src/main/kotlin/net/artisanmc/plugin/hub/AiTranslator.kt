package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode

/**
 * "Translate the missing ones" (ADR `editor-assistant`): the assistant's model fills the empty
 * languages of a few texts in one call, without tools. The editor writes what comes back into its
 * Project like a typed edit; nothing here touches a file. A translation that loses or invents a
 * placeholder (`{player}`, `{i18n:key}`) is dropped: the text stays missing rather than broken.
 */
class AiTranslator(private val provider: AiProvider) {
    data class Text(val id: String, val text: String, val context: String?)

    data class Request(val source: String, val targets: List<String>, val texts: List<Text>, val module: String?)

    data class Result(
        /** Per text id, per language. */
        val translations: Map<String, Map<String, String>>,
        /** Ids with a language the model left out or broke. */
        val failed: List<String>,
        val inputTokens: Long,
        val outputTokens: Long,
    )

    /** Throws [AiFailure] when the provider fails or answers something that is not the JSON asked for. */
    fun translate(request: Request): Result {
        val prompt = Call.mapper.writeValueAsString(
            mapOf(
                "source_language" to request.source,
                "target_languages" to request.targets,
                "module" to request.module,
                "texts" to request.texts.map { mapOf("id" to it.id, "context" to it.context, "text" to it.text).filterValues { v -> v != null } },
            ),
        )
        val reply = provider.conversation(SYSTEM, emptyList()).step(listOf(AiInput.Text(prompt)))
        if (reply.stop == AiReply.LIMIT) throw AiFailure("ai_output_limit", "the translations did not fit in one answer")
        if (reply.stop == AiReply.REFUSED) throw AiFailure("ai_refused", "the model declined to translate")
        val answer = parse(reply.texts.joinToString("\n")) ?: throw AiFailure("ai_bad_answer", "the model did not answer with the JSON asked for")
        val translations = mutableMapOf<String, Map<String, String>>()
        val failed = mutableListOf<String>()
        for (text in request.texts) {
            val got = answer.path(text.id)
            val kept = request.targets.mapNotNull { lang ->
                got.path(lang).takeIf { it.isTextual }?.asText()?.takeIf { it.isNotBlank() && samePlaceholders(text.text, it) }?.let { lang to it }
            }.toMap()
            if (kept.isNotEmpty()) translations[text.id] = kept
            if (kept.size < request.targets.size) failed += text.id
        }
        return Result(translations, failed, reply.inputTokens, reply.outputTokens)
    }

    private fun parse(text: String): JsonNode? {
        val start = text.indexOf('{')
        val end = text.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return runCatching { Call.mapper.readTree(text.substring(start, end + 1)) }.getOrNull()?.takeIf { it.isObject }
    }

    companion object {
        const val MAX_TEXTS = 100
        const val MAX_TEXT = 4000
        const val MAX_TARGETS = 12
        /** Characters to write in one call (texts × target languages): the answer must fit in one model reply. */
        const val MAX_OUTPUT_CHARS = 24_000
        val LANG = Regex("[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?")

        private val PLACEHOLDER = Regex("\\{[^{}]*\\}")

        /** The same `{…}` placeholders, as many times each, in any order. */
        fun samePlaceholders(source: String, translation: String): Boolean =
            PLACEHOLDER.findAll(source).map { it.value }.sorted().toList() == PLACEHOLDER.findAll(translation).map { it.value }.sorted().toList()

        val SYSTEM = """
            You translate the texts of a Minecraft server: menu titles and buttons, item names and lore, dialog lines, chat messages.
            The input is JSON: the source language, the target languages, the module the texts belong to, and the texts, each with an id and often a context (where it shows).
            Rules:
            - Keep every placeholder in braces exactly as it is, untranslated: {player}, {r.name}, {i18n:shop.title}, {x ? "a" : "b"}.
            - Keep MiniMessage tags (<gold>, <bold>, <click:run_command:/shop>, <hover:show_text:'…'>) and legacy codes (&a, §l) where they are; translate only the human text inside them, never commands, ids or URLs.
            - Keep line breaks, leading and trailing spaces, and the text's length class: a button stays short.
            - Use the register a game uses with its players in that language, the same across the texts.
            - A text that is a proper noun, a brand or a command stays as it is.
            Answer with one JSON object and nothing else: {"<id>": {"<target language>": "<translation>"}}, every id, every target language.
        """.trimIndent()
    }
}
