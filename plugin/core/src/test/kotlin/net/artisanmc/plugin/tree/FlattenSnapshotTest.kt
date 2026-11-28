package net.artisanmc.plugin.tree

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame

/** A draft or a Version made before its folder held the module's whole tree, in today's layout. */
class FlattenSnapshotTest {
    private val mapper = ObjectMapper()
    private val manifest = "schema: module/v1\n"
    private val shipped = "schema: menu/v1\nsize: 27\ntitle: Main\n"
    private val mine = "schema: menu/v1\nsize: 27\ntitle: Mine\n"

    private fun message(baseline: Map<String, String>, tree: Map<String, String>, binaries: Map<String, Any> = emptyMap()) =
        mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(mapOf(
            "type" to "project_draft_publish",
            "draft" to mapOf("snapshot" to mapOf(
                "baseline" to baseline, "tree" to tree,
                "binaryBaseline" to binaries, "binaryTree" to binaries,
            )),
        ))

    private fun snapshot(m: com.fasterxml.jackson.databind.JsonNode, part: String) =
        m.path("draft").path("snapshot").path(part).fields().asSequence().associate { it.key to it.value.asText() }

    @Test
    fun `a file created over an original becomes a change of the copied file`() {
        val base = mapOf("artisan-module.yml" to manifest, "originals/menus/main.yml" to shipped)
        val flat = FlattenSnapshot.draftMessage(message(base, base + ("menus/main.yml" to mine)))
        assertEquals(mapOf("artisan-module.yml" to manifest, "menus/main.yml" to shipped), snapshot(flat, "baseline"))
        assertEquals(mapOf("artisan-module.yml" to manifest, "menus/main.yml" to mine), snapshot(flat, "tree"))
    }

    @Test
    fun `back to the original writes the original`() {
        val base = mapOf("artisan-module.yml" to manifest, "originals/menus/main.yml" to shipped, "menus/main.yml" to mine)
        val flat = FlattenSnapshot.draftMessage(message(base, base - "menus/main.yml"))
        assertEquals(mine, snapshot(flat, "baseline")["menus/main.yml"])
        assertEquals(shipped, snapshot(flat, "tree")["menus/main.yml"])
    }

    @Test
    fun `binaries move with their rows, and a tree of today is left as is`() {
        val row = mapOf("hash" to "h", "size" to 3)
        val m = message(mapOf("artisan-module.yml" to manifest), mapOf("artisan-module.yml" to manifest), mapOf("originals/assets/textures/logo.png" to row))
        val flat = FlattenSnapshot.draftMessage(m)
        assertEquals(listOf("assets/textures/logo.png"), flat.path("draft").path("snapshot").path("binaryTree").fieldNames().asSequence().toList())
        assertEquals("h", flat.path("draft").path("snapshot").path("binaryTree").path("assets/textures/logo.png").path("hash").asText())

        val today = message(mapOf("menus/main.yml" to shipped), mapOf("menus/main.yml" to mine))
        assertSame(today, FlattenSnapshot.draftMessage(today))
        assertFalse(FlattenSnapshot.needed(listOf("menus/main.yml")))
    }
}
