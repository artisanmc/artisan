package net.artisanmc.plugin.pack

import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The theme `artisan` moved to one tree (ADR `editable-module-tree`, decision 9): the pack reads it as before. */
class KitMigrationTest {
    @TempDir lateinit var tmp: File

    private fun png(w: Int, h: Int) = Png.encode(RgbaImage(w, h))
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    private fun write(dir: File, files: Map<String, ByteArray>) = files.forEach { (p, b) -> File(dir, p).apply { parentFile.mkdirs() }.writeBytes(b) }

    @Test
    fun `untouched images read as the base, a redraw as the server's, and a redraw at other measures keeps the former layout`() {
        val button = png(54, 18)
        val mine = png(8, 8)
        val before = File(tmp, "before/artisan")
        val after = File(tmp, "after/artisan")
        write(before, mapOf(
            "originals/originals.yml" to "shipper: artisan\n".toByteArray(),
            "originals/assets/textures/button.3x1.png" to button,
            "originals/assets/textures/close.1x1.png" to png(16, 16),
            "assets/textures/close.1x1.png" to Png.encode(RgbaImage(16, 16).also { it.data[3] = 0xff.toByte() }),
            "assets/textures/mine.png" to mine,
        ))
        write(after, mapOf(
            "artisan-shipped.yml" to ("files:\n" +
                "  assets/textures/button.3x1.png: { module: artisan, template: base, version: 1, hash: ${sha(button)} }\n" +
                "  assets/textures/close.1x1.png: { module: artisan, template: base, version: 1, hash: ${sha(png(16, 16))} }\n").toByteArray(),
            "assets/textures/button.3x1.png" to button,
            "assets/textures/close.1x1.png" to File(before, "assets/textures/close.1x1.png").readBytes(),
            "assets/textures/mine.png" to mine,
        ))
        assertNull(MigrationAssets.compareKit(before, after, "artisan"))
        val view = KitLayout.asRead(PackProject("artisan", listOf(PackFile("artisan-shipped.yml", File(after, "artisan-shipped.yml").readText())),
            listOf("assets/textures/button.3x1.png", "assets/textures/close.1x1.png", "assets/textures/mine.png"), { File(after, it).readBytes() }, folder = "artisan"))
        assertEquals(listOf("originals/assets/textures/button.3x1.png", "assets/textures/close.1x1.png", "assets/textures/mine.png"), view.binaries)
        assertEquals(sha(button), sha(view.binary("originals/assets/textures/button.3x1.png")!!))

        // The server's close button at other measures: the builder took the base for it.
        File(before, "assets/textures/close.1x1.png").writeBytes(png(20, 20))
        File(after, "assets/textures/close.1x1.png").writeBytes(png(20, 20))
        val refused = assertNotNull(MigrationAssets.compareKit(before, after, "artisan"))
        assertTrue("close.1x1" in refused, refused)
    }
}
