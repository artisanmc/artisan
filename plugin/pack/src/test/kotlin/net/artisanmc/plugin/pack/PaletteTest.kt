package net.artisanmc.plugin.pack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The palette a tint names its colour in, as `palette.test.ts` in the editor. */
class PaletteTest {
    @Test
    fun `a palette yml gives its names their colours, an entry that is no name or no colour left out`() {
        val read = Palette.read("primary: \"#B3261E\"\ndanger: red\nwarning: \"#fff\"\nBad Name: \"#000000\"\ngold: \"#d4a017\"\nn: 12\n")
        assertEquals(listOf("primary" to "#B3261E", "gold" to "#d4a017"), read.toList())
        for (content in listOf("", "- a\n- b\n", "primary: [", "just text")) assertTrue(Palette.read(content).isEmpty())
    }

    @Test
    fun `a name is looked up from the highest place down, then in the default palette`() {
        val palette = Palette.of(
            listOf(
                "primary: \"#b3261e\"\ndanger: red\n",
                null,
                "primary: \"#101820\"\ndanger: \"#600000\"\n",
                "gold: \"#d4a017\"\ndanger: \"#990000\"\n",
            ),
        )
        assertEquals("#b3261e", palette.colour("primary"))
        assertEquals("#600000", palette.colour("danger"))
        assertEquals("#d4a017", palette.colour("gold"))
        assertEquals(Palette.DEFAULT["success"], palette.colour("success"))
        assertNull(palette.colour("nowhere"))
        assertEquals(Palette.DEFAULT["primary"], Palette.of(emptyList()).colour("primary"))
    }

    @Test
    fun `a tint is its own colour when it is one, else the palette's of that name`() {
        val palette = Palette.of(listOf("primary: \"#b3261e\"\n"))
        assertNull(palette.tintOf(null))
        assertEquals("#C03366", palette.tintOf("#C03366"))
        assertEquals("#b3261e", palette.tintOf("primary"))
        assertNull(palette.tintOf("nowhere"))
    }
}
