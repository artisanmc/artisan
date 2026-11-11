package net.artisanmc.plugin.customitems

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class NexoGlyphWebSocketTest {
    @TempDir lateinit var nexo: File
    private val mapper = ObjectMapper()

    private fun exchange(raw: String): com.fasterxml.jackson.databind.JsonNode {
        File(nexo, "glyphs/a.yml").apply { parentFile.mkdirs() }.writeText("bg:\n  texture: gui/bg\n")
        File(nexo, "pack/assets/minecraft/textures/gui/bg.png").apply { parentFile.mkdirs() }.writeBytes(byteArrayOf(7, 8))
        val sent = LinkedBlockingQueue<String>()
        val provider = SyncedMenuProvider(
            roots = ProjectRoots(Files.createTempDirectory("artisan-projects-").toFile()),
            logger = null,
            nexoGlyphs = NexoGlyphReader(nexo),
        ).also { it.setSendForTesting(sent::add) }
        try {
            provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
                .apply { isAccessible = true }.invoke(provider, raw)
            return mapper.readTree(sent.poll(2, TimeUnit.SECONDS))
        } finally {
            provider.shutdown()
        }
    }

    @Test
    fun `nexo_glyphs_list returns metadata`() {
        val json = exchange("""{"type":"nexo_glyphs_list","request_id":"r1"}""")
        assertEquals("nexo_glyphs_list_result", json["type"].asText())
        assertEquals("r1", json["request_id"].asText())
        assertEquals(true, json["ok"].asBoolean())
        assertEquals("bg", json["glyphs"][0]["id"].asText())
        assertEquals("gui/bg", json["glyphs"][0]["texture"].asText())
        assertEquals(true, json["glyphs"][0]["available"].asBoolean())
    }

    @Test
    fun `nexo_glyph_read returns the png bytes`() {
        val json = exchange("""{"type":"nexo_glyph_read","request_id":"r2","glyph_id":"bg"}""")
        assertEquals("nexo_glyph_read_result", json["type"].asText())
        assertEquals(true, json["ok"].asBoolean())
        assertEquals(Base64.getEncoder().encodeToString(byteArrayOf(7, 8)), json["content_base64"].asText())
    }

    @Test
    fun `nexo_glyph_read on an unknown glyph is not_found`() {
        val json = exchange("""{"type":"nexo_glyph_read","request_id":"r3","glyph_id":"nope"}""")
        assertEquals(false, json["ok"].asBoolean())
        assertEquals("not_found", json["error"].asText())
    }
}
