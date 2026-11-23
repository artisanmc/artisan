package net.artisanmc.plugin.pack

/**
 * Underline and strikethrough of title texts, as bar glyphs of the `text_y` fonts: Minecraft
 * draws these lines at fixed rows of the title line, so a text moved by `text_y{Y}` left its
 * line behind. `TitleCompiler` draws them with these bars instead. 16 glyphs in 128 × 16 cells,
 * drawn at the ascii sheet's scale (16 rows for twice its 8, so the rows are half pixels): the
 * underline bars (`U+F7F0` + i, 2^i px wide) on row 8 (one text height below the top), the
 * strikethrough bars (`U+F7F8` + i) on row 4. Port of the editor's `textDecorations.ts`.
 */
internal object TextDecorations {
    const val UNDERLINE = 0xF7F0
    const val STRIKE = 0xF7F8
    private const val CELL_W = 128
    private const val CELL_H = 16

    /** The MiniMessage tags that ask for a line; their texts get the bars in the pack. */
    private val TAG = Regex("<(?:u|underlined|st|strikethrough)>", RegexOption.IGNORE_CASE)

    fun used(texts: Iterable<String>): Boolean = texts.any { TAG.containsMatchIn(it) }

    /** The provider's one row of chars: the 8 underline bars, then the 8 strikethrough ones. */
    val CHARS: String = buildString { for (i in 0 until 16) appendCodePoint(UNDERLINE + i) }

    fun sheet(): RgbaImage {
        val image = RgbaImage(16 * CELL_W, CELL_H)
        for (i in 0 until 16) {
            val row = if (i < 8) 8 else 4
            val width = 1 shl (i % 8)
            val start = (row * image.width + i * CELL_W) * 4
            image.data.fill(-1, start, start + width * 4)
        }
        return image
    }
}
