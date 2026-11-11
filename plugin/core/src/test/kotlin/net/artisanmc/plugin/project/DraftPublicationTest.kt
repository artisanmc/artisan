package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ContentHash
import java.io.File
import java.nio.file.Files
import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class DraftPublicationTest {
    private val root = Files.createTempDirectory("artisan-draft-publish").toFile().also { File(it, "a.yml").writeText("a: 0") }
    private val mapper = ObjectMapper()
    private val png = byteArrayOf(7, 7, 7)
    private val hash = ContentHash.hashBytes(png)

    @AfterTest fun teardown() { root.deleteRecursively() }

    private fun message(operation: String, baseline: String = "a: 0", tree: String = "a: 1") = mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(
        mapOf(
            "type" to "project_draft_publish", "request_id" to "r", "project_id" to "shop", "operation_id" to operation,
            "draft" to mapOf("snapshot" to mapOf(
                "baseline" to mapOf("a.yml" to baseline), "tree" to mapOf("a.yml" to tree),
                "binaryBaseline" to emptyMap<String, Any>(), "binaryTree" to mapOf("logo.png" to mapOf("hash" to hash, "size" to 3)),
            )),
            "blobs" to mapOf(hash to Base64.getEncoder().encodeToString(png)),
        ),
    )

    @Test
    fun `a draft and its new binaries are written at once`() {
        val result = DraftPublication(root).publish(message("op-1"))
        assertEquals(true, result["ok"].asBoolean())
        assertEquals("a: 1", File(root, "a.yml").readText())
        assertEquals(png.toList(), File(root, "logo.png").readBytes().toList())
    }

    @Test
    fun `a file the editor only reformatted keeps its bytes, even changed on disk since`() {
        val shipped = "title: { en: \"Buy\", fr: \"Acheter\" }\r\nclose: true\r\n"
        File(root, "a.yml").writeText(shipped)
        val result = DraftPublication(root).publish(message("op-1", shipped, "title:\n  fr: Acheter\n  en: Buy\nclose: true\n"))
        assertEquals(true, result["ok"].asBoolean())
        assertEquals(1, result["wrote"].asInt())
        assertEquals(shipped, File(root, "a.yml").readText())
    }

    @Test
    fun `a publication replayed after a lost answer returns its first result`() {
        DraftPublication(root).publish(message("op-1"))
        assertEquals(true, DraftPublication(root).publish(message("op-1"))["ok"].asBoolean())
    }

    @Test
    fun `a file changed on disk since the draft started is a conflict, and nothing is written`() {
        File(root, "a.yml").writeText("a: hand edit")
        val result = DraftPublication(root).publish(message("op-1"))
        assertEquals("conflict", result["error"].asText())
        assertEquals("a: hand edit", File(root, "a.yml").readText())
        assertFalse(File(root, "logo.png").exists())
    }

    @Test
    fun `a draft started before its folder moved to yml publishes onto the yml files`() {
        File(root, "manifest.yaml").writeText("schema: manifest/v1\n")
        YmlMigration.run(root)
        val message = mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(mapOf(
            "type" to "project_draft_publish", "request_id" to "r", "project_id" to "shop", "operation_id" to "op-yml",
            "draft" to mapOf("snapshot" to mapOf(
                "baseline" to mapOf("manifest.yaml" to "schema: manifest/v1\n", "menus/b.yaml" to "b: 0"),
                "tree" to mapOf("manifest.yaml" to "schema: module/v1\n", "menus/b.yaml" to "b: 0", "menus/c.yaml" to "c: 0"),
            )),
        ))
        File(root, "menus/b.yml").apply { parentFile.mkdirs(); writeText("b: 0") }
        assertEquals(true, DraftPublication(root).publish(message)["ok"].asBoolean())
        assertEquals("schema: module/v1\n", File(root, "artisan-module.yml").readText())
        assertEquals("c: 0", File(root, "menus/c.yml").readText(), "a new file goes under .yml")
        assertFalse(File(root, "manifest.yaml").exists())
        assertFalse(File(root, "menus/b.yaml").exists())
    }
}
