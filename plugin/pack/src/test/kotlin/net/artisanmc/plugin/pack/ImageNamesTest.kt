package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** `testdata/image-ref-conformance.json`: the ids the builder gives, and the id a name reaches. */
class ImageNamesTest {
    private val vector = ObjectMapper().readTree(File("../testdata/image-ref-conformance.json"))

    private fun names(): ImageNames {
        val names = ImageNames()
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
    fun `the first module keeps the bare name, a later one is qualified`() {
        val names = names()
        // Asking twice (a glyph and a texture of one name in a module) gives the same id.
        assertEquals("guilds:gold", names.claim("guilds", "gold"))
    }

    @Test
    fun `a name reaches the id the shared cases say`() {
        val names = names()
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
