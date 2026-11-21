package net.artisanmc.plugin.customitems

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
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
    fun `a model with elements is drawn in 3D, once for the items that share it`() {
        file("items/blocks.yml", """
            throne:
              Pack:
                model: shop:furniture/throne
            throne_gold:
              Pack:
                model: shop:furniture/throne
            ore:
              Pack:
                parent_model: block/cube_all
                textures: [ shop:block/ore ]
            pillar:
              Pack:
                model: shop:block/pillar
            flat:
              Pack:
                model: shop:item/flat
            untextured:
              Pack:
                model: shop:furniture/ghost
        """.trimIndent())
        // Elements and display in a parent, textures in the child, a variable pointing to another.
        file("pack/assets/shop/models/furniture/throne.json",
            """{"parent":"shop:furniture/throne_base","textures":{"0":"shop:furniture/throne","particle":"#0"}}""")
        file("pack/assets/shop/models/furniture/throne_base.json", """{"gui_light":"front",
            "elements":[{"from":[2,0,2],"to":[14,12,14],"rotation":{"origin":[8,8,8],"axis":"y","angle":22.5},
              "faces":{"north":{"uv":[0,0,8,8],"texture":"#0"}}}],
            "display":{"gui":{"rotation":[30,225,0],"scale":[0.5,0.5,0.5]},"head":{"scale":[2,2,2]}}}""")
        png("pack/assets/shop/textures/furniture/throne.png", image(0xffff0000.toInt()))
        // A vanilla full block as parent: its shape is known, not read.
        file("pack/assets/shop/models/block/pillar.json",
            """{"parent":"minecraft:block/cube_column","textures":{"end":"shop:block/pillar_top","side":"shop:block/pillar"}}""")
        png("pack/assets/shop/textures/block/pillar.png", image(0xff00ff00.toInt()))
        png("pack/assets/shop/textures/block/pillar_top.png", image(0xff0000ff.toInt()))
        val ore = image(0xffffff00.toInt())
        png("pack/assets/shop/textures/block/ore.png", ore)
        file("pack/assets/shop/models/item/flat.json", """{"parent":"item/generated","textures":{"layer0":"shop:block/ore"}}""")
        file("pack/assets/shop/models/furniture/ghost.json",
            """{"textures":{"0":"shop:nowhere"},"elements":[{"from":[0,0,0],"to":[1,1,1],"faces":{"up":{"texture":"#0"}}}]}""")

        val sheet = NexoItemIcons(nexo).sheet()
        assertEquals(setOf("throne", "throne_gold", "ore", "pillar"), sheet.drawn)
        fun picture(id: String) = ImageIO.read(sheet.icons.getValue(id).inputStream())
        val side = NexoItemIcons.RENDER_SIDE
        for (id in sheet.drawn) assertEquals(side to side, picture(id).width to picture(id).height)
        // Two items of one model get the same picture.
        assertArrayEquals(sheet.icons["throne"], sheet.icons["throne_gold"])
        // The throne: its only face, lit from the front, in its texture's colour.
        val throne = picture("throne")
        val solid = (0 until side).flatMap { y -> (0 until side).map { x -> throne.getRGB(x, y) } }.filter { it ushr 24 == 255 }
        assertTrue(solid.isNotEmpty() && solid.all { it == 0xffff0000.toInt() })
        // The pillar: its top in the top texture, a side under it in the side texture, shaded.
        val pillar = picture("pillar")
        assertEquals(0xff0000ff.toInt(), pillar.getRGB(side / 2, side * 5 / 16))
        val flank = pillar.getRGB(side * 5 / 16, side * 11 / 16)
        assertEquals(0, flank and 0xff00ff)
        assertTrue(((flank shr 8) and 0xff) in 100..254)
        // A model without elements, or whose texture is nowhere, keeps the flat icon or none.
        assertArrayEquals(ore, sheet.icons["flat"])
        assertNull(sheet.icons["untextured"])
    }

    private fun image(argb: Int, width: Int = 16, height: Int = 16): ByteArray {
        val image = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
        for (y in 0 until height) for (x in 0 until width) image.setRGB(x, y, argb)
        return ByteArrayOutputStream().also { ImageIO.write(image, "png", it) }.toByteArray()
    }

    @Test
    fun `a model is drawn once, and the pack is not read again while Nexo's files stand still`() {
        var now = 0L
        file("items/a.yml", "crate:\n  Pack:\n    parent_model: block/cube_all\n    texture: shop:crate\n")
        val texture = png("pack/assets/shop/textures/crate.png", image(0xffff0000.toInt()))
        val generated = png("pack/pack.zip", byteArrayOf(1))
        val icons = NexoItemIcons(nexo, ttlMillis = 1000, clock = { now })
        val first = icons.sheet()
        assertEquals(setOf("crate"), first.drawn)

        // Past its time, with Nexo's generated pack and configs untouched: the same sheet, nothing read.
        texture.writeBytes(image(0xff00ff00.toInt()))
        now = 5000
        assertSame(first, icons.sheet())

        // Nexo rebuilt its pack: read again, and the model drawn from the new texture.
        generated.writeBytes(byteArrayOf(1, 2))
        now = 10_000
        val second = icons.sheet()
        assertNotEquals(first.hash, second.hash)
        assertEquals(0xff00ff00.toInt(), ImageIO.read(second.icons.getValue("crate").inputStream()).getRGB(32, 20))
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
        assertEquals(emptyMap<String, ByteArray>(), NexoItemIcons(File(nexo, "absent")).sheet().icons)
        file("items/evil.yml", "evil:\n  Pack:\n    texture: ../../../secret\n")
        png("secret.png", byteArrayOf(9))
        assertNull(NexoItemIcons(nexo).sheet().icons["evil"])
    }
}
