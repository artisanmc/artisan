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
        // The reference to minecraft:default comes last: a font takes each character from the first
        // provider that has it, and minecraft:default merges every pack the client loaded, its own
        // packs included. First, a client pack's private-use glyphs (negative space fonts use
        // U+F801..) took over the offsets and images of every Artisan title.
        val providers = mutableListOf<Any?>()
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
        providers += mapOf("type" to "reference", "id" to "minecraft:default")
        return mapOf("providers" to providers)
    }

    /** [symbols]: the `chars` rows of the pack's symbols sheet ([Symbols]), drawn after vanilla; empty, no provider. */
    fun textYFontJson(
        y: Int,
        h: Int,
        symbols: List<String> = emptyList(),
        decorations: Boolean = false,
        sheets: List<TextSheet> = TextChars.ALL,
    ): Map<String, Any?> {
        val shift = 6 - y
        val scale = h / 8.0
        // The vanilla sheets redrawn with the characters the pack keeps ([TextChars]).
        fun bitmap(v: TextSheet) = mapOf(
            "type" to "bitmap",
            "file" to "artisan:font/text_${v.name}.png",
            "ascent" to v.ascent + shift,
            "height" to round(v.height * scale),
            "chars" to v.chars,
        )
        return mapOf(
            "providers" to listOf(
                mapOf("type" to "space", "advances" to mapOf(" " to 4 * scale)),
            ) + sheets.map(::bitmap) +
                (if (symbols.isEmpty()) emptyList() else listOf(mapOf(
                "type" to "bitmap",
                "file" to "artisan:font/symbols.png",
                "ascent" to Symbols.ASCENT + shift,
                "height" to round(Symbols.HEIGHT * scale),
                "chars" to symbols,
            ))) + (if (!decorations) emptyList() else listOf(mapOf(
                // 16 rows at the ascii scale: the same ascent puts row 0 at the text's top.
                "type" to "bitmap",
                "file" to "artisan:font/decorations.png",
                "ascent" to ASCII.ascent + shift,
                "height" to 2 * h,
                "chars" to TextDecorations.CHARS,
            ))),
        )
    }

    fun textUpFontJson(rise: Int, symbols: List<String> = emptyList(), sheets: List<TextSheet> = TextChars.ALL): Map<String, Any?> = mapOf(
        "providers" to listOf<Any?>(mapOf("type" to "space", "advances" to mapOf(" " to 4))) +
            sheets.map { v ->
                mapOf(
                    "type" to "bitmap",
                    "file" to "artisan:font/${v.name}_up.png",
                    "ascent" to v.ascent + rise,
                    "height" to v.height + TEXT_UP_PAD,
                    "chars" to v.chars,
                )
            } +
            // Up to [Symbols.UP_FULL_MAX]: 16 px cells at half size, 2 × UP_FULL_MAX rows under each;
            // above, 8 px cells at scale 1, TEXT_UP_PAD rows under each ([Symbols.sheet]).
            (if (symbols.isEmpty()) emptyList() else listOf(mapOf(
                "type" to "bitmap",
                "file" to if (rise <= Symbols.UP_FULL_MAX) "artisan:font/symbols_up.png" else "artisan:font/symbols_up_half.png",
                "ascent" to Symbols.ASCENT + rise,
                "height" to Symbols.HEIGHT + if (rise <= Symbols.UP_FULL_MAX) Symbols.UP_FULL_MAX else TEXT_UP_PAD,
                "chars" to symbols,
            ))),
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
