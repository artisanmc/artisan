package net.artisanmc.plugin

import net.artisanmc.plugin.resourcepack.BedrockPackManager
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import kotlin.test.*

class BedrockPackManagerTest {
    private val dir = Files.createTempDirectory("artisan_bedrock_").toFile()
    private val served = Files.createTempDirectory("artisan_hub_").toFile()

    private class Inline(dir: File) : BedrockPackManager(dir) {
        override fun runDownload(action: () -> Unit) = action()
    }

    private fun pack(content: String): Pair<File, String> {
        val bytes = "PK$content".toByteArray()
        val hash = MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
        return File(served, "$hash.mcpack").apply { writeBytes(bytes) } to hash
    }

    @Test fun `downloads the pack, keeps the last one and tells its listeners`() {
        val mgr = Inline(dir)
        val seen = mutableListOf<File?>()
        mgr.onChange { seen += it }
        val (a, hashA) = pack("a")
        mgr.apply(a.toURI().toURL().toString(), hashA)
        assertEquals("$hashA.mcpack", mgr.current?.name)
        val (b, hashB) = pack("b")
        mgr.apply(b.toURI().toURL().toString(), hashB)
        assertEquals(listOf("$hashB.mcpack"), dir.list()!!.toList())
        assertEquals(listOf(null, "$hashA.mcpack", "$hashB.mcpack"), seen.map { it?.name })

        // A wrong hash leaves the current pack.
        mgr.apply(a.toURI().toURL().toString(), "0".repeat(40))
        assertEquals("$hashB.mcpack", mgr.current?.name)

        val again = Inline(dir)
        again.loadFromDisk()
        assertEquals("$hashB.mcpack", again.current?.name)
        again.clear()
        assertNull(again.current)
        assertTrue(dir.list()!!.isEmpty())
    }
}
