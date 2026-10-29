package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.protocol.ServerLink
import java.net.URI
import java.net.URLClassLoader
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EditionTest {
    private val mapper = ObjectMapper()
    private val applied = Collections.synchronizedList(mutableListOf<String>())
    private val server = object : EditorServer {
        override val id = "u-local"
        override val online = true
        override val link = ServerLink { CompletableFuture.completedFuture(mapOf("ok" to true)) }
        override val label = "Survie"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun announcement() = net.artisanmc.plugin.protocol.ServerAnnouncement()
        override fun serverConfig() = mapOf<String, Any?>()
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) { applied += hash }
    }
    private val packDir = Files.createTempDirectory("packs").toFile()
    // A pack received while the server ran the Pro jar.
    private val kept = PackStore(packDir).put("PK\u0003\u0004pro pack".toByteArray())
    private val sessions = Sessions()
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"),
        EditorApi.router(Servers(server), sessions, null, packs = PackStore(packDir), edition = Edition.FREE), sessions,
        EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newHttpClient()
    private lateinit var cookie: String

    @BeforeTest
    fun start() {
        hub.start()
        val token = (sessions.issueLink(UUID.randomUUID(), "Iban", EditorPermissions.ALL.toSet()) as Sessions.LinkResult.Issued).token
        cookie = "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
    }

    @AfterTest
    fun stop() = hub.stop()

    @Test
    fun `the free jar refuses a new pack and keeps serving the one it has`() {
        val put = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/u-local/resource-pack"))
            .PUT(HttpRequest.BodyPublishers.ofByteArray("PK\u0003\u0004new".toByteArray())).header("Cookie", cookie).build()
        val refused = client.send(put, HttpResponse.BodyHandlers.ofString())
        assertEquals(403, refused.statusCode())
        assertEquals(PackRoutes.PRO_REQUIRED, mapper.readTree(refused.body())["error"].asText())
        assertTrue(applied.isEmpty())

        val get = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/resource-pack/$kept.zip")).build()
        assertEquals(200, client.send(get, HttpResponse.BodyHandlers.ofByteArray()).statusCode())
    }

    @Test
    fun `the editor learns the edition with the user`() {
        val me = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/auth/me")).header("Cookie", cookie).build()
        assertEquals("free", mapper.readTree(client.send(me, HttpResponse.BodyHandlers.ofString()).body())["user"]["edition"].asText())
    }

    @Test
    fun `the edition comes from the jar, Pro without the file`() {
        val dir = Files.createTempDirectory("edition").toFile()
        val empty = URLClassLoader(arrayOf(dir.toURI().toURL()), null)
        assertEquals(Edition.PRO, Edition.bundled(empty))
        dir.resolve(Edition.RESOURCE).writeText("edition=free\n")
        assertEquals(Edition.FREE, Edition.bundled(URLClassLoader(arrayOf(dir.toURI().toURL()), null)))
        assertEquals(Edition.PRO, Edition.parse("pro"))
        assertEquals(Edition.PRO, Edition.parse("frée"))
    }
}
