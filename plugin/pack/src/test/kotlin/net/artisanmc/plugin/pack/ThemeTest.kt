package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The same cases as the editor's `theme.test.ts`: the two builders read and apply a theme alike.
class ThemeTest {
    private fun solid(width: Int, height: Int, vararg rgba: Int) = RgbaImage(width, height).also {
        for (i in it.data.indices) it.data[i] = rgba[i % 4].toByte()
    }

    private fun pixel(png: ByteArray, x: Int, y: Int) = Png.decode(png).let { image ->
        (0..3).map { image.data[(y * image.width + x) * 4 + it].toInt() and 0xff }
    }

    private fun kit(files: Map<String, String>, binaries: Map<String, ByteArray> = emptyMap()) =
        PackProject("ui-kit", files.map { PackFile(it.key, it.value) }, binaries.keys.toList(), { binaries[it] })

    private val table = "colors:\n  \"#3c8527\": \"#b3261e\"\n  \"#B3261E\": \"#ffffff\"\n"

    @Test
    fun `the table keeps the pairs of colours, quoted, that change something`() {
        val colors = KitTheme.colors(
            """
            colors:
              "#3c8527": "#b3261e"
              "#B0C88C": '#2E7D32'
              "#123456": "#123456"
              nope: "#000000"
              "#000001": red
              "#0000020": "#000000"
              "#abc": "#000000"
              #f4c842: "#000000"
              "#000003": 7
            """.trimIndent(),
        )
        assertEquals(mapOf(0x3c8527 to 0xb3261e, 0xb0c88c to 0x2e7d32), colors)
        assertEquals(emptyMap(), KitTheme.colors("colors: [a, b]\n"))
        assertEquals(emptyMap(), KitTheme.colors("name: Noël\n"))
        assertEquals(emptyMap(), KitTheme.colors("colors: {unclosed\n"))
        // The same colour twice is a file the editor does not read either.
        assertEquals(emptyMap(), KitTheme.colors("colors:\n  \"#000000\": \"#111111\"\n  \"#000000\": \"#222222\"\n"))
    }

    @Test
    fun `a theme is a folder of the kit module with a file or a redrawn image`() {
        val files = listOf("themes/noel/theme.yml", "themes/noel/theme.yaml", "themes/empty/notes.txt", "themes/Bad Name/theme.yml", "themes/theme.yml", "data/ui-kit.yml")
        val binaries = listOf(
            "themes/halloween/assets/textures/button.3x1.png",
            "themes/noel/assets/glyphs/banner.png",
            "themes/noel/assets/textures/banner.png",
            "themes/noel/assets/glyphs/star.png",
            "themes/noel/assets/textures/deep/button.3x1.png",
            "themes/noel/assets/other/button.3x1.png",
            "themes/noel/assets/textures/.png",
            "themes/noel/button.3x1.png",
            "themes/elsewhere/button.3x1.png",
        )
        assertEquals(listOf("halloween", "noel"), KitTheme.names(files, binaries))
        assertEquals("themes/noel/theme.yml", KitTheme.file("noel", files))
        assertEquals("themes/noel/theme.yaml", KitTheme.file("noel", files - "themes/noel/theme.yml"))
        assertNull(KitTheme.file("halloween", files))
        // A texture wins over a glyph of the same name; what is not right under the two folders is no image.
        assertEquals(
            mapOf("banner" to "themes/noel/assets/textures/banner.png", "star" to "themes/noel/assets/glyphs/star.png"),
            KitTheme.drawings("noel", binaries),
        )
        assertNull(KitTheme.read("nowhere", kit(mapOf("themes/noel/theme.yml" to table))))
        assertNull(KitTheme.read("Bad Name", kit(mapOf("themes/Bad Name/theme.yml" to table))))
        assertNotNull(KitTheme.read("halloween", kit(emptyMap(), mapOf("themes/halloween/assets/textures/a.png" to byteArrayOf(1)))))
    }

    @Test
    fun `colours are replaced once, whatever the alpha above zero`() {
        val theme = assertNotNull(KitTheme.read("noel", kit(mapOf("themes/noel/theme.yml" to table))))
        val image = RgbaImage(4, 1)
        intArrayOf(0x3c, 0x85, 0x27, 255, 0x3c, 0x85, 0x27, 128, 0x3c, 0x85, 0x27, 0, 0xb3, 0x26, 0x1e, 255)
            .forEachIndexed { i, v -> image.data[i] = v.toByte() }
        val png = Png.encode(image)
        val out = theme.shown("button.3x1", png, true)
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(out, 0, 0))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 128), pixel(out, 1, 0))
        assertEquals(listOf(0x3c, 0x85, 0x27, 0), pixel(out, 2, 0))
        // What was red becomes white; what became red stays red.
        assertEquals(listOf(255, 255, 255, 255), pixel(out, 3, 0))
        // No colour of the table: the very same file, not one encoded again.
        val other = Png.encode(solid(2, 2, 1, 2, 3, 255))
        assertTrue(theme.shown("x", other, true) === other)
        val broken = byteArrayOf(1, 2, 3)
        assertTrue(theme.shown("x", broken, true) === broken)
    }

    @Test
    fun `an image the theme redraws at its size is taken as it is`() {
        val drawn = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val small = Png.encode(solid(1, 1, 9, 9, 9, 255))
        val theme = assertNotNull(
            KitTheme.read(
                "noel",
                kit(
                    mapOf("themes/noel/theme.yml" to table),
                    mapOf(
                        "themes/noel/assets/textures/close.png" to drawn,
                        "themes/noel/assets/textures/back.png" to small,
                        "themes/noel/assets/textures/broken.png" to byteArrayOf(1, 2, 3),
                    ),
                ),
            ),
        )
        assertEquals(setOf("back", "broken", "close"), theme.drawings)
        val base = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        // Its own colours are not replaced: it is drawn in the theme already.
        assertTrue(theme.shown("close", base, true) === drawn)
        assertTrue(theme.drawing("close", base) === drawn)
        // Another size, or unreadable: left out, the image takes the theme's colours.
        assertNull(theme.drawing("back", base))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(theme.shown("back", base, true), 0, 0))
        assertNull(theme.drawing("broken", base))
        assertNull(theme.drawing("other", base))
    }

    @Test
    fun `a theme file about to be written says what is wrong in it`() {
        assertEquals(emptyList(), KitTheme.problems("colors:\n  \"#3c8527\": \"#b3261e\"\n"))
        assertEquals(emptyList(), KitTheme.problems("colors: {}\n"))
        // Unquoted, `#` starts a comment: the table is empty, which is said rather than written.
        assertTrue("Quote" in KitTheme.problems("colors:\n  #3c8527: #b3261e\n").single())
        assertTrue("not a YAML map" in KitTheme.problems("- a\n").single())
        assertEquals(
            listOf("`colors`: 'green' is not a colour as \"#rrggbb\".", "`colors`: '#3c8527' is replaced by 'red', which is not a colour as \"#rrggbb\"."),
            KitTheme.problems("colors:\n  green: \"#b3261e\"\n  \"#3c8527\": red\n"),
        )
        assertEquals("noel", KitTheme.nameOfFile("themes/noel/theme.yml"))
        assertEquals("noel", KitTheme.nameOfFile("themes/noel/theme.yaml"))
        assertNull(KitTheme.nameOfFile("themes/noel/assets/theme.yml"))
        assertNull(KitTheme.nameOfFile("menus/theme.yml"))

    }

    @Test
    fun `the themes in place are the list, the lowest first, else the former single theme`() {
        assertEquals(emptyList(), KitTheme.configured(null))
        assertEquals(emptyList(), KitTheme.configured(emptyMap()))
        assertEquals(listOf("noel"), KitTheme.configured(mapOf("resource-pack.theme" to "noel")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.theme" to "")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.theme" to "Bad Name")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.theme" to 3)))
        // The list wins; a name that is not one, or said twice, is left out.
        assertEquals(
            listOf("noel", "nuit"),
            KitTheme.configured(mapOf("resource-pack.themes" to listOf("noel", "Bad Name", 3, "nuit", "noel"), "resource-pack.theme" to "paques")),
        )
        // An empty list leaves the former key its say: a config that was never rewritten.
        assertEquals(listOf("paques"), KitTheme.configured(mapOf("resource-pack.themes" to emptyList<String>(), "resource-pack.theme" to "paques")))
        assertEquals(emptyList(), KitTheme.configured(mapOf("resource-pack.themes" to "noel")))
    }

    @Test
    fun `themes in place stack, each changes what the ones below show`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val drawn = Png.encode(solid(2, 2, 0xb3, 0x26, 0x1e, 255))
        val top = Png.encode(solid(2, 2, 7, 7, 7, 255))
        val files = mapOf(
            // `noel`: green to red, and its own `close`, in red.
            "themes/noel/theme.yml" to "colors:\n  \"#3c8527\": \"#b3261e\"\n",
            // `nuit`: red to black, colours alone.
            "themes/nuit/theme.yml" to "colors:\n  \"#b3261e\": \"#000000\"\n",
        )
        val binaries = mapOf("themes/noel/assets/textures/close.png" to drawn, "themes/haut/assets/textures/close.png" to top)
        fun stack(vararg names: String) = KitTheme.stack(names.toList(), kit(files, binaries))
        assertNull(stack())
        assertNull(stack("nowhere"))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(stack("noel")!!.shown("x", green, true), 0, 0))
        // `nuit` above `noel` repaints what `noel` shows; under it, it finds no red yet.
        assertEquals(listOf(0, 0, 0, 255), pixel(stack("noel", "nuit")!!.shown("x", green, true), 0, 0))
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(stack("nuit", "noel")!!.shown("x", green, true), 0, 0))
        // A theme the module does not hold is left out of the stack.
        assertEquals(listOf(0, 0, 0, 255), pixel(stack("noel", "nowhere", "nuit")!!.shown("x", green, true), 0, 0))
        // The highest theme that draws the image wins, as it is.
        assertTrue(stack("noel", "haut")!!.shown("close", green, true) === top)
        assertTrue(stack("noel", "haut")!!.drawing("close", green, true) === top)
        assertTrue(stack("haut", "noel")!!.drawing("close", green, true) === drawn)
        // Colours above a drawing repaint it, in `shown` and in `drawing` alike.
        assertEquals(listOf(0, 0, 0, 255), pixel(stack("noel", "nuit")!!.shown("close", green, true), 0, 0))
        assertEquals(listOf(0, 0, 0, 255), pixel(stack("noel", "nuit")!!.drawing("close", green, true)!!, 0, 0))
        // Colours are no drawing.
        assertNull(stack("noel", "nuit")!!.drawing("x", green, true))
        assertNull(stack("nuit")!!.drawing("close", green, true))
    }

    @Test
    fun `a theme of its own folder holds its table and its redraws of the common images`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val drawn = Png.encode(solid(2, 2, 9, 9, 9, 255))
        val binaries = listOf(
            "overrides/artisan/close.png", "overrides/artisan/deep/close.png", "overrides/artisan/.png", "overrides/artisan/notes.txt",
            "overrides/guilds/banner.png", "overrides/close.png", "assets/textures/close.png",
        ).associateWith { drawn }
        assertEquals(mapOf("close" to "overrides/artisan/close.png"), KitTheme.ownDrawings(binaries.keys))
        val theme = KitTheme.own(
            kit(
                mapOf(
                    "overrides/colors.yml" to table,
                    // `.yml` before `.yaml`; a file elsewhere is not the table.
                    "overrides/colors.yaml" to "colors:\n  \"#3c8527\": \"#0000ff\"\n",
                    "colors.yml" to "colors:\n  \"#3c8527\": \"#00ff00\"\n",
                ),
                binaries,
            ),
        )
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(theme.shown("x", green, true), 0, 0))
        assertTrue(theme.shown("close", green, true) === drawn)
        assertEquals(setOf("close"), theme.drawings)
        // `.yaml` alone is read; a folder that holds neither changes nothing.
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(KitTheme.own(kit(mapOf("overrides/colors.yaml" to table))).shown("x", green, true), 0, 0))
        assertTrue(KitTheme.own(kit(emptyMap())).shown("x", green, true) === green)
    }

    @Test
    fun `a theme in place is the Project of its name, else the folder the common images keep`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val common = kit(
            mapOf(
                "themes/noel/theme.yml" to "colors:\n  \"#3c8527\": \"#00ffff\"\n",
                "themes/nuit/theme.yml" to "colors:\n  \"#b3261e\": \"#000000\"\n",
            ),
        )
        val own = mapOf("noel" to kit(mapOf("overrides/colors.yml" to table)))
        // `noel` is read from its own folder, `nuit` where the common images keep it.
        assertEquals(listOf(0, 0, 0, 255), pixel(KitTheme.stack(listOf("noel", "nuit", "nowhere"), common, own)!!.shown("x", green, true), 0, 0))
        // Without the common images' Project, the themes of their own folder are still read.
        assertEquals(listOf(0xb3, 0x26, 0x1e, 255), pixel(KitTheme.stack(listOf("noel", "nuit"), null, own)!!.shown("x", green, true), 0, 0))
        assertNull(KitTheme.stack(listOf("nuit"), null, own))
        assertNull(KitTheme.stack(listOf("Bad Name"), common, mapOf("Bad Name" to kit(emptyMap()))))
    }

    @Test
    fun `a theme redraws a module's image at its size, and the highest in place wins as drawn`() {
        val image = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val low = Png.encode(solid(2, 2, 1, 1, 1, 255))
        val high = Png.encode(solid(2, 2, 2, 2, 2, 255))
        val large = Png.encode(solid(3, 2, 3, 3, 3, 255))
        val paths = listOf(
            "overrides/guilds/banner.png", "overrides/Shop_2/coin.png", "overrides/artisan/close.png", "overrides/guilds/deep/banner.png",
            "overrides/guilds/.png", "overrides/guilds/notes.txt", "overrides/banner.png", "assets/textures/banner.png",
        )
        assertEquals(
            listOf("Shop_2:coin" to "overrides/Shop_2/coin.png", "guilds:banner" to "overrides/guilds/banner.png"),
            KitTheme.ownModuleDrawings(paths).toList(),
        )
        val noel = kit(mapOf("overrides/colors.yml" to table), mapOf("overrides/guilds/banner.png" to low, "overrides/guilds/wide.png" to large))
        val theme = KitTheme.own(noel)
        assertEquals(setOf("guilds:banner", "guilds:wide"), theme.moduleDrawings)
        assertTrue(theme.moduleDrawing("guilds", "banner", image) === low)
        // Another module's image of that name, an image it does not redraw, and a drawing of another size are left.
        assertNull(theme.moduleDrawing("shop", "banner", image))
        assertNull(theme.moduleDrawing("guilds", "coin", image))
        assertNull(theme.moduleDrawing("guilds", "wide", image))
        assertNull(theme.moduleDrawing("guilds", "x", image))
        // In a stack the highest that redraws it wins; one that does not gives way to the one below.
        // The image does not follow the ramps: no colour touches it, drawn or not.
        val own = mapOf(
            "noel" to noel,
            "hiver" to kit(emptyMap(), mapOf("overrides/guilds/banner.png" to high)),
            "nuit" to kit(mapOf("overrides/colors.yml" to "colors:\n  \"#010101\": \"#ffffff\"\n")),
        )
        fun stack(vararg names: String) = KitTheme.stack(names.toList(), null, own)!!
        assertTrue(stack("noel", "hiver").moduleShown("guilds", "banner", image, false) === high)
        assertTrue(stack("hiver", "noel").moduleShown("guilds", "banner", image, false) === low)
        assertTrue(stack("noel", "nuit").moduleShown("guilds", "banner", image, false) === low)
        assertTrue(stack("nuit", "hiver").moduleShown("shop", "banner", image, false) === image)
        assertTrue(stack("noel").moduleShown("guilds", "x", image, false) === image)
        // A theme the common images keep redraws no module's image.
        val former = KitTheme.stack(listOf("old"), kit(mapOf("themes/old/theme.yml" to table), mapOf("themes/old/overrides/guilds/banner.png" to low)))!!
        assertTrue(former.moduleShown("guilds", "banner", image, false) === image)
    }

    @Test
    fun `colours repaint an image that follows the ramps, and no other`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val drawn = Png.encode(solid(2, 2, 0xb3, 0x26, 0x1e, 255))
        val red = listOf(0xb3, 0x26, 0x1e, 255)
        val black = listOf(0, 0, 0, 255)
        val own = mapOf(
            // `noel`: green to red, and its own `close` and `guilds:banner`, in red.
            "noel" to kit(mapOf("overrides/colors.yml" to table), mapOf("overrides/artisan/close.png" to drawn, "overrides/guilds/banner.png" to drawn)),
            // `nuit`: red to black, colours alone.
            "nuit" to kit(mapOf("overrides/colors.yml" to "colors:\n  \"#b3261e\": \"#000000\"\n")),
        )
        fun stack(vararg names: String) = KitTheme.stack(names.toList(), null, own)!!
        // A common image that does not follow the ramps keeps its colours; a theme's drawing of it is taken as drawn.
        assertTrue(stack("noel").shown("x", green, false) === green)
        assertTrue(stack("noel", "nuit").shown("x", green, false) === green)
        assertTrue(stack("noel", "nuit").shown("close", green, false) === drawn)
        assertTrue(stack("noel", "nuit").drawing("close", green, false) === drawn)
        assertNull(stack("nuit").drawing("close", green, false))
        // A module's image that follows the ramps takes each theme in turn, like a common one.
        assertEquals(red, pixel(stack("noel").moduleShown("shop", "coin", green, true), 0, 0))
        assertEquals(black, pixel(stack("noel", "nuit").moduleShown("shop", "coin", green, true), 0, 0))
        assertTrue(stack("noel").moduleShown("guilds", "banner", green, true) === drawn)
        assertEquals(black, pixel(stack("noel", "nuit").moduleShown("guilds", "banner", green, true), 0, 0))
        // One that does not is drawn or left.
        assertTrue(stack("noel", "nuit").moduleShown("shop", "coin", green, false) === green)
        assertTrue(stack("noel", "nuit").moduleShown("guilds", "banner", green, false) === drawn)
    }

    @Test
    fun `a theme's scope keeps its colours to one module's images`() {
        val green = Png.encode(solid(2, 2, 0x3c, 0x85, 0x27, 255))
        val red = listOf(0xb3, 0x26, 0x1e, 255)
        assertEquals("guilds", KitTheme.scope("scope: guilds\n"))
        assertEquals("guilds", KitTheme.scope("scope: guilds\n$table"))
        assertNull(KitTheme.scope(table))
        // Anything but a name is no scope: the colours reach every image that follows the ramps.
        assertNull(KitTheme.scope("scope: 3\n"))
        assertNull(KitTheme.scope("scope: \"\"\n"))
        assertNull(KitTheme.scope("scope: [guilds]\n"))
        assertNull(KitTheme.scope(": : :"))
        fun scoped(scope: String) = KitTheme.own(kit(mapOf("overrides/colors.yml" to "scope: $scope\n$table")))
        val guilds = scoped("guilds")
        assertEquals("guilds", guilds.scope)
        assertEquals(red, pixel(guilds.moduleShown("guilds", "banner", green, true), 0, 0))
        assertTrue(guilds.moduleShown("shop", "coin", green, true) === green)
        assertTrue(guilds.shown("button.3x1", green, true) === green)
        // `artisan`: the common images alone.
        val common = scoped("artisan")
        assertEquals(red, pixel(common.shown("button.3x1", green, true), 0, 0))
        assertTrue(common.moduleShown("guilds", "banner", green, true) === green)
        // In a stack, a theme of one module sits beside another: each paints what it reaches.
        val own = mapOf(
            "guilds-noel" to kit(mapOf("overrides/colors.yml" to "scope: guilds\n$table")),
            "nuit" to kit(mapOf("overrides/colors.yml" to "colors:\n  \"#3c8527\": \"#000000\"\n")),
            // Draws `close`, which the scoped theme above it leaves as drawn.
            "dessin" to kit(emptyMap(), mapOf("overrides/artisan/close.png" to green)),
        )
        fun stack(vararg names: String) = KitTheme.stack(names.toList(), null, own)!!
        assertEquals(red, pixel(stack("guilds-noel", "nuit").moduleShown("guilds", "banner", green, true), 0, 0))
        assertEquals(listOf(0, 0, 0, 255), pixel(stack("guilds-noel", "nuit").moduleShown("shop", "coin", green, true), 0, 0))
        assertTrue(stack("dessin", "guilds-noel").shown("close", green, true) === green)
        assertTrue(stack("dessin", "guilds-noel").drawing("close", green, true) === green)
        // A theme the common images keep reads its scope from its file too.
        val former = KitTheme.read("old", kit(mapOf("themes/old/theme.yml" to "scope: guilds\n$table")))!!
        assertTrue(former.shown("button.3x1", green, true) === green)
        // A scope that is no name is said to whoever writes the file.
        assertTrue("`scope`" in KitTheme.problems("scope: 3\ncolors: {}\n").single())
        assertEquals(emptyList(), KitTheme.problems("scope: guilds\ncolors: {}\n"))
    }
}
