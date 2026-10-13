package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.protocol.ServerLink
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PluginChannelTest {
    private val mapper = ObjectMapper()
    private val local = object : EditorServer {
        override val id = Servers.LOCAL
        override val online = true
        override val link = ServerLink { CompletableFuture.completedFuture(mapOf("ok" to true)) }
        override val label = "Lobby"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun modules() = emptyList<Map<String, Any?>>()
        override fun dataSources() = emptyList<Map<String, Any?>>()
        override fun models() = emptyList<Map<String, Any?>>()
        override fun screens() = emptyList<Map<String, Any?>>()
        override fun serverConfig() = null
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) {}
    }
    private val servers = Servers(local)
    private val sessions = Sessions()
    private val editors = EditorChannel(null)
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"), EditorApi.router(servers, sessions, null), sessions,
        EditorAssets(javaClass.classLoader), editors, Logger.getAnonymousLogger(),
        PluginChannel(servers, "s3cret", sessions, editors, { host -> "https://${host ?: "editor.example"}" }, null),
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

    /** A network server, test side: it receives the hub's messages and replies by hand. */
    private inner class Leaf : WebSocket.Listener {
        val received = LinkedBlockingQueue<JsonNode>()
        val closed = CompletableFuture<Int>()
        private val buffer = StringBuilder()
        val socket: WebSocket = client.newWebSocketBuilder().buildAsync(URI("ws://127.0.0.1:${hub.port}/ws/plugin"), this).get(5, TimeUnit.SECONDS)

        override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
            buffer.append(data)
            if (last) {
                received.add(mapper.readTree(buffer.toString()))
                buffer.clear()
            }
            webSocket.request(1)
            return null
        }

        override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
            closed.complete(statusCode)
            return null
        }

        fun send(message: Map<String, Any?>) {
            socket.sendText(mapper.writeValueAsString(message), true).get(5, TimeUnit.SECONDS)
        }

        fun next(): JsonNode = received.poll(5, TimeUnit.SECONDS) ?: error("nothing received")

        fun hello(key: String = "s3cret", name: String = "survie2", protocol: String = "1") = send(mapOf(
            "type" to "hello", "server_key" to key, "proxy_name" to name, "protocol_version" to protocol,
            "minecraft_version" to "1.21.4", "plugin_version" to "2.0.0",
            "installed_modules" to listOf(mapOf("id" to "quests", "version" to "1.0.0")),
            "server_config" to mapOf("language" to "fr"),
        ))
    }

    private fun get(path: String): CompletableFuture<Pair<Int, JsonNode?>> {
        val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}$path")).header("Cookie", cookie).build()
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .thenApply { it.statusCode() to runCatching { mapper.readTree(it.body()) }.getOrNull() }
    }

    @Test
    fun `a server without the secret is turned away`() {
        val leaf = Leaf()
        leaf.hello(key = "wrong")
        assertEquals(1008, leaf.closed.get(5, TimeUnit.SECONDS))
        assertEquals(1, get("/api/v1/networks/local/servers-status").get().second!!["total"].asInt())
    }

    @Test
    fun `a connected server is listed and answers through its socket`() {
        val leaf = Leaf()
        leaf.hello()
        val ack = leaf.next()
        assertEquals("hello_ack", ack["type"].asText())
        assertEquals("https://editor.example", ack["editor_url"].asText())
        assertTrue(ack["resource_pack"].isObject && ack["resource_pack"].isEmpty)

        val status = get("/api/v1/networks/local/servers-status").get().second!!
        assertEquals(listOf("local", "survie2"), status["servers"].map { it["id"].asText() })
        assertEquals("quests", get("/api/v1/networks/local/servers/survie2/modules").get().second!!["modules"][0]["id"].asText())
        assertEquals("fr", get("/api/v1/networks/local/servers/survie2/server-config").get().second!!["config"]["language"].asText())

        val list = get("/api/v1/networks/local/servers/survie2/projects")
        val listRequest = leaf.next()
        assertEquals("project_list", listRequest["type"].asText())
        leaf.send(mapOf(
            "type" to "project_list_result", "request_id" to listRequest["request_id"].asText(), "ok" to true,
            "project_ids" to listOf("shop"), "project_roots" to listOf(mapOf("project_id" to "shop", "identity" to "personal")),
        ))
        val projects = list.get(5, TimeUnit.SECONDS).second!!
        assertEquals("survie2.shop", projects["projects"][0]["id"].asText())
        assertEquals("survie2", projects["projects"][0]["serverKeyId"].asText())
        assertEquals("shop", projects["projects"][0]["externalId"].asText())

        val read = get("/api/v1/projects/survie2.shop/files")
        val readRequest = leaf.next()
        assertEquals("shop", readRequest["project_id"].asText())
        leaf.send(mapOf("type" to "project_read_result", "request_id" to readRequest["request_id"].asText(), "ok" to true, "files" to emptyList<Any>()))
        assertEquals(200, read.get(5, TimeUnit.SECONDS).first)
    }

    private fun send(method: String, path: String, body: Any? = null): CompletableFuture<Pair<Int, JsonNode?>> {
        val publisher = body?.let { HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(it)) } ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}$path")).method(method, publisher).header("Cookie", cookie).build()
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
            .thenApply { it.statusCode() to runCatching { mapper.readTree(it.body()) }.getOrNull() }
    }

    @Test
    fun `projects on another server are created, renamed and deleted through its socket`() {
        val leaf = Leaf()
        leaf.hello(protocol = "1.1")
        leaf.next()

        val create = send("POST", "/api/v1/networks/local/projects", mapOf("name" to "shop", "serverKeyId" to "survie2"))
        val createRequest = leaf.next()
        assertEquals("project_create", createRequest["type"].asText())
        assertEquals("shop", createRequest["project_id"].asText())
        leaf.send(mapOf("type" to "project_create_result", "request_id" to createRequest["request_id"].asText(), "ok" to true))
        val (created, body) = create.get(5, TimeUnit.SECONDS)
        assertEquals(201, created)
        assertEquals("survie2.shop", body!!["project"]["id"].asText())

        val rename = send("POST", "/api/v1/projects/survie2.shop/rename", mapOf("targetId" to "store"))
        val renameRequest = leaf.next()
        assertEquals("project_rename", renameRequest["type"].asText())
        assertEquals("shop", renameRequest["project_id"].asText())
        assertEquals("store", renameRequest["target_project_id"].asText())
        leaf.send(mapOf("type" to "project_rename_result", "request_id" to renameRequest["request_id"].asText(), "ok" to true))
        assertEquals("survie2.store", rename.get(5, TimeUnit.SECONDS).second!!["projectId"].asText())

        val delete = send("DELETE", "/api/v1/user/projects/survie2.store")
        val deleteRequest = leaf.next()
        assertEquals("project_delete", deleteRequest["type"].asText())
        leaf.send(mapOf("type" to "project_delete_result", "request_id" to deleteRequest["request_id"].asText(), "ok" to false, "error" to "addon_immutable"))
        assertEquals(409, delete.get(5, TimeUnit.SECONDS).first)
    }

    @Test
    fun `a server of an older release is told to update instead of waiting for a reply`() {
        val leaf = Leaf()
        leaf.hello(protocol = "1.0")
        leaf.next()
        for ((code, body) in listOf(
            send("POST", "/api/v1/networks/local/projects", mapOf("name" to "shop", "serverKeyId" to "survie2")),
            send("POST", "/api/v1/projects/survie2.shop/rename", mapOf("targetId" to "store")),
            send("DELETE", "/api/v1/user/projects/survie2.shop"),
        ).map { it.get(5, TimeUnit.SECONDS) }) {
            assertEquals(501, code)
            assertEquals("plugin_update_required", body!!["error"].asText())
        }
        assertTrue(leaf.received.isEmpty())
    }

    @Test
    fun `a server on another major protocol version is shown but not used`() {
        val leaf = Leaf()
        leaf.hello(protocol = "2.0")
        leaf.next()
        val status = get("/api/v1/networks/local/servers-status").get().second!!
        assertEquals(true, status["servers"][1]["updateRequired"].asBoolean())
        val (code, body) = get("/api/v1/networks/local/servers/survie2/projects").get(5, TimeUnit.SECONDS)
        assertEquals(503, code)
        assertEquals("plugin_update_required", body!!["error"].asText())
        assertTrue(leaf.received.isEmpty())
    }

    @Test
    fun `a player on another server gets a link from the hub`() {
        val leaf = Leaf()
        leaf.hello()
        leaf.next()
        val player = UUID.randomUUID().toString()
        val request = mapOf(
            "type" to "editor_link", "request_id" to "r1", "player_id" to player, "player_name" to "Iban",
            "permissions" to listOf(EditorPermissions.VIEW, EditorPermissions.EDIT, "op.everything"), "host" to "play.example",
        )
        leaf.send(request)
        val reply = leaf.next()
        assertEquals("r1", reply["request_id"].asText())
        val url = reply["url"].asText()
        assertTrue(url.startsWith("https://play.example/login/"), url)
        val session = sessions.redeem(url.substringAfterLast('/'))!!
        assertEquals(setOf(EditorPermissions.VIEW, EditorPermissions.EDIT), session.permissions)

        leaf.send(request + ("request_id" to "r2"))
        assertEquals("too_soon", leaf.next()["error"].asText())
    }

    @Test
    fun `a disconnected server stays listed offline`() {
        val leaf = Leaf()
        leaf.hello()
        leaf.next()
        leaf.socket.sendClose(WebSocket.NORMAL_CLOSURE, "bye").get(5, TimeUnit.SECONDS)
        var status: JsonNode
        val deadline = System.currentTimeMillis() + 5000
        do {
            status = get("/api/v1/networks/local/servers-status").get().second!!
        } while (status["online"].asInt() != 1 && System.currentTimeMillis() < deadline)
        assertEquals(false, status["servers"][1]["online"].asBoolean())
        val (code, body) = get("/api/v1/networks/local/servers/survie2/projects").get(5, TimeUnit.SECONDS)
        assertEquals(503, code)
        assertEquals("server_offline", body!!["error"].asText())
    }
}
