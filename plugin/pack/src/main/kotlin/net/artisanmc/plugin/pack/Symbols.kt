package net.artisanmc.plugin.pack

/**
 * The symbols of title texts that the vanilla bitmap fonts lack (arrows, maths, box drawing,
 * shapes, dingbats…), drawn from GNU Unifont as the chat does. A pack carries only the ones its
 * Projects' files use: one sheet of 16 px cells (`symbols.png`, and `symbols_up.png` padded for
 * the rising fonts), one more bitmap provider in each `text_y` / `text_up` font.
 * Port of the editor's `symbols.ts`; the glyphs are `symbolGlyphs.ts`, exported by
 * `npm run pack -- kotlin-data` as `symbol-glyphs.hex`.
 */
internal object Symbols {
    /** Drawn like the ascii sheet: 8 px high, baseline 7 px below the top (16 px cells at half size). */
    const val HEIGHT = 8
    const val ASCENT = 7
    private const val CELL = 16

    /** Cells per row: as many as the symbols, up to 256, so only a large set's last row pads (`symbols.ts`). */
    private fun columns(count: Int) = count.coerceIn(1, 256)

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

    /** The sheet: [columns] cells per row, white glyphs; [pad] transparent rows under each cell. */
    fun sheet(symbols: List<Int>, pad: Int = 0): RgbaImage {
        val cellH = CELL + pad
        val cols = columns(symbols.size)
        val image = RgbaImage(cols * CELL, (symbols.size + cols - 1) / cols * cellH)
        symbols.forEachIndexed { i, cp ->
            val hex = glyphs.getValue(cp)
            val width = if (hex.length == 64) 16 else 8
            val digits = width / 4
            val x0 = (i % cols) * CELL
            val y0 = (i / cols) * cellH
            for (y in 0 until CELL) {
                val bits = hex.substring(y * digits, (y + 1) * digits).toInt(16)
                for (x in 0 until width) {
                    if ((bits shr (width - 1 - x)) and 1 == 0) continue
                    image.data.fill(-1, ((y0 + y) * image.width + x0 + x) * 4, ((y0 + y) * image.width + x0 + x) * 4 + 4)
                }
            }
        }
        return image
    }
}
