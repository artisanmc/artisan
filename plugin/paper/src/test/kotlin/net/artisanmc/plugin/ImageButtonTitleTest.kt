package net.artisanmc.plugin

import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.render.OffsetEncoder
import net.artisanmc.plugin.render.title.TitleCompiler
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.minimessage.MiniMessage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ImageButtonTitleTest {
    @Test fun `native button offsets survive yaml and select the matching generated font`() {
        val yaml = org.yaml.snakeyaml.Yaml().load<Map<String, Any>>("asset: small\nfit: native\noffset_x: 2\noffset_y: -3")
        val mapper = com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()
        val image = mapper.convertValue(yaml, net.artisanmc.plugin.model.ImageButtonYaml::class.java)
        val layout = net.artisanmc.plugin.render.menu.ImageButtonLayout(listOf(0), 7, 17, 18, 18)
        assertEquals("buttons/81db8ebbbbc69c6c6ad4a6aa92b76e0c08af547da236b9e2c9dbe1d8285a8130_18_18_native_17_2_-3", layout.assetKey(image))
    }
    @Test fun `button glyphs precede the plain title and retain their font`() {
        val entry = AssetEntry("button", "glyph", 0xe000, -4, 36, 54, "artisan:buttons/test")
        val title = TitleCompiler.compileTitle(
            listOf(MenuTitleLayer.Plain(LText("title")), MenuTitleLayer.Glyph("button", 7, 17)),
            "en", mapOf("title" to "Shop"), { entry },
        )
        val serialized = MiniMessage.miniMessage().serialize(title)
        assertTrue(serialized.indexOf('\ue000') < serialized.indexOf("Shop"))
        assertTrue(serialized.contains("artisan:buttons/test"))
        assertEquals(8, TitleCompiler.layerX(MenuTitleLayer.Plain(LText("title"))))
    }

    @Test fun `a transparent button uses the measured empty glyph advance`() {
        val entry = AssetEntry("button", "glyph", 0xe000, -4, 36, 0, "artisan:buttons/test")
        val (_, end) = TitleCompiler.compileLayerBody(
            MenuTitleLayer.Glyph("button", 7, 17), 7, emptyMap(), { entry }, OffsetEncoder.EMPTY,
        )
        assertEquals(8, end)
    }
}
