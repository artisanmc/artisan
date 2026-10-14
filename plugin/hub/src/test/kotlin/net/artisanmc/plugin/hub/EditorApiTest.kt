package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.protocol.ServerLink
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EditorApiTest {
    private val mapper = ObjectMapper()
    private val sent: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())
    private var answer: (Map<String, Any?>) -> Map<String, Any?> = { mapOf("ok" to true) }
    private val server = object : EditorServer {
        override val id = Servers.LOCAL
        override val uuid = "u-local"
        override val online = true
        override val link = ServerLink { message ->
            sent += message
            CompletableFuture.completedFuture(mapOf("type" to "${message["type"]}_result") + answer(message))
        }
        override val label = "Survie"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun modules() = listOf(mapOf<String, Any?>("id" to "menus", "version" to "2.0.0"))
        override fun dataSources() = emptyList<Map<String, Any?>>()
        override fun models() = listOf(mapOf<String, Any?>("id" to "plain"), mapOf<String, Any?>("id" to "shop:item"))
        override fun screens() = emptyList<Map<String, Any?>>()
        override fun serverConfig() = mapOf<String, Any?>("language" to "en")
        override fun customItems() = listOf(mapOf("id" to "nexo:coin", "label" to "coin", "category" to "nexo"))
        override fun applyResourcePack(hash: String, path: String) { applied += hash to path }
    }
    private val applied = Collections.synchronizedList(mutableListOf<Pair<String, String>>())
    private var stored = false
    private val loaded = object : LoadedProjects {
        override fun list(server: String) = if (!stored) null else mapOf<String, Any?>(
            "project_ids" to listOf("kept"), "project_roots" to listOf(mapOf("project_id" to "kept", "identity" to "folder", "project_key" to "k-9")),
            "resource_inventory" to emptyList<Any>(),
        )
        override fun read(server: String, folder: String) = if (!stored || folder != "kept") null else mapOf<String, Any?>(
            "hash" to "s1", "files" to listOf(mapOf("path" to "a.yml", "content" to "a: 1")), "failed" to emptyList<Any>(), "binaries" to emptyList<Any>(),
        )
        override fun binary(server: String, folder: String, path: String) = if (stored && path == "logo.png") byteArrayOf(4, 2) else null
    }
    private val history = object : ProjectHistory {
        override fun versions(server: String, folder: String) =
            if (server == Servers.LOCAL && folder == "shop") listOf(mapOf<String, Any?>("id" to "7", "hash" to "h7")) else null
        override fun version(server: String, folder: String, id: String) =
            if (folder == "shop" && id == "7") mapOf<String, Any?>("id" to "7", "previousId" to null) else null
        override fun versionBinary(server: String, folder: String, id: String, path: String) =
            if (folder == "shop" && id == "7" && path == "logo.png") byteArrayOf(9, 9) else null
        override fun fileHistory(server: String, folder: String, path: String) =
            if (folder == "shop") listOf(mapOf<String, Any?>("at" to 1L, "content" to "a: 1", "author" to null)) else null
    }
    private val sessions = Sessions()
    private val player = UUID.randomUUID()
    private val prefsDir = java.nio.file.Files.createTempDirectory("prefs").toFile()
    private val prefs = PlayerPrefs(prefsDir)
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"), EditorApi.router(Servers(server), sessions, null, VanillaAssets(java.nio.file.Files.createTempDirectory("vanilla").toFile(), "1.21.4", null, manifestUrl = VanillaAssetsTest.OFFLINE),
            PackStore(java.nio.file.Files.createTempDirectory("packs").toFile()), prefs, history, loaded), sessions,
        EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newHttpClient()
    private lateinit var cookie: String

    @BeforeTest
    fun start() {
        hub.start()
        val token = (sessions.issueLink(player, "Iban", EditorPermissions.ALL.toSet()) as Sessions.LinkResult.Issued).token
        cookie = "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
    }

    @AfterTest
    fun stop() = hub.stop()

    private fun call(method: String, path: String, body: Any? = null): Pair<Int, JsonNode?> {
        val publisher = body?.let { HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(it)) } ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}$path"))
            .method(method, publisher).header("Cookie", cookie).header("Content-Type", "application/json").build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        return response.statusCode() to runCatching { mapper.readTree(response.body()) }.getOrNull()
    }

    @Test
    fun `the signed-in player is the editor user`() {
        val (status, body) = call("GET", "/api/v1/auth/me")
        assertEquals(200, status)
        assertEquals(player.toString(), body!!["user"]["id"].asText())
        assertEquals("Iban", body["user"]["name"].asText())
        assertTrue(body["user"]["editorTour"].isNull)
    }

    @Test
    fun `editor preferences are kept per player`() {
        val (status, body) = call("PATCH", "/api/v1/auth/me", mapOf("theme" to "dark", "editor_language" to "fr", "editor_tour" to mapOf("action" to "start")))
        assertEquals(200, status)
        assertTrue(body!!["tourStarted"].asBoolean())
        assertEquals(0, body["user"]["editorTour"]["step"].asInt())
        call("PATCH", "/api/v1/auth/me", mapOf("editor_tour" to mapOf("action" to "progress", "step" to 3)))
        val me = call("GET", "/api/v1/auth/me").second!!["user"]
        assertEquals("dark", me["theme"].asText())
        assertEquals("fr", me["editorLanguage"].asText())
        assertEquals(3, me["editorTour"]["step"].asInt())
        assertTrue(java.io.File(prefsDir, "$player.json").isFile)
        assertEquals(422, call("PATCH", "/api/v1/auth/me", mapOf("theme" to "neon")).first)
        assertEquals(422, call("PATCH", "/api/v1/auth/me", mapOf("editor_tour" to mapOf("action" to "progress", "step" to 9))).first)
        assertEquals(400, call("PATCH", "/api/v1/auth/me", mapOf("theme" to "x".repeat(PlayerPrefs.MAX_BODY))).first)
        assertEquals("dark", call("GET", "/api/v1/auth/me").second!!["user"]["theme"].asText())
    }

    @Test
    fun `one network with one server, both named local`() {
        val (_, body) = call("GET", "/api/v1/network")
        assertEquals("u-local", body!!["serverKeys"][0]["slug"].asText())
        assertEquals("Survie", body["serverKeys"][0]["label"].asText())
        assertEquals(404, call("GET", "/api/v1/servers/other/modules").first)
        assertEquals("menus", call("GET", "/api/v1/servers/u-local/modules").second!!["modules"][0]["id"].asText())
        assertEquals(listOf("shop:item"), call("GET", "/api/v1/servers/u-local/models").second!!["models"].map { it["id"].asText() })
    }

    @Test
    fun `projects are listed by folder name`() {
        answer = { mapOf("ok" to true, "project_ids" to listOf("shop"), "project_roots" to listOf(mapOf("project_id" to "shop", "identity" to "folder", "project_key" to "k-1"))) }
        val (_, body) = call("GET", "/api/v1/servers/u-local/projects")
        assertEquals("shop", body!!["project_ids"][0].asText())
        assertEquals("k-1", body["projects"][0]["projectKey"].asText())
        assertEquals("shop", body["projects"][0]["externalId"].asText())
        assertEquals("u-local", body["projects"][0]["serverKeyId"].asText())

        val (status, identity) = call("GET", "/api/v1/user/projects/shop?server=local&network=local")
        assertEquals(200, status)
        assertEquals("shop", identity!!["project"]["id"].asText())
        assertEquals(404, call("GET", "/api/v1/user/projects/missing").first)
    }

    @Test
    fun `an asset addressed by its hash is cached for good, any other answer is revalidated`() {
        val png = byteArrayOf(1, 2, 3)
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(png).joinToString("") { "%02x".format(it) }
        answer = { mapOf("ok" to true, "content_base64" to java.util.Base64.getEncoder().encodeToString(png)) }
        fun cacheOf(path: String): String {
            val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}$path")).header("Cookie", cookie).GET().build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofByteArray())
            assertEquals(200, response.statusCode())
            return response.headers().firstValue("Cache-Control").orElse("")
        }
        assertEquals("private, max-age=31536000, immutable", cacheOf("/api/v1/projects/shop/binary?path=assets/a.png&h=$hash"))
        assertEquals("private, no-cache", cacheOf("/api/v1/projects/shop/binary?path=assets/a.png&h=${"0".repeat(64)}"))
        assertEquals("private, no-cache", cacheOf("/api/v1/projects/shop/binary?path=assets/a.png"))
        assertEquals("private, max-age=31536000, immutable", cacheOf("/api/v1/user/projects/shop/drafts/d1/blobs/$hash"))
    }

    @Test
    fun `versions and file history come from the database`() {
        assertEquals("h7", call("GET", "/api/v1/projects/shop/versions").second!!["versions"][0]["hash"].asText())
        assertEquals(0, call("GET", "/api/v1/projects/other/versions").second!!["versions"].size())
        assertEquals("7", call("GET", "/api/v1/projects/shop/versions/7").second!!["id"].asText())
        assertEquals(404, call("GET", "/api/v1/projects/shop/versions/8").first)
        assertEquals(200, call("GET", "/api/v1/projects/shop/versions/7/binary?path=logo.png").first)
        assertEquals(404, call("GET", "/api/v1/projects/shop/versions/7/binary?path=a.yml").first)
        assertEquals("a: 1", call("GET", "/api/v1/projects/shop/history?path=a.yml").second!!["versions"][0]["content"].asText())
        assertTrue(sent.none { it["type"] == "project_history" })
    }

    @Test
    fun `projects are read from the database, without asking the server`() {
        stored = true
        assertEquals("kept", call("GET", "/api/v1/servers/u-local/projects").second!!["projects"][0]["externalId"].asText())
        assertEquals("s1", call("GET", "/api/v1/projects/kept/files").second!!["hash"].asText())
        assertEquals(true, call("GET", "/api/v1/projects/kept/files?if_hash=s1").second!!["unchanged"].asBoolean())
        assertEquals(200, call("GET", "/api/v1/projects/kept/binary?path=logo.png").first)
        assertEquals(200, call("GET", "/api/v1/user/projects/kept").first)
        assertTrue(sent.isEmpty(), "nothing relayed: $sent")
    }

    @Test
    fun `an offline server's project opens from the database, dated by its last presence`() {
        stored = true
        val servers = Servers(server, known = { mapOf("survie" to Servers.Seen("u-survie", java.time.Instant.parse("2026-10-14T10:00:00Z"))) })
        val offline = HubServer(
            WebConfig(port = 0, bind = "127.0.0.1"), EditorApi.router(servers, sessions, null, loaded = loaded), sessions,
            EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
        ).also { it.start() }
        try {
            fun get(path: String) = client.send(
                HttpRequest.newBuilder(URI("http://127.0.0.1:${offline.port}$path")).header("Cookie", cookie).GET().build(),
                HttpResponse.BodyHandlers.ofString(),
            ).let { mapper.readTree(it.body()) }
            assertEquals("2026-10-14T10:00:00Z", get("/api/v1/projects/survie.kept/files")["offlineSince"].asText())
            assertEquals(false, get("/api/v1/user/projects/survie.kept")["connection"]["available"].asBoolean())
            assertEquals(true, get("/api/v1/user/projects/kept")["connection"]["available"].asBoolean())
        } finally {
            offline.stop()
        }
    }

    @Test
    fun `a publication names its author`() {
        call("PUT", "/api/v1/projects/shop/files", mapOf("operation_id" to "op-1", "files" to emptyList<Any>()))
        assertEquals(player.toString(), sent.last()["author_id"])
        assertEquals("Iban", sent.last()["author_name"])
    }

    @Test
    fun `reading a project passes the plugin tree through`() {
        answer = { mapOf("ok" to true, "files" to listOf(mapOf("path" to "main.yml", "content" to "a")), "hash" to "h1") }
        val (status, body) = call("GET", "/api/v1/projects/shop/files?if_hash=h0")
        assertEquals(200, status)
        assertEquals("h1", body!!["hash"].asText())
        assertEquals("h0", sent.last()["if_hash"])
        answer = { mapOf("ok" to false, "error" to "unknown_project") }
        assertEquals(404, call("GET", "/api/v1/projects/shop/files").first)
    }

    @Test
    fun `a conflicting write answers 409 with the conflicts`() {
        answer = { mapOf("ok" to false, "error" to "conflict", "conflicts" to listOf(mapOf("path" to "main.yml", "disk" to "b")), "disk_files" to listOf("main.yml")) }
        val (status, body) = call("PUT", "/api/v1/projects/shop/files", mapOf("files" to listOf(mapOf("path" to "main.yml", "content" to "a", "base_hash" to null)), "operationId" to "op1"))
        assertEquals(409, status)
        assertEquals("main.yml", body!!["disk_files"][0].asText())
        val message = sent.last()
        assertEquals("project_write", message["type"])
        assertEquals("op1", message["operation_id"])
        assertEquals(422, call("PUT", "/api/v1/projects/shop/files", mapOf("operationId" to "op1")).first)
    }

    @Test
    fun `drafts belong to the signed-in player`() {
        answer = { mapOf("ok" to true, "draft" to mapOf("id" to "d1", "revision" to 1)) }
        val (status, body) = call("POST", "/api/v1/user/projects/shop/drafts", mapOf("id" to "d1", "name" to "x", "snapshot" to mapOf("tree" to emptyMap<String, Any>())))
        assertEquals(201, status)
        assertEquals("shop", body!!["draft"]["projectId"].asText())
        assertEquals(player.toString(), sent.last()["owner_id"])
        assertEquals("create", sent.last()["action"])

        answer = { mapOf("ok" to false, "error" to "draft_conflict") }
        assertEquals(409, call("PUT", "/api/v1/user/projects/shop/drafts/d1", mapOf("revision" to 1, "snapshot" to emptyMap<String, Any>())).first)
        assertEquals(422, call("PUT", "/api/v1/user/projects/shop/drafts/d1", mapOf("snapshot" to emptyMap<String, Any>())).first)
    }

    @Test
    fun `projects are created, renamed and deleted on the server disk`() {
        val (created, body) = call("POST", "/api/v1/network/projects", mapOf("name" to "shop", "serverKeyId" to "u-local"))
        assertEquals(201, created)
        assertEquals("shop", body!!["project"]["id"].asText())
        assertEquals(mapOf("type" to "project_create", "project_id" to "shop"), sent.last())
        assertEquals(404, call("POST", "/api/v1/network/projects", mapOf("name" to "shop", "serverKeyId" to "nope")).first)
        assertEquals(422, call("POST", "/api/v1/network/projects", mapOf("serverKeyId" to "u-local")).first)

        val (renamed, identity) = call("POST", "/api/v1/projects/shop/rename", mapOf("operationId" to "op1", "targetId" to "store"))
        assertEquals(200, renamed)
        assertEquals("store", identity!!["projectId"].asText())
        assertEquals("store", identity["diskId"].asText())
        assertEquals(mapOf("type" to "project_rename", "project_id" to "shop", "target_project_id" to "store"), sent.last())

        assertEquals(200, call("DELETE", "/api/v1/user/projects/store").first)
        assertEquals(mapOf("type" to "project_delete", "project_id" to "store"), sent.last())

        for ((error, status) in listOf("project_exists" to 409, "invalid_name" to 422)) {
            answer = { mapOf("ok" to false, "error" to error) }
            val (code, refused) = call("POST", "/api/v1/network/projects", mapOf("name" to "shop", "serverKeyId" to "u-local"))
            assertEquals(status, code)
            assertEquals(error, refused!!["error"].asText())
        }
        answer = { mapOf("ok" to false, "error" to "destination_exists") }
        assertEquals(409, call("POST", "/api/v1/projects/shop/rename", mapOf("targetId" to "store")).first)
        answer = { mapOf("ok" to false, "error" to "unknown_project") }
        assertEquals(404, call("DELETE", "/api/v1/user/projects/shop").first)
    }

    @Test
    fun `a folder project can be renamed and deleted, an add-on project cannot`() {
        answer = { mapOf("ok" to true, "project_roots" to listOf(mapOf("project_id" to "shop", "identity" to "folder"), mapOf("project_id" to "quests", "identity" to "addon"))) }
        val shop = call("GET", "/api/v1/user/projects/shop").second!!["capabilities"]
        assertEquals(true, shop["canRename"].asBoolean())
        assertEquals(true, shop["canDelete"].asBoolean())
        assertEquals(false, call("GET", "/api/v1/user/projects/quests").second!!["capabilities"]["canDelete"].asBoolean())
    }

    @Test
    fun `server config and live data`() {
        assertEquals("en", call("GET", "/api/v1/servers/u-local/server-config").second!!["config"]["language"].asText())
        assertEquals(422, call("PATCH", "/api/v1/servers/u-local/server-config", mapOf("changes" to emptyMap<String, Any>())).first)
        answer = { mapOf("ok" to false, "error" to "invalid_config", "message" to "language: unknown") }
        val (status, body) = call("PATCH", "/api/v1/servers/u-local/server-config", mapOf("changes" to mapOf("language" to "xx")))
        assertEquals(422, status)
        assertEquals("language: unknown", body!!["message"].asText())

        answer = { mapOf("ok" to false) }
        assertEquals(0, call("GET", "/api/v1/servers/u-local/players").second!!["players"].size())
        assertEquals(422, call("GET", "/api/v1/servers/u-local/head-texture?id=abc").first)
    }

    @Test
    fun `config screens read and write the project on disk`() {
        val path = "/api/v1/servers/u-local/config"
        answer = { mapOf("ok" to true, "files" to listOf(mapOf("path" to "warps/spawn.yml", "content" to "x: 1"))) }
        val (status, body) = call("POST", "$path/read", mapOf("project_id" to "warps", "table" to "warps"))
        assertEquals(200, status)
        assertEquals("warps/spawn.yml", body!!["files"][0]["path"].asText())
        assertEquals(mapOf("type" to "config_read", "project_id" to "warps", "table" to "warps"), sent.last())

        assertEquals(422, call("POST", "$path/write", mapOf("project_id" to "warps", "files" to emptyList<Any>())).first)
        answer = { mapOf("ok" to true) }
        val files = listOf(mapOf("path" to "warps/spawn.yml", "content" to "x: 2"))
        assertEquals(200, call("POST", "$path/write", mapOf("project_id" to "warps", "files" to files)).first)
        assertEquals("config_write", sent.last()["type"])

        answer = { mapOf("ok" to false, "error" to "unknown_project") }
        assertEquals(404, call("POST", "$path/read", mapOf("project_id" to "nope", "table" to "t")).first)
    }

    @Test
    fun `items and textures come from the server`() {
        val items = call("GET", "/api/v1/user/projects/shop/items").second!!
        assertEquals("1.21.4", items["version"].asText())
        assertEquals("stone", items["items"][0]["id"].asText())
        assertEquals("nexo:coin", call("GET", "/api/v1/user/projects/shop/custom-items").second!!["items"][0]["id"].asText())

        val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/textures/1.21.4/icons/stone")).header("Cookie", cookie).build()
        val png = client.send(request, HttpResponse.BodyHandlers.ofString())
        assertEquals(200, png.statusCode())
        assertEquals("icon", png.body())
        assertEquals(404, call("GET", "/api/v1/textures/1.21.4/item/missing").first)
    }

    @Test
    fun `nexo glyphs are read from the server`() {
        answer = { message ->
            when (message["glyph_id"]) {
                null -> mapOf("ok" to true, "glyphs" to listOf(mapOf("id" to "bg", "texture" to "gui/bg", "available" to true)))
                "bg" -> mapOf("ok" to true, "content_base64" to java.util.Base64.getEncoder().encodeToString("png".toByteArray()))
                else -> mapOf("ok" to false, "error" to "not_found")
            }
        }
        assertEquals("bg", call("GET", "/api/v1/user/projects/shop/nexo-glyphs").second!!["glyphs"][0]["id"].asText())
        val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/user/projects/shop/nexo-glyphs/bg")).header("Cookie", cookie).build()
        val png = client.send(request, HttpResponse.BodyHandlers.ofString())
        assertEquals("image/png", png.headers().firstValue("Content-Type").get())
        assertEquals("png", png.body())
        assertEquals(404, call("GET", "/api/v1/user/projects/shop/nexo-glyphs/nope").first)
    }

    @Test
    fun `a pack built by the editor is served and applied`() {
        val zip = "PK\u0003\u0004pack".toByteArray()
        val put = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/u-local/resource-pack"))
            .PUT(HttpRequest.BodyPublishers.ofByteArray(zip)).header("Cookie", cookie).build()
        val response = client.send(put, HttpResponse.BodyHandlers.ofString())
        assertEquals(200, response.statusCode())
        val hash = mapper.readTree(response.body())["hash"].asText()
        assertEquals(listOf(hash to "/resource-pack/$hash.zip"), applied.toList())

        val get = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/resource-pack/$hash.zip")).build()
        val served = client.send(get, HttpResponse.BodyHandlers.ofByteArray())
        assertEquals(200, served.statusCode())
        assertTrue(zip.contentEquals(served.body()))

        val bad = HttpRequest.newBuilder(URI("http://127.0.0.1:${hub.port}/api/v1/servers/u-local/resource-pack"))
            .PUT(HttpRequest.BodyPublishers.ofString("nope")).header("Cookie", cookie).build()
        assertEquals(422, client.send(bad, HttpResponse.BodyHandlers.ofString()).statusCode())
    }

    @Test
    fun `rights follow permissions`() {
        val token = (sessions.issueLink(UUID.randomUUID(), "Guest", setOf(EditorPermissions.VIEW)) as Sessions.LinkResult.Issued).token
        cookie = "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
        assertEquals(403, call("PUT", "/api/v1/projects/shop/files", mapOf("files" to emptyList<Any>())).first)
        assertEquals(403, call("PATCH", "/api/v1/servers/u-local/server-config", mapOf("changes" to mapOf("a" to 1))).first)
        val write = mapOf("project_id" to "warps", "files" to listOf(mapOf("path" to "a.yml", "content" to "")))
        assertEquals(403, call("POST", "/api/v1/servers/u-local/config/write", write).first)
        assertEquals(403, call("DELETE", "/api/v1/user/projects/shop").first)
        assertEquals(403, call("POST", "/api/v1/projects/shop/rename", mapOf("targetId" to "store")).first)
        assertEquals(403, call("POST", "/api/v1/network/projects", mapOf("name" to "shop", "serverKeyId" to "u-local")).first)
    }
}
