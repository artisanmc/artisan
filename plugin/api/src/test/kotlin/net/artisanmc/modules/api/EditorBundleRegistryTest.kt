package net.artisanmc.modules.api

import java.net.URL
import java.net.URLClassLoader
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.artisanmc.modules.api.editor.DuplicateEditorBundleException
import net.artisanmc.modules.api.editor.EditorBundleDeclaration
import net.artisanmc.modules.api.editor.EditorBundleRegistry

/** Runtime module bundles, level 3: a module ships its editor view in its jar. */
class EditorBundleRegistryTest {

    private fun bundle(script: String = "export default {}", sdk: String = "1.0") =
        EditorBundleDeclaration(script.toByteArray(), sdk)

    @Test
    fun `a bundle is owned by the module registering it and leaves with it`() {
        val reg = EditorBundleRegistry()
        reg.bindOwner("quests")
        reg.register(bundle())
        reg.bindOwner("shop")
        reg.register(bundle("export const x = 1", "1.2.3"))
        reg.bindOwner(null)

        assertEquals(listOf("quests", "shop"), reg.registered().keys.toList())
        assertEquals("1.2.3", reg.find("shop")?.sdk)
        assertNull(reg.find("other"))

        reg.unregisterOwnedBy("quests")
        assertNull(reg.find("quests"))
        assertTrue(reg.unregister("shop"))
        assertFalse(reg.unregister("shop"))
        assertTrue(reg.registered().isEmpty())
    }

    @Test
    fun `one bundle per module, and only from a module's onEnable`() {
        val reg = EditorBundleRegistry()
        assertEquals(
            "an editor bundle is registered from a module's onEnable",
            assertFailsWith<IllegalStateException> { reg.register(bundle()) }.message,
        )
        reg.bindOwner("quests")
        reg.register(bundle())
        assertFailsWith<DuplicateEditorBundleException> { reg.register(bundle("export const y = 2")) }
        assertEquals("export default {}", String(reg.find("quests")!!.script))
    }

    @Test
    fun `the declaration hashes its script and validates it`() {
        val b = bundle("abc")
        // SHA-256("abc"), the FIPS 180-2 test vector.
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", b.hash)
        assertEquals(3, b.size)
        assertEquals(mapOf("sdk" to "1.0", "hash" to b.hash, "size" to 3), b.toWire())
        assertEquals(listOf("sdk", "hash", "size"), b.toWire().keys.toList())

        val copy = b.script
        copy[0] = 'z'.code.toByte()
        assertEquals("abc", String(b.script))

        assertFailsWith<IllegalArgumentException> { EditorBundleDeclaration(ByteArray(0), "1.0") }
        assertFailsWith<IllegalArgumentException> { EditorBundleDeclaration(ByteArray(EditorBundleDeclaration.MAX_SIZE + 1) { 'a'.code.toByte() }, "1.0") }
        assertFailsWith<IllegalArgumentException> { EditorBundleDeclaration(byteArrayOf(0xC3.toByte()), "1.0") }
        for (sdk in listOf("1", "v1.0", "1.0.0.0", "1.0-beta", "")) {
            assertFailsWith<IllegalArgumentException>(sdk) { bundle(sdk = sdk) }
        }
        EditorBundleDeclaration(ByteArray(EditorBundleDeclaration.MAX_SIZE) { 'a'.code.toByte() }, "10.20.30")
    }

    @Test
    fun `fromResource reads the module jar`() {
        val dir = Files.createTempDirectory("bundle-jar")
        Files.createDirectories(dir.resolve("artisan-editor"))
        Files.writeString(dir.resolve("artisan-editor/ui.js"), "export default { id: 'quests' }")
        URLClassLoader(arrayOf<URL>(dir.toUri().toURL()), null).use { loader ->
            val b = EditorBundleDeclaration.fromResource(loader, "artisan-editor/ui.js", "1.0")
            assertContentEquals("export default { id: 'quests' }".toByteArray(), b.script)
            assertFailsWith<IllegalArgumentException> { EditorBundleDeclaration.fromResource(loader, "artisan-editor/missing.js", "1.0") }
        }
    }
}
