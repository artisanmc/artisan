package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/**
 * A player's editor preferences (language, theme, guided tour), one small JSON file per UUID
 * in [dir]. Only known keys are read and written.
 */
class PlayerPrefs(private val dir: File) {
    data class Tour(val step: Int, val completed: Boolean)
    data class Prefs(val editorLanguage: String? = null, val theme: String? = null, val editorTour: Tour? = null)

    class InvalidPrefs(val code: String) : Exception(code)

    @Synchronized
    fun read(player: UUID): Prefs {
        val node = runCatching { Call.mapper.readTree(file(player)) }.getOrNull() ?: return Prefs()
        val tour = node["editorTour"]?.takeIf { it.isObject }?.let { Tour(it.path("step").asInt(0).coerceIn(0, LAST_STEP), it.path("completed").asBoolean()) }
        return Prefs(
            editorLanguage = node["editorLanguage"]?.textValue()?.takeIf(LANGUAGE::matches),
            theme = node["theme"]?.textValue()?.takeIf { it in THEMES },
            editorTour = tour,
        )
    }

    /**
     * Applies a `PATCH /auth/me`: `editor_language`, `theme`, `editor_tour` (`start`, `progress`,
     * `complete`, `import`). Returns the preferences and, for `start`, whether the tour was just
     * started.
     */
    @Synchronized
    fun update(player: UUID, body: JsonNode): Pair<Prefs, Boolean?> {
        if (!body.isObject) throw InvalidPrefs("invalid_body")
        var prefs = read(player)
        if (body.has("editor_language")) {
            val language = body["editor_language"].takeUnless { it.isNull }?.textValue()
            if (language != null && !LANGUAGE.matches(language)) throw InvalidPrefs("invalid_editor_language")
            prefs = prefs.copy(editorLanguage = language)
        }
        if (body.has("theme")) {
            val theme = body["theme"].takeUnless { it.isNull }?.textValue()
            if (theme != null && theme !in THEMES) throw InvalidPrefs("invalid_theme")
            prefs = prefs.copy(theme = theme)
        }
        var started: Boolean? = null
        if (body.has("editor_tour")) {
            val action = body["editor_tour"]
            val step = action.path("step").takeIf { it.isInt && it.asInt() in 0..LAST_STEP }?.asInt()
            val current = prefs.editorTour
            val tour = when (action.path("action").asText()) {
                "start" -> { started = current == null; current ?: Tour(0, false) }
                "complete" -> Tour(LAST_STEP, true)
                "progress" -> step?.let { if (current?.completed == true) current else Tour(it, false) }
                "import" -> step?.takeIf { action.path("completed").isBoolean }?.let { current ?: Tour(it, action["completed"].asBoolean()) }
                else -> null
            } ?: throw InvalidPrefs("invalid_editor_tour")
            prefs = prefs.copy(editorTour = tour)
        }
        write(player, prefs)
        return prefs to started
    }

    private fun write(player: UUID, prefs: Prefs) {
        dir.mkdirs()
        val target = file(player)
        val tmp = File(dir, "${target.name}.tmp")
        tmp.writeBytes(Call.mapper.writeValueAsBytes(prefs))
        Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    private fun file(player: UUID) = File(dir, "$player.json")

    companion object {
        const val MAX_BODY = 4096
        private const val LAST_STEP = 6
        private val THEMES = setOf("dark", "light")
        private val LANGUAGE = Regex("[a-z]{2}(-[A-Z]{2})?")
    }
}
