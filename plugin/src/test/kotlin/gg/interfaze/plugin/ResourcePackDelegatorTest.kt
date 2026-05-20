package gg.interfaze.plugin

import gg.interfaze.plugin.resourcepack.ResourcePackDelegator
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.test.*

class ResourcePackDelegatorTest {
    private lateinit var tempDir: File

    @BeforeTest
    fun setup() {
        tempDir = Files.createTempDirectory("ifz-delegator-test").toFile()
    }

    @AfterTest
    fun teardown() {
        tempDir.deleteRecursively()
    }

    /** Build an in-memory zip with the given (path -> bytes) entries. */
    private fun buildZip(entries: Map<String, ByteArray>): ByteArray {
        val baos = ByteArrayOutputStream()
        ZipOutputStream(baos).use { zos ->
            for ((path, bytes) in entries) {
                zos.putNextEntry(ZipEntry(path))
                zos.write(bytes)
                zos.closeEntry()
            }
        }
        return baos.toByteArray()
    }

    /** Compute SHA-1 hex of bytes (matches the format produced by the backend). */
    private fun sha1Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    @Test
    fun `applyBytes extracts assets-interfaze entries into target dir`() {
        val zip = buildZip(mapOf(
            "assets/interfaze/font/default.json" to "{}".toByteArray(),
            "assets/interfaze/textures/foo.png" to byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        val fontFile = File(tempDir, "assets/interfaze/font/default.json")
        val pngFile = File(tempDir, "assets/interfaze/textures/foo.png")
        assertTrue(fontFile.exists(), "font file not extracted")
        assertTrue(pngFile.exists(), "png file not extracted")
        assertEquals("{}", fontFile.readText())
    }

    @Test
    fun `applyBytes skips pack-mcmeta at zip root`() {
        val zip = buildZip(mapOf(
            "pack.mcmeta" to """{"pack":{"pack_format":64}}""".toByteArray(),
            "assets/interfaze/font/default.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertFalse(File(tempDir, "pack.mcmeta").exists(), "pack.mcmeta should NOT be extracted")
        assertTrue(File(tempDir, "assets/interfaze/font/default.json").exists())
    }

    @Test
    fun `applyBytes skips entries outside assets-interfaze`() {
        val zip = buildZip(mapOf(
            "assets/minecraft/font/default.json" to "{}".toByteArray(),
            "assets/oraxen/textures/foo.png" to byteArrayOf(0x00),
            "assets/interfaze/textures/keep.png" to byteArrayOf(0x01),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertFalse(File(tempDir, "assets/minecraft/font/default.json").exists())
        assertFalse(File(tempDir, "assets/oraxen/textures/foo.png").exists())
        assertTrue(File(tempDir, "assets/interfaze/textures/keep.png").exists())
    }

    @Test
    fun `applyBytes wipes assets-interfaze before extraction`() {
        val staleDir = File(tempDir, "assets/interfaze")
        staleDir.mkdirs()
        File(staleDir, "stale.png").writeBytes(byteArrayOf(0xFF.toByte()))

        val zip = buildZip(mapOf(
            "assets/interfaze/fresh.png" to byteArrayOf(0x01),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertFalse(File(staleDir, "stale.png").exists(), "stale file should be wiped")
        assertTrue(File(staleDir, "fresh.png").exists())
    }

    @Test
    fun `applyBytes does NOT wipe content outside assets-interfaze`() {
        val hostFile = File(tempDir, "assets/minecraft/font/default.json")
        hostFile.parentFile.mkdirs()
        hostFile.writeText("host content")
        val hostRoot = File(tempDir, "pack.mcmeta")
        hostRoot.writeText("""{"pack":{"pack_format":64}}""")

        val zip = buildZip(mapOf(
            "assets/interfaze/x.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertEquals("host content", hostFile.readText(), "host file must not be touched")
        assertTrue(hostRoot.exists(), "host pack.mcmeta must not be touched")
    }

    @Test
    fun `applyBytes silently skips path traversal entries`() {
        val zip = buildZip(mapOf(
            "assets/interfaze/../../etc/passwd" to "evil".toByteArray(),
            "assets/interfaze/safe.png" to byteArrayOf(0x01),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertTrue(File(tempDir, "assets/interfaze/safe.png").exists())
        val parent = tempDir.parentFile
        val unexpected = parent.list { _, name -> name == "etc" }
        assertTrue(unexpected == null || unexpected.isEmpty(), "path traversal escaped: ${unexpected?.toList()}")
    }

    @Test
    fun `applyBytes throws on hash mismatch and does not touch target dir`() {
        val zip = buildZip(mapOf(
            "assets/interfaze/x.json" to "{}".toByteArray(),
        ))
        val wrongHash = "0".repeat(40)
        val delegator = ResourcePackDelegator(tempDir, logger = null)

        assertFails {
            delegator.applyBytes(zip, wrongHash)
        }
        assertFalse(File(tempDir, "assets/interfaze/x.json").exists(),
            "no file should be extracted when hash mismatches")
    }

    // ----- ZIP output mode (target path ends with .zip) -----

    /** Read entry names from a zip file on disk. */
    private fun zipEntries(zipFile: File): Map<String, ByteArray> {
        val out = mutableMapOf<String, ByteArray>()
        ZipInputStream(FileInputStream(zipFile)).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                if (!entry.isDirectory) {
                    out[entry.name] = zis.readBytes()
                }
                zis.closeEntry()
            }
        }
        return out
    }

    @Test
    fun `zip mode writes a zip file with assets-interfaze entries plus pack-mcmeta`() {
        val target = File(tempDir, "interfaze.zip")
        val zip = buildZip(mapOf(
            "assets/interfaze/font/default.json" to "{}".toByteArray(),
            "assets/interfaze/textures/foo.png" to byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47),
        ))
        val delegator = ResourcePackDelegator(target, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertTrue(target.exists() && target.isFile, "target must be a regular file")
        val entries = zipEntries(target)
        assertTrue(entries.containsKey("pack.mcmeta"), "pack.mcmeta should be at zip root")
        assertEquals("{}", entries["assets/interfaze/font/default.json"]?.toString(Charsets.UTF_8))
        assertNotNull(entries["assets/interfaze/textures/foo.png"])
    }

    @Test
    fun `zip mode skips entries outside assets-interfaze`() {
        val target = File(tempDir, "interfaze.zip")
        val zip = buildZip(mapOf(
            "pack.mcmeta" to """{"pack":{"pack_format":64}}""".toByteArray(),
            "assets/minecraft/font/default.json" to "{}".toByteArray(),
            "assets/oraxen/textures/foo.png" to byteArrayOf(0x00),
            "assets/interfaze/keep.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(target, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        val entries = zipEntries(target)
        // Our own pack.mcmeta replaces the source one (since we write it first
        // and the source one is filtered out by acceptEntry).
        val ourMcmeta = entries["pack.mcmeta"]?.toString(Charsets.UTF_8) ?: ""
        assertFalse("pack_format\":64" in ourMcmeta, "source pack.mcmeta must not leak in")
        assertFalse(entries.containsKey("assets/minecraft/font/default.json"))
        assertFalse(entries.containsKey("assets/oraxen/textures/foo.png"))
        assertTrue(entries.containsKey("assets/interfaze/keep.json"))
    }

    @Test
    fun `zip mode overwrites a stale target zip atomically`() {
        val target = File(tempDir, "interfaze.zip")
        // Pre-existing stale zip with old content.
        target.writeBytes(buildZip(mapOf(
            "assets/interfaze/stale.png" to byteArrayOf(0xFF.toByte()),
        )))

        val zip = buildZip(mapOf(
            "assets/interfaze/fresh.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(target, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        val entries = zipEntries(target)
        assertFalse(entries.containsKey("assets/interfaze/stale.png"), "stale entry should be gone")
        assertTrue(entries.containsKey("assets/interfaze/fresh.json"))
        // No leftover .tmp file from the atomic rename.
        assertFalse(File(tempDir, "interfaze.zip.tmp").exists())
    }

    @Test
    fun `zip mode throws on hash mismatch and does not create target`() {
        val target = File(tempDir, "interfaze.zip")
        val zip = buildZip(mapOf(
            "assets/interfaze/x.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(target, logger = null)

        assertFails {
            delegator.applyBytes(zip, "0".repeat(40))
        }
        assertFalse(target.exists(), "zip should not be written on hash mismatch")
    }
}
