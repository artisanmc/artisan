package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper


/** A vanilla bitmap font of `minecraft:default`: cell height, ascent, the rows of its atlas. */
internal class VanillaFont(val height: Int, val ascent: Int, val chars: List<String>)

/**
 * The fonts every pack carries (`fontJsonBuilder.ts`, `spaceOffsets.ts`): `artisan:default`
 * (glyphs + the `space` provider of pixel offsets), `text_y{Y}_h{H}`, `text_up{R}`, `glyph_y{Y}`.
 */
internal object Fonts {
    /** `vanillaFontChars.ts`, exported by `npm run pack -- kotlin-data` (editor). */
    private val vanilla: Map<String, VanillaFont> by lazy {
        val stream = Fonts::class.java.getResourceAsStream("vanilla-font-chars.json")
            ?: error("vanilla-font-chars.json missing from the jar")
        val tree = stream.use { ObjectMapper().readTree(it) }
        tree.fields().asSequence().associate { (name, font) ->
            name to VanillaFont(font["height"].asInt(), font["ascent"].asInt(), font["chars"].map { it.asText() })
        }
    }
    val ASCII get() = vanilla.getValue("ascii")
    val ACCENTED get() = vanilla.getValue("accented")
    val NONLATIN_EUROPEAN get() = vanilla.getValue("nonlatin_european")

    const val SPACE_OFFSET_CODEPOINT_START = 0xf800
    val SPACE_OFFSET_ADVANCES = listOf(1, 2, 4, 8, 16, 32, 64, 128, 256, -1, -2, -4, -8, -16, -32, -64, -128, -256)

    /** `(codepoint, advance)` of each pixel offset of the `space` provider. */
    fun spaceOffsetTable(): List<Pair<Int, Int>> = SPACE_OFFSET_ADVANCES.mapIndexed { i, a -> (SPACE_OFFSET_CODEPOINT_START + i) to a }

    /** Transparent rows under each cell of the `*_up.png` textures. */
    const val TEXT_UP_PAD = 128

    /** Highest rise of an `artisan:text_up{R}` font. */
    const val TEXT_UP_MAX = 128
    val TEXT_UP_TEXTURES = listOf("ascii", "accented", "nonlatin_european")

    const val GLYPH_Y_BASE = 13

    fun defaultGlyphY(ascent: Double?): Double = GLYPH_Y_BASE - (ascent ?: 0.0)

    fun glyphYFloor(height: Double): Double = GLYPH_Y_BASE - height

    private fun round(x: Double): Long = Math.round(x)

    fun minYForSize(h: Int): Int {
        val scale = h / 8.0
        return listOf(ASCII, ACCENTED, NONLATIN_EUROPEAN).maxOf { (it.ascent + 6 - round(it.height * scale)).toInt() }
    }

    fun defaultFontJson(assets: List<AssetRow>): Map<String, Any?> {
        val glyphs = assets.filter { it.type == "glyph" && it.codepoint != null }.sortedBy { it.codepoint }
        val providers = mutableListOf<Any?>(mapOf("type" to "reference", "id" to "minecraft:default"))
        for (g in glyphs) {
            providers += mapOf(
                "type" to "bitmap",
                "file" to "artisan:font/${g.name}.png",
                "ascent" to g.ascent,
                "height" to g.height,
                "chars" to listOf(Js.fromCodePoint(g.codepoint!!)),
            )
        }
        val advances = LinkedHashMap<String, Any?>()
        for ((codepoint, advance) in spaceOffsetTable()) advances[String(Character.toChars(codepoint))] = advance
        providers += mapOf("type" to "space", "advances" to advances)
        return mapOf("providers" to providers)
    }

    fun textYFontJson(y: Int, h: Int): Map<String, Any?> {
        val shift = 6 - y
        val scale = h / 8.0
        fun bitmap(file: String, v: VanillaFont) = mapOf(
            "type" to "bitmap",
            "file" to file,
            "ascent" to v.ascent + shift,
            "height" to round(v.height * scale),
            "chars" to v.chars,
        )
        return mapOf(
            "providers" to listOf(
                mapOf("type" to "space", "advances" to mapOf(" " to 4 * scale)),
                bitmap("minecraft:font/ascii.png", ASCII),
                bitmap("minecraft:font/accented.png", ACCENTED),
                bitmap("minecraft:font/nonlatin_european.png", NONLATIN_EUROPEAN),
            ),
        )
    }

    fun textUpFontJson(rise: Int): Map<String, Any?> = mapOf(
        "providers" to listOf<Any?>(mapOf("type" to "space", "advances" to mapOf(" " to 4))) +
            listOf("ascii" to ASCII, "accented" to ACCENTED, "nonlatin_european" to NONLATIN_EUROPEAN).map { (name, v) ->
                mapOf(
                    "type" to "bitmap",
                    "file" to "artisan:font/${name}_up.png",
                    "ascent" to v.ascent + rise,
                    "height" to v.height + TEXT_UP_PAD,
                    "chars" to v.chars,
                )
            },
    )

    fun glyphYFontJson(y: Double, glyphs: Collection<AssetRow>): Map<String, Any?> = mapOf(
        "providers" to glyphs.sortedBy { it.codepoint ?: 0.0 }.map { g ->
            mapOf(
                "type" to "bitmap",
                "file" to "artisan:font/${g.name}.png",
                "ascent" to GLYPH_Y_BASE - y,
                "height" to g.height,
                "chars" to listOf(Js.fromCodePoint(g.codepoint!!)),
            )
        },
    )

}
