package net.artisanmc.modules.api.text

import org.bukkit.entity.Player
import kotlin.test.Test
import kotlin.test.assertEquals

/** `OverlayApi.compose` over the primitives: every piece placed from the centre, the pen brought back. */
class OverlayComposeTest {

    /** Pieces written as tokens; a text advances 6 px a character, images "box" and "cursor" are in the pack. */
    private class Fake(private val height: Int = -1) : OverlayApi {
        override fun imageHeight(asset: String) = height
        override fun width(miniMessage: String) = miniMessage.length * 6
        override fun raise(miniMessage: String, rise: Int) = "{$rise:$miniMessage}"
        override fun move(px: Int) = "<$px>"
        override fun image(asset: String, rise: Int) = if (asset == "ghost") null else "[$asset@$rise]"
        override fun hasPack(player: Player) = true
        override fun show(player: Player, slot: OverlayApi.Slot, layer: String, priority: Int, miniMessage: String) {}
        override fun hide(player: Player, slot: OverlayApi.Slot, layer: String) {}
    }

    private val overlay = Fake()

    private val layout = OverlayLayout.read(
        listOf(
            mapOf("image" to "box", "x" to -130, "y" to -92),
            mapOf("text" to "name", "x" to -120, "y" to -86, "width" to 240),
            mapOf("list" to "choices", "x" to -110, "y" to -31, "width" to 230, "lines" to 2,
                "cursor" to mapOf("image" to "cursor", "x" to -10, "y" to 1)),
        ),
    ).layout()

    @Test
    fun `each piece goes to its place and the pen comes back after it`() {
        val content = OverlayContent.builder()
            .text("name", listOf("Bob"))
            .rows("choices", listOf("Oui", "Non"), 0, 0)
            .build()
        val frame = overlay.compose(layout, content)
        assertEquals(
            "<-130>[box@92]<130>" +
                "<-120>{86:Bob}<102>" +
                "<-110>{31:Oui}<92>" +
                "<-120>[cursor@30]<120>" +
                "<-110>{20:Non}<92>",
            frame.miniMessage(),
        )
        assertEquals(emptyList(), frame.missingImages())
    }

    @Test
    fun `an image the pack lacks is left out and named once`() {
        val ghostly = OverlayLayout.read(
            listOf(mapOf("image" to "ghost", "x" to 0, "y" to 0), mapOf("image" to "ghost", "x" to 4, "y" to 2)),
        ).layout()
        val frame = overlay.compose(ghostly, OverlayContent.EMPTY)
        assertEquals("", frame.miniMessage())
        assertEquals(listOf("ghost"), frame.missingImages())
    }

    @Test
    fun `an image slot anchored by its bottom is missing while its height is unknown`() {
        val slot = OverlayLayout.read(listOf(mapOf("image_slot" to "portrait", "y" to 8, "anchor" to "bottom"))).layout()
        val content = OverlayContent.builder().image("portrait", "marthe").build()
        assertEquals(listOf("marthe"), overlay.compose(slot, content).missingImages())

        assertEquals("<0>[marthe@64]<0>", Fake(height = 72).compose(slot, content).miniMessage())
    }

    @Test
    fun `nothing is drawn by the inert overlay, and every image is missing`() {
        val frame = OverlayApi.NONE.compose(layout, OverlayContent.builder().rows("choices", listOf("a"), 0, 0).build())
        assertEquals(listOf("box", "cursor"), frame.missingImages())
    }
}
