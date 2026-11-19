package net.artisanmc.plugin.customitems

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.imageio.ImageIO

class NexoItemIconsTest {
    @TempDir lateinit var nexo: File

    private fun file(rel: String, content: String) = File(nexo, rel).apply { parentFile.mkdirs(); writeText(content) }
    private fun png(rel: String, bytes: ByteArray) = File(nexo, rel).apply { parentFile.mkdirs(); writeBytes(bytes) }

    @Test
    fun `a texture, a list of textures or a map of textures`() {
        file("items/tools.yml", """
            ruby:
              material: PAPER
              Pack:
                texture: default/ruby.png
            layered:
              material: LEATHER_HORSE_ARMOR
              Pack:
                textures: [ default/base, default/overlay ]
            mapped:
              material: PAPER
              Pack:
                textures: { layer1: default/overlay, layer0: default/base }
            plain:
              material: DIAMOND
        """.trimIndent())
        file("items/broken.yml", ":\n  - [unclosed")
        png("pack/assets/minecraft/textures/default/ruby.png", byteArrayOf(1))
        png("pack/assets/minecraft/textures/default/base.png", byteArrayOf(2))

        val icons = NexoItemIcons(nexo)
        assertArrayEquals(byteArrayOf(1), icons.sheet().icons["ruby"])
        assertArrayEquals(byteArrayOf(2), icons.sheet().icons["layered"])
        assertArrayEquals(byteArrayOf(2), icons.sheet().icons["mapped"])
        assertNull(icons.sheet().icons["plain"])
        assertNull(icons.sheet().icons["unknown"])
    }

    @Test
    fun `a model gives its layer0, through its parents and an item definition`() {
        file("items/nested/models.yml", """
            sword:
              material: DIAMOND_SWORD
              Pack:
                model: weapons/sword
            crate:
              material: PAPER
              Pack:
                model: shop:block/crate
            modern:
              material: PAPER
              Components:
                item_model: shop:modern
        """.trimIndent())
        file("pack/assets/minecraft/models/weapons/sword.json",
            """{"parent":"weapons/base_sword","textures":{"layer1":"weapons/glow"}}""")
        file("pack/assets/minecraft/models/weapons/base_sword.json",
            """{"parent":"item/handheld","textures":{"layer0":"weapons/sword"}}""")
        png("pack/assets/minecraft/textures/weapons/sword.png", byteArrayOf(3))
        // A block model: the face a player sees, `#` references followed.
        file("pack/assets/shop/models/block/crate.json",
            """{"parent":"block/cube","textures":{"particle":"#side","side":"shop:block/crate_side","top":"shop:block/crate_top"}}""")
        png("pack/assets/shop/textures/block/crate_side.png", byteArrayOf(4))
        // 1.21.4: assets/shop/items/modern.json → its model, from an external zip.
        File(nexo, "pack/external_packs/Extra.zip").also { it.parentFile.mkdirs() }.outputStream().use { out ->
            ZipOutputStream(out).use { zip ->
                for ((name, bytes) in listOf(
                    "assets/shop/items/modern.json" to """{"model":{"type":"minecraft:model","model":"shop:item/modern"}}""".toByteArray(),
                    "assets/shop/models/item/modern.json" to """{"parent":"item/generated","textures":{"layer0":"shop:item/modern"}}""".toByteArray(),
                    "assets/shop/textures/item/modern.png" to byteArrayOf(5),
                )) {
                    zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry()
                }
            }
        }

        val icons = NexoItemIcons(nexo)
        assertArrayEquals(byteArrayOf(3), icons.sheet().icons["sword"])
        assertArrayEquals(byteArrayOf(4), icons.sheet().icons["crate"])
        assertArrayEquals(byteArrayOf(5), icons.sheet().icons["modern"])
    }

    @Test
    fun `an animated texture gives its first frame`() {
        val strip = BufferedImage(16, 48, BufferedImage.TYPE_INT_ARGB)
        val bytes = ByteArrayOutputStream().also { ImageIO.write(strip, "png", it) }.toByteArray()
        file("items/a.yml", "spin:\n  Pack:\n    texture: anim/spin\n")
        png("pack/assets/minecraft/textures/anim/spin.png", bytes)

        val large = BufferedImage(256, 128, BufferedImage.TYPE_INT_ARGB)
        file("items/b.yml", "big:\n  Pack:\n    texture: anim/big\n")
        png("pack/assets/minecraft/textures/anim/big.png", ByteArrayOutputStream().also { ImageIO.write(large, "png", it) }.toByteArray())

        val icons = NexoItemIcons(nexo).sheet().icons
        val frame = ImageIO.read(icons.getValue("spin").inputStream())
        assertEquals(16 to 16, frame.width to frame.height)
        val scaled = ImageIO.read(icons.getValue("big").inputStream())
        assertEquals(64 to 32, scaled.width to scaled.height)
    }

    @Test
    fun `the sheet is kept for its time, and its hash follows the icons`() {
        var now = 0L
        val config = file("items/a.yml", "gem:\n  Pack:\n    texture: gems/red\n")
        png("pack/assets/minecraft/textures/gems/red.png", byteArrayOf(6))
        png("pack/assets/minecraft/textures/gems/blue.png", byteArrayOf(7))
        val icons = NexoItemIcons(nexo, ttlMillis = 1000, clock = { now })
        val first = icons.sheet()
        assertArrayEquals(byteArrayOf(6), first.icons["gem"])

        config.writeText("gem:\n  Pack:\n    texture: gems/blue\n")
        now = 999
        assertSame(first, icons.sheet())
        now = 1000
        val second = icons.sheet()
        assertArrayEquals(byteArrayOf(7), second.icons["gem"])
        assertNotEquals(first.hash, second.hash)
        now = 2000
        assertEquals(second.hash, icons.sheet().hash)
    }

    @Test
    fun `no Nexo folder and escaping refs give nothing`() {
        assertNull(NexoItemIcons(File(nexo, "absent")).read("ruby"])
        file("items/evil.yml", "evil:\n  Pack:\n    texture: ../../../secret\n")
        png("secret.png", byteArrayOf(9))
        assertNull(NexoItemIcons(nexo).read("evil"])
    }
}
