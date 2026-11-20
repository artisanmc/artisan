package net.artisanmc.plugin.hub

import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VanillaAssetsTest {
    private val cache = Files.createTempDirectory("vanilla").toFile()
    private val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)

    @AfterTest fun stop() { http.stop(0); cache.deleteRecursively(); jarRoots.forEach { it.deleteRecursively() } }

    @Test fun `the catalogue closest to the server version is picked`() {
        assertEquals("1.21.4", VanillaAssets(cache, "1.21.4", null).catalogVersion)
        assertEquals("1.21.11", VanillaAssets(cache, "1.21.9", null).catalogVersion)
        assertEquals("1.21.11", VanillaAssets(cache, "1.22", null).catalogVersion)
        assertEquals(2, VanillaAssets(cache, "1.21.10", null).items!!.size())
    }

    @Test fun `embedded icons are served and paths cannot escape`() {
        val assets = VanillaAssets(cache, "1.21.4", null, manifestUrl = OFFLINE)
        assertEquals("icon", assets.texture("icons/stone")!!.decodeToString())
        assertNull(assets.texture("../items/1.21.4"))
        assertNull(assets.texture("item/missing"))
    }

    @Test fun `textures come from the verified Mojang client jar`() {
        val jar = zip("assets/minecraft/textures/item/diamond.png" to "gem", "assets/minecraft/lang/en_us.json" to "{}")
        serve("/jar", jar)
        serve("/version", """{"downloads":{"client":{"url":"${url("/jar")}","sha1":"${sha1(jar)}"}}}""".toByteArray())
        serve("/manifest", """{"versions":[{"id":"1.21.4","url":"${url("/version")}"}]}""".toByteArray())
        http.start()

        val assets = VanillaAssets(cache, "1.21.4", null, manifestUrl = url("/manifest"))
        assets.download()
        assertEquals("gem", assets.texture("item/diamond")!!.decodeToString())
        assertTrue(File(cache, "1.21.4/.done").isFile)
        assertTrue(!File(cache, "1.21.4/client.jar.part").exists())
    }

    @Test fun `a jar that does not match its checksum is not extracted`() {
        serve("/jar", zip("assets/minecraft/textures/item/diamond.png" to "gem"))
        serve("/version", """{"downloads":{"client":{"url":"${url("/jar")}","sha1":"0000"}}}""".toByteArray())
        serve("/manifest", """{"versions":[{"id":"1.21.4","url":"${url("/version")}"}]}""".toByteArray())
        http.start()

        val assets = VanillaAssets(cache, "1.21.4", null, manifestUrl = url("/manifest"))
        assets.download()
        assertNull(assets.texture("item/diamond"))
        assertTrue(!File(cache, "1.21.4/.done").exists())
    }

    @Test fun `icons come from the CDN once their checksum matches the jar's`() {
        val zip = zip("mc-assets/1.21.4/textures/icons/oak_log.png" to "log", "items/1.21.4.json" to "[]")
        serve("/vanilla/icons-1.21.4.zip", zip)
        http.start()

        val assets = VanillaAssets(cache, "1.21.4", null, loader = jarWithIconHash(sha256(zip)), manifestUrl = OFFLINE, iconsUrl = url("/vanilla"))
        assertTrue(assets.downloadIcons())
        assertEquals("log", assets.texture("icons/oak_log")!!.decodeToString())
        assertTrue(File(cache, "icons/1.21.4/.done").isFile)
        assertTrue(!File(cache, "icons/icons-1.21.4.zip.part").exists())
    }

    @Test fun `icons that do not match the jar's checksum are not extracted`() {
        serve("/vanilla/icons-1.21.4.zip", zip("mc-assets/1.21.4/textures/icons/oak_log.png" to "log"))
        http.start()

        val assets = VanillaAssets(cache, "1.21.4", null, loader = jarWithIconHash("00"), manifestUrl = OFFLINE, iconsUrl = url("/vanilla"))
        assertTrue(!assets.downloadIcons())
        assertNull(assets.texture("icons/oak_log"))
    }

    @Test fun `the atlas puts every catalogue item in its own square, in catalogue order`() {
        File(cache, "1.21.4/textures/item").mkdirs()
        png(16, 0xFF00FF00.toInt()).let { File(cache, "1.21.4/textures/item/emerald.png").writeBytes(it) }
        File(cache, "1.21.4/.done").writeText("1.21.4")
        File(cache, "icons/1.21.4").mkdirs()
        png(256, 0xFFFF0000.toInt()).let { File(cache, "icons/1.21.4/oak_log.png").writeBytes(it) }
        File(cache, "icons/1.21.4/.done").writeText("x")
        val catalogue = """[{"id":"emerald","texture":"item/emerald"},{"id":"air","label":"Air"},{"id":"oak_log","texture":"icons/oak_log"}]"""
        val assets = VanillaAssets(cache, "1.21.4", null, loader = jarWithIconHash("00", catalogue), manifestUrl = OFFLINE, iconsUrl = url("/vanilla"))

        val atlas = javax.imageio.ImageIO.read(assets.atlas()!!.inputStream())
        val cell = VanillaAssets.ATLAS_CELL
        assertEquals(VanillaAssets.ATLAS_COLUMNS * cell, atlas.width)
        assertEquals(cell, atlas.height)
        assertEquals(0xFF00FF00.toInt(), atlas.getRGB(cell / 2, cell / 2))
        assertEquals(0, atlas.getRGB(cell + cell / 2, cell / 2) ushr 24)
        assertEquals(0xFFFF0000.toInt(), atlas.getRGB(2 * cell + cell / 2, cell / 2))
    }

    @Test fun `no atlas before the textures and icons are downloaded`() {
        val assets = VanillaAssets(cache, "1.21.4", null, loader = jarWithIconHash("00"), manifestUrl = OFFLINE, iconsUrl = url("/vanilla"))
        assertNull(assets.atlas())
        File(cache, "1.21.4").mkdirs()
        File(cache, "1.21.4/.done").writeText("1.21.4")
        assertNull(assets.atlas())
    }

    private fun png(size: Int, argb: Int): ByteArray {
        val image = java.awt.image.BufferedImage(size, size, java.awt.image.BufferedImage.TYPE_INT_ARGB)
        for (x in 0 until size) for (y in 0 until size) image.setRGB(x, y, argb)
        return ByteArrayOutputStream().also { javax.imageio.ImageIO.write(image, "png", it) }.toByteArray()
    }

    /** A jar holding the 1.21.4 catalogue and the checksum of its icons. */
    private fun jarWithIconHash(hash: String, catalogue: String = "[]"): ClassLoader {
        val root = Files.createTempDirectory("jar").toFile().also { jarRoots += it }
        File(root, "vanilla/items").apply { mkdirs() }.resolve("versions.txt").writeText("1.21.4")
        File(root, "vanilla/items/1.21.4.json").writeText(catalogue)
        File(root, "vanilla/icons").apply { mkdirs() }.resolve("1.21.4.sha256").writeText(hash)
        return java.net.URLClassLoader(arrayOf(root.toURI().toURL()), null)
    }

    private val jarRoots = mutableListOf<File>()

    companion object { const val OFFLINE = "http://127.0.0.1:1/manifest" }

    private fun url(path: String) = "http://127.0.0.1:${http.address.port}$path"

    private fun serve(path: String, body: ByteArray) = http.createContext(path) { exchange ->
        exchange.sendResponseHeaders(200, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
    }

    private fun zip(vararg entries: Pair<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip -> entries.forEach { (name, text) -> zip.putNextEntry(ZipEntry(name)); zip.write(text.toByteArray()); zip.closeEntry() } }
        return out.toByteArray()
    }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun sha1(bytes: ByteArray) = MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
}
