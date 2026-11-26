package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals

/** [PackResult.missingImages], on the cases of `testdata/resource-pack-conformance.json`. */
class MissingImagesTest {
    private val vectors: JsonNode = ObjectMapper().readTree(File("../testdata/resource-pack-conformance.json"))

    private fun inputOf(case: JsonNode): PackInput {
        val projects = case["projects"].map { p ->
            val bytes = p["binaries"].fields().asSequence().associate { (path, b64) -> path to Base64.getDecoder().decode(b64.asText()) }
            PackProject(
                id = p["id"].asText(),
                files = p["files"].fields().asSequence().map { (path, content) -> PackFile(path, content.asText()) }.toList(),
                binaries = bytes.keys.toList(),
                binary = { bytes[it] },
                overlayImages = p["overlayImages"]?.map {
                    OverlayImageRequest(it["asset"].asText(), it["rise"]?.asInt(), it["bottom"]?.asInt())
                }.orEmpty(),
                folder = p["folder"]?.asText() ?: p["id"].asText(),
                theme = p["role"]?.asText() == "theme",
            )
        }
        return PackInput(projects = projects, themes = case["themes"]?.map { it.asText() } ?: listOfNotNull(case["theme"]?.asText()))
    }

    private fun missing(case: String) =
        ResourcePackBuilder.build(inputOf(vectors["cases"].first { it["name"].asText().startsWith(case) })).missingImages

    @Test
    fun `a build names, by module, the images written that reach no image of the server`() {
        // A common image the server and the base lack, under either spelling.
        assertEquals(mapOf("shop" to listOf("kit:", "kit:nothing", "kit:nowhere")), missing("ui kit"))
        assertEquals(mapOf("shop" to listOf("artisan:nowhere", "nothing")), missing("common images"))
        // A theme's own image is reached by `<theme>:<name>` alone.
        assertEquals(mapOf("shop" to listOf("noel:ghost", "star")), missing("a theme's own images"))
        // What a kind's file asks the pack for (`pack.images`) counts as a menu's.
        assertEquals(mapOf("alpha" to listOf("ghost")), missing("module images at a height"))
    }

    @Test
    fun `a build whose names all reach an image names none`() {
        assertEquals(emptyMap(), missing("images by module"))
        assertEquals(emptyMap(), missing("themes of their own folder"))
        assertEquals(emptyMap(), missing("glyph, texture and bitmap font, no menu"))
    }

    @Test
    fun `a build names the layers of a composed image that take nothing`() {
        val composed = ResourcePackBuilder.build(inputOf(vectors["cases"].first { it["name"].asText().startsWith("composed images") }))
        // A PNG the module lacks, a common image nobody holds, and another composed image: no layer takes one.
        assertEquals(
            mapOf("guilds" to mapOf("empty" to listOf("nothing", "kit:nothing"), "of_composed" to listOf("card_members"), "sized" to listOf("missing"))),
            composed.missingLayers,
        )
        // Themes change what a layer shows, not whether it takes something.
        for (name in listOf("theme:", "themes in place stack", "ramps and scope", "ui kit")) {
            assertEquals(emptyMap(), ResourcePackBuilder.build(inputOf(vectors["cases"].first { it["name"].asText().startsWith(name) })).missingLayers, name)
        }
    }

    @Test
    fun `a placeholder is filled in game and a name written twice is named once`() {
        val menu = """
            id: shop
            size: 9
            elements:
              - positions: '0'
                image: { asset: '{{row.icon}}' }
              - positions: '1'
                image: { asset: ghost }
              - positions: '2'
                image: { asset: ghost }
              - positions: '3'
                image: { asset: '%rank%' }
        """.trimIndent()
        val shop = PackProject("survival.shop", listOf(PackFile("menus/shop.yml", menu)), emptyList(), { null }, folder = "shop")
        assertEquals(mapOf("shop" to listOf("ghost")), ResourcePackBuilder.build(PackInput(listOf(shop))).missingImages)
    }
}
