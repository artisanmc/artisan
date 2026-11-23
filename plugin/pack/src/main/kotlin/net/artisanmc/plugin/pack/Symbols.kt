package net.artisanmc.plugin.pack

/**
 * The symbols of title texts that the vanilla bitmap fonts lack (arrows, maths, box drawing,
 * shapes, dingbats…), drawn from GNU Unifont as the chat does. A pack carries only the ones its
 * Projects' files use: one sheet of 16 px cells (`symbols.png`, and `symbols_up.png` padded for
 * the rising fonts up to [UP_FULL_MAX], `symbols_up_half.png` at half resolution above), one more
 * bitmap provider in each `text_y` / `text_up` font.
 * Port of the editor's `symbols.ts`; the glyphs are `symbolGlyphs.ts`, exported by
 * `npm run pack -- kotlin-data` as `symbol-glyphs.hex`.
 */
internal object Symbols {
    /** Drawn like the ascii sheet: 8 px high, baseline 7 px below the top (16 px cells at half size). */
    const val HEIGHT = 8
    const val ASCENT = 7
    private const val CELL = 16

    /** Cells per row: as many as the symbols, up to 16 (256 px): Nexo replaces a wider one-row font texture. */
    private fun columns(count: Int) = count.coerceIn(1, 16)

    /** Highest `text_up` rise drawn at full resolution: a 16 + 2 × 120 px cell, within Nexo's 256 (`symbols.ts`). */
    const val UP_FULL_MAX = 120

    private val glyphs: Map<Int, String> by lazy {
        val text = Symbols::class.java.getResourceAsStream("symbol-glyphs.hex")?.use { it.readBytes().decodeToString() }
            ?: error("symbol-glyphs.hex missing from the jar")
        text.lineSequence().filter { ':' in it }
            .associate { it.substringBefore(':').toInt(16) to it.substringAfter(':').trim() }
    }

    /** The symbols the texts use, in codepoint order. */
    fun used(texts: Iterable<String>): List<Int> {
        val used = sortedSetOf<Int>()
        for (text in texts) text.codePoints().forEach { if (it in glyphs) used += it }
        return used.toList()
    }

    /** The `chars` of the sheet's bitmap provider: rows of [columns], `\u0000` for an empty cell. */
    fun rows(symbols: List<Int>): List<String> {
        val cols = columns(symbols.size)
        return symbols.chunked(cols).map { row ->
            buildString {
                for (cp in row) appendCodePoint(cp)
                repeat(cols - row.size) { append('\u0000') }
            }
        }
    }

    /** The sheet: [columns] cells per row, white glyphs; [pad] transparent rows under each cell. [half]: 8 px cells, a pixel lit when any of its 2 × 2 is. */
    fun sheet(symbols: List<Int>, pad: Int = 0, half: Boolean = false): RgbaImage {
        val cell = if (half) CELL / 2 else CELL
        val cellH = cell + pad
        val cols = columns(symbols.size)
        val image = RgbaImage(cols * cell, (symbols.size + cols - 1) / cols * cellH)
        symbols.forEachIndexed { i, cp ->
            val hex = glyphs.getValue(cp)
            val width = if (hex.length == 64) 16 else 8
            val digits = width / 4
            val x0 = (i % cols) * cell
            val y0 = (i / cols) * cellH
            for (y in 0 until CELL) {
                val bits = hex.substring(y * digits, (y + 1) * digits).toInt(16)
                for (x in 0 until width) {
                    if ((bits shr (width - 1 - x)) and 1 == 0) continue
                    val at = ((y0 + if (half) y shr 1 else y) * image.width + x0 + if (half) x shr 1 else x) * 4
                    image.data.fill(-1, at, at + 4)
                }
            }
        }
        return image
    }
}
