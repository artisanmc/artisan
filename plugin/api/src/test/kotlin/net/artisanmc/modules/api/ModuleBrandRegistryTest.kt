package net.artisanmc.modules.api

import java.net.URLClassLoader
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.artisanmc.modules.api.editor.ModuleBrandDeclaration
import net.artisanmc.modules.api.editor.ModuleBrandRegistry

/** A module ships its icon and its logo in its jar; the editor shows them. */
class ModuleBrandRegistryTest {

    private fun svg(w: Int, h: Int, body: String = """<rect x="0" y="0" width="1" height="1" fill="#e0605a"/>""") =
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $w $h" shape-rendering="crispEdges">$body</svg>""".toByteArray()

    private fun brand(vararg files: Pair<String, ByteArray>) = ModuleBrandDeclaration(linkedMapOf(*files))

    @Test
    fun `a brand is owned by the module registering it and leaves with it`() {
        val reg = ModuleBrandRegistry()
        assertFailsWith<IllegalStateException> { reg.register(brand("icon" to svg(16, 16))) }
        reg.bindOwner("auctions")
        reg.register(brand("icon" to svg(16, 16)))
        reg.register(brand("icon" to svg(16, 16), "logo-dark" to svg(85, 8)))
        reg.bindOwner(null)

        assertEquals(listOf("icon", "logo-dark"), reg.find("auctions")?.fileNames)
        reg.unregisterOwnedBy("auctions")
        assertNull(reg.find("auctions"))
        assertTrue(reg.registered().isEmpty())
    }

    @Test
    fun `the wire names the files in a fixed order, the hash and the logo's grid`() {
        val decl = brand("logo-light" to svg(85, 8), "icon" to svg(16, 16), "logo-dark" to svg(85, 8))
        val wire = decl.toWire()
        assertEquals(listOf("icon", "logo-dark", "logo-light"), wire["files"])
        assertEquals(mapOf("width" to 85, "height" to 8), wire["logo"])
        assertEquals(64, (wire["hash"] as String).length)
        assertEquals(setOf("icon", "logo-dark", "logo-light"), decl.texts().keys)
        // The hash covers each file under its name.
        assertNotEquals(brand("icon" to svg(16, 16)).hash, brand("logo-dark" to svg(16, 16)).hash)
        assertNull(brand("icon" to svg(16, 16)).toWire()["logo"])
    }

    @Test
    fun `only static SVGs within the size, under known names`() {
        assertFailsWith<IllegalArgumentException> { ModuleBrandDeclaration(emptyMap()) }
        assertFailsWith<IllegalArgumentException> { brand("banner" to svg(16, 16)) }
        assertFailsWith<IllegalArgumentException> { brand("icon" to "not an image".toByteArray()) }
        assertFailsWith<IllegalArgumentException> { brand("icon" to svg(16, 16, "<script>alert(1)</script>")) }
        assertFailsWith<IllegalArgumentException> { brand("icon" to svg(16, 16, """<rect onload="x()"/>""")) }
        assertFailsWith<IllegalArgumentException> { brand("icon" to svg(16, 16, """<a href="javascript:x()"/>""")) }
        assertFailsWith<IllegalArgumentException> { brand("icon" to svg(16, 16, "<foreignObject/>")) }
        assertFailsWith<IllegalArgumentException> {
            brand("icon" to ByteArray(ModuleBrandDeclaration.MAX_FILE_SIZE + 1) { 'a'.code.toByte() })
        }
    }

    @Test
    fun `fromResources reads the files a jar ships and skips the missing ones`() {
        val dir = Files.createTempDirectory("brand")
        Files.createDirectories(dir.resolve("artisan-brand"))
        Files.write(dir.resolve("artisan-brand/icon.svg"), svg(16, 16))
        Files.write(dir.resolve("artisan-brand/logo-dark.svg"), svg(71, 8))
        URLClassLoader(arrayOf(dir.toUri().toURL()), null).use { loader ->
            val decl = ModuleBrandDeclaration.fromResources(loader, "artisan-brand")
            assertEquals(listOf("icon", "logo-dark"), decl.fileNames)
            assertEquals(listOf(71, 8), decl.logoSize!!.toList())
            assertFailsWith<IllegalArgumentException> { ModuleBrandDeclaration.fromResources(loader, "nothing") }
        }
    }
}
