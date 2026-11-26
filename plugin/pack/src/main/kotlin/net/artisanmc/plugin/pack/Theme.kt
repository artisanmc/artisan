package net.artisanmc.plugin.pack

/**
 * A theme (`theme.ts`): images under the names of the common ones, with other pixels. It is a
 * folder of its own beside the theme `artisan`, a Project of its name (ADR
 * `common-images-and-themes`, decision 5; ADR `resources-one-screen`):
 *
 * ```
 * themes/noel/assets/textures/button.3x1.png      the theme's image of that name, at its size
 * themes/noel/overrides/artisan/button.3x1.png    the former place of the same, still read
 * ```
 *
 * A server whose Artisan is older than that keeps its themes in the common images' Project
 * ([Kit.FOLDER]), which is read where no Project of the theme's name is:
 *
 * ```
 * themes/noel/assets/textures/button.3x1.png    this image redrawn, at its size
 * ```
 *
 * A theme in place changes what `kit:<name>` shows: the theme's own drawing of that image when
 * it has one of the same size. A theme holds no Document and moves nothing, so a menu laid out
 * against the kit keeps its layout; at worst it is ugly. A module's own image is the module's:
 * no theme changes it (ADR `resources-one-screen`, decision 2), and a theme repaints no pixel
 * (decision 3): what it once held to do so is no longer read.
 *
 * The themes in place are a stack (`resource-pack.themes` of `config.yml`, the lowest first):
 * the highest that draws an image wins ([ThemeStack]).
 */
class KitTheme internal constructor(
    /** The images the theme redraws: their name to their file. */
    private val redrawn: Map<String, String>,
    private val binary: (String) -> ByteArray?,
) {
    private val files = HashMap<String, ByteArray?>()

    /** The names of the images this theme redraws. */
    val drawings: Set<String> get() = redrawn.keys

    /** The kit image [name], whose PNG is [png], as the theme shows it: its own drawing, else [png]. */
    fun shown(name: String, png: ByteArray): ByteArray = drawing(name, png) ?: png

    /** The theme's own drawing of [name], when it has one as large as [png]; null otherwise. */
    fun drawing(name: String, png: ByteArray): ByteArray? {
        val path = redrawn[name] ?: return null
        val mine = files.getOrPut(path) { binary(path) } ?: return null
        val base = runCatching { Png.decode(png) }.getOrNull() ?: return null
        val drawn = runCatching { Png.decode(mine) }.getOrNull() ?: return null
        return mine.takeIf { drawn.width == base.width && drawn.height == base.height }
    }

    companion object {
        /** The folder of the themes, at the kit module's root: where a server older than a theme's own folder keeps them. */
        const val DIR = "themes"

        /** In a theme's own folder, what it changes in images that exist elsewhere. */
        const val OVERRIDES_DIR = "overrides/"

        /** Its redraws of the common images, before the image's name. */
        const val COMMON_DIR = OVERRIDES_DIR + "artisan/"

        /** The path of the theme's own drawing of the common image [name]. */
        fun drawingPath(name: String): String = "$COMMON_DIR$name.png"

        private val NAME = Regex("^[a-z0-9][a-z0-9_-]*$")
        private val IMAGE_DIRS = listOf("assets/glyphs/", "assets/textures/")

        /** The key of the server's themes in its `config.yml`: the stack in place, the lowest first. */
        const val CONFIG_KEY = "resource-pack.themes"

        /** The former key, one theme: still read when the list names none (a server older than the list reports it alone). */
        const val FORMER_CONFIG_KEY = "resource-pack.theme"

        fun isName(name: String): Boolean = NAME.matches(name)

        /**
         * The themes a server's `config.yml` puts in place, as its plugin reports it: the lowest
         * first, each name once (ADR `common-images-and-themes`, decision 6). Empty when it names none.
         */
        fun configured(config: Map<String, Any?>?): List<String> =
            (config?.get(CONFIG_KEY) as? List<*>).orEmpty().filterIsInstance<String>().filter(::isName).distinct().ifEmpty {
                listOfNotNull((config?.get(FORMER_CONFIG_KEY) as? String)?.takeIf(::isName))
            }

        /**
         * The themes [names] as one look, in that order: each from the Project of its name among
         * [own] (the server's themes, by folder), else from the common images' Project [kit], where
         * an older server keeps it. One the server does not hold is left out; null for none.
         */
        fun stack(names: List<String>, kit: PackProject?, own: Map<String, PackProject> = emptyMap()): ThemeStack? = ThemeStack.of(
            names.filter(::isName).mapNotNull { name -> own[name]?.let(::own) ?: kit?.let { read(name, it) } },
        )

        /**
         * The images a theme of its own folder holds among its [binaries], by name: what it shows
         * in place of the image of that name below it (ADR `resources-one-screen`, decision 2). Its
         * image is a file of `assets/` like a module's (a texture wins over a glyph), which wins over
         * the former place of a redraw, `overrides/artisan/`.
         */
        fun ownDrawings(binaries: Collection<String>): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for (dir in listOf(COMMON_DIR) + IMAGE_DIRS) {
                for (path in binaries.sorted()) {
                    val file = path.removePrefix(dir).takeIf { it.length < path.length } ?: continue
                    if ('/' in file || !file.endsWith(".png") || file.length == ".png".length) continue
                    out[file.dropLast(".png".length)] = path
                }
            }
            return out
        }

        /** A theme that is its own Project: its images, which replace the common ones of their names. One that holds none changes nothing. */
        fun own(theme: PackProject): KitTheme = ownOf(theme.binaries, theme.binary)

        /** [own] of a theme given as the paths of its [binaries] and what reads one. */
        fun ownOf(binaries: Collection<String>, binary: (String) -> ByteArray?): KitTheme = KitTheme(ownDrawings(binaries), binary)

        /** The images the theme [name] redraws among [binaries], by name: a texture wins over a glyph. */
        fun drawings(name: String, binaries: Collection<String>): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for (path in binaries.sorted()) {
                val rest = path.removePrefix("$DIR/$name/").takeIf { it.length < path.length } ?: continue
                val dir = IMAGE_DIRS.firstOrNull { rest.startsWith(it) } ?: continue
                val file = rest.substring(dir.length)
                if ('/' in file || !file.endsWith(".png") || file.length == ".png".length) continue
                out[file.dropLast(".png".length)] = path
            }
            return out
        }

        /** The themes a kit module holds: every `themes/<name>/` with a redrawn image. */
        fun names(binaries: Collection<String>): List<String> =
            binaries.asSequence()
                .filter { it.startsWith("$DIR/") }
                .map { it.substring(DIR.length + 1).substringBefore('/') }
                .filter(::isName)
                .distinct()
                .filter { drawings(it, binaries).isNotEmpty() }
                .sorted()
                .toList()

        /** The theme [name] of the kit module [kit]; null when the module has no such theme. */
        fun read(name: String, kit: PackProject): KitTheme? = of(name, kit.binaries, kit.binary)

        /**
         * The theme [name] of a kit module given as the paths of its [binaries] and what reads one;
         * null when the module has no such theme.
         */
        fun of(name: String, binaries: Collection<String>, binary: (String) -> ByteArray?): KitTheme? {
            if (!isName(name)) return null
            return drawings(name, binaries).takeIf { it.isNotEmpty() }?.let { KitTheme(it, binary) }
        }
    }
}

/**
 * The themes in place as one look (`kitThemeStack` in `theme.ts`), from the lowest to the
 * highest: an image is the highest theme's drawing of it, else itself.
 */
class ThemeStack private constructor(private val themes: List<KitTheme>) {
    /** The kit image [name], whose PNG is [png], as the themes show it. */
    fun shown(name: String, png: ByteArray): ByteArray = drawing(name, png) ?: png

    /** The themes' drawing of [name]: null unless one draws it at [png]'s size. */
    fun drawing(name: String, png: ByteArray): ByteArray? = themes.asReversed().firstNotNullOfOrNull { it.drawing(name, png) }

    companion object {
        /** Null for no theme. */
        fun of(themes: List<KitTheme>): ThemeStack? = themes.takeIf { it.isNotEmpty() }?.let(::ThemeStack)
    }
}
