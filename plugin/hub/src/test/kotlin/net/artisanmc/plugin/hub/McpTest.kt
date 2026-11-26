package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Collections
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The MCP endpoint end to end (ADR `mcp-server`): OAuth, the tools, and deploying only when the player allowed it. */
class McpTest {
    private val mapper = ObjectMapper()
    private val sent: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())
    private val history = McpFixtures.History()
    private val modules = java.util.concurrent.ConcurrentHashMap<String, McpFixtures.Module>()
    private val config = java.util.concurrent.ConcurrentHashMap<String, Any?>()
    private var protocol = net.artisanmc.plugin.protocol.ProtocolVersion.CURRENT
    private val server = McpFixtures.server(sent, history, modules, config) { protocol }

    /** The image model generate_image calls: it records what it was asked and answers one picture, or fails. */
    private class ScriptedImages : ImageModel {
        val asked = java.util.concurrent.CopyOnWriteArrayList<ImageRequest>()
        @Volatile var failure: AiFailure? = null
        @Volatile override var transparency = false
        override val model = "scripted-image"

        /** A square of 8x8 art pixels, two reds in a chequer, drawn four times its size in the middle of a magenta ground. */
        val picture: ByteArray = net.artisanmc.plugin.pack.RgbaImage(64, 64).let { image ->
            for (y in 0 until 64) for (x in 0 until 64) {
                val inside = x in 16 until 48 && y in 16 until 48
                java.nio.ByteBuffer.wrap(image.data, (y * 64 + x) * 4, 4).putInt(if (!inside) 0xff00ffff.toInt() else if ((x / 4 + y / 4) % 2 == 0) 0xc03030ff.toInt() else 0x801818ff.toInt())
            }
            net.artisanmc.plugin.pack.Png.encode(image)
        }

        override fun generate(request: ImageRequest): GeneratedImage {
            asked += request
            failure?.let { throw it }
            return GeneratedImage(picture)
        }
    }

    private val imageModel = ScriptedImages()
    private val drafts = McpFixtures.Drafts()
    private val sessions = Sessions()
    private val grants = McpGrants()
    private val player = UUID.randomUUID()
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"),
        EditorApi.router(
            Servers(server), sessions, null, history = history, drafts = drafts, mcp = grants, version = "2.0.0",
            ai = AiConfig(image = AiImageConfig(provider = "openai", apiKey = "k", dailyLimit = 4)), aiImages = { imageModel },
        ),
        sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newHttpClient()
    private lateinit var cookie: String
    private val base get() = "http://127.0.0.1:${hub.port}"

    @BeforeTest
    fun start() {
        sessions.onPermissions(grants::permissionsChanged)
        hub.start()
        val token = (sessions.issueLink(player, "Iban", EditorPermissions.ALL.toSet(), origin = "u-local") as Sessions.LinkResult.Issued).token
        cookie = "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
    }

    @AfterTest
    fun stop() = hub.stop()

    private class Answer(val status: Int, val body: JsonNode?, val headers: java.net.http.HttpHeaders)

    private fun http(method: String, path: String, body: String? = null, headers: Map<String, String> = emptyMap()): Answer {
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(URI("$base$path")).method(method, publisher).apply { headers.forEach(::header) }.build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        return Answer(response.statusCode(), runCatching { mapper.readTree(response.body()) }.getOrNull(), response.headers())
    }

    private fun editor(method: String, path: String, body: Any? = null) =
        http(method, path, body?.let(mapper::writeValueAsString), mapOf("Cookie" to cookie, "Content-Type" to "application/json"))

    private fun form(path: String, vararg fields: Pair<String, String>) = http(
        "POST", path, fields.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, Charsets.UTF_8)}" },
        mapOf("Content-Type" to "application/x-www-form-urlencoded"),
    )

    private var nextId = 1

    private fun rpc(token: String?, method: String, params: Any? = null, headers: Map<String, String> = emptyMap()): Answer {
        val message = mutableMapOf<String, Any?>("jsonrpc" to "2.0", "id" to nextId++, "method" to method)
        if (params != null) message["params"] = params
        val auth = token?.let { mapOf("Authorization" to "Bearer $it") }.orEmpty()
        return http("POST", McpRoutes.PATH, mapper.writeValueAsString(message), mapOf("Content-Type" to "application/json") + auth + headers)
    }

    private fun tool(token: String, name: String, vararg args: Pair<String, Any?>): JsonNode {
        val answer = rpc(token, "tools/call", mapOf("name" to name, "arguments" to args.toMap()))
        assertEquals(200, answer.status, answer.body.toString())
        return answer.body!!["result"]
    }

    private val verifier = "v".repeat(20) + UUID.randomUUID().toString().replace("-", "")
    private val redirect = "https://claude.ai/api/mcp/auth_callback"

    private fun registerClient(): String {
        val answer = http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("client_name" to "Claude", "redirect_uris" to listOf(redirect))))
        assertEquals(201, answer.status)
        return answer.body!!["client_id"].asText()
    }

    /** Register, authorize, consent, code: what a client and the player do, in that order. */
    private fun code(clientId: String = registerClient(), challenge: String = McpGrants.challenge(verifier), publish: Boolean = false, images: Boolean = false): String {
        val authorize = http("GET", "${OAuthRoutes.AUTHORIZE}?response_type=code&client_id=$clientId&redirect_uri=${URLEncoder.encode(redirect, Charsets.UTF_8)}&state=xyz&code_challenge=$challenge&code_challenge_method=S256")
        assertEquals(302, authorize.status)
        val consent = authorize.headers.firstValue("Location").get()
        assertTrue(consent.startsWith(OAuthRoutes.CONSENT_PAGE + "?"), consent)
        val query = consent.substringAfter('?').split('&').associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), Charsets.UTF_8) }
        assertEquals("Claude", editor("GET", "${OAuthRoutes.CONSENT}?client_id=$clientId&redirect_uri=${URLEncoder.encode(redirect, Charsets.UTF_8)}").body!!["client"]["name"].asText())
        val approved = editor("POST", OAuthRoutes.CONSENT, query + ("approve" to true) + ("publish" to publish) + ("images" to images))
        assertEquals(200, approved.status)
        val back = approved.body!!["redirect"].asText()
        assertTrue(back.startsWith("$redirect?code="), back)
        assertTrue("state=xyz" in back)
        return back.substringAfter("code=").substringBefore('&')
    }

    private fun tokens(clientId: String = registerClient(), publish: Boolean = false, images: Boolean = false): Pair<String, String> {
        val code = code(clientId, publish = publish, images = images)
        val answer = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to verifier)
        assertEquals(200, answer.status, answer.body.toString())
        assertEquals("Bearer", answer.body!!["token_type"].asText())
        return answer.body["access_token"].asText() to answer.body["refresh_token"].asText()
    }

    @Test
    fun `without a token, a client is told where to sign in`() {
        val answer = rpc(null, "initialize")
        assertEquals(401, answer.status)
        assertTrue(answer.headers.firstValue("WWW-Authenticate").get().contains("resource_metadata=\"$base${OAuthRoutes.RESOURCE_METADATA}\""))
        val resource = http("GET", OAuthRoutes.RESOURCE_METADATA).body!!
        assertEquals("$base/mcp", resource["resource"].asText())
        val metadata = http("GET", OAuthRoutes.SERVER_METADATA).body!!
        assertEquals(base, metadata["issuer"].asText())
        assertEquals(listOf("S256"), metadata["code_challenge_methods_supported"].map { it.asText() })
        assertEquals("$base${OAuthRoutes.REGISTER}", metadata["registration_endpoint"].asText())
        assertEquals(401, rpc("amcp_forged", "ping").status)
    }

    @Test
    fun `a client the player approved lists the draft tools, none of which deploys`() {
        val (access, _) = tokens()
        val init = rpc(access, "initialize", mapOf("protocolVersion" to "2025-06-18", "capabilities" to emptyMap<String, Any>(), "clientInfo" to mapOf("name" to "t", "version" to "1")))
        assertEquals("2025-06-18", init.body!!["result"]["protocolVersion"].asText())
        val notification = http("POST", McpRoutes.PATH, """{"jsonrpc":"2.0","method":"notifications/initialized"}""", mapOf("Authorization" to "Bearer $access"))
        assertEquals(202, notification.status)
        val names = rpc(access, "tools/list").body!!["result"]["tools"].map { it["name"].asText() }
        assertEquals(listOf("artisan_overview", "list_documents", "read_document", "get_kind_guide", "read_docs", "start_draft", "write_document", "read_image", "write_image", "measure_image", "render_menu", "survey_ui", "theme_colours", "list_versions"), names)
        assertTrue(names.none { "publish" in it || "deploy" in it || "rollback" in it })
        // The kind guide is prose for the model to read, the schema outlined rather than dumped.
        val guide = tool(access, "get_kind_guide", "kind" to "menu", "project" to "u-local.shop")
        val text = guide["content"][0]["text"].asText()
        assertFalse(guide.has("structuredContent"))
        assertTrue(text.startsWith("# menu Documents\n") && "\n## Fields\n" in text && "## Example: menus/shop.yml" in text, text)
        assertTrue(text.length < 25_000, "${text.length} characters")
        // The schema knows the core's actions; the server adds its modules', each once.
        assertTrue("- guilds:rank_delete (module guilds): {rank: string}; primary: rank\n  - rank: The rank to delete." in text, text)
        assertFalse("- open_menu (module" in text || "\n- open_menu: no arguments" in text)
        assertTrue("## Texts and languages\n" in text && "title: { fr: Boutique, en: Shop }" in text)
        val full = tool(access, "get_kind_guide", "kind" to "menu", "detail" to "schema")["content"][0]["text"].asText()
        assertTrue("```json\n{\"\$schema\"" in full)
        // The docs of this release, shipped in the jar: a list, then a page without its front matter.
        val docs = tool(access, "read_docs")["content"][0]["text"].asText()
        assertTrue("- editor/expressions: Expressions — " in docs, docs)
        val page = tool(access, "read_docs", "page" to "editor/expressions")["content"][0]["text"].asText()
        assertTrue(page.startsWith("# Expressions\n\n") && "description:" !in page.substringBefore("\n## "), page.take(300))
        assertTrue(tool(access, "read_docs", "page" to "nope")["isError"].asBoolean())
        assertEquals(-32601, rpc(access, "resources/list").body!!["error"]["code"].asInt())
        assertEquals(405, http("GET", McpRoutes.PATH, headers = mapOf("Authorization" to "Bearer $access")).status)
    }

    @Test
    fun `a draft written through the MCP endpoint is checked, kept as the player's, and never published`() {
        val (access, _) = tokens()
        val overview = tool(access, "artisan_overview")["structuredContent"]
        assertEquals("u-local.shop", overview["servers"][0]["projects"][0].asText())
        val docs = tool(access, "list_documents", "project" to "u-local.shop")["structuredContent"]
        assertEquals("menus/shop.yml", docs["documents"][0]["path"].asText())
        assertEquals("menu", docs["documents"][0]["kind"].asText())
        assertTrue(docs["variants"].isNull, docs.toString())
        assertTrue("variants.yml" in overview["workflow"].toString())

        val started = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: boutique")["structuredContent"]
        val draftId = started["draft_id"].asText()
        val stored = mapper.readTree(drafts.rows.getValue(draftId))
        assertEquals("ai", stored["source"].asText())
        assertEquals(player.toString(), stored["ownerId"].asText())

        val refused = tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to "schema: menu/v1\nbad: 1\n")
        assertTrue(refused["isError"].asBoolean())
        assertEquals("schema", refused["structuredContent"]["problems"][0]["stage"].asText())
        assertNull(mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]["menus/vip.yml"])

        val written = tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to "schema: menu/v1\n")
        assertFalse(written.has("isError"), written.toString())
        assertEquals(2, written["structuredContent"]["revision"].asInt())
        val mine = tool(access, "list_documents", "project" to "u-local.shop")["structuredContent"]["your_drafts"]
        assertEquals(listOf(draftId to "AI: boutique"), mine.map { it["draft_id"].asText() to it["name"].asText() })
        val tree = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]
        assertEquals("schema: menu/v1\n", tree["menus/vip.yml"].asText())
        assertEquals("a: b\n", tree["lang/en.yml"].asText())
        val read = tool(access, "read_document", "project" to "u-local.shop", "path" to "menus/vip.yml", "draft_id" to draftId)
        assertEquals("schema: menu/v1\n", read["structuredContent"]["content"].asText())

        // The check sees the draft's changes against what the server runs, not the file alone.
        val check = sent.last { it["type"] == "documents_check" }
        assertEquals("shop", check["project_id"])
        assertEquals("active", mapper.readTree(drafts.rows.getValue(draftId))["status"].asText())
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" })
    }

    @Test
    fun `a menu is rendered as a picture, from a draft with the images it holds or as deployed`() {
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: render")["structuredContent"]["draft_id"].asText()
        val green = mapOf("palette" to mapOf("g" to "#20c040"), "rows" to List(18) { "g".repeat(54) })
        assertFalse(tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "buy_button", "pixels" to green).has("isError"))
        val menu = "schema: menu/v1\nsize: 27\ntitle: Shop\nelements:\n  - id: buy\n    positions: \"12-14\"\n    image: { asset: buy_button }\n  - id: gem\n    positions: \"0\"\n    material: DIAMOND\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to menu).has("isError"))

        val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/vip.yml", "draft_id" to draftId)
        assertFalse(rendered.has("isError"), rendered.toString())
        val facts = rendered["structuredContent"]
        assertEquals("x3", facts["shown_at"].asText())
        val window = facts["window"]
        assertEquals(listOf(176, 113 + 3 * 18), listOf(window["width"].asInt(), window["height"].asInt()))
        assertTrue(facts["notes"].any { "every item shows" in it.asText() }, "no item pictures in this hub: said, not hidden")
        val picture = rendered["content"][1]
        assertEquals("image" to "image/png", picture["type"].asText() to picture["mimeType"].asText())
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(picture["data"].asText()))
        // The button over slots 12 to 14 (second row, columns 3 to 5), three picture pixels a game pixel.
        val at = ((window["y"].asInt() + 17 + 18 + 9) * 3 * shown.width + (window["x"].asInt() + 7 + 4 * 18) * 3) * 4
        assertEquals(listOf(0x20, 0xc0, 0x40), shown.data.slice(at until at + 3).map { it.toInt() and 0xff })

        // As deployed, without the draft: the menu the server has. Another file is not a menu.
        val deployed = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/shop.yml", "scale" to 1)
        assertEquals("x1", deployed["structuredContent"]["shown_at"].asText())
        assertTrue(tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/vip.yml")["isError"].asBoolean(), "not deployed yet")
        assertTrue(tool(access, "render_menu", "project" to "u-local.shop", "path" to "lang/en.yml")["isError"].asBoolean())
    }

    @Test
    fun `a server's images are surveyed module by module, with its kit, and a menu draws the kit's image`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/shop_icon.png" to solid(16, 16, 0x3366cc)))
        modules["artisan"] = McpFixtures.Module(
            files = mapOf("data/ui-kit.yml" to "notes: Vanilla bevel, no black outline.\n", "menus/demo.yml" to "schema: menu/v1\nsize: 9\nelements:\n  - positions: \"0\"\n    image: { asset: kit_button }\n"),
            images = mapOf(
                "assets/textures/kit_button.png" to solid(54, 18, 0x20c040), "originals/assets/textures/kit_button.png" to solid(54, 18, 0x000000),
                "assets/glyphs/kit_window.png" to solid(176, 166, 0xc6c6c6),
            ),
        )
        val (access, _) = tokens()

        val survey = tool(access, "survey_ui", "server" to "u-local")
        assertFalse(survey.has("isError"), survey.toString())
        val facts = survey["structuredContent"]
        assertEquals(listOf("u-local.shop", "u-local.artisan"), facts["modules"].map { it["project"].asText() })
        // The kit's own button, not the one it shipped with; numbered across the modules.
        val kitImages = facts["modules"][1]["images"]
        assertEquals(listOf("kit_window" to "background", "kit_button" to "button"), kitImages.map { it["name"].asText() to it["use"].asText() })
        assertEquals(listOf(2, 3), kitImages.map { it["n"].asInt() })
        assertEquals(listOf("menus/demo.yml"), facts["modules"][1]["menus_with_images"].map { it.asText() })
        assertEquals("#c6c6c6", facts["colours"][0]["colour"].asText(), "the colour most pixels have")
        assertTrue("Vanilla bevel" in facts["common"]["content"].asText())
        assertEquals("u-local.artisan", facts["common"]["project"].asText())
        assertEquals(listOf("text", "image", "image", "image"), survey["content"].map { it["type"].asText() }, "one sheet per module, one for the base")

        // A menu of the shop that names the kit's button draws it: an image is found on the whole server.
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: kit")["structuredContent"]["draft_id"].asText()
        val menu = "schema: menu/v1\nsize: 9\nvanilla_texture: false\nelements:\n  - positions: \"0-2\"\n    image: { asset: kit_button }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/kit.yml", "content" to menu).has("isError"))
        val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/kit.yml", "draft_id" to draftId, "scale" to 1)
        assertTrue(rendered["structuredContent"]["notes"].none { "kit_button" in it.asText() }, rendered["structuredContent"].toString())
        val window = rendered["structuredContent"]["window"]
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
        val at = ((window["y"].asInt() + 17 + 9) * shown.width + window["x"].asInt() + 7 + 27) * 4
        assertEquals(listOf(0x20, 0xc0, 0x40), shown.data.slice(at until at + 3).map { it.toInt() and 0xff })

        // A server whose Artisan is older than the theme `artisan` has no common images of its own.
        modules.remove("artisan")
        assertTrue("older" in tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["common"]["how"].asText())
        assertTrue(tool(access, "survey_ui", "server" to "nowhere")["isError"].asBoolean())
    }

    @Test
    fun `the base is the one the theme artisan holds, and a menu reaches a common image by its name alone`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/panel.3x1.png" to solid(54, 18, 0x3366cc)))
        // Another module's image under a common image's name: its own menus' only.
        modules["guilds"] = McpFixtures.Module(images = mapOf("assets/textures/ribbon.png" to solid(54, 18, 0x101010)))
        modules["artisan"] = McpFixtures.Module(
            images = mapOf(
                // The base as this server holds it, and an image the server added.
                "originals/assets/textures/button.3x1.png" to solid(54, 18, 0x20c040),
                "originals/assets/textures/panel.3x1.png" to solid(54, 18, 0x804020),
                "assets/textures/ribbon.png" to solid(54, 18, 0xc020a0),
            ),
        )
        val (access, _) = tokens()

        // The base is no image of the theme's own: it is listed once, as Artisan's.
        val facts = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]
        val common = facts["modules"].first { it["project"].asText() == "u-local.artisan" }
        assertEquals(listOf("ribbon"), common["images"].map { it["name"].asText() })
        val button = facts["base"]["images"].first { it["image"].asText() == "button.3x1" }
        assertEquals("artisan", button["drawn_by"].asText())
        // What a menu writes: the name alone, `artisan:<name>` where the name alone is the module's own.
        assertTrue("artisan:<name>" in facts["base"]["how"].asText())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: common")["structuredContent"]["draft_id"].asText()
        val menu = "schema: menu/v1\nsize: 18\nvanilla_texture: false\nelements:\n" +
            "  - positions: \"0-2\"\n    image: { asset: button.3x1 }\n" +
            "  - positions: \"3-5\"\n    image: { asset: ribbon }\n" +
            "  - positions: \"6-8\"\n    image: { asset: panel.3x1 }\n" +
            "  - positions: \"9-11\"\n    image: { asset: 'artisan:panel.3x1' }\n" +
            "  - positions: \"12-14\"\n    image: { asset: 'kit:ribbon' }\n" +
            "  - positions: \"15-17\"\n    image: { asset: 'guilds:ribbon' }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/common.yml", "content" to menu).has("isError"))
        val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/common.yml", "draft_id" to draftId, "scale" to 1)
        val window = rendered["structuredContent"]["window"]
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
        fun colour(column: Int, row: Int): Int {
            val at = ((window["y"].asInt() + 17 + 9 + row * 18) * shown.width + window["x"].asInt() + 7 + 27 + column * 18) * 4
            return shown.data.slice(at until at + 3).fold(0) { rgb, byte -> (rgb shl 8) or (byte.toInt() and 0xff) }
        }
        assertEquals(0x20c040, colour(0, 0), "a base image by its name, as the server holds it")
        assertEquals(0xc020a0, colour(3, 0), "an image the server added, by its name, before another module's")
        assertEquals(0x101010, colour(6, 1), "another module's image by module and name")
        assertEquals(0x3366cc, colour(6, 0), "the module's own image first")
        assertEquals(0x804020, colour(0, 1), "artisan:<name> is the common one though the module holds one")
        assertEquals(0xc020a0, colour(3, 1), "kit:<name> is still read")
    }

    @Test
    fun `the kit's base is on every server under kit names, and the kit module's image of the same size replaces one`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/shop_icon.png" to solid(16, 16, 0x3366cc)))
        val (access, _) = tokens()

        // A server without a kit module has the base as Artisan ships it, numbered after its own images.
        val base = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["base"]
        assertEquals(net.artisanmc.plugin.pack.Kit.slots.map { "kit:${it.id}" }, base["images"].map { it["image"].asText() })
        assertEquals((2..20).toList(), base["images"].map { it["n"].asInt() })
        assertEquals(setOf("artisan"), base["images"].map { it["drawn_by"].asText() }.toSet())
        assertEquals(54 to 18, base["images"][3].let { it["width"].asInt() to it["height"].asInt() })

        // A menu draws a base image as an element's and as its window.
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: base")["structuredContent"]["draft_id"].asText()
        val menu = "schema: menu/v1\nsize: 27\nvanilla_texture: false\ntitle:\n  - { kind: background, asset: \"kit:window.3\" }\n" +
            "elements:\n  - positions: \"0-2\"\n    image: { asset: \"kit:button.3x1\", fit: native }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/base.yml", "content" to menu).has("isError"))
        fun pixels(): Pair<List<Int>, List<Int>> {
            val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/base.yml", "draft_id" to draftId, "scale" to 1)
            assertTrue(rendered["structuredContent"]["notes"].none { "kit:" in it.asText() }, rendered["structuredContent"].toString())
            val window = rendered["structuredContent"]["window"]
            val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            fun at(x: Int, y: Int) = ((window["y"].asInt() + y) * shown.width + window["x"].asInt() + x) * 4
            fun rgb(at: Int) = shown.data.slice(at until at + 3).map { it.toInt() and 0xff }
            // The middle of the button over the first three slots; the window's corner pixel that is not empty.
            return rgb(at(7 + 27, 17 + 9)) to rgb(at(3, 3))
        }
        fun shipped(id: String, x: Int, y: Int): List<Int> {
            val image = net.artisanmc.plugin.pack.Png.decode(net.artisanmc.plugin.pack.Kit.shipped(net.artisanmc.plugin.pack.Kit.slot(id)!!))
            return image.data.slice((y * image.width + x) * 4 until (y * image.width + x) * 4 + 3).map { it.toInt() and 0xff }
        }
        assertEquals(shipped("button.3x1", 27, 9) to shipped("window.3", 3, 3), pixels())

        // The kit module restyles a slot with an image of its name and size; another size or another module is refused.
        modules["artisan"] = McpFixtures.Module()
        val kitDraft = tool(access, "start_draft", "project" to "u-local.artisan", "name" to "AI: kit")["structuredContent"]["draft_id"].asText()
        fun png(width: Int, height: Int) = java.util.Base64.getEncoder().encodeToString(solid(width, height, 0xcc2020))
        val small = tool(access, "write_image", "project" to "u-local.artisan", "draft_id" to kitDraft, "name" to "button.3x1", "png_base64" to png(20, 10))
        assertTrue(small["isError"].asBoolean() && "54x18" in small["structuredContent"]["message"].asText(), small.toString())
        val written = tool(access, "write_image", "project" to "u-local.artisan", "draft_id" to kitDraft, "name" to "button.3x1", "use" to "background", "png_base64" to png(54, 18))
        assertFalse(written.has("isError"), written.toString())
        assertEquals("assets/textures/button.3x1.png", written["structuredContent"]["path"].asText())
        assertTrue("names `button.3x1`" in written["structuredContent"]["use_it"].asText())
        assertTrue(tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "button.3x1", "png_base64" to png(54, 18))["isError"].asBoolean())
        val other = tool(access, "write_image", "project" to "u-local.artisan", "draft_id" to kitDraft, "name" to "banner", "png_base64" to png(20, 10))
        assertTrue("{asset: banner, fit: native}" in other["structuredContent"]["use_it"].asText(), other.toString())

        // Deployed, the server's image is what every menu naming the slot shows; one of another size is left out.
        modules["artisan"] = McpFixtures.Module(
            images = mapOf("assets/textures/button.3x1.png" to solid(54, 18, 0xcc2020), "assets/textures/window.3.png" to solid(20, 20, 0x00ff00)),
        )
        assertEquals(listOf(0xcc, 0x20, 0x20) to shipped("window.3", 3, 3), pixels())
        val restyled = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["base"]["images"].associateBy { it["image"].asText() }
        assertEquals("this server", restyled.getValue("button.3x1")["drawn_by"].asText())
        assertEquals("artisan", restyled.getValue("window.3")["drawn_by"].asText())
        assertTrue(restyled.getValue("window.3").has("ignored"))
        assertFalse(restyled.getValue("cell").has("ignored"))
    }

    @Test
    fun `a theme of the kit recolours what kit names show, redraws an image at its size, and a menu is rendered in it`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        fun png(width: Int, height: Int, rgb: Int) = java.util.Base64.getEncoder().encodeToString(solid(width, height, rgb))
        fun shipped(id: String, x: Int, y: Int): List<Int> {
            val image = net.artisanmc.plugin.pack.Png.decode(net.artisanmc.plugin.pack.Kit.shipped(net.artisanmc.plugin.pack.Kit.slot(id)!!))
            return image.data.slice((y * image.width + x) * 4 until (y * image.width + x) * 4 + 3).map { it.toInt() and 0xff }
        }
        val button = shipped("button.3x1", 27, 9)
        val red = listOf(0xb3, 0x26, 0x1e)
        val navy = listOf(0x11, 0x22, 0x33)
        val table = "colors:\n  \"#%02x%02x%02x\": \"#b3261e\"\n".format(button[0], button[1], button[2])
        modules["artisan"] = McpFixtures.Module()
        // A server older than themes of their own folder: its themes are written in its common images.
        protocol = "1.10"
        val (access, _) = tokens()
        val kitDraft = tool(access, "start_draft", "project" to "u-local.artisan", "name" to "AI: noel")["structuredContent"]["draft_id"].asText()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: themed")["structuredContent"]["draft_id"].asText()
        fun kit(tool: String, vararg args: Pair<String, Any?>) = tool(access, tool, "project" to "u-local.artisan", "draft_id" to kitDraft, *args)

        // The theme's table: colours quoted, or the write is refused with the reason (unquoted, `#` starts a comment).
        val unquoted = kit("write_document", "path" to "themes/noel/theme.yml", "content" to "colors:\n  #3c8527: #b3261e\n")
        assertFalse(unquoted["structuredContent"]["written"].asBoolean(), unquoted.toString())
        assertTrue("Quote" in unquoted["structuredContent"]["problems"][0]["message"].asText())
        val wrong = kit("write_document", "path" to "themes/noel/theme.yml", "content" to "colors:\n  \"#3c8527\": \"red\"\n")
        assertTrue("'red'" in wrong["structuredContent"]["problems"][0]["message"].asText(), wrong.toString())
        assertTrue(kit("write_document", "path" to "themes/noel/theme.yml", "content" to table)["structuredContent"]["written"].asBoolean())

        // The theme's own drawing of a kit image: of its size, in the kit module, of an image the kit has.
        val small = kit("write_image", "name" to "cell", "theme" to "noel", "png_base64" to png(10, 10, 0x112233))
        assertTrue(small["isError"].asBoolean() && "18x18" in small["structuredContent"]["message"].asText(), small.toString())
        assertTrue("No common image" in kit("write_image", "name" to "nothing", "theme" to "noel", "png_base64" to png(18, 18, 0x112233))["structuredContent"]["message"].asText())
        val elsewhere = tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "cell", "theme" to "noel", "png_base64" to png(18, 18, 0x112233))
        assertTrue(elsewhere["isError"].asBoolean() && "common images" in elsewhere["structuredContent"]["message"].asText(), elsewhere.toString())
        val drawn = kit("write_image", "name" to "cell", "theme" to "noel", "png_base64" to png(18, 18, 0x112233))
        assertFalse(drawn.has("isError"), drawn.toString())
        assertEquals("themes/noel/assets/textures/cell.png", drawn["structuredContent"]["path"].asText())
        val snapshot = mapper.readTree(drafts.rows.getValue(kitDraft))["snapshot"]
        assertEquals(listOf("themes/noel/assets/textures/cell.png"), snapshot["binaryTree"].fieldNames().asSequence().toList())
        assertEquals(listOf("themes/noel/theme.yml"), snapshot["tree"].fieldNames().asSequence().filter { it.startsWith("themes/") }.toList())

        // A menu of another module, with a button and a slot's frame of the kit.
        val menu = "schema: menu/v1\nsize: 27\nelements:\n  - positions: \"0-2\"\n    image: { asset: \"kit:button.3x1\", fit: native }\n" +
            "  - positions: \"4\"\n    image: { asset: \"kit:cell\", fit: native }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/themed.yml", "content" to menu).has("isError"))
        fun render(vararg args: Pair<String, Any?>) = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/themed.yml", "draft_id" to draftId, "scale" to 1, *args)
        // The middle of the button over the first three slots, and of the frame over the fifth; the theme it was drawn in.
        fun shown(rendered: JsonNode): Triple<List<Int>, List<Int>, String?> {
            assertFalse(rendered.has("isError"), rendered.toString())
            val window = rendered["structuredContent"]["window"]
            val picture = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            fun rgb(x: Int, y: Int) = ((window["y"].asInt() + y) * picture.width + window["x"].asInt() + x).let { picture.data.slice(it * 4 until it * 4 + 3).map { b -> b.toInt() and 0xff } }
            return Triple(rgb(7 + 27, 17 + 9), rgb(7 + 4 * 18 + 9, 17 + 9), rendered["structuredContent"]["themes"]?.joinToString(",") { it.asText() })
        }
        val plain = Triple(button, shipped("cell", 9, 9), null)
        assertEquals(plain, shown(render()))
        // Not deployed: the theme is in the kit's draft only, which render_menu reads when given.
        val absent = render("theme" to "noel")
        assertTrue(absent["isError"].asBoolean() && "No theme 'noel'" in absent["structuredContent"]["message"].asText(), absent.toString())
        assertEquals(Triple(red, navy, "noel"), shown(render("theme" to "noel", "common_draft_id" to kitDraft)))
        assertEquals(plain, shown(render("common_draft_id" to kitDraft)))
        // The parameter's former name is still read.
        assertEquals(Triple(red, navy, "noel"), shown(render("theme" to "noel", "kit_draft_id" to kitDraft)))

        // Deployed, and picked as the server's theme: every view of the kit is in it, unless asked without.
        modules["artisan"] = McpFixtures.Module(
            files = mapOf("themes/noel/theme.yml" to table),
            images = mapOf("themes/noel/assets/textures/cell.png" to solid(18, 18, 0x112233), "themes/noel/assets/textures/window.3.png" to solid(20, 20, 0x00ff00)),
        )
        assertEquals(plain, shown(render()))
        config["resource-pack.theme"] = "noel"
        assertEquals(Triple(red, navy, "noel"), shown(render()))
        assertEquals(plain, shown(render("theme" to "none")))
        val survey = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]
        assertEquals(listOf("noel"), survey["common"]["in_place"].map { it.asText() })
        assertEquals(1, survey["common"]["themes"].size())
        assertEquals(1, survey["common"]["themes"][0]["colors"].asInt())
        assertEquals(listOf("cell", "window.3"), survey["common"]["themes"][0]["redraws"].map { it.asText() })
        assertEquals(listOf("noel"), survey["base"]["themes"].map { it.asText() })
        assertTrue("theme.yml" in survey["themes_format"].asText())
        // The colours a table replaces are the kit's own, whatever the theme in place.
        assertTrue("#%02x%02x%02x".format(button[0], button[1], button[2]) in survey["common_colours"].map { it.asText() }, survey["common_colours"].toString())
        assertFalse("#b3261e" in survey["common_colours"].map { it.asText() })
        // No image of the theme folders is one of the kit module's own.
        assertTrue(survey["modules"].none { it["project"].asText() == "u-local.artisan" }, survey["modules"].toString())

        // Several in place, the lowest first: `nuit` above repaints what `noel` shows (the red of
        // its table), not the frame `noel` redraws in navy; under `noel`, it finds no red yet.
        // One the kit does not hold is left out, as in the pack.
        modules["artisan"] = McpFixtures.Module(
            files = mapOf("themes/noel/theme.yml" to table, "themes/nuit/theme.yml" to "colors:\n  \"#b3261e\": \"#010203\"\n"),
            images = mapOf("themes/noel/assets/textures/cell.png" to solid(18, 18, 0x112233), "themes/noel/assets/textures/window.3.png" to solid(20, 20, 0x00ff00)),
        )
        config["resource-pack.themes"] = listOf("noel", "gone", "nuit")
        assertEquals(Triple(listOf(1, 2, 3), navy, "noel,nuit"), shown(render()))
        config["resource-pack.themes"] = listOf("nuit", "noel")
        assertEquals(Triple(red, navy, "nuit,noel"), shown(render()))
        assertEquals(listOf("nuit", "noel"), tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["common"]["in_place"].map { it.asText() })
        // Asked for one theme: that one alone, whatever is in place.
        assertEquals(Triple(red, navy, "noel"), shown(render("theme" to "noel")))
        config.remove("resource-pack.themes")

        // A theme of its own folder is the Project of its name (`overrides/colors.yml`, `overrides/artisan/<image>.png`):
        // it wins over the folder of that name the common images keep, and a module of a theme's name is no theme.
        modules["noel"] = McpFixtures.Module(
            files = mapOf("overrides/colors.yml" to "colors:\n  \"#%02x%02x%02x\": \"#445566\"\n".format(button[0], button[1], button[2])),
            images = mapOf("overrides/artisan/cell.png" to solid(18, 18, 0x778899), "assets/textures/cell.png" to solid(18, 18, 0x00ff00)),
            role = "theme",
        )
        modules["nuit"] = McpFixtures.Module(files = mapOf("overrides/colors.yml" to "colors:\n  \"#445566\": \"#040506\"\n"))
        config["resource-pack.themes"] = listOf("noel", "nuit")
        // `nuit` is a module here, and the common images still keep a theme of that name: that one is read (it finds no red).
        assertEquals(Triple(listOf(0x44, 0x55, 0x66), listOf(0x77, 0x88, 0x99), "noel,nuit"), shown(render()))
        assertEquals(Triple(listOf(0x44, 0x55, 0x66), listOf(0x77, 0x88, 0x99), "noel"), shown(render("theme" to "noel")))
        val own = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]
        assertEquals(listOf("noel", "nuit"), own["common"]["themes"].map { it["name"].asText() })
        assertEquals("u-local.noel", own["common"]["themes"][0]["project"].asText())
        assertEquals(listOf("cell"), own["common"]["themes"][0]["redraws"].map { it.asText() })
        assertFalse(own["common"]["themes"][1].has("project"))
        // The theme's folder is no module with images to list.
        assertTrue(own["modules"].none { it["project"].asText() == "u-local.noel" }, own["modules"].toString())
        modules.remove("noel")
        modules.remove("nuit")
        config.remove("resource-pack.themes")

        // A theme the kit does not hold is no theme, as in the pack.
        config["resource-pack.theme"] = "gone"
        assertEquals(plain, shown(render()))
        assertFalse(tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["common"].has("in_place"))
    }

    @Test
    fun `a theme is created as a Project of its own, written in its draft, and a menu is rendered in that draft`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        fun png(width: Int, height: Int, rgb: Int) = java.util.Base64.getEncoder().encodeToString(solid(width, height, rgb))
        fun shipped(id: String, x: Int, y: Int): List<Int> {
            val image = net.artisanmc.plugin.pack.Png.decode(net.artisanmc.plugin.pack.Kit.shipped(net.artisanmc.plugin.pack.Kit.slot(id)!!))
            return image.data.slice((y * image.width + x) * 4 until (y * image.width + x) * 4 + 3).map { it.toInt() and 0xff }
        }
        val button = shipped("button.3x1", 27, 9)
        val table = "colors:\n  \"#%02x%02x%02x\": \"#b3261e\"\n".format(button[0], button[1], button[2])
        modules["artisan"] = McpFixtures.Module(role = "theme")
        val (draftOnly, _) = tokens()
        assertFalse(rpc(draftOnly, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "create_theme" })
        val (access, _) = tokens(publish = true)

        // Created on the server, with the role that makes it a theme's folder; a server older than them cannot.
        protocol = "1.10"
        assertEquals("plugin_update_required", tool(access, "create_theme", "server" to "u-local", "name" to "noel")["structuredContent"]["error"].asText())
        protocol = net.artisanmc.plugin.protocol.ProtocolVersion.CURRENT
        assertEquals("invalid_name", tool(access, "create_theme", "server" to "u-local", "name" to "Noel")["structuredContent"]["error"].asText())
        assertEquals("invalid_name", tool(access, "create_theme", "server" to "u-local", "name" to "artisan")["structuredContent"]["error"].asText())
        assertEquals("project_exists", tool(access, "create_theme", "server" to "u-local", "name" to "shop")["structuredContent"]["error"].asText())
        assertEquals(0, sent.count { it["type"] == "project_create" && it["project_id"] != "shop" })
        val created = tool(access, "create_theme", "server" to "u-local", "name" to "noel")["structuredContent"]
        assertEquals("u-local.noel", created["project"].asText())
        assertEquals(mapOf("type" to "project_create", "project_id" to "noel", "role" to "theme"), sent.last { it["type"] == "project_create" })
        modules["noel"] = McpFixtures.Module(role = "theme")
        assertTrue("create_theme" in tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["themes_format"].asText())

        val themeDraft = tool(access, "start_draft", "project" to "u-local.noel", "name" to "AI: noel")["structuredContent"]["draft_id"].asText()
        val kitDraft = tool(access, "start_draft", "project" to "u-local.artisan", "name" to "AI: kit")["structuredContent"]["draft_id"].asText()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: themed")["structuredContent"]["draft_id"].asText()
        fun theme(tool: String, vararg args: Pair<String, Any?>) = tool(access, tool, "project" to "u-local.noel", "draft_id" to themeDraft, *args)
        fun kit(tool: String, vararg args: Pair<String, Any?>) = tool(access, tool, "project" to "u-local.artisan", "draft_id" to kitDraft, *args)

        // Its table of colours is the one file it holds, checked here: the server reads no Document from a theme.
        val unquoted = theme("write_document", "path" to "overrides/colors.yml", "content" to "colors:\n  #3c8527: #b3261e\n")
        assertFalse(unquoted["structuredContent"]["written"].asBoolean(), unquoted.toString())
        assertTrue("Quote" in unquoted["structuredContent"]["problems"][0]["message"].asText())
        val menuInTheme = theme("write_document", "path" to "menus/x.yml", "content" to "schema: menu/v1\n")
        assertTrue(menuInTheme["isError"].asBoolean() && "overrides/colors.yml" in menuInTheme["structuredContent"]["message"].asText(), menuInTheme.toString())
        val checks = sent.count { it["type"] == "documents_check" }
        assertTrue(theme("write_document", "path" to "overrides/colors.yml", "content" to table)["structuredContent"]["written"].asBoolean())
        assertEquals(checks, sent.count { it["type"] == "documents_check" })
        // The former place, in the common images, is no longer written.
        val former = kit("write_document", "path" to "themes/noel/theme.yml", "content" to table)
        assertTrue(former["isError"].asBoolean() && "create_theme" in former["structuredContent"]["message"].asText(), former.toString())
        val formerImage = kit("write_image", "name" to "cell", "theme" to "noel", "png_base64" to png(18, 18, 0x112233))
        assertTrue(formerImage["isError"].asBoolean() && "Project of its own" in formerImage["structuredContent"]["message"].asText(), formerImage.toString())

        // Its drawing of a common image: named as that image, at its size.
        val small = theme("write_image", "name" to "cell", "png_base64" to png(10, 10, 0x112233))
        assertTrue(small["isError"].asBoolean() && "18x18" in small["structuredContent"]["message"].asText(), small.toString())
        assertTrue("No common image" in theme("write_image", "name" to "nothing", "png_base64" to png(18, 18, 0x112233))["structuredContent"]["message"].asText())
        assertTrue(theme("write_image", "name" to "cell", "theme" to "paques", "png_base64" to png(18, 18, 0x112233))["isError"].asBoolean())
        val drawn = theme("write_image", "name" to "cell", "png_base64" to png(18, 18, 0x112233))
        assertFalse(drawn.has("isError"), drawn.toString())
        assertEquals("overrides/artisan/cell.png", drawn["structuredContent"]["path"].asText())
        assertEquals("noel", drawn["structuredContent"]["theme"].asText())
        assertTrue("theme_draft_id" in drawn["structuredContent"]["use_it"].asText())
        val snapshot = mapper.readTree(drafts.rows.getValue(themeDraft))["snapshot"]
        assertEquals(listOf("overrides/artisan/cell.png"), snapshot["binaryTree"].fieldNames().asSequence().toList())
        assertEquals(listOf("overrides/colors.yml"), snapshot["tree"].fieldNames().asSequence().toList())

        // A menu of a module, seen in the theme as deployed (it changes nothing yet), then as its draft has it.
        val menu = "schema: menu/v1\nsize: 27\nelements:\n  - positions: \"0-2\"\n    image: { asset: \"kit:button.3x1\", fit: native }\n" +
            "  - positions: \"4\"\n    image: { asset: \"kit:cell\", fit: native }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/themed.yml", "content" to menu).has("isError"))
        fun render(vararg args: Pair<String, Any?>) = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/themed.yml", "draft_id" to draftId, "scale" to 1, *args)
        fun shown(rendered: JsonNode): Pair<List<Int>, List<Int>> {
            assertFalse(rendered.has("isError"), rendered.toString())
            val window = rendered["structuredContent"]["window"]
            val picture = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            fun rgb(x: Int, y: Int) = ((window["y"].asInt() + y) * picture.width + window["x"].asInt() + x).let { picture.data.slice(it * 4 until it * 4 + 3).map { b -> b.toInt() and 0xff } }
            return rgb(7 + 27, 17 + 9) to rgb(7 + 4 * 18 + 9, 17 + 9)
        }
        val plain = button to shipped("cell", 9, 9)
        assertEquals(plain, shown(render("theme" to "noel")))
        assertEquals(listOf(0xb3, 0x26, 0x1e) to listOf(0x11, 0x22, 0x33), shown(render("theme" to "noel", "theme_draft_id" to themeDraft)))
        // The draft is a theme's: the theme is named, and is one of its own folder.
        assertTrue(render("theme_draft_id" to themeDraft)["isError"].asBoolean())
        assertTrue(render("theme" to "artisan", "theme_draft_id" to themeDraft)["isError"].asBoolean())

        // Removing its drawing gives the image back to the themes below.
        val removed = theme("write_image", "name" to "cell", "delete" to true)
        assertTrue(removed["structuredContent"]["deleted"].asBoolean(), removed.toString())
        assertEquals(listOf(0xb3, 0x26, 0x1e) to shipped("cell", 9, 9), shown(render("theme" to "noel", "theme_draft_id" to themeDraft)))

        // A theme redraws a module's image too, named `<module>:<image>`, at that image's size.
        modules["guilds"] = McpFixtures.Module(
            files = mapOf("assets/textures/pair.yml" to "width: 36\nheight: 18\ncompose:\n  - image: crest\n  - image: crest\n    x: 18\n"),
            images = mapOf("assets/textures/crest.png" to solid(18, 18, 0x101010)),
        )
        val crestMenu = "schema: menu/v1\nsize: 27\nelements:\n  - positions: \"0\"\n    image: { asset: \"guilds:crest\", fit: native }\n" +
            "  - positions: \"3-4\"\n    image: { asset: \"guilds:pair\", fit: native }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/crest.yml", "content" to crestMenu).has("isError"))
        fun crest(vararg args: Pair<String, Any?>): Pair<List<Int>, List<Int>> {
            val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/crest.yml", "draft_id" to draftId, "scale" to 1, *args)
            assertFalse(rendered.has("isError"), rendered.toString())
            val window = rendered["structuredContent"]["window"]
            val picture = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            fun rgb(x: Int, y: Int) = ((window["y"].asInt() + y) * picture.width + window["x"].asInt() + x).let { picture.data.slice(it * 4 until it * 4 + 3).map { b -> b.toInt() and 0xff } }
            return rgb(7 + 9, 17 + 9) to rgb(7 + 3 * 18 + 27, 17 + 9)
        }
        val dark = listOf(0x10, 0x10, 0x10)
        assertEquals(dark to dark, crest("theme" to "noel", "theme_draft_id" to themeDraft))
        val wrongSize = theme("write_image", "name" to "guilds:crest", "png_base64" to png(10, 10, 0xaabbcc))
        assertTrue(wrongSize["isError"].asBoolean() && "18x18" in wrongSize["structuredContent"]["message"].asText(), wrongSize.toString())
        assertTrue("No module 'nowhere'" in theme("write_image", "name" to "nowhere:crest", "png_base64" to png(18, 18, 0xaabbcc))["structuredContent"]["message"].asText())
        assertTrue("no image 'nothing'" in theme("write_image", "name" to "guilds:nothing", "png_base64" to png(18, 18, 0xaabbcc))["structuredContent"]["message"].asText())
        assertTrue("composed image" in theme("write_image", "name" to "guilds:pair", "png_base64" to png(36, 18, 0xaabbcc))["structuredContent"]["message"].asText())
        val redrawn = theme("write_image", "name" to "guilds:crest", "png_base64" to png(18, 18, 0xaabbcc))
        assertFalse(redrawn.has("isError"), redrawn.toString())
        assertEquals("overrides/guilds/crest.png", redrawn["structuredContent"]["path"].asText())
        // The module's image and the image composed from it follow, in the theme's draft only; `artisan:<name>` is the common image.
        val light = listOf(0xaa, 0xbb, 0xcc)
        assertEquals(light to light, crest("theme" to "noel", "theme_draft_id" to themeDraft))
        assertEquals(dark to dark, crest("theme" to "noel"))
        assertEquals("overrides/artisan/cell.png", theme("write_image", "name" to "artisan:cell", "png_base64" to png(18, 18, 0x112233))["structuredContent"]["path"].asText())
        // Deployed, the survey lists what the theme redraws in modules.
        modules["noel"] = McpFixtures.Module(images = mapOf("overrides/guilds/crest.png" to solid(18, 18, 0xaabbcc)), role = "theme")
        val survey = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]
        assertEquals(listOf("guilds:crest"), survey["common"]["themes"].first { it["name"].asText() == "noel" }["module_redraws"].map { it.asText() })
        assertEquals(light to light, crest("theme" to "noel"))
    }

    @Test
    fun `the colours of a theme are computed from one colour per family of the base`() {
        val (access, _) = tokens()
        // The families are the base's: every colour of a button's face is in `primary`.
        val ramps = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["ramps"]
        assertEquals(listOf("primary", "danger", "accent", "neutral"), ramps["ramps"].map { it["id"].asText() })
        assertEquals("#3c8527", ramps["ramps"][0]["main"].asText())
        assertTrue("theme_colours" in ramps["how"].asText())

        // One colour picked: the family's main colour becomes it, its shades follow, the others keep Artisan's.
        val one = tool(access, "theme_colours", "ramps" to mapOf("primary" to "#B3261E"))["structuredContent"]
        assertEquals("#b3261e", one["colors"]["#3c8527"].asText())
        assertEquals(net.artisanmc.plugin.pack.Ramps.ramp("primary")!!.shades.size, one["colors"].size())
        assertNull(one["colors"]["#a02824"])
        assertTrue(one["file"].asText().startsWith("colors:\n  \"#3c8527\": \"#b3261e\"\n"), one["file"].asText())
        assertEquals("overrides/colors.yml", one["path"].asText())
        // The file is a theme's table as the builders read it.
        assertEquals(one["colors"].size(), net.artisanmc.plugin.pack.KitTheme.colors(one["file"].asText()).size)

        // Two families, in the declaration's order whatever order they are asked in.
        val two = tool(access, "theme_colours", "ramps" to mapOf("neutral" to "#4a5a8c", "primary" to "#b3261e"))["structuredContent"]
        assertEquals(listOf("primary", "neutral"), two["ramps"].fieldNames().asSequence().toList())
        assertEquals("#3c8527", two["colors"].fieldNames().next())
        assertNull(two["colors"]["#000000"], "black stays black")

        // Artisan's own colour changes nothing; an unknown family and a colour that is not one are refused.
        val same = tool(access, "theme_colours", "ramps" to mapOf("primary" to "#3c8527"))["structuredContent"]
        assertEquals(0, same["colors"].size())
        assertEquals("", same["file"].asText())
        assertEquals("invalid_input", tool(access, "theme_colours", "ramps" to mapOf("brand" to "#b3261e"))["structuredContent"]["error"].asText())
        assertEquals("invalid_input", tool(access, "theme_colours", "ramps" to mapOf("primary" to "red"))["structuredContent"]["error"].asText())
        assertEquals("invalid_input", tool(access, "theme_colours", "ramps" to emptyMap<String, String>())["structuredContent"]["error"].asText())
    }

    @Test
    fun `a theme's colours repaint the images that follow the ramps, and its scope keeps them to one module`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        fun png(width: Int, height: Int, rgb: Int) = java.util.Base64.getEncoder().encodeToString(solid(width, height, rgb))
        val base = net.artisanmc.plugin.pack.Png.decode(net.artisanmc.plugin.pack.Kit.shipped(net.artisanmc.plugin.pack.Kit.slot("button.3x1")!!))
        val button = base.data.slice((9 * base.width + 27) * 4 until (9 * base.width + 27) * 4 + 3).map { it.toInt() and 0xff }
        val green = (button[0] shl 16) or (button[1] shl 8) or button[2]
        val red = listOf(0xb3, 0x26, 0x1e)
        val table = "colors:\n  \"#%06x\": \"#b3261e\"\n".format(green)
        modules["artisan"] = McpFixtures.Module(role = "theme")
        // Two images of the base's green in a module: `flag` says it follows the ramps, `plain` does not.
        modules["guilds"] = McpFixtures.Module(
            files = mapOf("assets/textures/flag.yml" to "width: 18\nheight: 18\nramps: true\n"),
            images = mapOf("assets/textures/flag.png" to solid(18, 18, green), "assets/textures/plain.png" to solid(18, 18, green)),
        )
        fun themed(colors: String) { modules["noel"] = McpFixtures.Module(files = mapOf("overrides/colors.yml" to colors), role = "theme") }
        themed(table)
        val (access, _) = tokens(publish = true)
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: ramps")["structuredContent"]["draft_id"].asText()
        val menu = "schema: menu/v1\nsize: 27\nelements:\n  - positions: \"0\"\n    image: { asset: \"guilds:flag\", fit: native }\n" +
            "  - positions: \"2\"\n    image: { asset: \"guilds:plain\", fit: native }\n  - positions: \"4-6\"\n    image: { asset: button.3x1, fit: native }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/ramps.yml", "content" to menu).has("isError"))
        // The pixel in the middle of `flag`, of `plain`, and of the base's button.
        fun shown(vararg args: Pair<String, Any?>): List<List<Int>> {
            val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/ramps.yml", "draft_id" to draftId, "scale" to 1, *args)
            assertFalse(rendered.has("isError"), rendered.toString())
            val window = rendered["structuredContent"]["window"]
            val picture = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            fun rgb(x: Int, y: Int) = ((window["y"].asInt() + y) * picture.width + window["x"].asInt() + x).let { picture.data.slice(it * 4 until it * 4 + 3).map { b -> b.toInt() and 0xff } }
            return listOf(rgb(7 + 9, 17 + 9), rgb(7 + 2 * 18 + 9, 17 + 9), rgb(7 + 4 * 18 + 27, 17 + 9))
        }
        assertEquals(listOf(button, button, button), shown("theme" to "none"))
        // The image that follows the ramps and the base take the theme's colours; the other keeps its own.
        assertEquals(listOf(red, button, red), shown("theme" to "noel"))
        // A theme of one module: its colours stay in that module's images.
        themed("scope: guilds\n$table")
        assertEquals(listOf(red, button, button), shown("theme" to "noel"))
        themed("scope: artisan\n$table")
        assertEquals(listOf(button, button, red), shown("theme" to "noel"))
        themed("scope: shop\n$table")
        assertEquals(listOf(button, button, button), shown("theme" to "noel"))
        // The survey says which images follow the ramps, and what a theme's colours are kept to.
        val survey = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]
        val images = survey["modules"].first { it["project"].asText() == "u-local.guilds" }["images"]
        assertEquals(mapOf("flag" to true, "plain" to false), images.associate { it["name"].asText() to it.path("ramps").asBoolean() })
        assertEquals("shop", survey["common"]["themes"].first { it["name"].asText() == "noel" }["scope"].asText())

        // write_image says it, changes it, and keeps it when it is not said.
        fun write(vararg args: Pair<String, Any?>) = tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, *args)
        fun descriptor() = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]["assets/textures/tag.yml"].asText()
        val first = write("name" to "tag", "png_base64" to png(18, 18, green), "ramps" to true)
        assertFalse(first.has("isError"), first.toString())
        assertTrue(first["structuredContent"]["ramps"].asBoolean())
        assertTrue("ramps: true\n" in descriptor(), descriptor())
        val again = write("name" to "tag", "png_base64" to png(18, 18, green))
        assertTrue(again["structuredContent"]["ramps"].asBoolean())
        assertEquals(1, Regex("ramps: true").findAll(descriptor()).count())
        val off = write("name" to "tag", "png_base64" to png(18, 18, green), "ramps" to false)
        assertFalse(off["structuredContent"]["ramps"].asBoolean())
        assertFalse("ramps" in descriptor(), descriptor())
        assertFalse(write("name" to "untold", "png_base64" to png(18, 18, green))["structuredContent"]["ramps"].asBoolean())
        // A composed image follows its layers, and a theme's drawing is taken as drawn: neither says it.
        val composed = write("name" to "both", "compose" to mapOf("layers" to listOf(mapOf("image" to "tag"))), "ramps" to true)
        assertTrue(composed["isError"].asBoolean() && "layers" in composed["structuredContent"]["message"].asText(), composed.toString())
        val themeDraft = tool(access, "start_draft", "project" to "u-local.noel", "name" to "AI: noel")["structuredContent"]["draft_id"].asText()
        val inTheme = tool(access, "write_image", "project" to "u-local.noel", "draft_id" to themeDraft, "name" to "cell", "png_base64" to png(18, 18, green), "ramps" to true)
        assertTrue(inTheme["isError"].asBoolean() && "as drawn" in inTheme["structuredContent"]["message"].asText(), inTheme.toString())
        // A theme's file is checked for its scope too.
        val badScope = tool(access, "write_document", "project" to "u-local.noel", "draft_id" to themeDraft, "path" to "overrides/colors.yml", "content" to "scope: 3\n$table")
        assertFalse(badScope["structuredContent"]["written"].asBoolean(), badScope.toString())
        assertTrue("`scope`" in badScope["structuredContent"]["problems"][0]["message"].asText())
        assertTrue(
            tool(access, "write_document", "project" to "u-local.noel", "draft_id" to themeDraft, "path" to "overrides/colors.yml", "content" to "scope: guilds\n$table")
                ["structuredContent"]["written"].asBoolean(),
        )
    }

    @Test
    fun `a composed image is written as a recipe, shown as the pack assembles it, and follows the kit`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        fun rgb(image: net.artisanmc.plugin.pack.RgbaImage, x: Int, y: Int) = image.data.slice((y * image.width + x) * 4 until (y * image.width + x) * 4 + 3).map { it.toInt() and 0xff }
        fun picture(result: com.fasterxml.jackson.databind.JsonNode) =
            net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(result["content"][1]["data"].asText()))
        fun shipped(id: String, x: Int, y: Int) =
            rgb(net.artisanmc.plugin.pack.Png.decode(net.artisanmc.plugin.pack.Kit.shipped(net.artisanmc.plugin.pack.Kit.slot(id)!!)), x, y)
        val blue = listOf(0x33, 0x66, 0xcc)
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/shop_icon.png" to solid(16, 16, 0x3366cc)))
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: composed")["structuredContent"]["draft_id"].asText()
        fun write(vararg args: Pair<String, Any?>) = tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, *args)
        val snapshot = { mapper.readTree(drafts.rows.getValue(draftId))["snapshot"] }
        val layers = listOf(
            mapOf("image" to "kit:window.3"),
            mapOf("image" to "kit:cell", "x" to 7, "y" to 17, "columns" to 9, "rows" to 3),
            mapOf("image" to "shop_icon", "x" to 80, "y" to 1),
        )

        // A window put together from the kit and the module's icon: a descriptor, and no PNG.
        val written = write("name" to "shop_window", "use" to "background", "compose" to mapOf("layers" to layers))
        assertFalse(written.has("isError"), written.toString())
        val facts = written["structuredContent"]
        assertEquals("assets/glyphs/shop_window.yml", facts["path"].asText())
        assertEquals(176 to 166, facts["width"].asInt() to facts["height"].asInt())
        assertEquals(
            "ascent: 13\ncodepoint: 57344\nusages: [menu]\ncompose:\n  - use: \"kit:window.3\"\n  - grid: \"kit:cell\"\n    x: 7\n    y: 17\n" +
                "    columns: 9\n    rows: 3\n  - image: \"shop_icon\"\n    x: 80\n    y: 1\n",
            snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText(),
        )
        assertEquals(listOf("assets/textures/shop_icon.png"), snapshot()["binaryTree"].fieldNames().asSequence().toList())
        // The picture as assembled, kept beside the draft for the editor's assistant to show.
        assertEquals(176, net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(facts["preview_hash"].asText())).width)
        // The picture the model looks at, twice the size: the icon over the window, a slot's frame, the window under them.
        val shown = picture(written)
        assertEquals(176 * 2, shown.width)
        assertEquals(blue, rgb(shown, 2 * 85, 2 * 5))
        assertEquals(shipped("cell", 9, 9), rgb(shown, 2 * (7 + 18 + 9), 2 * (17 + 18 + 9)))
        assertEquals(shipped("window.3", 3, 150), rgb(shown, 2 * 3, 2 * 150))

        // Read back, it is its layers; a draft lists it apart from its PNGs.
        val read = tool(access, "read_image", "project" to "u-local.shop", "path" to "assets/glyphs/shop_window.yml", "draft_id" to draftId)
        assertEquals(mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(layers), read["structuredContent"]["compose"]["layers"])
        assertEquals(176, read["structuredContent"]["width"].asInt())
        assertEquals(blue, rgb(picture(read), 2 * 85, 2 * 5))
        val listed = tool(access, "list_documents", "project" to "u-local.shop", "draft_id" to draftId)["structuredContent"]
        assertEquals(listOf("assets/glyphs/shop_window.yml"), listed["composed_images"].map { it.asText() })
        assertTrue(tool(access, "read_image", "project" to "u-local.shop", "path" to "assets/glyphs/shop_window.yml")["isError"].asBoolean(), "not deployed yet")

        // A menu of the draft draws it as its window.
        val menu = "schema: menu/v1\nsize: 27\nvanilla_texture: false\ntitle:\n  - { kind: background, asset: shop_window }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/composed.yml", "content" to menu).has("isError"))
        val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/composed.yml", "draft_id" to draftId, "scale" to 1)
        assertTrue(rendered["structuredContent"]["notes"].none { "shop_window" in it.asText() }, rendered["structuredContent"].toString())
        val window = rendered["structuredContent"]["window"]
        assertEquals(blue, rgb(picture(rendered), window["x"].asInt() + 85, window["y"].asInt() + 5))

        // A layer the pack would leave out is refused here, with what to name instead.
        val revision = mapper.readTree(drafts.rows.getValue(draftId))["revision"].asInt()
        fun refused(vararg args: Pair<String, Any?>): String = write(*args).also { assertTrue(it["isError"].asBoolean(), it.toString()) }["structuredContent"]["message"].asText()
        assertTrue("no image 'gone'" in refused("name" to "card", "compose" to mapOf("layers" to listOf(mapOf("image" to "gone")))))
        assertTrue("kit:gone" in refused("name" to "card", "compose" to mapOf("layers" to listOf(mapOf("image" to "kit:gone")))))
        assertTrue("itself a composed image" in refused("name" to "card", "compose" to mapOf("layers" to listOf(mapOf("image" to "shop_window")))))
        assertTrue("layer of itself" in refused("name" to "shop_icon", "compose" to mapOf("layers" to listOf(mapOf("image" to "shop_icon")))))
        assertTrue("together" in refused("name" to "card", "compose" to mapOf("layers" to listOf(mapOf("image" to "shop_icon")), "width" to 20)))
        assertTrue("columns" in refused("name" to "card", "compose" to mapOf("layers" to listOf(mapOf("image" to "shop_icon", "columns" to 65)))))
        assertTrue("at least one" in refused("name" to "card", "compose" to mapOf("layers" to emptyList<Any>())))
        assertEquals(revision, mapper.readTree(drafts.rows.getValue(draftId))["revision"].asInt())

        // A given size clips the layers; written as pixels, the image keeps its place and loses its recipe; composed again, its PNG.
        val card = write("name" to "card", "compose" to mapOf("layers" to listOf(mapOf("image" to "kit:card.3x2"), mapOf("image" to "shop_icon", "x" to 19, "y" to 4)), "width" to 30, "height" to 12))
        assertEquals(30 to 12, card["structuredContent"]["width"].asInt() to card["structuredContent"]["height"].asInt())
        assertEquals(
            "width: 30\nheight: 12\nusages: [button]\ncompose:\n  - use: \"kit:card.3x2\"\n  - image: \"shop_icon\"\n    x: 19\n    y: 4\n",
            snapshot()["tree"]["assets/textures/card.yml"].asText(),
        )
        val pixels = mapOf("palette" to mapOf("#" to "#373737"), "rows" to listOf("##", "##"))
        val drawn = write("name" to "shop_window", "pixels" to pixels)
        assertEquals("assets/glyphs/shop_window.png", drawn["structuredContent"]["path"].asText())
        assertTrue(drawn["structuredContent"]["replaced"].asBoolean())
        assertEquals("ascent: 13\ncodepoint: 57344\nusages: [menu]\nwidth: 2\nheight: 2\n", snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText())
        val again = write("name" to "shop_window", "compose" to mapOf("layers" to listOf(mapOf("image" to "kit:window.3"))))
        assertTrue(again["structuredContent"]["replaced"].asBoolean())
        assertNull(snapshot()["binaryTree"]["assets/glyphs/shop_window.png"])
        assertEquals("ascent: 13\ncodepoint: 57344\nusages: [menu]\ncompose:\n  - use: \"kit:window.3\"\n", snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText())
        assertTrue(write("name" to "card", "delete" to true)["structuredContent"]["deleted"].asBoolean())
        assertNull(snapshot()["tree"]["assets/textures/card.yml"])

        // Deployed in another module, it is surveyed with what it is made of, and it follows the server's kit:
        // the window redrawn in the kit module is the one under the icon.
        modules["guilds"] = McpFixtures.Module(
            files = mapOf(
                "assets/glyphs/guild_window.yml" to "ascent: 13\ncodepoint: 57344\ncompose:\n  - use: 'kit:window.3'\n  - image: guild_icon\n    x: 80\n    y: 1\n",
                "menus/guild.yml" to "schema: menu/v1\nsize: 27\nvanilla_texture: false\ntitle:\n  - { kind: background, asset: guild_window }\n",
            ),
            images = mapOf("assets/textures/guild_icon.png" to solid(16, 16, 0x3366cc)),
        )
        fun deployed(): Pair<List<Int>, List<Int>> {
            val shownMenu = tool(access, "render_menu", "project" to "u-local.guilds", "path" to "menus/guild.yml", "scale" to 1)
            val at = shownMenu["structuredContent"]["window"]
            return rgb(picture(shownMenu), at["x"].asInt() + 85, at["y"].asInt() + 5) to rgb(picture(shownMenu), at["x"].asInt() + 3, at["y"].asInt() + 150)
        }
        assertEquals(blue to shipped("window.3", 3, 150), deployed())
        val surveyed = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["modules"].first { it["project"].asText() == "u-local.guilds" }["images"]
        assertEquals(listOf("guild_window" to "assets/glyphs/guild_window.yml", "guild_icon" to "assets/textures/guild_icon.png"), surveyed.map { it["name"].asText() to it["path"].asText() })
        assertEquals(listOf("kit:window.3", "guild_icon"), surveyed[0]["composed_of"].map { it.asText() })
        assertEquals(176 to 166, surveyed[0]["width"].asInt() to surveyed[0]["height"].asInt())
        modules["artisan"] = McpFixtures.Module(images = mapOf("assets/textures/window.3.png" to solid(176, 166, 0xcc2020)))
        assertEquals(blue to listOf(0xcc, 0x20, 0x20), deployed())
        assertEquals(listOf("assets/glyphs/guild_window.yml"), tool(access, "list_documents", "project" to "u-local.guilds")["structuredContent"]["composed_images"].map { it.asText() })
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" })
    }

    @Test
    fun `a rendered menu shows its module's own image, and another module's by module and name`() {
        fun solid(rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(54, 18).also { image ->
            for (i in 0 until 54 * 18) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        // Two modules hold `gold`: `bank` is the first by Project order.
        modules["bank"] = McpFixtures.Module(images = mapOf("assets/textures/gold.png" to solid(0xcc2020)))
        modules["guilds"] = McpFixtures.Module(
            files = mapOf(
                "menus/two.yml" to "schema: menu/v1\nsize: 27\ntitle: Gold\nelements:\n" +
                    "  - id: own\n    positions: \"12-14\"\n    image: { asset: gold }\n" +
                    "  - id: theirs\n    positions: \"3-5\"\n    image: { asset: \"bank:gold\" }\n" +
                    "  - id: named\n    positions: \"21-23\"\n    image: { asset: \"guilds:gold\" }\n",
            ),
            images = mapOf("assets/textures/gold.png" to solid(0x3366cc)),
        )
        val (access, _) = tokens()
        val rendered = tool(access, "render_menu", "project" to "u-local.guilds", "path" to "menus/two.yml", "scale" to 1)
        assertFalse(rendered.has("isError"), rendered.toString())
        val window = rendered["structuredContent"]["window"]
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
        // The middle of the button over columns 3 to 5 of a row.
        fun row(index: Int): List<Int> {
            val at = ((window["y"].asInt() + 17 + index * 18 + 9) * shown.width + window["x"].asInt() + 7 + 4 * 18) * 4
            return shown.data.slice(at until at + 3).map { it.toInt() and 0xff }
        }
        assertEquals(listOf(0xcc, 0x20, 0x20), row(0), "bank:gold")
        assertEquals(listOf(0x33, 0x66, 0xcc), row(1), "its own gold, not the first module's")
        assertEquals(listOf(0x33, 0x66, 0xcc), row(2), "guilds:gold")
    }

    @Test
    fun `an owner's image at other measures than its original's is not taken, the original shows, and the tools say so`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        // The module ships `crest` as a menu image, 54x18; the owner's is 20x20.
        modules["guilds"] = McpFixtures.Module(
            files = mapOf(
                "originals/assets/textures/crest.yml" to "function: menu\n",
                "assets/textures/crest.yml" to "width: 20\nheight: 20\nusages: [button]\n",
                "menus/hall.yml" to "schema: menu/v1\nsize: 27\ntitle: Hall\nelements:\n" +
                    "  - id: crest\n    positions: \"3-5\"\n    image: { asset: crest }\n",
            ),
            images = mapOf(
                "originals/assets/textures/crest.png" to solid(54, 18, 0x3366cc),
                "assets/textures/crest.png" to solid(20, 20, 0xcc2020),
            ),
        )
        val (access, _) = tokens()
        // The middle of the button over columns 3 to 5 of the first row.
        fun shown(vararg args: Pair<String, Any?>): List<Int> {
            val rendered = tool(access, "render_menu", "project" to "u-local.guilds", "path" to "menus/hall.yml", "scale" to 1, *args)
            assertFalse(rendered.has("isError"), rendered.toString())
            val window = rendered["structuredContent"]["window"]
            val picture = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            val at = ((window["y"].asInt() + 17 + 9) * picture.width + window["x"].asInt() + 7 + 4 * 18) * 4
            return picture.data.slice(at until at + 3).map { it.toInt() and 0xff }
        }
        assertEquals(listOf(0x33, 0x66, 0xcc), shown(), "the original, as the pack shows it")

        // The image is still read where it is, and says it is not taken.
        fun read(path: String, draft: String? = null) =
            tool(access, "read_image", *listOfNotNull("project" to "u-local.guilds", "path" to path, draft?.let { "draft_id" to it }).toTypedArray())["structuredContent"]
        val note = read("assets/textures/crest.png")["not_taken"].asText()
        assertTrue("54x18" in note && "originals/assets/textures/crest.png" in note, note)
        assertFalse(read("originals/assets/textures/crest.png").has("not_taken"))
        // The survey lists what the pack shows: the original.
        val surveyed = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["modules"].first { it["project"].asText() == "u-local.guilds" }
        assertEquals(listOf("originals/assets/textures/crest.png"), surveyed["images"].map { it["path"].asText() })

        // Written at other measures, the image enters the draft and the result says it is not taken; at the original's, it is.
        val draftId = tool(access, "start_draft", "project" to "u-local.guilds", "name" to "AI: crest")["structuredContent"]["draft_id"].asText()
        fun write(png: ByteArray) = tool(
            access, "write_image", "project" to "u-local.guilds", "draft_id" to draftId, "name" to "crest",
            "png_base64" to java.util.Base64.getEncoder().encodeToString(png),
        )
        val small = write(solid(30, 18, 0x20c040))
        assertFalse(small.has("isError"), small.toString())
        assertTrue("54x18" in small["structuredContent"]["not_taken"].asText())
        assertEquals(listOf(0x33, 0x66, 0xcc), shown("draft_id" to draftId))
        assertTrue(read("assets/textures/crest.png", draftId).has("not_taken"))
        val sized = write(solid(54, 18, 0x20c040))
        assertFalse(sized["structuredContent"].has("not_taken"), sized.toString())
        assertEquals(listOf(0x20, 0xc0, 0x40), shown("draft_id" to draftId))
        assertFalse(read("assets/textures/crest.png", draftId).has("not_taken"))
    }

    @Test
    fun `an image is cut out of a picture, at the art's own size and without its ground`() {
        // A round button drawn four times its size on a plain ground, as a screenshot or a sprite sheet shows it.
        val rows = listOf("_kkkkkk_", "kwwwwwgk", "kwrrrrgk", "kwrbbrgk", "kgggggGk", "_kkkkkk_")
        val colours = mapOf('_' to 0x3a2852, 'k' to 0x000000, 'w' to 0xffffff, 'r' to 0xc03030, 'b' to 0x3050c0, 'g' to 0x8b8b8b, 'G' to 0x555555)
        val sheet = net.artisanmc.plugin.pack.RgbaImage(120, 90)
        for (y in 0 until 90) for (x in 0 until 120) {
            val key = rows.getOrNull(Math.floorDiv(y - 19, 4))?.getOrNull(Math.floorDiv(x - 23, 4)) ?: '_'
            java.nio.ByteBuffer.wrap(sheet.data, (y * 120 + x) * 4, 4).putInt((colours.getValue(key) shl 8) or 0xff)
        }
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/sheet.png" to net.artisanmc.plugin.pack.Png.encode(sheet)))
        val (access, _) = tokens()

        val measured = tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/sheet.png")
        assertFalse(measured.has("isError"), measured.toString())
        val facts = measured["structuredContent"]
        assertEquals(listOf(120, 90, 4), listOf("width", "height", "pixel_size").map { facts[it].asInt() })
        assertEquals("x8" to "#3a2852", facts["shown_at"].asText() to facts["background"].asText())
        assertEquals("""[{"n":1,"x":23,"y":19,"width":32,"height":24,"art_size":"8x6"}]""", facts["elements"].toString())
        assertEquals("image" to "image/png", measured["content"][1]["type"].asText() to measured["content"][1]["mimeType"].asText())
        // A zone holds what is asked of the picture, and one outside it is refused.
        val zone = mapOf("x" to 10, "y" to 10, "width" to 60, "height" to 40)
        assertEquals("x12", tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/sheet.png", "zone" to zone)["structuredContent"]["shown_at"].asText())
        assertTrue(tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/sheet.png", "zone" to zone + ("x" to 500))["isError"].asBoolean())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: cut")["structuredContent"]["draft_id"].asText()
        fun cut(name: String, vararg from: Pair<String, Any?>) =
            tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to name, "from" to mapOf("path" to "assets/textures/sheet.png", *from))
        fun stored(name: String): net.artisanmc.plugin.pack.RgbaImage {
            val ref = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["binaryTree"]["assets/textures/$name.png"]
            return net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(ref["hash"].asText()))
        }
        fun pixel(image: net.artisanmc.plugin.pack.RgbaImage, x: Int, y: Int) = java.nio.ByteBuffer.wrap(image.data, (y * image.width + x) * 4, 4).int

        // A loose rectangle around the button: its ground goes, the image is the button alone, one pixel per art pixel.
        val round = cut("round_button", "x" to 18, "y" to 15, "width" to 44, "height" to 33, "background" to "remove")
        assertFalse(round.has("isError"), round.toString())
        val cutFacts = round["structuredContent"]
        assertEquals(listOf(8, 6, 4), listOf("width", "height", "pixel_size").map { cutFacts[it].asInt() })
        assertEquals("#3a2852", cutFacts["background_removed"].asText())
        assertEquals("""{"picture":"assets/textures/sheet.png","x":23,"y":19,"width":32,"height":24}""", cutFacts["cut_from"].toString())
        val button = stored("round_button")
        assertEquals(listOf(0, 0x000000ff, 0xffffffff.toInt(), 0x3050c0ff), listOf(pixel(button, 0, 0), pixel(button, 1, 0), pixel(button, 1, 1), pixel(button, 3, 3)))
        assertEquals("width: 8\nheight: 6\nusages: [button]\n", mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]["assets/textures/round_button.yml"].asText())

        // Kept as it is: a rectangle a pixel or two off snaps to the art's pixels, and the corners keep the ground.
        assertEquals(0x3a2852ff, pixel(cut("square_button", "x" to 24, "y" to 18, "width" to 31, "height" to 25).let { stored("square_button") }, 0, 0))
        // A pixel size given wins over the one found; fewer colours when asked.
        val coarse = cut("coarse", "x" to 23, "y" to 19, "width" to 32, "height" to 24, "pixel_size" to 8, "colours" to 2)["structuredContent"]
        assertEquals(listOf(4, 3, 2), listOf("width", "height", "colours_kept").map { coarse[it].asInt() })

        // What cannot be cut says why: no attachment outside the assistant, a rectangle off the picture, only ground.
        val none = cut("x", "attachment" to "capture.png")
        assertTrue(none["isError"].asBoolean() && "editor's assistant" in none["structuredContent"]["message"].asText(), none.toString())
        assertTrue(cut("x", "x" to 200, "y" to 0, "width" to 10, "height" to 10)["isError"].asBoolean())
        assertTrue("Nothing is left" in cut("x", "x" to 80, "y" to 60, "width" to 20, "height" to 20, "background" to "remove")["structuredContent"]["message"].asText())
        assertTrue(tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "x", "from" to mapOf("x" to 1))["isError"].asBoolean())
    }

    @Test
    fun `icons are cut out of an inventory's slots, in a picture resized by a fraction`() {
        // Three slots as the game draws them (dark edge top and left, light edge bottom and right) in a panel, a gem in the
        // first and a block that fills the second, the whole resized by 4.5 and smoothed: a store's preview, a mock-up.
        val gem = listOf("__kkkkkkkk__", "_kwwwwwwwwk_", "kwwbbbbbbwwk", "kwbbwbbbbbwk", "kwbwbbbbbbwk", "_kwbbbbbbwk_", "__kwbbbbwk__", "___kwbbwk___", "____kwwk____", "_____kk_____")
        val colours = mapOf('_' to 0x8b8b8b, 'k' to 0x000000, 'w' to 0xffffff, 'r' to 0xc03030, 'b' to 0x3050c0, 'p' to 0xc6c6c6, 'd' to 0x373737)
        fun art(x: Int, y: Int): Char {
            val column = Math.floorDiv(x - 1, 18)
            val i = Math.floorMod(x - 1, 18)
            val j = y - 1
            if (column !in 0..2 || j !in 0..17) return 'p'
            return when {
                (j == 0 && i < 17) || (i == 0 && j < 17) -> 'd'
                (j == 17 && i > 0) || (i == 17 && j > 0) -> 'w'
                i == 0 || i == 17 -> '_'
                column == 0 -> gem.getOrNull(j - 4)?.getOrNull(i - 3) ?: '_'
                column == 2 -> '_'
                else -> if (((i - 1) / 4 + (j - 1) / 4) % 2 == 0) 'r' else 'b'
            }
        }
        val scale = 4.5
        val picture = net.artisanmc.plugin.pack.RgbaImage((56 * scale).toInt(), (20 * scale).toInt())
        for (y in 0 until picture.height) for (x in 0 until picture.width) {
            val sum = IntArray(3)
            for (j in 0 until 4) for (i in 0 until 4) {
                val colour = colours.getValue(art(((x + (i + 0.5) / 4) / scale).toInt(), ((y + (j + 0.5) / 4) / scale).toInt()))
                sum[0] += colour shr 16
                sum[1] += (colour shr 8) and 0xff
                sum[2] += colour and 0xff
            }
            java.nio.ByteBuffer.wrap(picture.data, (y * picture.width + x) * 4, 4).putInt(((sum[0] / 16) shl 24) or ((sum[1] / 16) shl 16) or ((sum[2] / 16) shl 8) or 0xff)
        }
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/preview.png" to net.artisanmc.plugin.pack.Png.encode(picture)))
        val (access, _) = tokens()

        val facts = tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/preview.png")["structuredContent"]
        assertEquals(4.5, facts["pixel_size"].asDouble(), 0.02)
        assertTrue("resized" in facts["pixel_size_note"].asText())
        assertEquals("#8b8b8b", facts["background"].asText())
        // The slots' lines part the icons and are no element; the block touches them and still comes alone.
        assertEquals(listOf("12x10", "16x16"), facts["elements"].map { it["art_size"].asText() })
        assertTrue("background: \"#8b8b8b\"" in facts["next"].asText(), facts["next"].asText())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: icons")["structuredContent"]["draft_id"].asText()
        fun cut(name: String, element: JsonNode, vararg more: Pair<String, Any?>) = tool(
            access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to name,
            "from" to mapOf("path" to "assets/textures/preview.png", "x" to element["x"].asInt(), "y" to element["y"].asInt(), "width" to element["width"].asInt(), "height" to element["height"].asInt(), *more),
        )
        fun stored(name: String): net.artisanmc.plugin.pack.RgbaImage {
            val ref = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["binaryTree"]["assets/textures/$name.png"]
            return net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(ref["hash"].asText()))
        }
        fun pixel(image: net.artisanmc.plugin.pack.RgbaImage, x: Int, y: Int) = java.nio.ByteBuffer.wrap(image.data, (y * image.width + x) * 4, 4).int

        // The element's own rectangle has no ground around it: the ground is named, and goes from the rectangle's edge inward.
        val written = cut("gem", facts["elements"][0], "background" to "#8b8b8b", "colours" to 4)
        assertFalse(written.has("isError"), written.toString())
        val cutFacts = written["structuredContent"]
        assertEquals(listOf(12, 10), listOf("width", "height").map { cutFacts[it].asInt() })
        assertEquals(4.5, cutFacts["pixel_size"].asDouble(), 0.02)
        assertEquals("#8b8b8b", cutFacts["background_removed"].asText())
        assertTrue(cutFacts["notes"].any { "resized" in it.asText() }, cutFacts.toString())
        val image = stored("gem")
        // A corner is transparent, the outline black, the gem's inside blue, as drawn.
        assertEquals(listOf(0, 0x000000ff, 0x3050c0ff), listOf(pixel(image, 0, 0), pixel(image, 2, 0), pixel(image, 5, 4)))

        // A ground the rectangle's edge does not show is said, not guessed; anything else than a colour or a mode is refused.
        val wrong = cut("block", facts["elements"][1], "background" to "#00ff00")["structuredContent"]
        assertEquals(listOf(16, 16), listOf("width", "height").map { wrong[it].asInt() })
        assertTrue(!wrong.has("background_removed") && wrong["notes"].any { "Nothing was removed" in it.asText() }, wrong.toString())
        assertTrue(cut("x", facts["elements"][0], "background" to "green")["isError"].asBoolean())
        // The size given by hand is laid on the art's own cells: the same image.
        cut("gem_by_hand", facts["elements"][0], "background" to "#8b8b8b", "colours" to 4, "pixel_size" to 4.5)
        assertContentEquals(image.data, stored("gem_by_hand").data)
    }

    @Test
    fun `an image written as pixels enters the draft with its descriptor, and comes back enlarged for the model to see`() {
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: images")["structuredContent"]["draft_id"].asText()
        fun write(vararg args: Pair<String, Any?>) = tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, *args)
        val pixels = mapOf("palette" to mapOf("#" to "#373737", "w" to "#ffffff", "s" to "#00000080"), "rows" to listOf("####", "#ww#", "#.s#", "####"))

        val written = write("name" to "shop_button", "pixels" to pixels)
        assertFalse(written.has("isError"), written.toString())
        val facts = written["structuredContent"]
        assertEquals("assets/textures/shop_button.png", facts["path"].asText())
        assertEquals(listOf(4, 4, 3, 1), listOf("width", "height", "colours", "translucent_pixels").map { facts[it].asInt() })
        // The picture the model looks at: a PNG, each pixel a square.
        val picture = written["content"][1]
        assertEquals("image" to "image/png", picture["type"].asText() to picture["mimeType"].asText())
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(picture["data"].asText()))
        assertEquals(4 * 16, shown.width)
        val snapshot = { mapper.readTree(drafts.rows.getValue(draftId))["snapshot"] }
        val ref = snapshot()["binaryTree"]["assets/textures/shop_button.png"]
        assertEquals("width: 4\nheight: 4\nusages: [button]\n", snapshot()["tree"]["assets/textures/shop_button.yml"].asText())
        val stored = net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(ref["hash"].asText()))
        assertEquals(listOf(0x37, 0x37, 0x37, 0xff), stored.data.take(4).map { it.toInt() and 0xff })
        assertEquals(0, stored.alpha(1, 2))
        assertEquals(0x80, stored.alpha(2, 2))

        // Read back from the draft: the same pixels as text, to change and write again.
        val read = tool(access, "read_image", "project" to "u-local.shop", "path" to "assets/textures/shop_button.png", "draft_id" to draftId)
        assertEquals(listOf("####", "#aa#", "#.b#", "####"), read["structuredContent"]["pixels"]["rows"].map { it.asText() })
        assertEquals("#00000080", read["structuredContent"]["pixels"]["palette"]["b"].asText())
        assertEquals(listOf("assets/textures/shop_button.png"), tool(access, "list_documents", "project" to "u-local.shop", "draft_id" to draftId)["structuredContent"]["images"].map { it.asText() })
        assertTrue(tool(access, "read_image", "project" to "u-local.shop", "path" to "assets/textures/shop_button.png")["isError"].asBoolean())

        // A window background is a title image: a codepoint no other image of the draft has, kept when it is written over.
        val png = java.util.Base64.getEncoder().encodeToString(net.artisanmc.plugin.pack.Png.encode(net.artisanmc.plugin.pack.RgbaImage(176, 166)))
        assertFalse(write("name" to "shop_window", "use" to "background", "png_base64" to png).has("isError"))
        assertFalse(write("name" to "vip_window", "use" to "background", "png_base64" to png).has("isError"))
        assertEquals("ascent: 13\ncodepoint: 57344\nwidth: 176\nheight: 166\nusages: [menu]\n", snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText())
        assertTrue("codepoint: 57345\n" in snapshot()["tree"]["assets/glyphs/vip_window.yml"].asText())
        val again = write("name" to "shop_window", "pixels" to pixels)
        assertTrue(again["structuredContent"]["replaced"].asBoolean())
        assertEquals("ascent: 13\ncodepoint: 57344\nusages: [menu]\nwidth: 4\nheight: 4\n", snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText())

        // What cannot be an image is refused with what to fix, and the draft does not move.
        val revision = mapper.readTree(drafts.rows.getValue(draftId))["revision"].asInt()
        val ragged = write("name" to "bad", "pixels" to mapOf("palette" to mapOf("#" to "#000000"), "rows" to listOf("##", "#")))
        assertTrue(ragged["isError"].asBoolean() && "row 2" in ragged["structuredContent"]["message"].asText(), ragged.toString())
        assertTrue(write("name" to "bad", "pixels" to mapOf("palette" to mapOf("#" to "red"), "rows" to listOf("#")))["isError"].asBoolean())
        assertTrue(write("name" to "bad", "pixels" to mapOf("palette" to emptyMap<String, String>(), "rows" to listOf("?")))["isError"].asBoolean())
        assertTrue(write("name" to "Bad Name", "pixels" to pixels)["isError"].asBoolean())
        assertTrue(write("name" to "bad", "png_base64" to "bm90IGEgcG5nIGZpbGUsIGp1c3QgdGV4dCB0aGF0IGlzIGxvbmc=")["isError"].asBoolean())
        val huge = net.artisanmc.plugin.pack.Png.encode(net.artisanmc.plugin.pack.RgbaImage(1, 1)).also { java.nio.ByteBuffer.wrap(it).putInt(16, 100_000) }
        assertTrue(write("name" to "bad", "png_base64" to java.util.Base64.getEncoder().encodeToString(huge))["isError"].asBoolean())
        assertEquals(revision, mapper.readTree(drafts.rows.getValue(draftId))["revision"].asInt())

        assertTrue(write("name" to "vip_window", "delete" to true)["structuredContent"]["deleted"].asBoolean())
        assertNull(snapshot()["binaryTree"]["assets/glyphs/vip_window.png"])
        assertNull(snapshot()["tree"]["assets/glyphs/vip_window.yml"])
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" })
    }

    @Test
    fun `the MCP endpoint writes to a server's disk only through a publication, for a principal that may deploy`() {
        assertEquals(setOf("list", "read", "create", "update", "write_blob", "publish"), McpProjects.DRAFT_ACTIONS)
        val projects = McpProjects(Servers(server), null, drafts)
        val shop = ProjectRef(server, "shop")
        assertFailsWith<IllegalArgumentException> { projects.draft(McpPrincipal(player, "Iban", EditorPermissions.ALL.toSet()), shop, "discard") }
        val draftOnly = McpPrincipal(player, "Iban", EditorPermissions.ALL.toSet() - EditorPermissions.PUBLISH)
        assertEquals("forbidden", assertFailsWith<McpRefusal> { projects.draft(draftOnly, shop, "publish") }.code)
        // No MCP or assistant source names a message that writes to a server's disk: a publication is built by the drafts.
        val dir = listOf("src/main/kotlin/net/artisanmc/plugin/hub", "hub/src/main/kotlin/net/artisanmc/plugin/hub").map(::File).first { it.isDirectory }
        val sources = dir.listFiles { f -> f.name.startsWith("Mcp") || f.name.startsWith("Ai") || f.name.startsWith("Anthropic") }!!
        assertTrue(sources.size >= 8)
        for (file in sources) {
            val text = file.readText()
            for (forbidden in listOf("project_write", "project_draft_publish", "template_copy", "project_delete", "project_rename")) {
                assertFalse(forbidden in text, "${file.name} names $forbidden")
            }
        }
    }

    @Test
    fun `revoking a client cuts it off on its next call`() {
        val (access, _) = tokens()
        assertEquals(200, rpc(access, "ping").status)
        val listed = editor("GET", OAuthRoutes.GRANTS).body!!["grants"]
        assertEquals("Claude", listed[0]["client"].asText())
        assertEquals(200, editor("DELETE", "${OAuthRoutes.GRANTS}/${listed[0]["id"].asText()}").status)
        assertEquals(401, rpc(access, "ping").status)
    }

    @Test
    fun `losing artisan editor edit cuts access, losing view ends the grant`() {
        val (access, _) = tokens()
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW)))
        val answer = rpc(access, "ping")
        assertEquals(403, answer.status)
        assertTrue(answer.headers.firstValue("WWW-Authenticate").get().contains("insufficient_scope"))
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW, EditorPermissions.EDIT, EditorPermissions.PUBLISH)))
        assertEquals(200, rpc(access, "ping").status)
        assertFalse(grants.grants(player).single().can(EditorPermissions.PUBLISH), "an MCP client is draft only by default")
        sessions.refresh("u-local", mapOf(player to emptySet()))
        assertEquals(401, rpc(access, "ping").status)
        assertTrue(grants.grants(player).isEmpty())
    }

    @Test
    fun `a code needs its verifier, works once, and a refresh token rotates`() {
        val clientId = registerClient()
        val code = code(clientId)
        val wrong = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to "w".repeat(43))
        assertEquals("invalid_grant", wrong.body!!["error"].asText())
        // A wrong verifier burns the code.
        val retry = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to verifier)
        assertEquals("invalid_grant", retry.body!!["error"].asText())

        val (access, refresh) = tokens(clientId)
        val rotated = form(OAuthRoutes.TOKEN, "grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to clientId)
        assertEquals(200, rotated.status)
        assertEquals(401, rpc(access, "ping").status)
        assertEquals(200, rpc(rotated.body!!["access_token"].asText(), "ping").status)
        assertEquals("invalid_grant", form(OAuthRoutes.TOKEN, "grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to clientId).body!!["error"].asText())
    }

    @Test
    fun `an app the player allowed shows the diff, deploys the reviewed revision as theirs via the app, and rolls back`() {
        val (access, _) = tokens(publish = true)
        val names = rpc(access, "tools/list").body!!["result"]["tools"]
        val publish = names.first { it["name"].asText() == "draft_publish" }
        assertTrue(publish["annotations"]["destructiveHint"].asBoolean())
        assertTrue(names.any { it["name"].asText() == "version_rollback" })
        assertTrue(tool(access, "artisan_overview")["structuredContent"]["can_deploy"].asBoolean())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: vip")["structuredContent"]["draft_id"].asText()
        tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/shop.yml", "content" to "schema: menu/v1\ntitle: Shop\n")
        // A stale revision deploys nothing.
        val stale = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 1)
        assertEquals("draft_conflict", stale["structuredContent"]["error"].asText())
        val preview = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 2, "dry_run" to true)["structuredContent"]
        assertFalse(preview["deployed"].asBoolean())
        assertEquals("@@ -1,1 +1,2 @@\n schema: menu/v1\n+title: Shop\n", preview["changes"][0]["diff"].asText())
        assertTrue(sent.none { it["type"] == "project_draft_publish" }, "a dry run deploys nothing")

        val deployed = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 2)
        assertFalse(deployed.has("isError"), deployed.toString())
        val result = deployed["structuredContent"]
        assertEquals("2", result["version"].asText())
        assertEquals("1", result["previous_version"].asText())
        assertEquals("Iban via Claude", result["published_by"].asText())
        assertEquals("modified", result["changes"][0]["change"].asText())
        val publication = sent.single { it["type"] == "project_draft_publish" }
        assertEquals("Claude", publication["author_via"])
        assertEquals("Iban", publication["author_name"])
        assertEquals("published", mapper.readTree(drafts.rows.getValue(draftId))["status"].asText())
        val versions = tool(access, "list_versions", "project" to "u-local.shop")["structuredContent"]["versions"]
        assertEquals("Iban via Claude", versions[0]["published_by"].asText())

        // Rolling back needs the newest Version the player saw: another deploy since refuses it.
        val raced = tool(access, "version_rollback", "project" to "u-local.shop", "version" to "1", "expected_version" to "1")
        assertEquals("version_conflict", raced["structuredContent"]["error"].asText())
        val rolled = tool(access, "version_rollback", "project" to "u-local.shop", "version" to "1", "expected_version" to "2")["structuredContent"]
        assertEquals("3", rolled["version"].asText())
        assertEquals("1", rolled["restored_from"].asText())
        assertEquals("@@ -1,2 +1,1 @@\n schema: menu/v1\n-title: Shop\n", rolled["changes"].first { it["path"].asText() == "menus/shop.yml" }["diff"].asText())
        assertEquals("schema: menu/v1\n", history.versions.last().files["menus/shop.yml"])
        assertEquals("1", history.versions.last().restoredFrom)
    }

    @Test
    fun `an app the player allowed creates an empty module, and only one with a valid new name`() {
        val (draftOnly, _) = tokens()
        assertFalse(rpc(draftOnly, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "create_module" })
        assertFalse(tool(draftOnly, "artisan_overview")["structuredContent"]["can_create_modules"].asBoolean())

        val (access, _) = tokens(publish = true)
        val create = rpc(access, "tools/list").body!!["result"]["tools"].first { it["name"].asText() == "create_module" }
        assertFalse(create["annotations"]["destructiveHint"].asBoolean())
        val created = tool(access, "create_module", "server" to "u-local", "name" to "ia")["structuredContent"]
        assertEquals("u-local.ia", created["project"].asText())
        assertEquals("ia", sent.single { it["type"] == "project_create" }["project_id"])
        assertEquals("project_exists", tool(access, "create_module", "server" to "u-local", "name" to "shop")["structuredContent"]["error"].asText())
        assertEquals("invalid_name", tool(access, "create_module", "server" to "u-local", "name" to "../x")["structuredContent"]["error"].asText())
        assertEquals("unknown_server", tool(access, "create_module", "server" to "nope", "name" to "x")["structuredContent"]["error"].asText())
        assertEquals(2, sent.count { it["type"] == "project_create" })
    }

    @Test
    fun `an app asks the server's image model only once the player allowed it, and cuts the picture it got`() {
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/gem.png" to net.artisanmc.plugin.pack.Png.encode(net.artisanmc.plugin.pack.RgbaImage(8, 8))))
        val (access, _) = tokens()
        fun names() = rpc(access, "tools/list").body!!["result"]["tools"].map { it["name"].asText() }
        fun generate(vararg args: Pair<String, Any?>) = tool(access, "generate_image", *args)

        // Not offered, and refused when called anyway: the server's owner pays for each picture.
        assertFalse("generate_image" in names())
        val refused = generate("prompt" to "a red square on nothing")
        assertEquals("forbidden", refused["structuredContent"]["error"].asText())
        assertTrue("Settings → AI apps" in refused["structuredContent"]["message"].asText())
        assertFalse(tool(access, "artisan_overview")["structuredContent"]["can_generate_images"].asBoolean())
        assertTrue(imageModel.asked.isEmpty())

        val listed = editor("GET", OAuthRoutes.GRANTS).body!!
        assertTrue(listed["canImages"].asBoolean())
        assertFalse(listed["grants"][0]["images"].asBoolean())
        val grant = listed["grants"][0]["id"].asText()
        val allowed = editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("images" to true))
        assertEquals(200 to """{"ok":true,"images":true}""", allowed.status to allowed.body.toString())
        assertTrue(editor("GET", OAuthRoutes.GRANTS).body!!["grants"][0]["images"].asBoolean())
        assertFalse(editor("GET", OAuthRoutes.GRANTS).body!!["grants"][0]["publish"].asBoolean(), "one choice does not move the other")
        assertTrue("generate_image" in names())
        assertTrue(tool(access, "artisan_overview")["structuredContent"]["can_generate_images"].asBoolean())

        // A model that makes no transparent background is asked for a flat one; a small reference is enlarged for it.
        val made = generate(
            "prompt" to "a red square, pixel art", "shape" to "wide", "transparent" to true,
            "references" to listOf(mapOf("project" to "u-local.shop", "path" to "assets/textures/gem.png")),
        )
        assertFalse(made.has("isError"), made.toString())
        val facts = made["structuredContent"]
        assertEquals(listOf("generated-1.png", "64", "64", "scripted-image"), listOf("picture", "width", "height", "model").map { facts[it].asText() })
        assertTrue("magenta" in facts["background"].asText())
        assertEquals("image", made["content"][1]["type"].asText())
        val request = imageModel.asked.single()
        assertTrue(request.prompt.startsWith("a red square, pixel art\n\n") && "#ff00ff" in request.prompt, request.prompt)
        assertEquals(ImageRequest.Shape.WIDE to false, request.shape to request.transparent)
        assertEquals("reference-1.png", request.references.single().name)
        assertEquals(128, net.artisanmc.plugin.pack.Png.decode(request.references.single().png).width)

        // The picture is no module's file: it is measured and cut by the name it came back under.
        val measured = tool(access, "measure_image", "attachment" to "generated-1.png")
        assertEquals("""[{"n":1,"x":16,"y":16,"width":32,"height":32,"art_size":"8x8"}]""", measured["structuredContent"]["elements"].toString())
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: picture")["structuredContent"]["draft_id"].asText()
        val cut = tool(
            access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "red_square",
            "from" to mapOf("attachment" to "generated-1.png", "x" to 8, "y" to 8, "width" to 48, "height" to 48, "background" to "remove"),
        )
        assertFalse(cut.has("isError"), cut.toString())
        assertEquals(listOf(8, 8), listOf("width", "height").map { cut["structuredContent"][it].asInt() })
        assertTrue("assets/textures/red_square.png" in mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["binaryTree"].fieldNames().asSequence().toList())

        // A model that makes one is asked for it, with the prompt as written.
        imageModel.transparency = true
        assertEquals("transparent", generate("prompt" to "a blue circle, alone", "transparent" to true)["structuredContent"]["background"].asText())
        assertEquals(Triple("a blue circle, alone", ImageRequest.Shape.SQUARE, true), imageModel.asked.last().let { Triple(it.prompt, it.shape, it.transparent) })
        assertEquals("filled", generate("prompt" to "a painted night sky")["structuredContent"]["background"].asText())

        // What is wrong in the call never reaches the model; a picture the model did not make is not counted.
        assertTrue(generate("prompt" to "short")["isError"].asBoolean())
        assertTrue(generate("prompt" to "a red square on nothing", "shape" to "round")["isError"].asBoolean())
        assertTrue(generate("prompt" to "a red square on nothing", "references" to List(5) { mapOf("attachment" to "generated-1.png") })["isError"].asBoolean())
        assertTrue(generate("prompt" to "a red square on nothing", "references" to listOf(mapOf("attachment" to "nope.png")))["isError"].asBoolean())
        assertEquals(3, imageModel.asked.size)
        imageModel.failure = AiFailure("ai_image_refused", "api.example refused the request: not that")
        val failed = generate("prompt" to "something it refuses")
        assertEquals("ai_image_refused" to "api.example refused the request: not that", failed["structuredContent"].let { it["error"].asText() to it["message"].asText() })
        imageModel.failure = null

        // Four pictures a day here: the fifth waits for tomorrow, whichever app asks.
        assertFalse(generate("prompt" to "the last of the day").has("isError"))
        val limited = generate("prompt" to "one picture too many")
        assertEquals("ai_image_limit", limited["structuredContent"]["error"].asText())
        assertEquals(5, imageModel.asked.size)
        val (other, _) = tokens(images = true)
        assertEquals("ai_image_limit", tool(other, "generate_image", "prompt" to "from another app")["structuredContent"]["error"].asText())
        assertEquals(listOf("generated-1.png", "generated-2.png", "generated-3.png", "generated-4.png"), hubPictures())

        // Taken back, the app is refused on its next call.
        assertEquals(200, editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("images" to false)).status)
        assertFalse("generate_image" in names())
        assertEquals("forbidden", generate("prompt" to "a red square on nothing")["structuredContent"]["error"].asText())
        assertEquals(422, editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("images" to "yes")).status)
    }

    /** The names of the pictures the hub keeps for the player, as the editor asks for them. */
    private fun hubPictures(): List<String> = (1..5).map { "generated-$it.png" }.filter {
        client.send(
            HttpRequest.newBuilder(URI("$base${AiRoutes.GENERATED}/$it")).header("Cookie", cookie).build(), HttpResponse.BodyHandlers.ofByteArray(),
        ).statusCode() == 200
    }

    @Test
    fun `an app is draft only unless the player allows it, and allowing takes the player's own publish`() {
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI")["structuredContent"]["draft_id"].asText()
        // Not offered, and refused when called anyway.
        val refused = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 1)
        assertEquals("forbidden", refused["structuredContent"]["error"].asText())
        assertFalse(tool(access, "artisan_overview")["structuredContent"]["can_deploy"].asBoolean())

        val listed = editor("GET", OAuthRoutes.GRANTS).body!!
        assertTrue(listed["canPublish"].asBoolean())
        assertFalse(listed["grants"][0]["publish"].asBoolean())
        val grant = listed["grants"][0]["id"].asText()
        assertEquals(200, editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("publish" to true)).status)
        assertTrue(rpc(access, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "draft_publish" })
        assertEquals(404, editor("PATCH", "${OAuthRoutes.GRANTS}/nope", mapOf("publish" to true)).status)

        // A player who cannot deploy cannot let an app deploy, and an app allowed before loses it with them.
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW, EditorPermissions.EDIT)))
        assertFalse(rpc(access, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "draft_publish" })
        // The editor session follows the same report: the player's own consent page no longer offers deploying.
        assertEquals(403, editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("publish" to true)).status)
        tokens(publish = true)
        assertEquals(2, grants.grants(player).size)
        assertTrue(grants.grants(player).none { it.can(EditorPermissions.PUBLISH) })
    }

    @Test
    fun `registration takes https or loopback redirects only`() {
        for (uri in listOf("http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag")) {
            val answer = http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("redirect_uris" to listOf(uri))))
            assertEquals(400, answer.status, uri)
        }
        assertEquals(201, http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("redirect_uris" to listOf("http://127.0.0.1:6274/oauth/callback")))).status)
        // An unknown client is never redirected to: the editor page says so.
        val unknown = http("GET", "${OAuthRoutes.AUTHORIZE}?client_id=nope&redirect_uri=https://evil.example/cb")
        assertEquals("${OAuthRoutes.CONSENT_PAGE}?error=invalid_client", unknown.headers.firstValue("Location").get())
    }

    @Test
    fun `another site cannot use the editor cookie on the MCP endpoint or the consent`() {
        val foreign = mapOf("Cookie" to cookie, "Origin" to "https://evil.example")
        assertEquals(401, rpc(null, "ping", headers = foreign).status)
        assertEquals(200, rpc(null, "ping", headers = mapOf("Cookie" to cookie)).status)
        val clientId = registerClient()
        val consent = http("POST", OAuthRoutes.CONSENT, mapper.writeValueAsString(mapOf("client_id" to clientId, "redirect_uri" to redirect, "approve" to true, "code_challenge" to McpGrants.challenge(verifier))),
            foreign + ("Content-Type" to "application/json"))
        assertEquals(403, consent.status)
        assertNotNull(grants.client(clientId))
        assertTrue(grants.grants(player).isEmpty())
    }
}
