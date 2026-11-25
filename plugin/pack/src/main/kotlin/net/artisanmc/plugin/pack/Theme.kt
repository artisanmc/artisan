package net.artisanmc.plugin.pack

/**
 * A theme (`theme.ts`): the same images, under the same names and at the same sizes, with other
 * pixels. It is a folder of its own beside the theme `artisan`, a Project of its name (ADR
 * `common-images-and-themes`, decision 5):
 *
 * ```
 * themes/noel/overrides/colors.yml                colors: {"#3c8527": "#b3261e"}
 * themes/noel/overrides/artisan/button.3x1.png    this common image redrawn, at its size
 * ```
 *
 * A server whose Artisan is older than that keeps its themes in the common images' Project
 * ([Kit.FOLDER]), which is read where no Project of the theme's name is:
 *
 * ```
 * themes/noel/theme.yml                         colors: {"#3c8527": "#b3261e"}
 * themes/noel/assets/textures/button.3x1.png    this image redrawn, at its size
 * ```
 *
 * A theme in place changes what `kit:<name>` shows: the theme's own drawing of that image when
 * it has one of the same size, else the image with each colour of the table replaced, its
 * transparency kept. A theme holds no Document and moves nothing, so a menu laid out against
 * the kit keeps its layout; at worst it is ugly.
 *
 * The themes in place are a stack (`resource-pack.themes` of `config.yml`, the lowest first):
 * each changes what the ones below show ([ThemeStack]), so the highest that draws an image
 * wins, and a theme of colours alone repaints what is below it.
 */
class KitTheme internal constructor(
    /** A colour to its replacement, each as `0xRRGGBB`. */
    private val colors: Map<Int, Int>,
    /** The images the theme redraws: their name to their file. */
    private val redrawn: Map<String, String>,
    private val binary: (String) -> ByteArray?,
    /** The modules' images the theme redraws: their [moduleImageKey] to their file. */
    private val modules: Map<String, String> = emptyMap(),
) {
    private val files = HashMap<String, ByteArray?>()

    /** The names of the images this theme redraws. */
    val drawings: Set<String> get() = redrawn.keys

    /** How many colours the theme replaces. */
    val colorCount: Int get() = colors.size

    /** The kit image [name], whose PNG is [png], as the theme shows it. */
    fun shown(name: String, png: ByteArray): ByteArray = drawing(name, png) ?: recolored(png)

    /** The theme's own drawing of [name], when it has one as large as [png]; null otherwise. */
    fun drawing(name: String, png: ByteArray): ByteArray? = drawnAt(redrawn[name], png)

    /** The modules' images this theme redraws, each as `<module>:<name>`. */
    val moduleDrawings: Set<String> get() = modules.keys

    /**
     * The theme's own drawing of the image [name] of the module [folder], whose PNG is [png], when
     * it has one as large; null otherwise. A module's image is never recoloured: drawn or left.
     */
    fun moduleDrawing(folder: String, name: String, png: ByteArray): ByteArray? = drawnAt(modules[moduleImageKey(folder, name)], png)

    /** The theme's file at [path], when it is as large as [png]: a drawing of another size is left out. */
    private fun drawnAt(path: String?, png: ByteArray): ByteArray? {
        if (path == null) return null
        val mine = files.getOrPut(path) { binary(path) } ?: return null
        val base = runCatching { Png.decode(png) }.getOrNull() ?: return null
        val drawn = runCatching { Png.decode(mine) }.getOrNull() ?: return null
        return mine.takeIf { drawn.width == base.width && drawn.height == base.height }
    }

    /** [png] with the theme's colours; [png] itself when none of its pixels has one. */
    fun recolored(png: ByteArray): ByteArray {
        if (colors.isEmpty()) return png
        val image = runCatching { Png.decode(png) }.getOrNull() ?: return png
        return if (recolor(image)) Png.encode(image) else png
    }

    /** Replaces the colours of [image] in place, whatever their alpha above zero; whether a pixel changed. */
    fun recolor(image: RgbaImage): Boolean {
        var changed = false
        val data = image.data
        var i = 0
        while (i < data.size) {
            if (data[i + 3].toInt() != 0) {
                val rgb = ((data[i].toInt() and 0xff) shl 16) or ((data[i + 1].toInt() and 0xff) shl 8) or (data[i + 2].toInt() and 0xff)
                val to = colors[rgb]
                if (to != null) {
                    data[i] = (to shr 16).toByte()
                    data[i + 1] = (to shr 8).toByte()
                    data[i + 2] = to.toByte()
                    changed = true
                }
            }
            i += 4
        }
        return changed
    }

    companion object {
        /** The folder of the themes, at the kit module's root: where a server older than a theme's own folder keeps them. */
        const val DIR = "themes"

        /** In a theme's own folder, what it changes in images that exist elsewhere. */
        const val OVERRIDES_DIR = "overrides/"

        /** Its redraws of the common images, before the image's name. */
        const val COMMON_DIR = OVERRIDES_DIR + "artisan/"

        /** Its table of colours: `.yml` before `.yaml`. */
        val COLORS_FILES = listOf(OVERRIDES_DIR + "colors.yml", OVERRIDES_DIR + "colors.yaml")

        /** The path of the theme's own drawing of the common image [name]. */
        fun drawingPath(name: String): String = "$COMMON_DIR$name.png"

        /** Colours a theme may replace. */
        const val MAX_COLORS = 256

        private val NAME = Regex("^[a-z0-9][a-z0-9_-]*$")
        private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
        private val IMAGE_DIRS = listOf("assets/glyphs/", "assets/textures/")
        private val FILE = Regex("^themes/([^/]+)/theme\\.ya?ml$")

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

        /** The common images a theme of its own folder redraws among its [binaries], by name. */
        fun ownDrawings(binaries: Collection<String>): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for (path in binaries.sorted()) {
                val file = path.removePrefix(COMMON_DIR).takeIf { it.length < path.length } ?: continue
                if ('/' in file || !file.endsWith(".png") || file.length == ".png".length) continue
                out[file.dropLast(".png".length)] = path
            }
            return out
        }

        /** The key of the image [name] of the module [folder] among a theme's redraws of modules' images. */
        fun moduleImageKey(folder: String, name: String): String = "$folder:$name"

        /**
         * The modules' images a theme of its own folder redraws among its [binaries]
         * (`overrides/<module>/<image>.png`), by [moduleImageKey]. `overrides/artisan/` is the
         * common images' ([ownDrawings]).
         */
        fun ownModuleDrawings(binaries: Collection<String>): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for (path in binaries.sorted()) {
                if (!path.startsWith(OVERRIDES_DIR) || path.startsWith(COMMON_DIR)) continue
                val parts = path.substring(OVERRIDES_DIR.length).split('/')
                if (parts.size != 2 || parts[0].isEmpty()) continue
                val file = parts[1]
                if (!file.endsWith(".png") || file.length == ".png".length) continue
                out[moduleImageKey(parts[0], file.dropLast(".png".length))] = path
            }
            return out
        }

        /** A theme that is its own Project: its table and its redraws of the common images. One that holds neither changes nothing. */
        fun own(theme: PackProject): KitTheme = ownOf(theme.files.associate { it.path to it.content }, theme.binaries, theme.binary)

        /** [own] of a theme given as its text [files] (path to content), the paths of its [binaries] and what reads one. */
        fun ownOf(files: Map<String, String>, binaries: Collection<String>, binary: (String) -> ByteArray?): KitTheme =
            KitTheme(COLORS_FILES.firstNotNullOfOrNull(files::get)?.let(::colors).orEmpty(), ownDrawings(binaries), binary, ownModuleDrawings(binaries))

        /** `0xRRGGBB` of `#rrggbb`; null for anything else. */
        fun color(text: Any?): Int? = (text as? String)?.takeIf { COLOR.matches(it) }?.substring(1)?.toInt(16)

        /**
         * The table a `theme.yml` holds: `colors`, a map of `"#rrggbb"` to `"#rrggbb"` (quoted, a
         * `#` starts a comment otherwise). An entry that is not two such colours, or that changes
         * nothing, is left out; an unreadable file has no table.
         */
        fun colors(text: String): Map<Int, Int> {
            val table = ((Yaml.parseOrNull(text) as? Map<*, *>)?.get("colors") as? Map<*, *>) ?: return emptyMap()
            val out = LinkedHashMap<Int, Int>()
            for ((key, value) in table) {
                if (out.size >= MAX_COLORS) break
                val from = color(key) ?: continue
                val to = color(value) ?: continue
                if (from != to) out[from] = to
            }
            return out
        }

        /** The path of the theme [name]'s file among [paths]: `.yml` before `.yaml`. */
        fun file(name: String, paths: Collection<String>): String? =
            listOf("$DIR/$name/theme.yml", "$DIR/$name/theme.yaml").firstOrNull { it in paths }

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

        /** The themes a kit module holds: every `themes/<name>/` with a `theme.yml` or a redrawn image. */
        fun names(files: Collection<String>, binaries: Collection<String>): List<String> =
            (files + binaries).asSequence()
                .filter { it.startsWith("$DIR/") }
                .map { it.substring(DIR.length + 1).substringBefore('/') }
                .filter(::isName)
                .distinct()
                .filter { file(it, files) != null || drawings(it, binaries).isNotEmpty() }
                .sorted()
                .toList()

        /** The theme [name] of the kit module [kit]; null when the module has no such theme. */
        fun read(name: String, kit: PackProject): KitTheme? =
            of(name, kit.files.associate { it.path to it.content }, kit.binaries, kit.binary)

        /**
         * The theme [name] of a kit module given as its text [files] (path to content), the paths of
         * its [binaries] and what reads one; null when the module has no such theme.
         */
        fun of(name: String, files: Map<String, String>, binaries: Collection<String>, binary: (String) -> ByteArray?): KitTheme? {
            if (!isName(name)) return null
            val file = file(name, files.keys)
            val redrawn = drawings(name, binaries)
            if (file == null && redrawn.isEmpty()) return null
            return KitTheme(file?.let(files::get)?.let(::colors).orEmpty(), redrawn, binary)
        }

        /** The theme whose file is at [path] (`themes/<name>/theme.yml`); null for any other path. */
        fun nameOfFile(path: String): String? =
            FILE.matchEntire(path)?.groupValues?.get(1)

        /**
         * What is wrong in a `theme.yml` about to be written, for whoever writes one (the pack
         * itself reads what it can and leaves the rest out): empty when the table is sound.
         */
        fun problems(text: String): List<String> {
            val root = Yaml.parseOrNull(text) as? Map<*, *>
                ?: return listOf("The file is not a YAML map. A theme is `colors: {\"#3c8527\": \"#b3261e\"}`.")
            val table = root["colors"] as? Map<*, *>
                ?: return listOf("`colors` is not a map of colours. Quote each one: `colors: {\"#3c8527\": \"#b3261e\"}` (unquoted, `#` starts a comment and the line is empty).")
            val out = ArrayList<String>()
            if (table.size > MAX_COLORS) out += "`colors` holds ${table.size} colours: a theme replaces $MAX_COLORS at most."
            for ((key, value) in table) {
                if (out.size >= 8) break
                if (color(key) == null) out += "`colors`: '$key' is not a colour as \"#rrggbb\"."
                else if (color(value) == null) out += "`colors`: '$key' is replaced by '$value', which is not a colour as \"#rrggbb\"."
            }
            return out
        }
    }
}

/**
 * The themes in place as one look (`kitThemeStack` in `theme.ts`), from the lowest to the
 * highest: each is applied to what the ones below show, so the highest that draws an image wins
 * and the colours of the ones above it repaint that drawing. A module's image is the highest
 * theme's drawing of it, as drawn.
 */
class ThemeStack private constructor(private val themes: List<KitTheme>) {
    /** The kit image [name], whose PNG is [png], as the themes show it. */
    fun shown(name: String, png: ByteArray): ByteArray = themes.fold(png) { out, theme -> theme.shown(name, out) }

    /**
     * The themes' drawing of [name]: null unless one draws it at [png]'s size (a table of colours
     * is not a drawing); the themes above the one that does repaint its drawing, as in [shown].
     */
    fun drawing(name: String, png: ByteArray): ByteArray? {
        var out: ByteArray? = null
        for (theme in themes) out = theme.drawing(name, out ?: png) ?: out?.let(theme::recolored)
        return out
    }

    /** The image [name] of the module [folder] as the highest theme that redraws it at [png]'s size draws it; null when none does. */
    fun moduleDrawing(folder: String, name: String, png: ByteArray): ByteArray? =
        themes.asReversed().firstNotNullOfOrNull { it.moduleDrawing(folder, name, png) }

    companion object {
        /** Null for no theme. */
        fun of(themes: List<KitTheme>): ThemeStack? = themes.takeIf { it.isNotEmpty() }?.let(::ThemeStack)
    }
}
