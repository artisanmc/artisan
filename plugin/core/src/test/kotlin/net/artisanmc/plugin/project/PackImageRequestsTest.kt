package net.artisanmc.plugin.project

import net.artisanmc.modules.api.document.PackImagesProvider
import net.artisanmc.modules.api.text.OverlayLayout.PackImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PackImageRequestsTest {
    /** Asks for its `image` at its `rise`, then each speaker's `portrait` 10 px higher. */
    private val modes = PackImagesProvider { doc, ctx ->
        listOf(PackImage.at(doc["image"] as String, (doc["rise"] as Number).toInt())) +
            ctx.files("speakers").map { PackImage.at((it.value as Map<*, *>)["portrait"] as String, 10) }
    }

    /** Asks for an image named after the Document's id, by its bottom. */
    private val boxes = PackImagesProvider { doc, _ -> listOf(PackImage.byBottom("box_${doc["id"]}", -3)) }

    @Test
    fun `files ask in path order through the kind of their folder, with their id`() {
        val files = mapOf(
            "modes/b.yml" to "image: hud_b\nrise: 4\n",
            "boxes/z.yml" to "schema: box/v1\n",
            "modes/a.yaml" to "image: hud_a\nrise: 2\n",
            "speakers/zed.yml" to "portrait: zed\n",
            "speakers/amy.yml" to "portrait: amy\n",
            "menus/shop.yml" to "title: x\n",
            "modes/deep/c.yml" to "image: nested\nrise: 1\n",
        )
        // Registration order (modes before boxes) does not count: path order does.
        val images = PackImageRequests.of(files, linkedMapOf("modes" to modes, "boxes" to boxes))
        assertEquals(
            listOf(
                PackImageRequest("box_z", bottom = -3),
                PackImageRequest("hud_a", rise = 2), PackImageRequest("amy", rise = 10), PackImageRequest("zed", rise = 10),
                PackImageRequest("hud_b", rise = 4), PackImageRequest("amy", rise = 10), PackImageRequest("zed", rise = 10),
            ),
            images,
        )
    }

    @Test
    fun `a broken file or provider costs only its own images`() {
        val warnings = mutableListOf<String>()
        val files = mapOf(
            "modes/a.yml" to "image: [unclosed\n",
            "modes/b.yml" to "- a list\n",
            "modes/c.yml" to "rise: 1\n",
            "modes/d.yml" to "image: ok\nrise: 3\n",
        )
        assertEquals(listOf(PackImageRequest("ok", rise = 3)), PackImageRequests.of(files, mapOf("modes" to modes), warnings::add))
        assertEquals(1, warnings.size)
        assertTrue(warnings.single().startsWith("modes/c.yml:"), warnings.toString())
    }

    @Test
    fun `answers out of range or without an asset are skipped`() {
        val loose = PackImagesProvider { _, ctx ->
            listOf(
                PackImage.at("", 0), PackImage.at("high", 129), PackImage.at("low", -167),
                PackImage.at("top", 128), PackImage.at("bottom", -166), PackImage.byBottom("deep", -500),
            ) + listOfNotNull(ctx.file("data/missing.yml")?.let { PackImage.at("never", 0) })
        }
        assertEquals(
            listOf(PackImageRequest("top", rise = 128), PackImageRequest("bottom", rise = -166), PackImageRequest("deep", bottom = -500)),
            PackImageRequests.of(mapOf("modes/a.yml" to "x: 1\n"), mapOf("modes" to loose)),
        )
    }

    @Test
    fun `no provider reads nothing`() {
        assertEquals(emptyList(), PackImageRequests.of(mapOf("modes/a.yml" to "image: x\nrise: 1\n"), emptyMap()))
    }
}
