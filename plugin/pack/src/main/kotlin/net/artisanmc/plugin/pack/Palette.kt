package net.artisanmc.plugin.pack

/**
 * The palette of named colours a tint may write (ADR `component-colours`, decision 2;
 * `palette.ts` in the editor's builder). A theme, and the server's library, hold one in
 * `palette.yml` at their root, a map of names to `#rrggbb`:
 *
 * ```yaml
 * primary: "#3b82f6"
 * danger: "#d6453d"
 * ```
 *
 * A name is looked up like an image's: the themes in place from the highest down, then the
 * library, then the palette every server has ([DEFAULT]).
 */
class Palette private constructor(private val places: List<Map<String, String>>) {
    /** The colour of [name], `#rrggbb`; null for one no place defines. */
    fun colour(name: String): String? = places.firstNotNullOfOrNull { it[name] } ?: DEFAULT[name]

    /** The colour a layer's [tint] gives: itself when it is one, else this palette's of that name. */
    fun tintOf(tint: String?): String? = when {
        tint == null -> null
        COLOUR.matches(tint) -> tint
        else -> colour(tint)
    }

    companion object {
        const val FILE = "palette.yml"

        /** The names every server has, and their colours until a theme or the library says otherwise. */
        val DEFAULT: Map<String, String> = linkedMapOf(
            "neutral" to "#8b8f98",
            "primary" to "#3b82f6",
            "success" to "#22a55b",
            "danger" to "#d6453d",
            "warning" to "#e0a526",
        )

        private val NAME = Regex("^[a-z0-9_-]+$")
        private val COLOUR = Regex("^#[0-9a-fA-F]{6}$")

        /** The colours [content] (a `palette.yml`) gives, by name; an entry that is no name or no colour is left out. */
        fun read(content: String): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            val read = Yaml.parseOrNull(content) as? Map<*, *> ?: return out
            for ((name, value) in read) {
                if (name is String && value is String && NAME.matches(name) && COLOUR.matches(value)) out[name] = value
            }
            return out
        }

        /** The palettes [files] (each the text of a `palette.yml`, the highest place first, an absent file as null) as one, over the default one. */
        fun of(files: List<String?>): Palette = Palette(files.filterNotNull().map(::read))

        /** The palette of a server's pack: its [themes] in place (the lowest first) among [own], then its library [kit]. */
        fun of(themes: List<String>, kit: PackProject?, own: Map<String, PackProject>): Palette =
            of(themes.reversed().map { name -> own[name]?.let(::fileOf) } + kit?.let(::fileOf))

        private fun fileOf(project: PackProject): String? = project.files.firstOrNull { it.path == FILE }?.content
    }
}
