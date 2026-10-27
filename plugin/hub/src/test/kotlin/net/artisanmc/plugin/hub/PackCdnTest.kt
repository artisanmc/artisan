package net.artisanmc.plugin.hub

import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** [PackCdn] against a stand-in for `deploy/pack-cdn-worker`: same routes, same answers. */
class PackCdnTest {
    private val secret = "s".repeat(43)
    private val stored = mutableMapOf<String, ByteArray>()
    private val calls = CopyOnWriteArrayList<String>()
    /** Status forced on every call; null: the host behaves. */
    @Volatile private var forced: Int? = null
    private val host = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/resource-pack/") { exchange ->
            val hash = exchange.requestURI.path.removePrefix("/resource-pack/").removeSuffix(".zip")
            val body = exchange.requestBody.readBytes()
            calls += "${exchange.requestMethod} $hash ${exchange.requestHeaders.getFirst("Authorization")}"
            val url = "https://cdn.test/resource-pack/$hash.zip"
            val (status, answer) = when {
                forced != null -> forced!! to "refused"
                exchange.requestMethod == "POST" && hash in stored -> 200 to """{"url":"$url","hash":"$hash","stored":false}"""
                exchange.requestMethod == "POST" -> 404 to "no such pack"
                else -> { stored[hash] = body; 201 to """{"url":"$url","hash":"$hash","stored":true}""" }
            }
            val bytes = answer.toByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        start()
    }
    private val cdn = PackCdn("http://127.0.0.1:${host.address.port}", { secret }, null)

    @AfterEach
    fun stop() = host.stop(0)

    @Test
    fun `uploads a pack the host lacks, then only touches it`() {
        val zip = "PK-pack".toByteArray()
        assertEquals("https://cdn.test/resource-pack/abc.zip", cdn.publish("abc") { zip })
        assertContentEquals(zip, stored["abc"])
        assertEquals(listOf("POST abc Bearer $secret", "PUT abc Bearer $secret"), calls.toList())

        calls.clear()
        assertEquals("https://cdn.test/resource-pack/abc.zip", cdn.publish("abc") { error("not read: the host has it") })
        assertEquals(listOf("POST abc Bearer $secret"), calls.toList())
    }

    @Test
    fun `a host that refuses or is down gives no address`() {
        forced = 429
        assertNull(cdn.publish("abc") { "PK".toByteArray() })
        host.stop(0)
        assertNull(PackCdn("http://127.0.0.1:1", { secret }, null).publish("abc") { "PK".toByteArray() })
    }

    @Test
    fun `refresh sends back the packs the hub serves`(@TempDir dir: File) {
        val store = PackStore(dir)
        val hash = store.put("PK-one".toByteArray())
        stored.clear()
        cdn.refresh(store)
        assertContentEquals("PK-one".toByteArray(), stored[hash])
    }

    @Test
    fun `a leaf is told the host's address, else the hub's`() {
        val leaf = RemoteServer("leaf", publicUrl = { "https://hub.test" })
        leaf.applyResourcePack("abc", "/resource-pack/abc.zip", "https://cdn.test/resource-pack/abc.zip")
        assertEquals("https://cdn.test/resource-pack/abc.zip", leaf.pack?.get("url"))
        leaf.applyResourcePack("abc", "/resource-pack/abc.zip", null)
        assertEquals("https://hub.test/resource-pack/abc.zip", leaf.pack?.get("url"))
    }

    /**
     * Against the real Worker, when `ARTISAN_PACK_CDN_URL` names one (`npm run dev:test` in
     * deploy/pack-cdn-worker: http://127.0.0.1:8788): a pack zipped here goes up, then is only touched.
     */
    @Test
    fun `the Worker takes a pack the JDK zipped`() {
        val worker = System.getenv("ARTISAN_PACK_CDN_URL")
        org.junit.jupiter.api.Assumptions.assumeTrue(!worker.isNullOrBlank(), "ARTISAN_PACK_CDN_URL not set")
        val zip = java.io.ByteArrayOutputStream().also { out ->
            java.util.zip.ZipOutputStream(out).use { z ->
                z.putNextEntry(java.util.zip.ZipEntry("pack.mcmeta"))
                z.write("""{"pack":{"pack_format":46,"description":"${java.util.UUID.randomUUID()}"}}""".toByteArray())
                z.putNextEntry(java.util.zip.ZipEntry("assets/minecraft/textures/item/stick.png"))
                z.write(ByteArray(4096) { it.toByte() })
            }
        }.toByteArray()
        val hash = java.security.MessageDigest.getInstance("SHA-1").digest(zip).joinToString("") { "%02x".format(it) }
        val real = PackCdn(worker!!, { secret + java.util.UUID.randomUUID() }, null)
        val url = real.publish(hash) { zip }
        assertEquals("${PackCdn.baseUrl(worker)}/resource-pack/$hash.zip", url)
        val download = java.net.URI(url!!).toURL().readBytes()
        assertContentEquals(zip, download)
        assertEquals(url, real.publish(hash) { error("not read: the host has it") })
    }

    @Test
    fun `a bare host name means https`() {
        assertEquals("https://cdn.artisanmc.net", PackCdn.baseUrl("cdn.artisanmc.net/"))
        assertEquals("http://127.0.0.1:8788", PackCdn.baseUrl(" http://127.0.0.1:8788 "))
    }
}
