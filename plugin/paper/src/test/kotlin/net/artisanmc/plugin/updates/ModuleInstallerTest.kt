package net.artisanmc.plugin.updates

import java.io.ByteArrayInputStream
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.writeBytes
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ModuleInstallerTest {
    private val root: Path = Files.createTempDirectory("artisan-install")
    private val plugins: Path = Files.createDirectories(root.resolve("plugins"))
    private val update: Path = plugins.resolve("update")
    private val jar = "a jar's bytes".toByteArray()
    private val fetched = mutableListOf<Pair<URI, String>>()
    private var served = jar
    private val installer = ModuleInstaller(plugins, update, { "https://site.test" }, null) { uri, token ->
        fetched += uri to token
        ByteArrayInputStream(served)
    }

    private fun sha(bytes: ByteArray) = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun request(plugin: String = "ArtisanQuests", version: String = "1.2.0", url: String = "https://site.test/downloads/quests/1.2.0/", bytes: ByteArray = jar) =
        ModuleInstaller.Request(plugin, version, url, sha(bytes), bytes.size.toLong(), "arts_token")

    @Test
    fun `an installed plugin's jar goes to the update folder under the running jar's name`() {
        val running = plugins.resolve("ArtisanQuests-1.0.0.jar").also { it.writeBytes("old".toByteArray()) }
        val wanted = request()
        assertNull(installer.refusal(wanted, running))
        assertTrue(installer.begin(wanted))
        installer.install(wanted, running)

        assertContentEquals(jar, update.resolve("ArtisanQuests-1.0.0.jar").readBytes())
        // The running jar is untouched: the server swaps it at its next start.
        assertContentEquals("old".toByteArray(), running.readBytes())
        assertEquals(mapOf("ArtisanQuests" to mapOf("version" to "1.2.0", "state" to "ready")), installer.staged())
        assertEquals(URI.create("https://site.test/downloads/quests/1.2.0/") to "arts_token", fetched.single())
    }

    @Test
    fun `a new plugin's jar goes to the plugins folder, one file however many times`() {
        installer.install(request(), null)
        assertTrue(plugins.resolve("ArtisanQuests-1.2.0.jar").exists())

        installer.install(request(version = "1.3.0", url = "https://site.test/downloads/quests/1.3.0/"), null)
        assertEquals(listOf("ArtisanQuests-1.3.0.jar"), plugins.listDirectoryEntries("*.jar").map { it.name })
    }

    @Test
    fun `a jar that is not the one the site announced is thrown away`() {
        val wanted = request()
        served = "something else".toByteArray()
        installer.install(wanted, null)
        assertEquals(emptyList(), plugins.listDirectoryEntries().map { it.name })
        assertEquals("failed", installer.staged().getValue("ArtisanQuests")["state"])

        // Same length, other bytes.
        served = "A jar's bytes".toByteArray()
        installer.install(wanted, null)
        assertEquals(emptyList(), plugins.listDirectoryEntries().map { it.name })
        assertEquals("hash_mismatch", installer.staged().getValue("ArtisanQuests")["error"])
    }

    @Test
    fun `only this server's site, well-formed names and a jar in the plugins folder`() {
        assertEquals("invalid_input", installer.refusal(request(url = "https://elsewhere.test/downloads/quests/1.2.0/"), null))
        assertEquals("invalid_input", installer.refusal(request(url = "https://site.test.evil.test/x"), null))
        assertEquals("invalid_input", installer.refusal(request(plugin = "../Quests"), null))
        assertEquals("invalid_input", installer.refusal(request(version = "1.2.0/../x"), null))
        assertEquals("invalid_input", installer.refusal(request().copy(sha256 = "abc"), null))
        assertEquals("invalid_input", installer.refusal(request().copy(size = 0), null))
        assertEquals("not_updatable", installer.refusal(request(), root.resolve("elsewhere/ArtisanQuests.jar")))
        assertTrue(fetched.isEmpty())
    }

    @Test
    fun `one download per plugin at a time`() {
        val wanted = request()
        assertTrue(installer.begin(wanted))
        assertFalse(installer.begin(wanted))
        assertEquals("install_in_progress", installer.refusal(wanted, null))
        installer.install(wanted, null)
        assertNull(installer.refusal(wanted, null))
    }
}

/** The real download against a stand-in for the site: the bearer, and what each refusal becomes. */
class ModuleDownloadTest {
    private val jar = "a jar's bytes".toByteArray()
    private val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/downloads/") { e ->
            val status = when (e.requestHeaders.getFirst("Authorization")) {
                "Bearer arts_owner" -> 200
                "Bearer arts_other" -> 403
                else -> 401
            }
            val body = if (status == 200) jar else ByteArray(0)
            e.sendResponseHeaders(status, if (body.isEmpty()) -1 else body.size.toLong())
            e.responseBody.use { it.write(body) }
        }
        start()
    }
    private val site = "http://127.0.0.1:${server.address.port}"
    private val plugins: Path = Files.createDirectories(Files.createTempDirectory("artisan-download").resolve("plugins"))
    private val installer = ModuleInstaller(plugins, plugins.resolve("update"), { site })

    private fun request(token: String) = ModuleInstaller.Request(
        "ArtisanQuests", "1.2.0", "$site/downloads/quests/1.2.0/",
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(jar)), jar.size.toLong(), token,
    )

    @kotlin.test.AfterTest
    fun stop() = server.stop(0)

    @Test
    fun `the jar is downloaded with the token and placed once it matches`() {
        installer.install(request("arts_owner"), null)
        assertContentEquals(jar, plugins.resolve("ArtisanQuests-1.2.0.jar").readBytes())
        assertEquals("ready", installer.staged().getValue("ArtisanQuests")["state"])
    }

    @Test
    fun `a refusal by the site is the reason shown`() {
        installer.install(request("arts_other"), null)
        assertEquals("licence_required", installer.staged().getValue("ArtisanQuests")["error"])
        installer.install(request("arts_revoked"), null)
        assertEquals("site_not_linked", installer.staged().getValue("ArtisanQuests")["error"])
        assertEquals(emptyList(), plugins.listDirectoryEntries().map { it.name })
    }
}
