package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** `testdata/image-ref-conformance.json`: the ids the builder gives, and the id a name reaches. */
class ImageNamesTest {
    private val vector = ObjectMapper().readTree(File("../testdata/image-ref-conformance.json"))

    private fun names(): ImageNames {
        val names = ImageNames()
        for (name in vector["common"]) names.common(name.asText())
        for (module in vector["modules"]) {
            val folder = module["folder"].asText()
            for (font in module["fonts"]) names.take(font.asText())
            for (image in module["images"]) {
                val name = image.asText()
                assertEquals(vector["ids"][folder][name].asText(), names.claim(folder, name), "$folder/$name")
            }
        }
        return names
    }

    @Test
    fun `the first module keeps the bare name, a later one is qualified, and one that shares a common image's name`() {
        val names = names()
        // No common image is named `gold`: the first module's is the bare id. One is named `panel`.
        assertEquals("gold", names.claim("core", "gold"))
        assertEquals("core:panel", names.claim("core", "panel"))
        // Asking twice (a glyph and a texture of one name in a module) gives the same id.
        assertEquals("guilds:gold", names.claim("guilds", "gold"))
        // The theme's `<folder>:` names the common images: its own image keeps its name.
        assertEquals("gold", names.claim("artisan", "gold"))
    }

    @Test
    fun `a theme's own image is its theme's, once, and none for a reserved folder`() {
        val names = names()
        for (theme in vector["themes"]) {
            val folder = theme["folder"].asText()
            for (image in theme["images"]) {
                assertEquals("$folder:${image.asText()}", names.themeOwn(folder, image.asText()))
                // Asked twice (a glyph and a texture of one name): the first one keeps the id.
                assertNull(names.themeOwn(folder, image.asText()))
            }
        }
        // `guilds:gold` is the module's image: a theme of that folder gives none.
        assertNull(names.themeOwn("guilds", "gold"))
        // `artisan:<name>` and `kit:<name>` name the common images.
        assertNull(names.themeOwn("artisan", "star"))
        assertNull(names.themeOwn("kit", "star"))
        assertEquals("themes/noel/star", ImageNames.themePath("noel", "star"))
    }

    @Test
    fun `a name reaches the id the shared cases say`() {
        val names = names()
        for (theme in vector["themes"]) for (image in theme["images"]) names.themeOwn(theme["folder"].asText(), image.asText())
        for (id in vector["also"]) names.take(id.asText())
        for (c in vector["cases"]) {
            val from = c["from"].takeUnless { it.isNull }?.asText().orEmpty()
            assertEquals(c["expect"].asText(), names.resolve(from, c["ref"].asText()), "ref=${c["ref"]} from=$from")
        }
    }

    @Test
    fun `a qualified image has its files under its module`() {
        val row = AssetRow("gold", "p", "texture", "gold", 16.0, 16.0, null, null, null, null)
        assertEquals(row, ImageNames.named(row, "gold", "guilds"))
        val named = ImageNames.named(row, "guilds:gold", "guilds")
        assertEquals("guilds:gold", named.id)
        assertEquals("modules/guilds/gold", named.name)
    }
}
