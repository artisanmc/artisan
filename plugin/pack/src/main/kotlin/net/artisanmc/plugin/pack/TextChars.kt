package net.artisanmc.plugin.pack

/** A vanilla sheet as the text fonts draw it: its kept characters and where they come from. */
internal class TextSheet(
    /** One of [Fonts.TEXT_UP_TEXTURES]. */
    val name: String,
    val height: Int,
    val ascent: Int,
    /** Rows of [TextChars.COLUMNS] characters, `\0` after the last one. */
    val chars: List<String>,
    /** The vanilla cell of each kept character, `(column, row)`, in the order of [chars]. */
    val cells: List<Pair<Int, Int>>,
)

/**
 * The vanilla characters of the `text_y` / `text_up` fonts. Those ~300 fonts each listed the
 * ~2 500 characters of the three vanilla sheets (~7.5 KB each, most of a pack), so each sheet is
 * now redrawn in the pack with only the characters kept, in [COLUMNS] columns of the vanilla cell
 * size (`text_<sheet>.png` for `text_y`, `<sheet>_up.png` padded for `text_up`), and the fonts
 * list only those. Kept:
 *  - every character of the Latin and Greek blocks and of U+2000–2BFF (punctuation, currency,
 *    arrows, maths, shapes, symbols, dingbats) and the emoji of U+1F000–1FAFF ([BASE]): player
 *    names, European languages and the symbols other plugins' prefixes and placeholders use
 *    (€ ★ ❤ ✔ ⚔ →), whatever the Projects say;
 *  - every other character the Projects' files contain (menus, lang files, data rows).
 * A character an earlier sheet already draws is left out of the later ones (the first provider
 * wins in Minecraft, so it was never drawn there). Text written at run time outside every
 * Project (another plugin's placeholder in Cyrillic, say) draws the missing glyph.
 * The glyphs are the vanilla ones copied from the padded textures: a resource pack that replaces
 * `minecraft:font/ascii.png` no longer changes them, as it never changed `text_up`.
 * Mirror of `textChars.ts` (editor).
 */
internal object TextChars {
    val BASE = listOf(0x0000..0x024f, 0x0370..0x03ff, 0x2000..0x2bff, 0x1f000..0x1faff)

    /** Cells per row of a redrawn sheet: the vanilla sheets' own width. */
    const val COLUMNS = 16

    private fun vanilla(name: String): VanillaFont = when (name) {
        "ascii" -> Fonts.ASCII
        "accented" -> Fonts.ACCENTED
        "nonlatin_european" -> Fonts.NONLATIN_EUROPEAN
        else -> error("unknown vanilla sheet $name")
    }

    private fun inBase(cp: Int) = BASE.any { cp in it }

    /** The characters of the texts outside [BASE], as codepoints. */
    fun used(texts: Iterable<String>): Set<Int> {
        val used = HashSet<Int>()
        for (text in texts) text.codePoints().forEach { if (!inBase(it)) used += it }
        return used
    }

    /** The sheets with a kept character, in vanilla order; a null [used] keeps every one. */
    fun sheets(used: Set<Int>?): List<TextSheet> {
        val seen = HashSet<Int>()
        val sheets = ArrayList<TextSheet>()
        for (name in Fonts.TEXT_UP_TEXTURES) {
            val v = vanilla(name)
            val kept = ArrayList<Int>()
            val cells = ArrayList<Pair<Int, Int>>()
            v.chars.forEachIndexed { r, row ->
                var c = 0
                row.codePoints().forEach { cp ->
                    if (cp != 0 && cp !in seen && (used == null || inBase(cp) || cp in used)) {
                        seen += cp
                        kept += cp
                        cells += c to r
                    }
                    c++
                }
            }
            if (kept.isEmpty()) continue
            val chars = kept.chunked(COLUMNS).map { row ->
                val out = StringBuilder()
                for (cp in row) out.appendCodePoint(cp)
                repeat(COLUMNS - row.size) { out.append('\u0000') }
                out.toString()
            }
            sheets += TextSheet(name, v.height, v.ascent, chars, cells)
        }
        return sheets
    }

    /** Every vanilla character: the fonts' sheets when nothing says which characters to keep. */
    val ALL: List<TextSheet> by lazy { sheets(null) }

    /** [sheet]'s cells copied from its padded vanilla texture; [padded] keeps the rows under each. */
    private fun sheetImage(sheet: TextSheet, up: RgbaImage, padded: Boolean): RgbaImage {
        val v = vanilla(sheet.name)
        val width = up.width / v.chars[0].let { it.codePointCount(0, it.length) }
        val cellUp = up.height / v.chars.size
        val height = if (padded) cellUp else cellUp - Fonts.TEXT_UP_PAD
        val out = RgbaImage(COLUMNS * width, sheet.chars.size * height)
        sheet.cells.forEachIndexed { i, (c, r) ->
            Png.bitblt(up, out, c * width, r * cellUp, width, height, (i % COLUMNS) * width, (i / COLUMNS) * height)
        }
        return out
    }

    /** The pack's textures of [sheets], from the padded vanilla textures: `text_<sheet>.png` and `<sheet>_up.png`. */
    fun files(sheets: List<TextSheet>, textUp: (String) -> ByteArray, files: MutableMap<String, ByteArray>) {
        for (sheet in sheets) {
            val up = Png.decode(textUp(sheet.name))
            files["assets/artisan/textures/font/text_${sheet.name}.png"] = Png.encode(sheetImage(sheet, up, false))
            files["assets/artisan/textures/font/${sheet.name}_up.png"] = Png.encode(sheetImage(sheet, up, true))
        }
    }
}
