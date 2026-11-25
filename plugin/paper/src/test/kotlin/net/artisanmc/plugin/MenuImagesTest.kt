package net.artisanmc.plugin

import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.render.menu.MenuImages
import net.artisanmc.plugin.resourcepack.AssetEntry
import kotlin.test.Test
import kotlin.test.assertEquals

class MenuImagesTest {
    private val pack = setOf("gold", "plain:gold", "title", "plain:title")
    private fun images(module: String) = MenuImages(module) { id -> if (id in pack) AssetEntry(id, "glyph", 0xe000, 0, 8) else null }

    @Test fun `a title's images are the module's own, a text's font keeps its name`() {
        val text = MenuTitleLayer.Text(LText("Hi", literal = true), 0, 0, fontAssetId = "title")
        val layers = listOf(MenuTitleLayer.Background("gold"), MenuTitleLayer.Glyph("gold", 4, 4), MenuTitleLayer.Glyph("guilds:gold", 8, 4), text)
        assertEquals(
            listOf(MenuTitleLayer.Background("plain:gold"), MenuTitleLayer.Glyph("plain:gold", 4, 4), MenuTitleLayer.Glyph("gold", 8, 4), text),
            images("plain").title(layers),
        )
        assertEquals(
            listOf(MenuTitleLayer.Background("gold"), MenuTitleLayer.Glyph("gold", 4, 4), MenuTitleLayer.Glyph("gold", 8, 4), text),
            images("guilds").title(layers),
        )
        // A menu without a module (a relayed draft): names as written.
        assertEquals("gold", images("").id("gold"))
    }
}
