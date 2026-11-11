package net.artisanmc.plugin.customitems

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class NexoGlyphReaderTest {
    @TempDir lateinit var nexo: File

    private fun file(rel: String, content: String) = File(nexo, rel).apply { parentFile.mkdirs(); writeText(content) }
    private fun png(rel: String, bytes: ByteArray) = File(nexo, rel).apply { parentFile.mkdirs(); writeBytes(bytes) }

    @Test
    fun `lists glyphs recursively and resolves textures across pack sources`() {
        file("glyphs/menus.yml", """
            shop_bg:
              texture: shop:gui/bg.png
              ascent: 13
              height: 256
            coin:
              texture: icons/coin
            missing:
              texture: nowhere:nothing.png
            no_texture:
              char: x
            sheet:
              texture: sheet.png
              bitmap: { rows: 2, columns: 2 }
        """.trimIndent())
        file("glyphs/nested/zipped.yml", "zipped_one:\n  texture: zipns:z.png\n")
        file("glyphs/broken.yml", ":\n  - [unclosed")
        png("pack/assets/shop/textures/gui/bg.png", byteArrayOf(1))
        png("pack/external_packs/Folder/assets/minecraft/textures/icons/coin.png", byteArrayOf(2))
        File(nexo, "pack/external_packs/Zipped.zip").also { it.parentFile.mkdirs() }.outputStream().use { out ->
            ZipOutputStream(out).use { zip ->
                zip.putNextEntry(ZipEntry("assets/zipns/textures/z.png"))
                zip.write(byteArrayOf(3))
                zip.closeEntry()
            }
        }

        val reader = NexoGlyphReader(nexo)
        val glyphs = reader.list().associateBy { it.id }

        assertEquals(setOf("shop_bg", "coin", "missing", "zipped_one"), glyphs.keys)
        assertEquals(true, glyphs.getValue("shop_bg").available)
        assertEquals("shop:gui/bg.png", glyphs.getValue("shop_bg").texture)
        assertEquals(false, glyphs.getValue("missing").available)
        assertArrayEquals(byteArrayOf(1), reader.read("shop_bg"))
        assertArrayEquals(byteArrayOf(2), reader.read("coin"))
        assertArrayEquals(byteArrayOf(3), reader.read("zipped_one"))
        assertNull(reader.read("missing"))
        assertNull(reader.read("unknown"))
    }

    @Test
    fun `no Nexo folder means no glyphs`() {
        assertEquals(emptyList<NexoGlyph>(), NexoGlyphReader(File(nexo, "absent")).list())
    }

    @Test
    fun `texture keys cannot escape the pack`() {
        file("glyphs/evil.yml", "evil:\n  texture: ../../../secret.png\n")
        png("secret.png", byteArrayOf(9))
        assertNull(NexoGlyphReader(nexo).read("evil"))
    }
}
