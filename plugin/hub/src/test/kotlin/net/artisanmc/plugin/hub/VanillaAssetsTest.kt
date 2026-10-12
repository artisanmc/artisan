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

    @AfterTest fun stop() { http.stop(0); cache.deleteRecursively() }

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

    private fun sha1(bytes: ByteArray) = MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
}
