package net.artisanmc.plugin

import net.artisanmc.plugin.resourcepack.AssetCatalog
import net.artisanmc.plugin.resourcepack.PackLoadTracker
import net.artisanmc.plugin.resourcepack.PaperOverlay
import net.kyori.adventure.key.Key
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.TextComponent
import net.kyori.adventure.text.format.ShadowColor
import net.kyori.adventure.text.minimessage.MiniMessage
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PaperOverlayTest {

    private val mm = MiniMessage.miniMessage()
    private val offsets = listOf(1, 2, 4, 8, 16, 32, 64, 128, 256, -1, -2, -4, -8, -16, -32, -64, -128, -256)
    private val advanceOf = offsets.mapIndexed { i, adv -> (0xF800 + i) to adv }.toMap()

    private fun overlay(tmp: Path): PaperOverlay {
        val key = PaperOverlay.key("box", 92)
        val offsetsJson = advanceOf.entries.joinToString(",") { (cp, adv) -> "\"${cp.toString(16).uppercase()}\": $adv" }
        val cache = tmp.resolve("asset-index.json").toFile()
        cache.writeText(
            """{ "version": 2, "offsets": { $offsetsJson }, "assets": {
                "$key": { "name": "box", "type": "overlay", "codepoint": 57344, "ascent": 99, "height": 100,
                          "width": 300, "namespace": "artisan:$key", "slices": [256, 40] } } }""",
        )
        val catalog = AssetCatalog(cacheFile = cache).also { it.loadFromDisk() }
        return PaperOverlay({ catalog }, PackLoadTracker())
    }

    /** Every text leaf with its font and shadow, in order. */
    private fun leaves(c: Component, font: Key? = null, out: MutableList<Triple<String, Key?, ShadowColor?>> = mutableListOf()):
        List<Triple<String, Key?, ShadowColor?>> {
        val f = c.style().font() ?: font
        if (c is TextComponent && c.content().isNotEmpty()) out += Triple(c.content(), f, c.style().shadowColor())
        c.children().forEach { leaves(it, f, out) }
        return out
    }

    @Test
    fun `width sums the vanilla advances, bold adding one a character`(@TempDir tmp: Path) {
        assertEquals(7 + 7 + 6, overlay(tmp).width("<bold>ab</bold>c"))
        assertEquals(2 + 2, overlay(tmp).width("<red>i!"))
    }

    @Test
    fun `move is space characters of artisan default`(@TempDir tmp: Path) {
        val (text, font) = leaves(mm.deserialize(overlay(tmp).move(-300))).single()
        assertEquals(Key.key("artisan", "default"), font)
        assertEquals(-300, text.sumOf { advanceOf.getValue(it.code) })
        assertEquals("", overlay(tmp).move(0))
    }

    @Test
    fun `raise wraps the text in the rising font, clamped to 128`(@TempDir tmp: Path) {
        val parts = leaves(mm.deserialize(overlay(tmp).raise("<bold>Bruno</bold>", 200)))
        assertEquals(listOf("Bruno" to Key.key("artisan", "text_up128")), parts.map { it.first to it.second })
    }

    @Test
    fun `an image's slices are joined 256 px apart and the pen comes back`(@TempDir tmp: Path) {
        val parts = leaves(mm.deserialize(overlay(tmp).image("box", 92)!!))
        val glyphs = parts.filter { it.second == Key.key("artisan", PaperOverlay.key("box", 92)) }
        assertEquals(listOf("", ""), glyphs.map { it.first })
        assertEquals(setOf(ShadowColor.none()), glyphs.map { it.third }.toSet())
        // Pen: slice 0 advances 257, back 1 to 256, slice 1 advances 41, back 297 to 0.
        var pen = 0
        val starts = mutableListOf<Int>()
        for ((text, font, _) in parts) {
            if (font == Key.key("artisan", "default")) pen += text.sumOf { advanceOf.getValue(it.code) }
            else { starts += pen; pen += if (text == "") 257 else 41 }
        }
        assertEquals(listOf(0, 256), starts)
        assertEquals(0, pen)
    }

    @Test
    fun `an image the pack does not have is null`(@TempDir tmp: Path) {
        assertNull(overlay(tmp).image("box", 91))
        assertNull(overlay(tmp).image("panel", 92))
        assertNull(PaperOverlay({ null }, PackLoadTracker()).image("box", 92))
    }
}
